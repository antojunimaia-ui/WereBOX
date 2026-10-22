// tools/instalar-mouse.mjs — deixa o C: pronto para o mouse: acrescenta
// "MOUSE.COM" ao AUTOEXEC.BAT do disco (o driver em si JA esta' em C:\DOS,
// copiado da ISO pelo proprio DOS).
//
// Por que so' o AUTOEXEC: o v86 emula o mouse PS/2 (porta 8042) e o MOUSE.COM
// do MS-DOS 6.22 detecta sozinho -- nao ha' nada a configurar do lado do PC.
// Quem confirma isso e' o tools de teste e a bancada, olhando o vetor INT 33h.
//
// O arquivo e' mexido em memoria e so' vai para o disco depois de passar por
// uma conferencia (arquivo legivel, arvore intacta, alocacao consistente):
// se qualquer coisa sair errada, o c.img fica como estava.
//
// uso:  node tools/instalar-mouse.mjs [caminho-do-img]   (padrao: Systems/MS-DOS 6.22/c.img)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirFS } from "../ui/fat.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const emu = path.resolve(here, "..");
const padrao = path.resolve(emu, "..", "Systems", "MS-DOS 6.22", "c.img");
const alvo = path.resolve(emu, process.argv[2] || padrao);
const LINHA = "MOUSE.COM";

const ok = (t) => console.log(`   ok    ${t}`);
const mal = (t) => { console.log(`   FALHA ${t}`); falhas++; };
let falhas = 0;

/* ------------------------------------------------------- dispositivo de blocos */
const buf = fs.readFileSync(alvo);
const dev = {
  get: (off, len) => new Uint8Array(buf.buffer, buf.byteOffset + off, len),
  set: (off, bytes) => { new Uint8Array(buf.buffer, buf.byteOffset + off, bytes.length).set(bytes); },
};
const montar = () => abrirFS(dev);
const texto = (u8) => Buffer.from(u8).toString("latin1");

/* ---------------------------------------------------------------- o arquivo */
console.log(`= ${alvo} (${(buf.length / 1048576).toFixed(2)} MB)`);
const fs1 = montar();
const info = fs1.info();
console.log(`   ${info.fsTipo} · rotulo "${info.rotulo}" · ${info.clustersLivres} clusters livres`);

const raiz = fs1.listar(0);
const autoexec = raiz.find((e) => e.nomeCompleto === "AUTOEXEC.BAT");
if (!autoexec) { console.error("nao achei C:\\AUTOEXEC.BAT — esse disco nao parece um C: do reDOS"); process.exit(1); }
const antes = texto(fs1.ler(autoexec));
console.log(`   AUTOEXEC.BAT antes: ${JSON.stringify(antes)}`);

if (new RegExp(`^\\s*${LINHA}\\s*$`, "im").test(antes)) {
  console.log(`\na linha "${LINHA}" ja' estava no AUTOEXEC.BAT — nada a fazer`);
  process.exit(0);
}

// acrescenta a linha no fim, mantendo o resto exatamente como estava (CRLF = DOS)
const linhas = antes.split(/\r?\n/).filter((l) => l.trim() !== "");
linhas.push(LINHA);
const depois = linhas.join("\r\n") + "\r\n";
console.log(`   AUTOEXEC.BAT depois: ${JSON.stringify(depois)}`);

const mbrAntes = Buffer.from(buf.subarray(0, 512));
const contagemAntes = (() => {
  let arquivos = 0, pastas = 0;
  const andar = (c) => { for (const e of fs1.listar(c)) { if (e.atual || e.pai) continue; if (e.diretorio) { pastas++; andar(e.cluster); } else arquivos++; } };
  andar(0);
  return { arquivos, pastas };
})();

/* ------------------------------------------------------------------ a gravacao */
fs1.gravar(0, "AUTOEXEC.BAT", new TextEncoder().encode(depois));

/* ------------------------------------------------------------- a conferencia */
console.log("\n= conferindo o disco depois da gravacao (remontando do zero)");
const fs2 = montar();
const autoexec2 = fs2.listar(0).find((e) => e.nomeCompleto === "AUTOEXEC.BAT");
const lido = texto(fs2.ler(autoexec2));

lido.split(/\r?\n/).filter((l) => l.trim()).every((l) => linhas.includes(l.trim()))
  ? ok("todas as linhas do AUTOEXEC original continuam la'")
  : mal("alguma linha do AUTOEXEC original sumiu");
new RegExp(`^\\s*${LINHA}\\s*$`, "im").test(lido) ? ok(`o AUTOEXEC.BAT agora chama ${LINHA}`) : mal(`${LINHA} nao entrou no AUTOEXEC.BAT`);
fs2.listar(0)[0]?.nomeCompleto === "IO.SYS" ? ok("IO.SYS continua a primeira entrada (disco bootavel)") : mal("a raiz mudou de ordem");
Buffer.from(buf.subarray(0, 512)).equals(mbrAntes) ? ok("o MBR (setor 0) nao foi tocado") : mal("o MBR mudou");

// o driver tem que estar em C:\DOS, identico ao extraido da ISO
const dos = fs2.listar(0).find((e) => e.diretorio && e.nome === "DOS");
const listaDos = dos ? fs2.listar(dos.cluster).filter((e) => !e.atual && !e.pai) : [];
const arquivosDos = listaDos.filter((e) => !e.diretorio);
const driver = listaDos.find((e) => e.nomeCompleto === "MOUSE.COM");
const doRepo = fs.readFileSync(path.resolve(emu, "..", "Systems", "MS-DOS 6.22", "extracted", "MOUSE.COM"));
driver ? ok(`C:\\DOS\\MOUSE.COM presente (${driver.tamanho} bytes)`) : mal("C:\\DOS\\MOUSE.COM nao esta' no disco");
driver && Buffer.from(fs2.ler(driver)).equals(doRepo) ? ok("MOUSE.COM identico ao extraido da ISO") : mal("MOUSE.COM difere do extraido da ISO");

// arvore e alocacao: mesma contagem de antes, nenhum cluster perdido ou repetido
let arquivos = 0, pastas = 0;
const usados = new Set();
const problemas = [];
const andar = (c, prefixo) => {
  for (const e of fs2.listar(c)) {
    if (e.atual || e.pai) continue;
    const nome = `${prefixo}\\${e.nomeCompleto}`;
    for (const cl of fs2.cadeia(e.cluster)) { if (usados.has(cl)) problemas.push(`cluster ${cl} usado duas vezes (${nome})`); usados.add(cl); }
    if (e.diretorio) { pastas++; andar(e.cluster, nome); }
    else {
      arquivos++;
      const esperado = Math.ceil(e.tamanho / fs2.info().bytesPorCluster);
      const tem = fs2.cadeia(e.cluster).length;
      if (tem !== esperado) problemas.push(`${nome}: ${tem} clusters para ${e.tamanho} bytes`);
    }
  }
};
andar(0, "C:");

problemas.length === 0 ? ok("alocacao consistente depois da gravacao") : mal(problemas.slice(0, 3).join(" | "));
usados.size + fs2.info().clustersLivres === fs2.info().clusters
  ? ok(`usados + livres = total (${usados.size} + ${fs2.info().clustersLivres} = ${fs2.info().clusters})`)
  : mal("a contabilidade de clusters nao fecha");
arquivos === contagemAntes.arquivos && pastas === contagemAntes.pastas
  ? ok(`a arvore nao cresceu (${arquivos} arquivos, ${pastas} pasta(s))`)
  : mal(`a arvore mudou (${contagemAntes.arquivos}/${contagemAntes.pastas} -> ${arquivos}/${pastas})`);
arquivosDos.length === 40 ? ok("C:\\DOS continua com 40 arquivos") : mal(`C:\\DOS tem ${arquivosDos.length} arquivos (esperado 40)`);

/* ------------------------------------------------------------------- gravacao */
if (falhas) {
  console.error(`\n${falhas} conferencia(s) falharam — o ${path.basename(alvo)} NAO foi alterado`);
  process.exit(1);
}
fs.writeFileSync(alvo, buf);
console.log(`\n${path.basename(alvo)} gravado`);
console.log("  o driver carrega sozinho no boot (AUTOEXEC.BAT) e assume o INT 33h");
console.log("  confira com:  cd emulator && npm run test:fat");

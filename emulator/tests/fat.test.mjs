// tests/fat.test.mjs — prova o ui/fat.mjs contra a NOSSA imagem real
// (Systems/MS-DOS 6.22/c.img), sem navegador. Depois faz escrita num COPIA em
// memoria e confere a consistencia da alocacao (nenhum cluster perdido,
// nenhum arquivo quebrado).
//
//   node tests/fat.test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirFS, normalizar83, dataDOS } from "../ui/fat.mjs";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const emu = path.resolve(aqui, "..");
const raizRepo = path.resolve(emu, "..");
const pastaDos = path.join(raizRepo, "Systems", "MS-DOS 6.22");

let ok = 0, falhas = 0;
const check = (cond, msg) => {
  if (cond) { ok++; console.log(`   ok    ${msg}`); }
  else { falhas++; console.log(`   FALHA ${msg}`); }
};
const secao = (t) => console.log(`\n== ${t}`);

/** dispositivo de blocos sobre um Buffer (mesma interface que a imagem viva do v86) */
function dispositivo(buffer) {
  let leituras = 0, escritas = 0;
  return {
    get: (off, len) => { leituras++; return new Uint8Array(buffer.buffer, buffer.byteOffset + off, len); },
    set: (off, bytes) => { escritas++; new Uint8Array(buffer.buffer, buffer.byteOffset + off, bytes.length).set(bytes); },
    contadores: () => ({ leituras, escritas }),
  };
}

/** anda a arvore inteira e soma os clusters que deveriam estar alocados */
function auditar(fs) {
  const usados = new Set();
  const problemas = [];
  let arquivos = 0, pastas = 0, bytes = 0;
  const visitar = (cluster, caminho) => {
    let entradas;
    try { entradas = fs.listar(cluster); } catch (e) { problemas.push(`${caminho}: ${e.message}`); return; }
    for (const e of entradas) {
      if (e.atual || e.pai) continue;
      const nome = `${caminho}\\${e.nomeCompleto}`;
      if (e.diretorio) {
        pastas++;
        for (const c of fs.cadeia(e.cluster)) { if (usados.has(c)) problemas.push(`cluster ${c} usado duas vezes (${nome})`); usados.add(c); }
        visitar(e.cluster, nome);
      } else {
        arquivos++;
        bytes += e.tamanho;
        let soma = 0;
        for (const c of fs.cadeia(e.cluster)) {
          if (usados.has(c)) problemas.push(`cluster ${c} usado duas vezes (${nome})`);
          usados.add(c); soma++;
        }
        const esperado = Math.ceil(e.tamanho / fs.info().bytesPorCluster);
        if (soma !== esperado) problemas.push(`${nome}: ${soma} clusters para ${e.tamanho} bytes (esperado ${esperado})`);
      }
    }
  };
  visitar(0, "C:");
  return { usados, problemas, arquivos, pastas, bytes };
}

// --------------------------------------------------------------------- montagem
secao("montando Systems/MS-DOS 6.22/c.img");
const original = fs.readFileSync(path.join(pastaDos, "c.img"));
const bytes = new Uint8Array(original); // copia em memoria (nao mexe no arquivo)
const dev = dispositivo(bytes);
const fsC = abrirFS(dev);
const info = fsC.info();

console.log(`   ${info.fsTipo} · rotulo "${info.rotulo}" · OEM "${info.oem}" · serial ${info.serial.toString(16)}`);
console.log(`   ${info.bytesPorSetor} B/setor · ${info.bytesPorCluster} B/cluster · ${info.clusters} clusters`);
console.log(`   particao: lba ${info.particao?.lba} tipo 0x${info.particao?.tipo.toString(16)} ativa=${info.particao?.ativa} · base ${info.base}`);
console.log(`   livre ${(info.bytesLivres / 1048576).toFixed(2)} MB de ${(info.bytesTotal / 1048576).toFixed(2)} MB`);

check(info.rotulo === "REDOS", "rotulo do volume e REDOS");
check(info.particao && info.particao.lba === 63, "particao 1 comeca no LBA 63");
check(info.particao.ativa === true, "particao esta ativa (bootavel)");
check(info.base === 63 * 512, "o FS comeca no byte 32256");
check(info.bytesPorSetor === 512, "512 bytes por setor");
check(info.fsTipo === "FAT12" || info.fsTipo === "FAT16", `tipo detectado: ${info.fsTipo}`);
check(info.clusters > 3000, `clusters plausiveis (${info.clusters})`);

// --------------------------------------------------------------------- raiz
secao("raiz do C:");
const raiz = fsC.listar(0);
console.log("   " + raiz.map((e) => e.nomeCompleto + (e.diretorio ? "\\" : "")).join("  "));
const porNome = (lista, n) => lista.find((e) => e.nomeCompleto === n);
check(raiz[0]?.nomeCompleto === "IO.SYS", "IO.SYS e a primeira entrada (disco bootavel)");
check(raiz[1]?.nomeCompleto === "MSDOS.SYS", "MSDOS.SYS e a segunda");
check(!!porNome(raiz, "COMMAND.COM"), "COMMAND.COM na raiz");
check(!!raiz.find((e) => e.diretorio && e.nome === "DOS"), "pasta DOS na raiz");
check(!!porNome(raiz, "CONFIG.SYS"), "CONFIG.SYS na raiz");
check(!!porNome(raiz, "AUTOEXEC.BAT"), "AUTOEXEC.BAT na raiz");
check(!raiz.some((e) => e.volume), "o rotulo do volume nao aparece como arquivo");

const config = fsC.ler(porNome(raiz, "CONFIG.SYS"));
const autoexec = fsC.ler(porNome(raiz, "AUTOEXEC.BAT"));
const str = (u8) => Buffer.from(u8).toString("latin1");
console.log("   CONFIG.SYS:  " + JSON.stringify(str(config)));
console.log("   AUTOEXEC.BAT: " + JSON.stringify(str(autoexec)));
check(str(config).includes("HIMEM.SYS"), "CONFIG.SYS carrega o HIMEM.SYS");
check(str(config).includes("CD1.SYS"), "CONFIG.SYS carrega o driver de CD");
check(str(autoexec).includes("MSCDEX"), "AUTOEXEC.BAT monta o MSCDEX");
check(str(autoexec).includes("PATH C:\\DOS"), "AUTOEXEC.BAT poe C:\\DOS no PATH");
check(str(autoexec).includes("MOUSE.COM"), "AUTOEXEC.BAT carrega o driver de mouse no boot");

// --------------------------------------------------------------------- C:\DOS
secao("C:\\DOS");
const dos = raiz.find((e) => e.diretorio && e.nome === "DOS");
const listaDos = fsC.listar(dos.cluster).filter((e) => !e.atual && !e.pai);
const soArquivos = listaDos.filter((e) => !e.diretorio);
console.log(`   ${soArquivos.length} arquivos, ${listaDos.length - soArquivos.length} pastas`);
check(soArquivos.length === 40, `C:\\DOS tem 40 arquivos (achei ${soArquivos.length})`);
check(!!porNome(listaDos, "FORMAT.COM"), "FORMAT.COM esta em C:\\DOS");
check(listaDos.some((e) => e.data), "as entradas tem data (parse do campo do DOS)");
const comData = listaDos.find((e) => e.nomeCompleto === "FORMAT.COM");
console.log(`   FORMAT.COM  ${comData.tamanho} bytes  ${dataDOS(comData.data, comData.hora)}`);

// prova forte: um binario lido do C: tem que ser identico ao arquivo extraido da ISO
const noDisco = fsC.ler(comData);
const noRepo = fs.readFileSync(path.join(pastaDos, "extracted", "FORMAT.COM"));
check(noDisco.length === noRepo.length, `FORMAT.COM do C: tem o mesmo tamanho do extraido (${noDisco.length})`);
check(Buffer.from(noDisco).equals(noRepo), "FORMAT.COM do C: e byte a byte igual ao extraido da ISO");

// o driver de mouse tem que estar no C: (e' o que o AUTOEXEC.BAT carrega no boot)
const mouse = porNome(listaDos, "MOUSE.COM");
check(!!mouse, "MOUSE.COM esta em C:\\DOS (o driver PS/2 do MS-DOS 6.22)");
if (mouse) {
  const doIso = fs.readFileSync(path.join(pastaDos, "extracted", "MOUSE.COM"));
  check(mouse.tamanho === 56408, `MOUSE.COM tem os 56.408 bytes de sempre (${mouse.tamanho})`);
  check(Buffer.from(fsC.ler(mouse)).equals(doIso), "MOUSE.COM do C: e byte a byte igual ao extraido da ISO");
}

// --------------------------------------------------------------------- auditoria
secao("auditando a alocacao (nada perdido, nada duplicado)");
const antes = auditar(fsC);
const { leituras, escritas } = dev.contadores();
console.log(`   ${antes.arquivos} arquivos, ${antes.pastas} pastas, ${(antes.bytes / 1048576).toFixed(2)} MB`);
console.log(`   ${antes.usados.size} clusters em uso · ${info.clustersLivres} livres · ${info.clusters} no total`);
console.log(`   acesso ao dispositivo: ${leituras} leituras, ${escritas} escritas`);
check(antes.problemas.length === 0, `alocacao consistente${antes.problemas.length ? " -> " + antes.problemas.slice(0, 4).join(" | ") : ""}`);
check(antes.usados.size + info.clustersLivres === info.clusters, `usados + livres = total (${antes.usados.size} + ${info.clustersLivres} = ${info.clusters})`);
check(escritas === 0, "a leitura pura nao escreveu nada no disco");

// --------------------------------------------------------------------- escrita
secao("escrita num copia em memoria: criar, ler de volta, pasta, apagar");
const mbrAntes = bytes.slice(0, 512);
const conteudo = new TextEncoder().encode("reDOS: arquivo de teste gravado por fora do DOS.\r\n".repeat(200));
const criado = fsC.gravar(0, "TESTE.TXT", conteudo);
check(!!criado && criado.nomeCompleto === "TESTE.TXT", "TESTE.TXT criado na raiz");
check(criado.tamanho === conteudo.length, `tamanho gravado bate (${criado.tamanho})`);

// remonta do zero sobre o MESMO buffer (como se o DOS tivesse lido do disco depois)
const fs2 = abrirFS(dispositivo(bytes));
const lido = fs2.ler(fs2.listar(0).find((e) => e.nomeCompleto === "TESTE.TXT"));
check(lido.length === conteudo.length, "relido do disco com o mesmo tamanho");
check(Buffer.from(lido).equals(Buffer.from(conteudo)), "relido do disco byte a byte igual");
check(bytes.slice(0, 512).every((b, i) => b === mbrAntes[i]), "o MBR (setor 0) continua intacto");

const pasta = fs2.criarPasta(0, "NOVADIR");
check(!!pasta && pasta.diretorio, "NOVADIR criada");
const dentro = fs2.gravar(pasta.cluster, "OI.TXT", new TextEncoder().encode("oi"));
check(!!dentro, "OI.TXT gravado dentro de NOVADIR");
const fs3 = abrirFS(dispositivo(bytes));
const ldir = fs3.listar(fs3.listar(0).find((e) => e.nome === "NOVADIR").cluster);
check(ldir.some((e) => e.atual), "NOVADIR tem entrada '.'");
check(ldir.some((e) => e.pai), "NOVADIR tem entrada '..'");
check(ldir.some((e) => e.nomeCompleto === "OI.TXT"), "OI.TXT esta dentro de NOVADIR");
check(fs3.ler(ldir.find((e) => e.nomeCompleto === "OI.TXT")).toString() === "111,105", "OI.TXT relido com os bytes certos (111,105 = 'oi')");

const livresDepoisDeEscrever = fs3.info().clustersLivres;
check(livresDepoisDeEscrever < info.clustersLivres, `o espaco livre diminuiu (${info.clustersLivres} -> ${livresDepoisDeEscrever})`);

// apagar a pasta inteira (recursivo) e o arquivo grande
fs3.apagar(0, fs3.listar(0).find((e) => e.nome === "NOVADIR"));
fs3.apagar(0, fs3.listar(0).find((e) => e.nomeCompleto === "TESTE.TXT"));
const fs4 = abrirFS(dispositivo(bytes));
check(!fs4.listar(0).some((e) => e.nome === "NOVADIR"), "NOVADIR apagada");
check(!fs4.listar(0).some((e) => e.nomeCompleto === "TESTE.TXT"), "TESTE.TXT apagado");
check(fs4.info().clustersLivres === info.clustersLivres, `o espaco livre voltou ao original (${fs4.info().clustersLivres})`);

const depois = auditar(fs4);
check(depois.problemas.length === 0, `depois de escrever/apagar a alocacao continua consistente${depois.problemas.length ? " -> " + depois.problemas.slice(0, 4).join(" | ") : ""}`);
check(depois.usados.size + fs4.info().clustersLivres === fs4.info().clusters, "usados + livres = total depois de tudo");
check(depois.arquivos === antes.arquivos && depois.pastas === antes.pastas, `a arvore voltou ao original (${depois.arquivos} arquivos, ${depois.pastas} pastas)`);

// --------------------------------------------------------------------- nomes
secao("nomes 8.3");
const valor = (fn) => { try { return fn(); } catch (e) { return "ERRO: " + e.message; } };
check(valor(() => normalizar83("edit.ini").completo) === "EDIT.INI", 'normalizar83("edit.ini") = EDIT.INI');
check(valor(() => normalizar83("a.b").ext) === "B", "extensao curta ok");
const erro = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
check(!!erro(() => normalizar83("nomegrandedemais.txt")), "nome com mais de 8 caracteres e recusado");
check(!!erro(() => normalizar83("nome.toolong")), "extensao com mais de 3 e recusada");
check(!!erro(() => normalizar83("nao/vale.txt")), "barra no nome e recusada");
const pequeno = fsC.gravar(0, "SUBST.TXT", new Uint8Array(10));
const grande = fsC.gravar(0, "SUBST.TXT", new Uint8Array(5000)); // regravar = substituir
check(pequeno && grande && grande.tamanho === 5000, "regravar o mesmo nome substitui o arquivo");
check(fsC.ler(grande).length === 5000, "o arquivo substituido tem o tamanho novo");
check(fsC.listar(0).filter((e) => e.nomeCompleto === "SUBST.TXT").length === 1, "nao sobrou entrada duplicada");
fsC.apagar(0, fsC.listar(0).find((e) => e.nomeCompleto === "SUBST.TXT"));
check(erro(() => fsC.gravar(0, "DOS", new Uint8Array(1))) !== null, "nao deixa gravar arquivo com o nome de uma pasta");

console.log(`\n${ok} ok, ${falhas} falhas`);
process.exit(falhas ? 1 : 0);

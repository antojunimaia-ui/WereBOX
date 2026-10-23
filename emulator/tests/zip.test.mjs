// tests/zip.test.mjs — prova o extrator de ZIP contra imagens FAT de verdade.
//
//   node tests/zip.test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirFS } from "../ui/fat.mjs";
import { analisarZip, ehZip, ErroZip, extrairZipParaDisco } from "../ui/zip.mjs";
import { criarZip } from "./zip-helper.mjs";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const emu = path.resolve(aqui, "..");
const raiz = path.resolve(emu, "..");
const imagemA = fs.readFileSync(path.join(raiz, "Systems", "Windows 1.01", "win101.img"));

let ok = 0, falhas = 0;
const check = (cond, msg) => {
  if (cond) { ok++; console.log(`   ok    ${msg}`); }
  else { falhas++; console.log(`   FALHA ${msg}`); }
};
const secao = (t) => console.log(`\n== ${t}`);

function dispositivo(buffer) {
  return {
    get: (off, len) => new Uint8Array(buffer.buffer, buffer.byteOffset + off, len),
    set: (off, bytes) => {
      new Uint8Array(buffer.buffer, buffer.byteOffset + off, bytes.length).set(bytes);
    },
  };
}

/** copia nova do disquete do Windows 1.01 (1,44 MB, FAT12, ~248 KB livres) */
function novaA() {
  const bytes = new Uint8Array(imagemA);
  return { bytes, fs: abrirFS(dispositivo(bytes)) };
}

const nomes = (fs, cluster = 0) => fs.listar(cluster)
  .filter((e) => !e.atual && !e.pai)
  .map((e) => e.nomeCompleto)
  .sort();
const achar = (fs, nome, cluster = 0) => fs.listar(cluster)
  .find((e) => !e.diretorio && e.nomeCompleto === nome);
const ler = (fs, nome, cluster = 0) => {
  const e = achar(fs, nome, cluster);
  return e ? fs.ler(e) : null;
};
const pasta = (fs, nome, cluster = 0) => fs.listar(cluster)
  .find((e) => e.diretorio && !e.atual && !e.pai && e.nomeCompleto === nome);
const texto = (b) => Buffer.from(b).toString("utf8");
async function erroDe(fn) {
  try { await fn(); return null; }
  catch (e) { return e; }
}

// --------------------------------------------------------------------- deteccao
secao("detecção");
const zipStore = criarZip([{ nome: "LEIAME.TXT", dados: "olá zip\n" }]);
check(ehZip(zipStore), "reconhece ZIP com cabeçalho local");
check(ehZip(criarZip([])), "reconhece ZIP vazio (só EOCD)");
check(!ehZip(new TextEncoder().encode("MZ um executável")), "não confunde EXE com ZIP");
check(!ehZip(new Uint8Array(0)), "bytes vazios não são ZIP");

const analise = analisarZip(zipStore);
check(analise.entradas.length === 1, "uma entrada no diretório central");
check(analise.entradas[0].nome === "LEIAME.TXT", "nome da entrada");
check(analise.entradas[0].metodo === 0, "método store");
check(analise.entradas[0].descomprimido === new TextEncoder().encode("olá zip\n").length, "tamanho descompactado");
check(!analise.entradas[0].diretorio && !analise.entradas[0].criptografado, "entrada normal, sem senha");

const zipComentario = criarZip([{ nome: "C.TXT", dados: "c" }], { comentario: "comentário de teste" });
check(analisarZip(zipComentario).comentario === "comentário de teste", "comentário do EOCD é lido");

const zipLixo = new Uint8Array([...criarZip([{ nome: "L.TXT", dados: "l" }]), 0x00, 0x01]);
check(analisarZip(zipLixo).entradas[0].nome === "L.TXT", "EOCD com lixo depois ainda é encontrado");

// --------------------------------------------------------------------- store
secao("extração store");
{
  const { fs: fsA } = novaA();
  const dados = new TextEncoder().encode("conteudo store\n");
  const zip = criarZip([{ nome: "LEIAME.TXT", dados }]);
  const r = await extrairZipParaDisco(zip, fsA, 0);
  check(r.arquivos === 1 && r.pastas === 0, "store: contagem de arquivos/pastas");
  check(r.bytes === dados.length, "store: bytes extraídos");
  check(texto(ler(fsA, "LEIAME.TXT")) === "conteudo store\n", "store: conteúdo confere");
  check(!nomes(fsA).includes("LEIAME.ZIP"), "store: o ZIP não fica no disco");
}

// --------------------------------------------------------------------- deflate
secao("extração deflate");
{
  const { fs: fsA } = novaA();
  const grande = new Uint8Array(20000);
  for (let i = 0; i < grande.length; i++) grande[i] = 65 + (i % 26);
  const zip = criarZip([{ nome: "GRANDE.BIN", dados: grande, metodo: 8 }]);
  const r = await extrairZipParaDisco(zip, fsA, 0);
  check(r.arquivos === 1 && r.bytes === grande.length, "deflate: contagem e tamanho");
  check(zip.length < grande.length, "deflate: o ZIP é menor que o conteúdo");
  check(Buffer.from(ler(fsA, "GRANDE.BIN")).equals(Buffer.from(grande)), "deflate: conteúdo confere");
}

// --------------------------------------------------------------------- pastas
secao("pastas e diretórios");
{
  const { fs: fsA } = novaA();
  const zip = criarZip([
    { nome: "docs/nota.txt", dados: "nota" },
    { nome: "docs/sub/mais.txt", dados: "mais" },
  ]);
  const r = await extrairZipParaDisco(zip, fsA, 0);
  check(r.arquivos === 2 && r.pastas === 2, "pastas: contagem");
  const docs = pasta(fsA, "DOCS");
  check(!!docs, "DOCS criada");
  const sub = docs && pasta(fsA, "SUB", docs.cluster);
  check(!!sub, "DOCS/SUB criada");
  check(!!docs && texto(ler(fsA, "NOTA.TXT", docs.cluster)) === "nota", "DOCS/NOTA.TXT");
  check(!!sub && texto(ler(fsA, "MAIS.TXT", sub.cluster)) === "mais", "DOCS/SUB/MAIS.TXT");
}
{
  const { fs: fsA } = novaA();
  const zip = criarZip([{ nome: "vazia/", dados: new Uint8Array(0) }]);
  const r = await extrairZipParaDisco(zip, fsA, 0);
  check(r.arquivos === 0 && r.pastas === 1, "diretório explícito: contagem");
  check(!!pasta(fsA, "VAZIA"), "diretório explícito criado");
}

// --------------------------------------------------------------------- nomes 8.3
secao("nomes 8.3, colisão e reservados");
{
  const { fs: fsA } = novaA();
  const zip = criarZip([
    { nome: "relatorio.final.docx", dados: "a" },
    { nome: "a.txt", dados: "b" },
    { nome: "A.TXT", dados: "c" },
    { nome: "con.exe", dados: "d" },
  ]);
  const r = await extrairZipParaDisco(zip, fsA, 0);
  check(r.arquivos === 4, "quatro arquivos gravados");
  check(!!achar(fsA, "RELATORI.DOC"), "nome comprido vira 8.3");
  check(!!achar(fsA, "A.TXT") && !!achar(fsA, "A1.TXT"), "colisão ganha sufixo");
  check(!!achar(fsA, "_CON.EXE"), "nome reservado ganha _");
}
{
  const { fs: fsA } = novaA();
  fsA.gravar(0, "ARQ.TXT", new TextEncoder().encode("antigo"));
  const zip = criarZip([{ nome: "arq.txt", dados: "novo" }]);
  await extrairZipParaDisco(zip, fsA, 0);
  check(!!achar(fsA, "ARQ1.TXT"), "não sobrescreve arquivo existente");
  check(texto(ler(fsA, "ARQ.TXT")) === "antigo", "arquivo antigo continua intacto");
}

// --------------------------------------------------------------------- UTF-8 / CP437
secao("codificação dos nomes");
{
  const { fs: fsA } = novaA();
  const zip = criarZip([{ nome: "pasta/ção.txt", dados: "utf8", flags: 0x0800 }]);
  check(analisarZip(zip).entradas[0].nome === "pasta/ção.txt", "UTF-8 (bit 11) decodificado");
  const r = await extrairZipParaDisco(zip, fsA, 0);
  const p = pasta(fsA, "PASTA");
  check(r.pastas === 1 && !!p, "pasta UTF-8 criada");
  check(!!p && !!achar(fsA, "__O.TXT", p.cluster), "nome UTF-8 sanitizado para 8.3");
}
{
  const { fs: fsA } = novaA();
  // "AÇO.TXT" em CP437: A=0x41, Ç=0x80, O=0x4F, .=0x2E, TXT
  const nomeBruto = new Uint8Array([0x41, 0x80, 0x4f, 0x2e, 0x54, 0x58, 0x54]);
  const zip = criarZip([{ nomeBruto, flags: 0, dados: "cp437" }]);
  check(analisarZip(zip).entradas[0].nome === "AÇO.TXT", "CP437 decodificado sem o bit 11");
  await extrairZipParaDisco(zip, fsA, 0);
  check(!!achar(fsA, "A_O.TXT"), "nome CP437 vira 8.3");
}

// --------------------------------------------------------------------- ZIP64
secao("ZIP64");
{
  const { fs: fsA } = novaA();
  const zip = criarZip([{ nome: "ZIP64.TXT", dados: "zip64" }], { zip64: true });
  const a = analisarZip(zip);
  check(a.zip64 === true, "ZIP64 reconhecido");
  check(a.entradas[0].descomprimido === 5, "tamanho veio do campo ZIP64");
  const r = await extrairZipParaDisco(zip, fsA, 0);
  check(r.arquivos === 1 && texto(ler(fsA, "ZIP64.TXT")) === "zip64", "ZIP64 extraído");
}
{
  const zip = criarZip([{ nome: "EOCD64.TXT", dados: "eocd" }], { zip64Eocd: true });
  const a = analisarZip(zip);
  check(a.zip64 === true && a.entradas[0].descomprimido === 4, "ZIP64 só no EOCD");
}

// --------------------------------------------------------------------- recusas
secao("recusas e limites");
{
  const { fs: fsA } = novaA();
  const zip = criarZip([{ nome: "RUIM.TXT", dados: "abc", crc: 0x12345678 }]);
  const e = await erroDe(() => extrairZipParaDisco(zip, fsA, 0));
  check(e instanceof ErroZip && e.codigo === "crc", "CRC inválido é recusado");
  check(!achar(fsA, "RUIM.TXT"), "CRC inválido não grava arquivo");
}
{
  const { fs: fsA } = novaA();
  const zip = criarZip([{ nome: "SEGREDO.TXT", dados: "x", flags: 0x0001 }]);
  const e = await erroDe(() => extrairZipParaDisco(zip, fsA, 0));
  check(e instanceof ErroZip && e.codigo === "criptografado", "ZIP criptografado é recusado");
}
{
  const { fs: fsA } = novaA();
  const zip = criarZip([{ nome: "BZIP.TXT", dados: "x", metodo: 12 }]);
  const e = await erroDe(() => extrairZipParaDisco(zip, fsA, 0));
  check(e instanceof ErroZip && e.codigo === "metodo", "método bzip2 é recusado");
}
{
  const { fs: fsA } = novaA();
  const zip = criarZip([{ nome: "../evil.txt", dados: "x" }]);
  const e = await erroDe(() => extrairZipParaDisco(zip, fsA, 0));
  check(e instanceof ErroZip && e.codigo === "nome", "caminho com .. é recusado");
  check(!nomes(fsA).includes("EVIL.TXT"), ".. não grava nada fora da pasta");
}
{
  const { fs: fsA } = novaA();
  const zip = criarZip([{ nome: "/evil.txt", dados: "x" }]);
  const e = await erroDe(() => extrairZipParaDisco(zip, fsA, 0));
  check(e instanceof ErroZip && e.codigo === "nome", "caminho absoluto é recusado");
}
{
  const { fs: fsA } = novaA();
  const fundo = "a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q.txt";
  const zip = criarZip([{ nome: fundo, dados: "x" }]);
  const e = await erroDe(() => extrairZipParaDisco(zip, fsA, 0));
  check(e instanceof ErroZip && e.codigo === "nome", "profundidade limitada");
}
{
  const { fs: fsA } = novaA();
  const zip = criarZip([{ nome: "1.txt", dados: "1" }, { nome: "2.txt", dados: "2" }, { nome: "3.txt", dados: "3" }]);
  const e = await erroDe(() => extrairZipParaDisco(zip, fsA, 0, { limiteEntradas: 2 }));
  check(e instanceof ErroZip && e.codigo === "limite", "limite de entradas é respeitado");
}
{
  const { fs: fsA } = novaA();
  const grande = new Uint8Array(10000).fill(65);
  const zip = criarZip([{ nome: "GRANDE.BIN", dados: grande, metodo: 8 }]);
  const e = await erroDe(() => extrairZipParaDisco(zip, fsA, 0, { limiteBytes: 1000 }));
  check(e instanceof ErroZip && e.codigo === "limite", "limite de bytes é respeitado");
  check(!achar(fsA, "GRANDE.BIN"), "limite não grava arquivo");
}
{
  const { fs: fsA } = novaA();
  const grande = new Uint8Array(10000).fill(66);
  const zip = criarZip([{ nome: "MENTIRA.BIN", dados: grande, metodo: 8, descomprimido: 100 }]);
  const e = await erroDe(() => extrairZipParaDisco(zip, fsA, 0, { limiteBytes: 1000 }));
  check(e instanceof ErroZip && e.codigo === "limite", "tamanho declarado mentiroso é barrado no inflate");
}
{
  const { fs: fsA } = novaA();
  const grande = new Uint8Array(300 * 1024).fill(67);
  const zip = criarZip([{ nome: "GRANDE.BIN", dados: grande, metodo: 8 }]);
  const e = await erroDe(() => extrairZipParaDisco(zip, fsA, 0));
  check(e instanceof ErroZip && e.codigo === "espaco", "ZIP maior que o disco é recusado");
  check(!achar(fsA, "GRANDE.BIN"), "sem espaço não grava arquivo");
}
{
  const { fs: fsA } = novaA();
  const zip = criarZip([{ nome: "T.TXT", dados: "t" }]).subarray(0, 30);
  const e = await erroDe(() => extrairZipParaDisco(zip, fsA, 0));
  check(e instanceof ErroZip && e.codigo === "formato", "ZIP truncado é recusado");
}
{
  const { fs: fsA } = novaA();
  const zip = criarZip([]);
  const e = await erroDe(() => extrairZipParaDisco(zip, fsA, 0));
  check(e instanceof ErroZip && e.codigo === "formato", "ZIP vazio é recusado");
}

// --------------------------------------------------------------------- colisões de tipo
secao("arquivo e pasta com o mesmo nome");
{
  const { fs: fsA } = novaA();
  const zip = criarZip([
    { nome: "coisa", dados: "arquivo" },
    { nome: "coisa/", dados: new Uint8Array(0) },
    { nome: "coisa/dentro.txt", dados: "dentro" },
  ]);
  const r = await extrairZipParaDisco(zip, fsA, 0);
  check(r.arquivos === 2 && r.pastas === 1, "conflito: contagem");
  check(texto(ler(fsA, "COISA")) === "arquivo", "COISA continua arquivo");
  const p = pasta(fsA, "COISA1");
  check(!!p, "a pasta virou COISA1");
  check(!!p && texto(ler(fsA, "DENTRO.TXT", p.cluster)) === "dentro", "conteúdo foi para COISA1");
}

// --------------------------------------------------------------------- subpasta
secao("extração em subpasta");
{
  const { fs: fsA } = novaA();
  const entrada = fsA.criarPasta(0, "ENTRADA");
  const zip = criarZip([{ nome: "ARQ.TXT", dados: "sub" }]);
  const r = await extrairZipParaDisco(zip, fsA, entrada.cluster);
  check(r.arquivos === 1, "subpasta: contagem");
  check(texto(ler(fsA, "ARQ.TXT", entrada.cluster)) === "sub", "gravou dentro de ENTRADA");
  check(!achar(fsA, "ARQ.TXT", 0), "não gravou na raiz");
}

// --------------------------------------------------------------------- rollback
secao("rollback quando a gravação falha");
{
  const apagados = [];
  let chamadas = 0;
  const fsFalho = {
    info: () => ({ bytesLivres: 100000, bytesPorCluster: 512, entradasRaiz: 100 }),
    listar: () => [],
    cadeia: () => [2],
    criarPasta: () => { throw new Error("não deveria criar pasta"); },
    gravar: (clusterPai, nome, dados) => {
      chamadas++;
      if (chamadas === 2) throw new Error("falha simulada ao gravar");
      return { nomeCompleto: nome, diretorio: false, cluster: 10, tamanho: dados.length };
    },
    apagar: (clusterPai, entrada) => { apagados.push(entrada.nomeCompleto); },
  };
  const zip = criarZip([{ nome: "A.TXT", dados: "a" }, { nome: "B.TXT", dados: "b" }]);
  const e = await erroDe(() => extrairZipParaDisco(zip, fsFalho, 0));
  check(!!e && /falha simulada/.test(e.message), "erro de gravação é propagado");
  check(apagados.length === 1 && apagados[0] === "A.TXT", "o arquivo já gravado é apagado");
}
{
  const apagados = [];
  const fsFalho = {
    info: () => ({ bytesLivres: 100000, bytesPorCluster: 512, entradasRaiz: 100 }),
    listar: (cluster) => cluster === 20
      ? [
        { nomeCompleto: ".", atual: true, diretorio: true },
        { nomeCompleto: "..", pai: true, diretorio: true },
      ]
      : [],
    cadeia: () => [20],
    criarPasta: (clusterPai, nome) => ({ nomeCompleto: nome, diretorio: true, cluster: 20 }),
    gravar: () => { throw new Error("falha dentro da pasta"); },
    apagar: (clusterPai, entrada) => { apagados.push(entrada.nomeCompleto); },
  };
  const zip = criarZip([{ nome: "pasta/arquivo.txt", dados: "x" }]);
  const e = await erroDe(() => extrairZipParaDisco(zip, fsFalho, 0));
  check(!!e && /falha dentro da pasta/.test(e.message), "erro dentro da pasta é propagado");
  check(apagados.includes("PASTA"), "a pasta criada é apagada no rollback");
}

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);

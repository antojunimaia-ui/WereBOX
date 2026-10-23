// tests/download.test.mjs — prova o download por link + gravacao no FAT sem navegador.
//
//   node tests/download.test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirFS } from "../ui/fat.mjs";
import { baixarLinkParaDisco, lerPedidoDownload, nome83Seguro, paramsDaPagina, unidadeDeDownload } from "../ui/transferencia.mjs";
import { criarZip } from "./zip-helper.mjs";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const emu = path.resolve(aqui, "..");
const raiz = path.resolve(emu, "..");
const imagemC = fs.readFileSync(path.join(raiz, "Systems", "MS-DOS 6.22", "c.img"));
const imagemA = fs.readFileSync(path.join(raiz, "Systems", "Windows 1.01", "win101.img"));

let ok = 0, falhas = 0;
const check = (cond, msg) => {
  if (cond) { ok++; console.log(`   ok    ${msg}`); }
  else { falhas++; console.log(`   FALHA ${msg}`); }
};
const secao = (t) => console.log(`\n== ${t}`);

/** SyncBuffer falso: a mesma interface que o dispositivo de blocos do v86 usa */
function syncBuffer(buffer) {
  return {
    byteLength: buffer.length,
    get_from_cache: (off, len) => new Uint8Array(buffer.buffer, buffer.byteOffset + off, len),
    set: (off, bytes, cb) => {
      new Uint8Array(buffer.buffer, buffer.byteOffset + off, bytes.length).set(bytes);
      cb?.();
    },
  };
}

function dispositivo(buffer) {
  return {
    get: (off, len) => new Uint8Array(buffer.buffer, buffer.byteOffset + off, len),
    set: (off, bytes) => {
      new Uint8Array(buffer.buffer, buffer.byteOffset + off, bytes.length).set(bytes);
    },
  };
}

const emuladorC = (buffer) => ({
  v86: { cpu: { devices: { ide: { primary: { master: { buffer: syncBuffer(buffer) } } } } } },
});
const emuladorA = (buffer) => ({
  v86: { cpu: { devices: { fdc: { drives: [{ buffer: syncBuffer(buffer) }] } } } },
});

// mock do fetch: cada teste define a proxima resposta do proxy
let proxima = null;
let ultimaUrl = "";
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (url) => {
  ultimaUrl = String(url);
  if (!proxima) throw new Error("fetch inesperado");
  return proxima;
};
const responder = (bytes, headers = {}, status = 200) => {
  proxima = new Response(bytes, { status, headers });
};

// --------------------------------------------------------------------- nomes
secao("nome 8.3");
check(nome83Seguro("payload.exe", new Set()).nome === "PAYLOAD.EXE", "payload.exe -> PAYLOAD.EXE");
check(nome83Seguro("payload.exe", new Set(["PAYLOAD.EXE"])).nome === "PAYLOAD1.EXE", "colisao ganha sufixo");
check(nome83Seguro("relatorio.final.docx", new Set()).nome === "RELATORI.DOC", "varios pontos sao sanitizados");
check(nome83Seguro("a.b.c", new Set()).nome === "A_B.C", "ponto do meio nao vira ponto na entrada FAT");
check(nome83Seguro("con.exe", new Set()).nome === "_CON.EXE", "nome de dispositivo do DOS ganha prefixo");
check(nome83Seguro("COM1", new Set()).nome === "_COM1", "COM1 tambem e' reservado");

// --------------------------------------------------------------------- URL
secao("pedido por URL");
const p1 = lerPedidoDownload(new URLSearchParams("system=msdos622&download=https%3A%2F%2Fexemplo.com%2Fa.exe"));
check(p1?.url === "https://exemplo.com/a.exe", "?download= e' decodificado");
check(p1?.unidade === null, "sem unidade usa a do sistema");
const p2 = lerPedidoDownload(new URLSearchParams("baixar=https%3A%2F%2Fx%2Fb.bin&unidade=b&nome=TESTE.BIN"));
check(p2?.url === "https://x/b.bin" && p2?.unidade === "B" && p2?.nome === "TESTE.BIN", "alias baixar + unidade + nome");
check(lerPedidoDownload(new URLSearchParams("system=msdos622")) === null, "sem download nao ha pedido");

secao("formato compacto ?system=...=download'...'");
const compacto = lerPedidoDownload(paramsDaPagina("?system=msdos622=download'https://exemplo.com/a.exe'"));
check(compacto?.url === "https://exemplo.com/a.exe", "link entre aspas simples");
check(paramsDaPagina("?system=msdos622=download'https://exemplo.com/a.exe'").get("system") === "msdos622", "id do sistema e' separado do download");
const compactoAmp = lerPedidoDownload(paramsDaPagina("?system=msdos622=download'https://exemplo.com/a.exe?x=1&y=2'"));
check(compactoAmp?.url === "https://exemplo.com/a.exe?x=1&y=2", "& dentro do link nao quebra a query");
const compactoUnidade = lerPedidoDownload(paramsDaPagina("?system=msdos622=download'https://exemplo.com/a.exe'&unidade=A"));
check(compactoUnidade?.url === "https://exemplo.com/a.exe" && compactoUnidade?.unidade === "A", "outros parametros depois do link continuam valendo");
const compactoEnc = lerPedidoDownload(paramsDaPagina("?system=msdos622=download'https%3A%2F%2Fexemplo.com%2Fa.exe'"));
check(compactoEnc?.url === "https://exemplo.com/a.exe", "link codificado no formato compacto e' decodificado");
const compactoDuplo = lerPedidoDownload(paramsDaPagina('?system=win101=download"https://exemplo.com/b.bin"'));
check(compactoDuplo?.url === "https://exemplo.com/b.bin", "aspas duplas tambem valem");
const compactoMenu = paramsDaPagina("?menu=html&system=win101=download'https://exemplo.com/c.bin'&unidade=B");
check(compactoMenu.get("menu") === "html", "parametro antes do system e' preservado");
check(compactoMenu.get("unidade") === "B", "parametro depois do link e' preservado");

secao("unidade de destino");
check(unidadeDeDownload({ osAtual: "win101", sistemaAtual: { id: "grub" }, config: { hdb: {}, fda: {} } }) === "A", "Windows 1.01 bootado pelo GRUB -> A:");
check(unidadeDeDownload({ osAtual: "menuet", sistemaAtual: { id: "menuet" }, config: { fda: {} } }) === "A", "MenuetOS -> A:");
check(unidadeDeDownload({ osAtual: "kolibri", sistemaAtual: { id: "grub" }, config: { fdb: {} } }) === "B", "Kolibri no GRUB -> B:");
check(unidadeDeDownload({ osAtual: "kolibri", sistemaAtual: { id: "kolibri" }, config: { fda: {} } }) === "A", "Kolibri direto -> A:");
check(unidadeDeDownload({ osAtual: "msdos", sistemaAtual: { id: "grub" }, config: { hdb: {} } }) === "C", "MS-DOS -> C:");
check(unidadeDeDownload({ osAtual: "novaos", sistemaAtual: { id: "novaos" }, config: { cdrom: {} } }) === null, "Live CD sem disco -> null");

// --------------------------------------------------------------------- C:
secao("download + gravacao no C:");
const bytesC = new Uint8Array(imagemC);
const emC = emuladorC(bytesC);
const payload = new TextEncoder().encode("MZ amostra de teste\n");
responder(payload, {
  "content-type": "application/octet-stream",
  "content-disposition": 'attachment; filename="payload.exe"',
  "x-final-url": "https://exemplo.com/payload.exe",
});
const r1 = await baixarLinkParaDisco(emC, {
  url: "https://exemplo.com/download?id=1",
  unidade: "C",
  endpoint: "http://teste/__download",
});
check(r1.nome === "PAYLOAD.EXE", "nome veio do Content-Disposition");
check(r1.bytes === payload.length && r1.unidade === "C", "tamanho e unidade corretos");
check(ultimaUrl.includes("url=https%3A%2F%2Fexemplo.com%2Fdownload%3Fid%3D1"), "link foi codificado para o proxy");
check(ultimaUrl.includes("max="), "pedido leva o limite de espaco");

let fsC = abrirFS(dispositivo(bytesC));
let entrada = fsC.listar(0).find((e) => e.nomeCompleto === "PAYLOAD.EXE");
check(!!entrada && entrada.tamanho === payload.length, "PAYLOAD.EXE apareceu na raiz do C:");
check(!!entrada && Buffer.from(fsC.ler(entrada)).equals(Buffer.from(payload)), "bytes gravados conferem");

responder(payload, { "content-disposition": 'attachment; filename="payload.exe"' });
const r2 = await baixarLinkParaDisco(emC, { url: "https://exemplo.com/payload.exe", unidade: "C", endpoint: "http://teste/__download" });
check(r2.nome === "PAYLOAD1.EXE", "segundo download nao sobrescreve: PAYLOAD1.EXE");
fsC = abrirFS(dispositivo(bytesC));
check(fsC.listar(0).filter((e) => e.nomeCompleto.startsWith("PAYLOA")).length === 2, "os dois arquivos coexistem");

responder(payload, { "content-type": "application/octet-stream", "x-final-url": "https://exemplo.com/pasta/amostra.bin" });
const r3 = await baixarLinkParaDisco(emC, { url: "https://exemplo.com/redir", unidade: "C", endpoint: "http://teste/__download" });
check(r3.nome === "AMOSTRA.BIN", "sem Content-Disposition usa o nome da URL final");

responder(payload, { "content-disposition": 'attachment; filename="relatorio.final.docx"' });
const r4 = await baixarLinkParaDisco(emC, { url: "https://exemplo.com/x", unidade: "C", endpoint: "http://teste/__download" });
check(r4.nome === "RELATORI.DOC", "nome com varios pontos e' sanitizado");

// --------------------------------------------------------------------- A:
secao("download + gravacao no A:");
const bytesA = new Uint8Array(imagemA);
const emA = emuladorA(bytesA);
responder(payload, { "content-disposition": 'attachment; filename="amostra.bin"' });
const rA = await baixarLinkParaDisco(emA, { url: "https://exemplo.com/amostra.bin", unidade: "A", endpoint: "http://teste/__download" });
check(rA.nome === "AMOSTRA.BIN" && rA.unidade === "A", "gravou no disquete A:");
const fsA = abrirFS(dispositivo(bytesA));
const entA = fsA.listar(0).find((e) => e.nomeCompleto === "AMOSTRA.BIN");
check(!!entA && Buffer.from(fsA.ler(entA)).equals(Buffer.from(payload)), "bytes no A: conferem");

// --------------------------------------------------------------------- ZIP
secao("download + extração de ZIP");
const zipC = criarZip([
  { nome: "zipteste/leiame.txt", dados: "olá do zip\n" },
  { nome: "zipraiz.bin", dados: new Uint8Array([1, 2, 3, 4]) },
]);
responder(zipC, { "content-disposition": 'attachment; filename="pacote.zip"' });
const rZip = await baixarLinkParaDisco(emC, { url: "https://exemplo.com/pacote.zip", unidade: "C", endpoint: "http://teste/__download" });
check(rZip.zip === true && rZip.extraido === true, "ZIP foi extraído");
check(rZip.arquivos === 2 && rZip.pastas === 1, "ZIP: contagem de arquivos/pastas");
check(rZip.bytes === new TextEncoder().encode("olá do zip\n").length + 4, "ZIP: bytes extraídos");
check(rZip.bytesZip === zipC.length, "ZIP: tamanho do arquivo original");
let fsZip = abrirFS(dispositivo(bytesC));
const pastaZip = fsZip.listar(0).find((e) => e.diretorio && e.nomeCompleto === "ZIPTESTE");
check(!!pastaZip, "ZIP criou ZIPTESTE no C:");
const leiameZip = pastaZip && fsZip.listar(pastaZip.cluster).find((e) => e.nomeCompleto === "LEIAME.TXT");
check(!!leiameZip && Buffer.from(fsZip.ler(leiameZip)).toString() === "olá do zip\n", "ZIP gravou ZIPTESTE/LEIAME.TXT");
check(!!fsZip.listar(0).find((e) => e.nomeCompleto === "ZIPRAIZ.BIN"), "ZIP gravou ZIPRAIZ.BIN");
check(!fsZip.listar(0).some((e) => e.nomeCompleto === "PACOTE.ZIP"), "ZIP não ficou no disco");

secao("download de ZIP em subpasta");
const entradaC = fsZip.criarPasta(0, "ENTRADA");
const zipSub = criarZip([{ nome: "sub.txt", dados: "sub" }]);
responder(zipSub, { "content-disposition": 'attachment; filename="sub.zip"' });
const rSub = await baixarLinkParaDisco(emC, {
  url: "https://exemplo.com/sub.zip", unidade: "C", cluster: entradaC.cluster, endpoint: "http://teste/__download",
});
check(rSub.zip === true && rSub.extraido === true && rSub.arquivos === 1, "ZIP extraído em subpasta");
fsZip = abrirFS(dispositivo(bytesC));
const entrada2 = fsZip.listar(0).find((e) => e.diretorio && e.nomeCompleto === "ENTRADA");
check(!!entrada2 && !!fsZip.listar(entrada2.cluster).find((e) => e.nomeCompleto === "SUB.TXT"), "arquivo dentro de ENTRADA");
check(!fsZip.listar(0).some((e) => e.nomeCompleto === "SUB.TXT"), "não vazou para a raiz");

secao("download de ZIP64");
const zip64 = criarZip([{ nome: "zip64.txt", dados: "64" }], { zip64: true });
responder(zip64, { "content-disposition": 'attachment; filename="zip64.zip"' });
const r64 = await baixarLinkParaDisco(emC, { url: "https://exemplo.com/zip64.zip", unidade: "C", endpoint: "http://teste/__download" });
check(r64.zip === true && r64.extraido === true && r64.arquivos === 1, "ZIP64 extraído");
fsZip = abrirFS(dispositivo(bytesC));
check(!!fsZip.listar(0).find((e) => e.nomeCompleto === "ZIP64.TXT"), "ZIP64 gravou ZIP64.TXT");

secao("fallback: ZIP não extraído é salvo inteiro");
const zipCripto = criarZip([{ nome: "segredo.txt", dados: "x", flags: 0x0001 }]);
responder(zipCripto, { "content-disposition": 'attachment; filename="segredo.zip"' });
const rCripto = await baixarLinkParaDisco(emC, { url: "https://exemplo.com/segredo.zip", unidade: "C", endpoint: "http://teste/__download" });
check(rCripto.zip === true && rCripto.extraido === false, "ZIP criptografado cai no fallback");
check(/criptografado/.test(rCripto.zipFalhou), "motivo do fallback é explicado");
check(rCripto.nome === "SEGREDO.ZIP", "fallback grava com extensão .ZIP");
fsZip = abrirFS(dispositivo(bytesC));
const segredo = fsZip.listar(0).find((e) => e.nomeCompleto === "SEGREDO.ZIP");
check(!!segredo && Buffer.from(fsZip.ler(segredo)).equals(Buffer.from(zipCripto)), "ZIP criptografado foi salvo inteiro");
check(!fsZip.listar(0).some((e) => e.nomeCompleto === "SEGREDO.TXT"), "nada foi extraído do ZIP criptografado");

const zipTrav = criarZip([{ nome: "../evil.txt", dados: "x" }]);
responder(zipTrav, { "content-disposition": 'attachment; filename="dados.bin"' });
const rTrav = await baixarLinkParaDisco(emC, { url: "https://exemplo.com/dados.bin", unidade: "C", endpoint: "http://teste/__download" });
check(rTrav.zip === true && rTrav.extraido === false, "ZIP com .. cai no fallback");
check(rTrav.nome === "DADOS.ZIP", "fallback troca .bin por .ZIP");
fsZip = abrirFS(dispositivo(bytesC));
check(!!fsZip.listar(0).find((e) => e.nomeCompleto === "DADOS.ZIP"), "ZIP foi salvo como DADOS.ZIP");
check(!fsZip.listar(0).some((e) => e.nomeCompleto === "EVIL.TXT"), ".. não gravou EVIL.TXT");

const zipVazio = criarZip([]);
responder(zipVazio, { "content-disposition": 'attachment; filename="vazio.zip"' });
const rVazio = await baixarLinkParaDisco(emC, { url: "https://exemplo.com/vazio.zip", unidade: "C", endpoint: "http://teste/__download" });
check(rVazio.zip === true && rVazio.extraido === false && /vazio/.test(rVazio.zipFalhou), "ZIP vazio cai no fallback");
check(rVazio.nome === "VAZIO.ZIP", "ZIP vazio foi salvo como VAZIO.ZIP");

secao("fallback: ZIP que não cabe extraído (A:)");
const grandeA = new Uint8Array(300 * 1024).fill(68);
const zipGrandeA = criarZip([{ nome: "grande.bin", dados: grandeA, metodo: 8 }]);
responder(zipGrandeA, { "content-disposition": 'attachment; filename="grande.zip"' });
const rGrandeA = await baixarLinkParaDisco(emA, { url: "https://exemplo.com/grande.zip", unidade: "A", endpoint: "http://teste/__download" });
check(rGrandeA.zip === true && rGrandeA.extraido === false, "ZIP grande demais para extrair cai no fallback");
check(/espa/.test(rGrandeA.zipFalhou), "motivo é falta de espaço");
check(rGrandeA.nome === "GRANDE.ZIP", "ZIP grande foi salvo no A:");
const fsGrandeA = abrirFS(dispositivo(bytesA));
const zipA = fsGrandeA.listar(0).find((e) => e.nomeCompleto === "GRANDE.ZIP");
check(!!zipA && zipA.tamanho === zipGrandeA.length, "ZIP comprimido foi salvo inteiro");
check(!fsGrandeA.listar(0).some((e) => e.nomeCompleto === "GRANDE.BIN"), "conteúdo grande não foi extraído");

secao("ZIP não sobrescreve arquivo existente");
const zipCol = criarZip([{ nome: "payload.exe", dados: "novo" }]);
responder(zipCol, { "content-disposition": 'attachment; filename="colisao.zip"' });
const rCol = await baixarLinkParaDisco(emC, { url: "https://exemplo.com/colisao.zip", unidade: "C", endpoint: "http://teste/__download" });
check(rCol.zip === true && rCol.extraido === true && rCol.arquivos === 1, "ZIP com colisão foi extraído");
fsZip = abrirFS(dispositivo(bytesC));
check(!!fsZip.listar(0).find((e) => e.nomeCompleto === "PAYLOAD2.EXE"), "colisão gerou PAYLOAD2.EXE");

// --------------------------------------------------------------------- recusas
secao("recusas");
let erro = "";
try { await baixarLinkParaDisco(emC, { url: "ftp://exemplo.com/x", unidade: "C", endpoint: "http://teste/__download" }); }
catch (e) { erro = e.message; }
check(/http/.test(erro), "recusa protocolo que nao e' http(s)");

responder(new Uint8Array(0), {});
erro = "";
try { await baixarLinkParaDisco(emC, { url: "https://exemplo.com/vazio", unidade: "C", endpoint: "http://teste/__download" }); }
catch (e) { erro = e.message; }
check(/vazio/.test(erro), "recusa arquivo vazio");

responder("nao achei", {}, 404);
erro = "";
try { await baixarLinkParaDisco(emC, { url: "https://exemplo.com/404", unidade: "C", endpoint: "http://teste/__download" }); }
catch (e) { erro = e.message; }
check(/404/.test(erro), "mostra o status do proxy");

responder(new Uint8Array(300 * 1024), {});
erro = "";
try { await baixarLinkParaDisco(emA, { url: "https://exemplo.com/grande.bin", unidade: "A", endpoint: "http://teste/__download" }); }
catch (e) { erro = e.message; }
check(/só tem|disco/.test(erro), "recusa arquivo maior que o espaco livre");

globalThis.fetch = fetchOriginal;
console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);

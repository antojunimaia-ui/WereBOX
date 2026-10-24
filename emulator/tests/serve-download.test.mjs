// tests/serve-download.test.mjs — prova o proxy /emulator/__download de verdade.
//
// Sobe um servidor de origem (arquivo, redirect, 404, corpo sem Content-Length)
// e o tools/serve.mjs numa porta livre; depois conversa com o proxy por HTTP.
//
//   node tests/serve-download.test.mjs
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const emu = path.resolve(aqui, "..");
const serve = path.join(emu, "tools", "serve.mjs");

let ok = 0, falhas = 0;
const check = (cond, msg) => {
  if (cond) { ok++; console.log(`   ok    ${msg}`); }
  else { falhas++; console.log(`   FALHA ${msg}`); }
};
const secao = (t) => console.log(`\n== ${t}`);

const CONTEUDO = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));

function portaSolta() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

function escutar(servidor, porta) {
  return new Promise((resolve, reject) => {
    servidor.once("error", reject);
    servidor.listen(porta, "127.0.0.1", resolve);
  });
}

async function esperarServidor(base) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${base}/emulator/`, { method: "HEAD" });
      if (r.ok || r.status === 404) return;
    } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("o servidor de teste nao subiu");
}

// ------------------------------------------------------------- servidor origem
const origem = http.createServer((req, res) => {
  const rota = new URL(req.url, "http://x").pathname;
  if (rota === "/payload.bin") {
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": String(CONTEUDO.length),
      "content-disposition": 'attachment; filename="malware.exe"',
    });
    res.end(CONTEUDO);
    return;
  }
  if (rota === "/redireciona") {
    res.writeHead(302, { location: "/payload.bin" }).end();
    return;
  }
  if (rota === "/grande.bin") {
    const grande = Buffer.alloc(5000, 7);
    res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(grande.length) });
    res.end(grande);
    return;
  }
  if (rota === "/sem-tamanho") {
    // sem Content-Length: o proxy so' descobre o tamanho lendo o corpo
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.end(Buffer.alloc(5000, 9));
    return;
  }
  if (rota === "/vazio") {
    res.writeHead(200, { "content-type": "application/octet-stream" }).end();
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" }).end("nao achei");
});
const portaOrigem = await portaSolta();
await escutar(origem, portaOrigem);
const baseOrigem = `http://127.0.0.1:${portaOrigem}`;

// ------------------------------------------------------------- serve.mjs
const portaProxy = await portaSolta();
const baseProxy = `http://127.0.0.1:${portaProxy}`;
const filho = spawn(process.execPath, [serve, String(portaProxy)], {
  cwd: emu,
  env: { ...process.env, PORT: String(portaProxy) },
  stdio: ["ignore", "ignore", "pipe"],
});
let erroServidor = "";
filho.stderr.on("data", (c) => { erroServidor += c; });

try {
  await esperarServidor(baseProxy);

  secao("arquivo normal");
  {
    const r = await fetch(`${baseProxy}/emulator/__download?url=${encodeURIComponent(`${baseOrigem}/payload.bin`)}`);
    const corpo = Buffer.from(await r.arrayBuffer());
    check(r.status === 200, "status 200");
    check(corpo.equals(CONTEUDO), "bytes chegaram intactos");
    check(r.headers.get("content-disposition") === 'attachment; filename="malware.exe"', "Content-Disposition foi repassado");
    check(r.headers.get("x-final-url") === `${baseOrigem}/payload.bin`, "x-final-url aponta para o arquivo");
  }

  secao("redirect");
  {
    const r = await fetch(`${baseProxy}/emulator/__download?url=${encodeURIComponent(`${baseOrigem}/redireciona`)}`);
    const corpo = Buffer.from(await r.arrayBuffer());
    check(r.status === 200 && corpo.equals(CONTEUDO), "segue o redirect e devolve o arquivo");
    check(r.headers.get("x-final-url") === `${baseOrigem}/payload.bin`, "x-final-url e' a URL final");
  }

  secao("limites e recusas");
  {
    const r = await fetch(`${baseProxy}/emulator/__download?url=${encodeURIComponent(`${baseOrigem}/grande.bin`)}&max=100`);
    check(r.status === 413, "recusa pelo Content-Length (413)");
    check(/grande demais/.test(await r.text()), "mensagem explica o limite");
  }
  {
    const r = await fetch(`${baseProxy}/emulator/__download?url=${encodeURIComponent(`${baseOrigem}/sem-tamanho`)}&max=100`);
    check(r.status === 413, "recusa corpo sem Content-Length que estoura (413)");
  }
  {
    const r = await fetch(`${baseProxy}/emulator/__download?url=${encodeURIComponent("ftp://exemplo.com/x")}`);
    check(r.status === 400, "recusa protocolo que nao e' http(s)");
  }
  {
    const r = await fetch(`${baseProxy}/emulator/__download`);
    check(r.status === 400, "recusa pedido sem url");
  }
  {
    const r = await fetch(`${baseProxy}/emulator/__download?url=${encodeURIComponent(`http://user:senha@127.0.0.1:${portaOrigem}/payload.bin`)}`);
    check(r.status === 400, "recusa url com usuario/senha");
  }
  {
    const r = await fetch(`${baseProxy}/emulator/__download?url=${encodeURIComponent(`${baseOrigem}/nao-existe`)}`);
    check(r.status === 502, "repassa erro do servidor de origem como 502");
  }
  {
    const r = await fetch(`${baseProxy}/emulator/__download?url=${encodeURIComponent(`${baseOrigem}/vazio`)}`);
    check(r.status === 200 && (await r.arrayBuffer()).byteLength === 0, "arquivo vazio passa pelo proxy (a interface recusa)");
  }

  secao("redirect da raiz");
  {
    const consulta = "system=msdos622&download=https%3A%2F%2Fexemplo.com%2Fa.exe";
    const r = await fetch(`${baseProxy}/?${consulta}`, { redirect: "manual" });
    check(r.status === 302, "raiz responde 302");
    check(r.headers.get("location") === `/emulator/?${consulta}`, "query do link e' preservada no redirect");
  }

  secao("modo duo na pagina normal");
  {
    const r = await fetch(`${baseProxy}/?duo=win101,win203`, { redirect: "manual" });
    check(r.status === 302, "raiz com ?duo= responde 302");
    check(r.headers.get("location") === "/emulator/?duo=win101,win203", "?duo= e' preservado no redirect");
  }
  {
    const r = await fetch(`${baseProxy}/emulator/?duo=win101,win203`);
    const html = await r.text();
    check(r.status === 200, "a pagina normal responde 200");
    check(/ui\/app\.mjs/.test(html), "serve a mesma index.html/app.mjs");
    check(!/duo\.html/.test(html) && !/ui\/duo\.css/.test(html), "sem pagina separada e sem css extra");
  }
} finally {
  filho.kill();
  origem.close();
}

if (erroServidor.trim()) console.log(`\n[stderr do servidor]\n${erroServidor.trim()}`);
console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);

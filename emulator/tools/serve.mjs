// Servidor estatico minimo para a raiz do repo (o v86 precisa de http:// para
// carregar o .wasm e as imagens de disco; abrir por file:// nao funciona).
//
// uso:  node tools/serve.mjs [porta]        (padrao: 8123)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const port = Number(process.env.PORT || process.argv[2] || 8123);

// Modo de segurança: desabilita endpoints sensíveis em produção (Render, etc.)
// Define NODE_ENV=production para desabilitar __download e __save
const isProducao = process.env.NODE_ENV === "production";

// ---------------------------------------------------------------- POST /__save
// Canal de mao dupla da bancada: a pagina de preparo do disco manda a imagem ja
// formatada pelo DOS real (FORMAT/SYS/XCOPY) e a gente grava no repo.
const MAX_POST = 96 * 1024 * 1024;

// ------------------------------------------------------------- GET /__download
// A interface pede ao servidor para buscar um link (contorna CORS) e devolve os
// bytes para ela gravar no FAT da maquina. Os limites evitam que o endpoint
// vire um proxy aberto para arquivos enormes.
const MAX_DOWNLOAD = 64 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60000;

function responder(res, status, texto) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }).end(texto);
}

async function baixarPeloServidor(res, url) {
  let alvo;
  try {
    alvo = new URL(url.searchParams.get("url") || "");
  } catch {
    responder(res, 400, "url invalida");
    return;
  }
  if (alvo.protocol !== "http:" && alvo.protocol !== "https:") {
    responder(res, 400, "so http:// ou https://");
    return;
  }
  if (alvo.username || alvo.password) {
    responder(res, 400, "url com usuario/senha nao e aceita");
    return;
  }

  const pedidoMax = Number(url.searchParams.get("max"));
  const max = Math.min(
    Math.max(Number.isFinite(pedidoMax) && pedidoMax > 0 ? Math.floor(pedidoMax) : MAX_DOWNLOAD, 1),
    MAX_DOWNLOAD,
  );

  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), DOWNLOAD_TIMEOUT_MS);
  let resposta;
  try {
    resposta = await fetch(alvo, {
      redirect: "follow",
      signal: controle.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) WereBOX/1.0",
        accept: "*/*",
      },
    });
  } catch (e) {
    clearTimeout(relogio);
    const abortou = e.name === "AbortError";
    responder(res, abortou ? 504 : 502, abortou ? "tempo esgotado" : `falha ao buscar: ${e.cause?.message || e.message}`);
    return;
  }
  if (!resposta.ok) {
    clearTimeout(relogio);
    responder(res, 502, `o servidor respondeu ${resposta.status}`);
    return;
  }

  const declarado = Number(resposta.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > max) {
    clearTimeout(relogio);
    controle.abort();
    responder(res, 413, `arquivo grande demais (${declarado} bytes; limite ${max})`);
    return;
  }

  const partes = [];
  let total = 0;
  let estourou = false;
  try {
    if (resposta.body) {
      for await (const parte of resposta.body) {
        total += parte.length;
        if (total > max) { estourou = true; controle.abort(); break; }
        partes.push(Buffer.from(parte));
      }
    }
  } catch (e) {
    if (!estourou) {
      clearTimeout(relogio);
      const abortou = e.name === "AbortError";
      responder(res, abortou ? 504 : 502, abortou ? "tempo esgotado" : `falha ao ler o arquivo: ${e.message}`);
      return;
    }
  }
  clearTimeout(relogio);
  if (estourou) {
    responder(res, 413, `arquivo grande demais (limite ${max} bytes)`);
    return;
  }

  const corpo = Buffer.concat(partes);
  const cabecalhos = {
    "content-type": resposta.headers.get("content-type") || "application/octet-stream",
    "content-length": String(corpo.length),
    "cache-control": "no-store",
    "x-final-url": resposta.url || alvo.href,
  };
  const disposicao = resposta.headers.get("content-disposition");
  if (disposicao) cabecalhos["content-disposition"] = disposicao.replace(/[^\x20-\x7E]/g, "_");

  console.log(`  [download] ${alvo.origin}${alvo.pathname} (${corpo.length} bytes)`);
  res.writeHead(200, cabecalhos).end(corpo);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".bat": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};
const mimeFor = (f) => MIME[path.extname(f).toLowerCase()] || "application/octet-stream";

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  // Bloqueia endpoints sensíveis em produção
  if (isProducao && (url.pathname === "/emulator/__save" || url.pathname === "/emulator/__download")) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" })
       .end("Endpoint desabilitado em produção. Use apenas localmente (NODE_ENV != production).");
    return;
  }

  if (req.method === "POST" && url.pathname === "/emulator/__save") {
    // O nome pode ser um caminho relativo a raiz do repo (ex.:
    // "Systems/MS-DOS 6.22/c.img"). Os nomes antigos continuam aceitos para
    // nao quebrar chamadas de fora da interface.
    const aliases = {
      "c.img": "Systems/MS-DOS 6.22/c.img",
      "win101.img": "Systems/Windows 1.01/win101.img",
      "grub-hd.img": "Systems/GNU GRUB 2.06/grub-hd.img",
    };
    const pedido = url.searchParams.get("name") || "Systems/MS-DOS 6.22/c.img";
    const name = aliases[pedido] || pedido;
    if (!name || name.includes("\0") || !/\.(img|iso)$/i.test(name)) {
      res.writeHead(400, { "content-type": "text/plain" }).end("nome invalido"); return;
    }
    const file = path.resolve(root, name);
    const rel = path.relative(root, file);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      res.writeHead(403, { "content-type": "text/plain" }).end("fora da raiz"); return;
    }
    const chunks = [];
    let len = 0, estourou = false;
    req.on("data", (c) => {
      len += c.length;
      if (len > MAX_POST) { estourou = true; return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (estourou) { res.writeHead(413, { "content-type": "text/plain" }).end("grande demais"); return; }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.concat(chunks));
      console.log(`  [save] ${file} (${(len / 1048576).toFixed(2)} MB)`);
      res.writeHead(200, { "content-type": "text/plain" }).end(`salvei ${name} (${len} bytes)`);
    });
    req.on("error", () => { res.writeHead(500).end("erro"); });
    return;
  }

  if (req.method === "GET" && url.pathname === "/emulator/__download") {
    baixarPeloServidor(res, url).catch((e) => {
      console.error(`  [download] erro inesperado: ${e.message}`);
      if (!res.headersSent) responder(res, 500, "erro interno");
      else res.end();
    });
    return;
  }

  let p;
  try { p = decodeURIComponent(url.pathname); } catch { responder(res, 400, "url invalida"); return; }
  // a interface mora em /emulator/; preserva a query (?system=...&download=...)
  if (p === "/") { res.writeHead(302, { location: `/emulator/${url.search}` }).end(); return; }
  if (p.endsWith("/")) p += "index.html";
  const file = path.resolve(root, "." + p);
  if (!file.startsWith(root)) { res.writeHead(403, { "content-type": "text/plain" }).end("fora da raiz"); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { "content-type": "text/plain" }).end("404 " + p); return; }
    res.writeHead(200, {
      "content-type": mimeFor(file),
      "content-length": st.size,
      "cache-control": "no-cache",
    });
    fs.createReadStream(file).pipe(res);
  });
}).listen(port, "0.0.0.0", () => {
  console.log(`WereBOX — servidor escutando na porta ${port}`);
  console.log(`  interface  ->  http://localhost:${port}/emulator/`);
  if (isProducao) {
    console.log(`  [PRODUÇÃO] Endpoints __download e __save DESABILITADOS por segurança`);
  } else {
    console.log(`  download   ->  /emulator/__download (apenas local; NODE_ENV != production)`);
    console.log(`  save       ->  /emulator/__save (apenas local; NODE_ENV != production)`);
  }
});

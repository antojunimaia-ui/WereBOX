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

// ---------------------------------------------------------------- POST /__save
// Canal de mao dupla da bancada: a pagina de preparo do disco manda a imagem ja
// formatada pelo DOS real (FORMAT/SYS/XCOPY) e a gente grava no repo.
const MAX_POST = 96 * 1024 * 1024;

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

  let p = decodeURIComponent(url.pathname);
  if (p === "/") { res.writeHead(302, { location: "/emulator/" }).end(); return; }  // a interface mora em /emulator/
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
});

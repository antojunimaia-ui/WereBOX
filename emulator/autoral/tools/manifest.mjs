#!/usr/bin/env node
// Gera files.json para o front web listar os binarios a montar no drive C:
// (file:// e servidores estaticos nao listam pastas).
//
//   node tools/manifest.mjs [pasta-a-varrer] [arquivo-de-saida]
//   default: varre Systems/MS-DOS 6.22/extracted e escreve ../web/files.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, process.argv[2] || path.join(here, "..", "..", "..", "Systems", "MS-DOS 6.22", "extracted"));
const out = path.resolve(here, process.argv[3] || path.join(here, "..", "web", "files.json"));

if (!fs.existsSync(dir)) { console.error(`reDOS: nao achei ${dir}`); process.exit(1); }

const files = fs.readdirSync(dir)
  .filter((f) => fs.statSync(path.join(dir, f)).isFile())
  .sort((a, b) => a.localeCompare(b));

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ files }, null, 2) + "\n");
const total = files.reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
console.log(`OK: ${out} — ${files.length} arquivos, ${(total / 1024).toFixed(1)} KB`);

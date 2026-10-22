#!/usr/bin/env node
// reDOS — inicializa o emulador proprio (8086 + DOS em JS puro, sem DOSBox).
//
// Monta o drive C: virtual com os binarios extraidos da ISO do MS-DOS 6.22 e
// sobe o COMMAND.COM *real* da Microsoft, interativo no terminal.
//
//   node redos.mjs                 -> shell interativo (C:\>)
//   node redos.mjs VER DIR         -> roda os comandos e sai (modo lote)
//   node redos.mjs --clean         -> nao executa o AUTOEXEC.BAT real
//   node redos.mjs --dir <pasta>   -> usa outra pasta de binarios
//   node redos.mjs --steps <n>     -> passos de CPU por fatia (default 200000)
//
// Dentro do shell: EXIT encerra. Ctrl+C derruba o processo.
import { Machine } from "./src/machine.js";
import { INPUT_WAIT } from "./src/dos.js";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");   // raiz do repo (autoral/ -> emulator/ -> repo)

// se a saida for canalizada p/ head/Select-Object, sair limpo em vez de estourar
process.stdout.on("error", (e) => { if (e.code === "EPIPE") process.exit(0); });

// ---- argumentos ------------------------------------------------------------
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const batchCmds = argv.filter((a) => !a.startsWith("--"));
const flagVal = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const DOS_DIR = flagVal("--dir", process.env.REDOS_DIR || path.join(root, "Systems", "MS-DOS 6.22", "extracted"));
const CHUNK = Number(flagVal("--steps", "200000")) || 200000;

// ---- monta o "disco" e sobe o shell ---------------------------------------
const commandCom = path.join(DOS_DIR, "COMMAND.COM");
if (!fs.existsSync(commandCom)) {
  console.error(`reDOS: nao achei COMMAND.COM em ${DOS_DIR}`);
  console.error("       extraia a ISO do MS-DOS 6.22 (ou use --dir <pasta>).");
  process.exit(1);
}

const m = new Machine();
let nFiles = 0, nBytes = 0;
for (const f of fs.readdirSync(DOS_DIR)) {
  const p = path.join(DOS_DIR, f);
  if (!fs.statSync(p).isFile()) continue;
  const b = new Uint8Array(fs.readFileSync(p));
  m.mountFile(f, b);
  nFiles++; nBytes += b.length;
}
if (flags.has("--clean")) m.mountFile("AUTOEXEC.BAT", new Uint8Array(0));

m.loadCom(new Uint8Array(fs.readFileSync(commandCom)));
m.state.echoInput = false; // o terminal (readline) ja' ecoa o que digitamos

// ---- entrada interativa: o nucleo pausa sozinho quando o programa pede
// teclado (lanca INPUT_WAIT com o IP rebobinado p/ reexecutar o INT) ---------
m.state.interactive = true;

// ---- saida: imprime so' o que apareceu de novo -----------------------------
let printed = 0;
const flush = () => {
  const s = m.state.stdout;
  if (s.length > printed) { process.stdout.write(s.slice(printed)); printed = s.length; }
};

// ---- roda ate' o programa pedir tecla, sair, ou nao progredir --------------
async function pump() {
  for (;;) {
    const before = m.cpu.steps;
    let r;
    try { r = m.run(CHUNK); }
    catch (e) { if (e === INPUT_WAIT) { flush(); return { wait: true }; } throw e; }
    flush();
    if (r.exited || r.halted) return { exited: true, code: r.exitCode };
    if (m.cpu.steps === before) return { wait: true }; // travou sem pedir tecla
    await new Promise((res) => setImmediate(res)); // deixa o event loop respirar
  }
}

// ---- laço principal --------------------------------------------------------
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const nextLine = () => new Promise((res) => rl.once("line", res));

rl.on("SIGINT", () => { // nao da' p/ abortar no meio com seguranca (EXEC + PSP)
  process.stdout.write("\r\n[reDOS] encerrando (use EXIT para sair do DOS)\r\n");
  process.exit(0);
});

async function main() {
  process.stdout.write(
    "reDOS — nucleo proprio (8086 + DOS em JS, sem DOSBox)\r\n" +
    `C: montado de ${DOS_DIR} — ${nFiles} arquivos, ${(nBytes / 1024).toFixed(1)} KB\r\n` +
    "Digite comandos do DOS (EXIT para sair).\r\n\r\n");

  if (batchCmds.length) { for (const c of batchCmds) m.pushInputLine(c); m.pushInputLine("EXIT"); }
  const interactive = batchCmds.length === 0;

  for (let guard = 0; guard < 100000; guard++) {
    const r = await pump();
    if (r.exited || r.halted) {
      process.stdout.write(`\r\n[reDOS] shell encerrado (exit ${r.code}) — ${m.cpu.steps} passos de CPU\r\n`);
      break;
    }
    // pediu tecla
    if (!interactive) break; // modo lote: acabou o roteiro
    const line = await nextLine();
    m.pushInputLine(line);
  }
  rl.close();
}

main().catch((e) => {
  flush();
  process.stdout.write(`\r\n[reDOS] falha do nucleo: ${e.message}\r\n`);
  process.exit(1);
});

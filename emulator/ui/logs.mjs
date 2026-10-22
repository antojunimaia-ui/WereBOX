// logs.mjs — o diario da sessao: o que a interface faz, o que o v86 avisa e o
// que aparece no console do navegador (inclusive o debug do proprio v86).

const MAX = 6000;
const entradas = [];
const assinantes = new Set();
const consoleOriginal = {};
let capturandoConsole = false;

const paraTexto = (v) => {
  if (typeof v === "string") return v;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  try { return typeof v === "object" && v !== null ? JSON.stringify(v) : String(v); } catch { return String(v); }
};

export const logs = {
  /** nivel: "info" | "ok" | "warn" | "err" | "dbg" */
  add(fonte, texto, nivel = "info") {
    const e = { t: Date.now(), fonte, nivel, texto: String(texto) };
    entradas.push(e);
    if (entradas.length > MAX) entradas.splice(0, entradas.length - MAX);
    for (const fn of assinantes) { try { fn(e); } catch { /* assinante quebrado nao derruba o log */ } }
    return e;
  },
  assinar(fn) { assinantes.add(fn); return () => assinantes.delete(fn); },
  lista: () => entradas,
  limpar() { entradas.length = 0; for (const fn of assinantes) { try { fn(null); } catch { /* ignore */ } } },
  /** junta tudo num texto (para baixar) */
  texto() {
    return entradas.map((e) => `${new Date(e.t).toISOString()} [${e.nivel.toUpperCase().padEnd(4)}] ${e.fonte}: ${e.texto}`).join("\n") + "\n";
  },
  /** passa a registrar (ou parar de registrar) o console do navegador */
  capturarConsole(ligar) {
    for (const m of ["log", "info", "warn", "error", "debug"]) {
      if (ligar && !consoleOriginal[m]) {
        consoleOriginal[m] = console[m].bind(console);
        console[m] = (...args) => {
          consoleOriginal[m](...args);
          if (capturandoConsole) return;
          capturandoConsole = true;
          try {
            const nivel = m === "error" ? "err" : m === "warn" ? "warn" : "dbg";
            logs.add("console", args.map(paraTexto).join(" "), nivel);
          } finally { capturandoConsole = false; }
        };
      } else if (!ligar && consoleOriginal[m]) {
        console[m] = consoleOriginal[m];
        consoleOriginal[m] = null;
      }
    }
  },
};

export const log = (texto, nivel = "info") => logs.add("reDOS", texto, nivel);
export const logV86 = (texto, nivel = "info") => logs.add("v86", texto, nivel);

window.addEventListener("error", (e) => logs.add("erro", `${e.message} — ${e.filename || "?"}:${e.lineno || 0}`, "err"));
window.addEventListener("unhandledrejection", (e) => logs.add("erro", "promessa rejeitada: " + paraTexto(e.reason?.message || e.reason), "err"));

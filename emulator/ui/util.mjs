// util.mjs — miudezas de DOM, formatacao e download usadas pela interface.

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

/**
 * Cria elementos: el("div", { class:"x", onclick:fn }, "texto", outroElemento)
 * Nunca usa innerHTML com dado vindo do disco (nome de arquivo entra como texto).
 */
export function el(tag, props = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "texto") n.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const f of filhos.flat(9)) {
    if (f === null || f === undefined || f === false) continue;
    n.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return n;
}

export const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

/** 16515072 -> "15,75 MB" */
export function fmtBytes(n, casas = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const un = ["B", "KB", "MB", "GB"];
  let i = 0, v = Number(n);
  while (v >= 1024 && i < un.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: i === 0 ? 0 : casas, maximumFractionDigits: i === 0 ? 0 : casas })} ${un[i]}`;
}

/** 16515072 -> "15,75 MB" (decimal, como o DOS mostra tamanho de disco) */
export const fmtMB = (bytes) => `${(bytes / 1048576).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MB`;

export const fmtHora = (t) => new Date(t).toLocaleTimeString("pt-BR");
export const fmtDataHora = (t) => new Date(t).toLocaleString("pt-BR");
export const fmtDuracao = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}min` : m ? `${m}min ${s % 60}s` : `${s}s`;
};

export function baixar(nome, dados, tipo = "application/octet-stream") {
  const blob = dados instanceof Blob ? dados : new Blob([dados], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: nome });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}

/** baixa um arquivo que já está no servidor sem carregar na memória (link direto) */
export function baixarDeUrl(url) {
  const a = el("a", { href: url, download: "" });
  document.body.append(a);
  a.click();
  setTimeout(() => a.remove(), 4000);
}

/** foto da tela do PC (o canvas do v86) em miniatura, para ilustrar um snapshot */
export function capturarTela(largura = 320) {
  const cv = document.querySelector("#screen canvas");
  if (!cv || !cv.width) return null;
  try {
    const mini = document.createElement("canvas");
    mini.width = largura;
    mini.height = Math.max(1, Math.round((cv.height * largura) / cv.width));
    const ctx2 = mini.getContext("2d");
    ctx2.imageSmoothingEnabled = false;
    ctx2.drawImage(cv, 0, 0, mini.width, mini.height);
    return mini.toDataURL("image/png");
  } catch { return null; }
}

/** abre o seletor de arquivos do sistema e devolve os File escolhidos (ou []) */
export function escolherArquivo({ aceita = "", multiplo = false } = {}) {
  return new Promise((resolve) => {
    const input = el("input", { type: "file", accept: aceita, multiple: multiplo, style: "display:none" });
    document.body.append(input);
    input.addEventListener("change", () => {
      const arquivos = Array.from(input.files || []);
      input.remove();
      resolve(arquivos);
    });
    input.click();
  });
}

export const paraBytes = (d) => (d instanceof Uint8Array ? d : new Uint8Array(d));


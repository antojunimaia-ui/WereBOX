// snapshots.mjs — guarda os "retratos" da maquina (RAM + dispositivos + disco) no
// IndexedDB do navegador, para sobreviverem ao F5.
import { log } from "./logs.mjs";

const NOME = "redos";
const LOJA = "snapshots";
const VERSAO = 1;

function abrirBanco() {
  return new Promise((res, rej) => {
    const pedido = indexedDB.open(NOME, VERSAO);
    pedido.onupgradeneeded = () => {
      const db = pedido.result;
      if (!db.objectStoreNames.contains(LOJA)) {
        const loja = db.createObjectStore(LOJA, { keyPath: "id" });
        loja.createIndex("criado", "criado");
      }
    };
    pedido.onsuccess = () => res(pedido.result);
    pedido.onerror = () => rej(pedido.error || new Error("não consegui abrir o IndexedDB"));
  });
}

async function comLoja(modo, fn) {
  const db = await abrirBanco();
  try {
    return await new Promise((res, rej) => {
      const tx = db.transaction(LOJA, modo);
      const loja = tx.objectStore(LOJA);
      let resultado;
      try { resultado = fn(loja); } catch (e) { rej(e); return; }
      tx.oncomplete = () => res(resultado && resultado.result !== undefined ? resultado.result : resultado);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  } finally { db.close(); }
}

/** snapshot = { id, nome, criado, estado (Uint8Array), tela (dataURL), resumo } */
export async function guardar(snap) {
  await comLoja("readwrite", (loja) => loja.put(snap));
  log(`snapshot "${snap.nome}" guardado (${(snap.estado.byteLength / 1048576).toFixed(1)} MB)`, "ok");
  return snap.id;
}

export async function listar() {
  const todos = await comLoja("readonly", (loja) => loja.getAll());
  return (todos || []).sort((a, b) => b.criado - a.criado);
}

export async function obter(id) {
  return comLoja("readonly", (loja) => loja.get(id));
}

export async function apagar(id) {
  await comLoja("readwrite", (loja) => loja.delete(id));
  log(`snapshot ${id} apagado`, "warn");
}

export async function espaco() {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { uso: e.usage, cota: e.quota } : null;
  } catch { return null; }
}

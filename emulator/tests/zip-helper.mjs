// tests/zip-helper.mjs — monta ZIPs de teste sem depender de nenhuma biblioteca
// externa. Suporta store/deflate, ZIP64 e nomes em CP437/UTF-8.
import { deflateRawSync } from "node:zlib";

const u16 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
const u32 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
const u64 = (n) => {
  const b = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 0; i < 8; i++) { b[i] = Number(v & 0xffn); v >>= 8n; }
  return b;
};
const texto = (s) => new TextEncoder().encode(String(s));
const bytesDe = (v) => v instanceof Uint8Array ? v : typeof v === "string" ? texto(v) : new Uint8Array(v ?? []);
const juntar = (...partes) => {
  const total = partes.reduce((n, p) => n + p.length, 0);
  const saida = new Uint8Array(total);
  let o = 0;
  for (const p of partes) { saida.set(p, o); o += p.length; }
  return saida;
};

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {Array<{nome?:string,nomeBruto?:Uint8Array,dados?:any,metodo?:number,flags?:number,
 *   crc?:number,zip64?:boolean,diretorio?:boolean,comprimido?:Uint8Array,
 *   descomprimido?:number,comprimidoDeclarado?:number}>} entradas
 * @param {{zip64?:boolean,zip64Eocd?:boolean,comentario?:string}} [opcoes]
 */
export function criarZip(entradas, { zip64 = false, zip64Eocd = false, comentario = "" } = {}) {
  const itens = entradas.map((e) => {
    const dados = bytesDe(e.dados);
    const metodo = e.metodo ?? 0;
    const comprimido = e.comprimido ?? (metodo === 8 ? new Uint8Array(deflateRawSync(dados)) : dados);
    const nomeBruto = e.nomeBruto ?? texto(e.nome ?? "");
    const nome = e.nome ?? new TextDecoder().decode(nomeBruto);
    return {
      ...e,
      nome,
      nomeBruto,
      dados,
      metodo,
      comprimido,
      crc: e.crc ?? crc32(dados),
      flags: e.flags ?? 0x0800,
      descomprimido: e.descomprimido ?? dados.length,
      comprimidoDeclarado: e.comprimidoDeclarado ?? comprimido.length,
      zip64: !!(zip64 || e.zip64),
      diretorio: e.diretorio ?? (nome.endsWith("/") || nome.endsWith("\\")),
    };
  });

  const locais = [];
  let offset = 0;
  for (const item of itens) {
    item.offsetLocal = offset;
    const nomeLen = item.nomeBruto.length;
    const extraLocal = item.zip64
      ? juntar(u16(0x0001), u16(16), u64(item.descomprimido), u64(item.comprimidoDeclarado))
      : new Uint8Array(0);
    const local = juntar(
      u32(0x04034b50), u16(item.zip64 ? 45 : 20), u16(item.flags), u16(item.metodo),
      u16(0), u16(0), u32(item.crc),
      u32(item.zip64 ? 0xffffffff : item.comprimidoDeclarado),
      u32(item.zip64 ? 0xffffffff : item.descomprimido),
      u16(nomeLen), u16(extraLocal.length), item.nomeBruto, extraLocal, item.comprimido,
    );
    locais.push(local);
    offset += local.length;
  }

  const centrais = [];
  for (const item of itens) {
    const nomeLen = item.nomeBruto.length;
    const extraCentral = item.zip64
      ? juntar(u16(0x0001), u16(24), u64(item.descomprimido), u64(item.comprimidoDeclarado), u64(item.offsetLocal))
      : new Uint8Array(0);
    const attrExterno = item.diretorio ? 0x10 : 0;
    centrais.push(juntar(
      u32(0x02014b50), u16(item.zip64 ? 45 : 20), u16(item.zip64 ? 45 : 20),
      u16(item.flags), u16(item.metodo), u16(0), u16(0), u32(item.crc),
      u32(item.zip64 ? 0xffffffff : item.comprimidoDeclarado),
      u32(item.zip64 ? 0xffffffff : item.descomprimido),
      u16(nomeLen), u16(extraCentral.length), u16(0), u16(0), u16(0), u32(attrExterno),
      u32(item.zip64 ? 0xffffffff : item.offsetLocal),
      item.nomeBruto, extraCentral,
    ));
  }

  const cd = juntar(...centrais);
  const cdOffset = offset;
  const cdSize = cd.length;
  const total = itens.length;
  const precisaZip64 = !!(zip64 || zip64Eocd) || total > 0xffff || cdSize > 0xffffffff || cdOffset > 0xffffffff;

  let zip64EocdBytes = new Uint8Array(0);
  let locator = new Uint8Array(0);
  if (precisaZip64) {
    const offZip64 = cdOffset + cdSize;
    zip64EocdBytes = juntar(
      u32(0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0),
      u64(total), u64(total), u64(cdSize), u64(cdOffset),
    );
    locator = juntar(u32(0x07064b50), u32(0), u64(offZip64), u32(1));
  }

  const comentarioBytes = texto(comentario);
  const eocd = juntar(
    u32(0x06054b50), u16(0), u16(0),
    u16(precisaZip64 ? 0xffff : total), u16(precisaZip64 ? 0xffff : total),
    u32(precisaZip64 ? 0xffffffff : cdSize), u32(precisaZip64 ? 0xffffffff : cdOffset),
    u16(comentarioBytes.length), comentarioBytes,
  );

  return juntar(...locais, cd, zip64EocdBytes, locator, eocd);
}

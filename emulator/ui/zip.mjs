// zip.mjs — le e extrai ZIPs direto no FAT da maquina emulada.
//
// O navegador ja' sabe inflar deflate (DecompressionStream "deflate-raw"), entao
// nao precisamos de uma biblioteca: lemos o diretorio central, descompactamos
// cada entrada na memoria, conferimos o CRC e gravamos no FAT com nomes 8.3.
//
// O que nao e' suportado (ZIP criptografado, metodos alem de store/deflate,
// caminhos com "..", espaco insuficiente) vira um ErroZip; o chamador decide se
// grava o ZIP inteiro como fallback.
import { nome83Seguro } from "./nomes.mjs";

const ASSINATURAS = {
  local: 0x04034b50,
  central: 0x02014b50,
  eocd: 0x06054b50,
  zip64Eocd: 0x06064b50,
  zip64Locator: 0x07064b50,
};

const MAX_ENTRADAS = 4096;
const MAX_PROFUNDIDADE = 16;
const MAX_NOME = 1024;
const MAX_DESCOMPRIMIDO_PADRAO = 256 * 1024 * 1024;

export class ErroZip extends Error {
  constructor(mensagem, codigo = "zip") {
    super(mensagem);
    this.name = "ErroZip";
    this.codigo = codigo;
  }
}

function precisa(bytes, off, n) {
  if (off < 0 || n < 0 || off + n > bytes.length) {
    throw new ErroZip("ZIP truncado ou corrompido", "formato");
  }
}

const u16 = (b, o) => { precisa(b, o, 2); return b[o] | (b[o + 1] << 8); };
const u32 = (b, o) => {
  precisa(b, o, 4);
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
};
const u64 = (b, o) => {
  const baixo = u32(b, o);
  const alto = u32(b, o + 4);
  // Acima disso o numero nao cabe exato em double; um ZIP desse tamanho nao
  // cabe em memoria de qualquer jeito.
  if (alto > 0x1fffff) throw new ErroZip("valor ZIP64 grande demais", "formato");
  return baixo + alto * 0x100000000;
};

/** true se o comeco dos bytes parece um ZIP (cabecalho local ou EOCD vazio) */
export function ehZip(bytes) {
  if (!bytes || bytes.length < 4) return false;
  return bytes[0] === 0x50 && bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06));
}

// ---------------------------------------------------------------- CRC32
let tabelaCrc = null;
function tabelaCrc32() {
  if (tabelaCrc) return tabelaCrc;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  tabelaCrc = t;
  return t;
}

export function crc32(bytes) {
  const t = tabelaCrc32();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- nomes
// CP437 e' o padrao do ZIP quando o bit 11 (UTF-8) nao esta' ligado.
const CP437_ALTA = [
  0x00c7, 0x00fc, 0x00e9, 0x00e2, 0x00e4, 0x00e0, 0x00e5, 0x00e7,
  0x00ea, 0x00eb, 0x00e8, 0x00ef, 0x00ee, 0x00ec, 0x00c4, 0x00c5,
  0x00c9, 0x00e6, 0x00c6, 0x00f4, 0x00f6, 0x00f2, 0x00fb, 0x00f9,
  0x00ff, 0x00d6, 0x00dc, 0x00a2, 0x00a3, 0x00a5, 0x20a7, 0x0192,
  0x00e1, 0x00ed, 0x00f3, 0x00fa, 0x00f1, 0x00d1, 0x00aa, 0x00ba,
  0x00bf, 0x2310, 0x00ac, 0x00bd, 0x00bc, 0x00a1, 0x00ab, 0x00bb,
  0x2591, 0x2592, 0x2593, 0x2502, 0x2524, 0x2561, 0x2562, 0x2556,
  0x2555, 0x2563, 0x2551, 0x2557, 0x255d, 0x255c, 0x255b, 0x2510,
  0x2514, 0x2534, 0x252c, 0x251c, 0x2500, 0x253c, 0x255e, 0x255f,
  0x255a, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256c, 0x2567,
  0x2568, 0x2564, 0x2565, 0x2559, 0x2558, 0x2552, 0x2553, 0x256b,
  0x256a, 0x2518, 0x250c, 0x2588, 0x2584, 0x258c, 0x2590, 0x2580,
  0x03b1, 0x00df, 0x0393, 0x03c0, 0x03a3, 0x03c3, 0x00b5, 0x03c4,
  0x03a6, 0x0398, 0x03a9, 0x03b4, 0x221e, 0x03c6, 0x03b5, 0x2229,
  0x2261, 0x00b1, 0x2265, 0x2264, 0x2320, 0x2321, 0x00f7, 0x2248,
  0x00b0, 0x2219, 0x00b7, 0x221a, 0x207f, 0x00b2, 0x25a0, 0x00a0,
];

function decodificarNome(bruto, flags) {
  if (flags & 0x0800) return new TextDecoder("utf-8", { fatal: false }).decode(bruto);
  let s = "";
  for (let i = 0; i < bruto.length; i++) {
    const b = bruto[i];
    s += String.fromCharCode(b < 0x80 ? b : CP437_ALTA[b - 0x80]);
  }
  return s;
}

/** separa e valida o caminho de uma entrada; rejeita absoluto e ".." */
function caminhoDaEntrada(nome) {
  if (nome.length > MAX_NOME) {
    throw new ErroZip(`nome de entrada grande demais (${nome.length} caracteres)`, "nome");
  }
  if (/[\x00-\x1f]/.test(nome)) {
    throw new ErroZip("nome de entrada com caractere de controle", "nome");
  }
  const normal = nome.replace(/\\/g, "/");
  if (normal.startsWith("/") || /^[A-Za-z]:/.test(normal)) {
    throw new ErroZip(`caminho absoluto não é aceito: ${nome}`, "nome");
  }
  const partes = normal.split("/").filter((p) => p && p !== ".");
  if (partes.some((p) => p === "..")) {
    throw new ErroZip(`caminho com ".." não é aceito: ${nome}`, "nome");
  }
  if (partes.length > MAX_PROFUNDIDADE) {
    throw new ErroZip(`caminho fundo demais (${partes.length} níveis): ${nome}`, "nome");
  }
  return partes;
}

// ---------------------------------------------------------------- leitura
function acharEOCD(bytes) {
  if (bytes.length < 22) throw new ErroZip("arquivo pequeno demais para ser um ZIP", "formato");
  const minimo = Math.max(0, bytes.length - 22 - 0xffff);
  const ehEocd = (i) => bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06;
  // Primeiro procura um EOCD cujo comentario termina exatamente no fim.
  for (let i = bytes.length - 22; i >= minimo; i--) {
    if (!ehEocd(i)) continue;
    const comentario = u16(bytes, i + 20);
    if (i + 22 + comentario === bytes.length) return i;
  }
  // Alguns arquivos tem lixo depois do EOCD; aceita o ultimo que caiba.
  for (let i = bytes.length - 22; i >= minimo; i--) {
    if (!ehEocd(i)) continue;
    const comentario = u16(bytes, i + 20);
    if (i + 22 + comentario <= bytes.length) return i;
  }
  throw new ErroZip("não achei o diretório central (não parece um ZIP)", "formato");
}

function lerZip64(bytes, eocdOff) {
  const locOff = eocdOff - 20;
  if (locOff < 0) return null;
  if (bytes[locOff] !== 0x50 || bytes[locOff + 1] !== 0x4b ||
      bytes[locOff + 2] !== 0x06 || bytes[locOff + 3] !== 0x07) return null;
  const discoZip64 = u32(bytes, locOff + 4);
  const offZip64 = u64(bytes, locOff + 8);
  const totalDiscos = u32(bytes, locOff + 16);
  if (discoZip64 !== 0 || totalDiscos !== 1) {
    throw new ErroZip("ZIP em vários discos não é suportado", "formato");
  }
  precisa(bytes, offZip64, 56);
  if (u32(bytes, offZip64) !== ASSINATURAS.zip64Eocd) {
    throw new ErroZip("cabeçalho ZIP64 inválido", "formato");
  }
  const tamRegistro = u64(bytes, offZip64 + 4);
  if (tamRegistro < 44) throw new ErroZip("cabeçalho ZIP64 inválido", "formato");
  precisa(bytes, offZip64 + 12, tamRegistro);
  return {
    disco: u32(bytes, offZip64 + 16),
    discoCD: u32(bytes, offZip64 + 20),
    totalEntradas: u64(bytes, offZip64 + 32),
    tamanhoCD: u64(bytes, offZip64 + 40),
    offsetCD: u64(bytes, offZip64 + 48),
  };
}

function lerExtraZip64(extra, precisaDesc, precisaComp, precisaOffset, precisaDisco) {
  let p = 0;
  while (p + 4 <= extra.length) {
    const id = u16(extra, p);
    const tam = u16(extra, p + 2);
    if (p + 4 + tam > extra.length) break;
    if (id === 0x0001) {
      const dados = extra.subarray(p + 4, p + 4 + tam);
      let q = 0;
      const ler64 = () => {
        if (q + 8 > dados.length) throw new ErroZip("campo ZIP64 incompleto", "formato");
        const v = u64(dados, q);
        q += 8;
        return v;
      };
      const ler32 = () => {
        if (q + 4 > dados.length) throw new ErroZip("campo ZIP64 incompleto", "formato");
        const v = u32(dados, q);
        q += 4;
        return v;
      };
      const fora = {};
      if (precisaDesc) fora.descomprimido = ler64();
      if (precisaComp) fora.comprimido = ler64();
      if (precisaOffset) fora.offsetLocal = ler64();
      if (precisaDisco) fora.disco = ler32();
      return fora;
    }
    p += 4 + tam;
  }
  return null;
}

/**
 * Le o diretorio central e devolve as entradas, sem descompactar nada.
 * @returns {{entradas: object[], comentario: string, zip64: boolean}}
 */
export function analisarZip(bytes, { limiteEntradas = MAX_ENTRADAS } = {}) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  const eocdOff = acharEOCD(bytes);
  const disco = u16(bytes, eocdOff + 4);
  const discoCD = u16(bytes, eocdOff + 6);
  const entradasDisco = u16(bytes, eocdOff + 8);
  let totalEntradas = u16(bytes, eocdOff + 10);
  let tamanhoCD = u32(bytes, eocdOff + 12);
  let offsetCD = u32(bytes, eocdOff + 16);
  const comentarioLen = u16(bytes, eocdOff + 20);
  const comentario = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(eocdOff + 22, eocdOff + 22 + comentarioLen));

  const sentinela = disco === 0xffff || discoCD === 0xffff || entradasDisco === 0xffff ||
    totalEntradas === 0xffff || tamanhoCD === 0xffffffff || offsetCD === 0xffffffff;
  let zip64 = false;
  if (sentinela) {
    const z = lerZip64(bytes, eocdOff);
    if (z) {
      if (z.disco !== 0 || z.discoCD !== 0) throw new ErroZip("ZIP em vários discos não é suportado", "formato");
      totalEntradas = z.totalEntradas;
      tamanhoCD = z.tamanhoCD;
      offsetCD = z.offsetCD;
      zip64 = true;
    } else if (disco !== 0 || discoCD !== 0) {
      throw new ErroZip("ZIP em vários discos não é suportado", "formato");
    }
  } else if (disco !== 0 || discoCD !== 0) {
    throw new ErroZip("ZIP em vários discos não é suportado", "formato");
  }

  if (totalEntradas > limiteEntradas) {
    throw new ErroZip(`o ZIP tem ${totalEntradas} entradas; o limite é ${limiteEntradas}`, "limite");
  }
  if (offsetCD + tamanhoCD > bytes.length) {
    throw new ErroZip("diretório central fora do arquivo", "formato");
  }

  const fimCD = offsetCD + tamanhoCD;
  const entradas = [];
  let p = offsetCD;
  for (let i = 0; i < totalEntradas; i++) {
    if (p + 46 > fimCD) throw new ErroZip("diretório central truncado", "formato");
    if (u32(bytes, p) !== ASSINATURAS.central) {
      throw new ErroZip(`entrada ${i + 1} do diretório central é inválida`, "formato");
    }
    const flags = u16(bytes, p + 8);
    const metodo = u16(bytes, p + 10);
    const crc = u32(bytes, p + 16);
    let comprimido = u32(bytes, p + 20);
    let descomprimido = u32(bytes, p + 24);
    const nomeLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const comentarioEntrada = u16(bytes, p + 32);
    let discoInicio = u16(bytes, p + 34);
    const attrExterno = u32(bytes, p + 38);
    let offsetLocal = u32(bytes, p + 42);
    if (p + 46 + nomeLen + extraLen + comentarioEntrada > fimCD) {
      throw new ErroZip("diretório central truncado", "formato");
    }
    const nomeBruto = bytes.subarray(p + 46, p + 46 + nomeLen);
    const extra = bytes.subarray(p + 46 + nomeLen, p + 46 + nomeLen + extraLen);

    const precisaDesc = descomprimido === 0xffffffff;
    const precisaComp = comprimido === 0xffffffff;
    const precisaOffset = offsetLocal === 0xffffffff;
    const precisaDisco = discoInicio === 0xffff;
    if (precisaDesc || precisaComp || precisaOffset || precisaDisco) {
      const z = lerExtraZip64(extra, precisaDesc, precisaComp, precisaOffset, precisaDisco);
      if (!z) throw new ErroZip("entrada ZIP64 sem o campo 0x0001", "formato");
      if (precisaDesc) descomprimido = z.descomprimido;
      if (precisaComp) comprimido = z.comprimido;
      if (precisaOffset) offsetLocal = z.offsetLocal;
      if (precisaDisco) discoInicio = z.disco;
    }
    if (discoInicio !== 0) throw new ErroZip("ZIP em vários discos não é suportado", "formato");

    const nome = decodificarNome(nomeBruto, flags);
    const diretorio = nome.endsWith("/") || nome.endsWith("\\") ||
      (attrExterno & 0x10) !== 0 || ((attrExterno >>> 16) & 0xf000) === 0x4000;
    entradas.push({
      nome,
      flags,
      metodo,
      crc,
      comprimido,
      descomprimido,
      offsetLocal,
      attrExterno,
      diretorio,
      criptografado: (flags & 0x0001) !== 0 || (flags & 0x0040) !== 0,
      utf8: (flags & 0x0800) !== 0,
    });
    p += 46 + nomeLen + extraLen + comentarioEntrada;
  }
  return { entradas, comentario, zip64 };
}

/** bytes comprimidos de uma entrada, usando os tamanhos do cabecalho local */
function dadosDaEntrada(bytes, entrada) {
  const off = entrada.offsetLocal;
  precisa(bytes, off, 30);
  if (u32(bytes, off) !== ASSINATURAS.local) {
    throw new ErroZip(`cabeçalho local inválido para "${entrada.nome}"`, "formato");
  }
  const metodoLocal = u16(bytes, off + 8);
  if (metodoLocal !== entrada.metodo) {
    throw new ErroZip(`método de compressão diferente no cabeçalho local de "${entrada.nome}"`, "formato");
  }
  const nomeLen = u16(bytes, off + 26);
  const extraLen = u16(bytes, off + 28);
  const inicio = off + 30 + nomeLen + extraLen;
  precisa(bytes, inicio, entrada.comprimido);
  return bytes.subarray(inicio, inicio + entrada.comprimido);
}

// ---------------------------------------------------------------- inflate
async function inflar(bytes, limite) {
  if (typeof DecompressionStream !== "function" || typeof Blob !== "function") {
    throw new ErroZip("este navegador não sabe descompactar deflate (ZIP)", "formato");
  }
  let fluxo;
  try {
    fluxo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  } catch (e) {
    throw new ErroZip(`este navegador não sabe descompactar deflate: ${e.message}`, "formato");
  }
  const leitor = fluxo.getReader();
  const pedacos = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      total += value.length;
      if (total > limite) {
        try { await leitor.cancel(); } catch { /* ja' falhou */ }
        throw new ErroZip(`o ZIP descompacta para mais de ${limite} bytes`, "limite");
      }
      pedacos.push(value);
    }
  } catch (e) {
    if (e instanceof ErroZip) throw e;
    throw new ErroZip(`não consegui descompactar o deflate: ${e.message}`, "formato");
  } finally {
    try { leitor.releaseLock(); } catch { /* ignore */ }
  }
  const saida = new Uint8Array(total);
  let o = 0;
  for (const pedaco of pedacos) { saida.set(pedaco, o); o += pedaco.length; }
  return saida;
}

// ---------------------------------------------------------------- arvore 8.3
function novoNo(cluster, entradas, novo, pai, nome, nomeOriginal, mudou) {
  const uteis = entradas.filter((e) => !e.atual && !e.pai);
  return {
    cluster,
    novo,
    nomes: new Set(uteis.map((e) => e.nomeCompleto)),
    existentes: new Map(uteis.map((e) => [e.nomeCompleto, e])),
    filhos: new Map(),
    arquivos: [],
    pastas: [],
    pai,
    nome,
    nomeOriginal,
    mudou,
  };
}

function obterPasta(no, componente, fs) {
  const chave = componente.toUpperCase();
  if (no.filhos.has(chave)) return no.filhos.get(chave);
  const escolhido = nome83Seguro(componente, no.nomes);
  const existente = no.existentes.get(escolhido.nome);
  const filho = existente && existente.diretorio
    ? novoNo(existente.cluster, fs.listar(existente.cluster), false, no, escolhido.nome, componente, escolhido.mudou)
    : novoNo(null, [], true, no, escolhido.nome, componente, escolhido.mudou);
  no.nomes.add(escolhido.nome);
  no.pastas.push(filho);
  no.filhos.set(chave, filho);
  return filho;
}

/** monta a arvore de pastas/arquivos e resolve os nomes 8.3 sem tocar no disco */
function planejar(zip, fs, cluster, dados) {
  const raiz = novoNo(cluster, fs.listar(cluster), false, null, null, null, false);
  for (let i = 0; i < zip.entradas.length; i++) {
    const e = zip.entradas[i];
    if (e.ignorar) continue;
    let no = raiz;
    for (let j = 0; j < e.partes.length - 1; j++) no = obterPasta(no, e.partes[j], fs);
    const ultimo = e.partes[e.partes.length - 1];
    if (e.diretorio) {
      obterPasta(no, ultimo, fs);
    } else {
      const escolhido = nome83Seguro(ultimo, no.nomes);
      no.nomes.add(escolhido.nome);
      no.arquivos.push({
        entrada: e,
        indice: i,
        nome: escolhido.nome,
        nomeOriginal: ultimo,
        mudou: escolhido.mudou,
        dados: dados.get(i),
      });
    }
  }
  return raiz;
}

function medir(no, info) {
  let arquivos = 0, pastas = 0, bytes = 0, clusters = 0;
  for (const a of no.arquivos) {
    arquivos++;
    bytes += a.dados.length;
    clusters += Math.ceil(a.dados.length / info.bytesPorCluster);
  }
  for (const p of no.pastas) {
    if (p.novo) { pastas++; clusters++; }
    const m = medir(p, info);
    arquivos += m.arquivos;
    pastas += m.pastas;
    bytes += m.bytes;
    clusters += m.clusters;
  }
  return { arquivos, pastas, bytes, clusters };
}

/** confere se cada pasta comporta as entradas que vamos criar (o FAT nao cresce sozinho) */
function verificarCapacidade(no, fs, info) {
  const porCluster = Math.floor(info.bytesPorCluster / 32);
  const capacidade = no.cluster === 0
    ? info.entradasRaiz
    : (no.novo ? porCluster : fs.cadeia(no.cluster).length * porCluster);
  const usadas = no.novo ? 2 : fs.listar(no.cluster).length;
  const novas = no.arquivos.length + no.pastas.filter((p) => p.novo).length;
  if (usadas + novas > capacidade) {
    const nome = no.nome || "a raiz";
    throw new ErroZip(`a pasta ${nome} não tem entradas livres suficientes (${usadas + novas} de ${capacidade})`, "espaco");
  }
  for (const p of no.pastas) verificarCapacidade(p, fs, info);
}

function escrever(no, fs, criados) {
  for (const a of no.arquivos) {
    const entrada = fs.gravar(no.cluster, a.nome, a.dados) ||
      fs.listar(no.cluster).find((e) => !e.diretorio && e.nomeCompleto === a.nome);
    if (!entrada) throw new Error(`não consegui localizar ${a.nome} depois de gravar`);
    criados.push({ clusterPai: no.cluster, entrada });
  }
  for (const p of no.pastas) {
    if (p.novo) {
      const entrada = fs.criarPasta(no.cluster, p.nome) ||
        fs.listar(no.cluster).find((e) => e.diretorio && e.nomeCompleto === p.nome);
      if (!entrada) throw new Error(`não consegui localizar a pasta ${p.nome} depois de criar`);
      p.cluster = entrada.cluster;
      criados.push({ clusterPai: no.cluster, entrada });
    }
    escrever(p, fs, criados);
  }
}

/**
 * Extrai um ZIP para o diretorio `cluster` do FAT.
 *
 * @param {Uint8Array} bytes              conteudo do ZIP
 * @param {object} fs                     retorno de abrirFS()
 * @param {number} [cluster=0]            diretorio de destino (0 = raiz)
 * @param {object} [opcoes]
 * @param {number} [opcoes.limiteBytes]   teto de bytes descompactados (senao usa o espaco livre)
 * @param {number} [opcoes.limiteEntradas=4096]
 * @returns {Promise<{arquivos:number,pastas:number,bytes:number,bytesZip:number,entradasIgnoradas:number}>}
 */
export async function extrairZipParaDisco(bytes, fs, cluster = 0, {
  limiteBytes,
  limiteEntradas = MAX_ENTRADAS,
} = {}) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  if (!fs || typeof fs.listar !== "function" || typeof fs.gravar !== "function" ||
      typeof fs.criarPasta !== "function" || typeof fs.info !== "function") {
    throw new Error("sistema de arquivos inválido para extrair o ZIP");
  }
  const zip = analisarZip(bytes, { limiteEntradas });
  if (zip.entradas.length === 0) throw new ErroZip("o ZIP está vazio (não tem nenhum arquivo)", "formato");

  for (const e of zip.entradas) {
    e.partes = caminhoDaEntrada(e.nome);
    e.ignorar = e.partes.length === 0;
  }

  const info = fs.info();
  const disponivel = Math.max(0, Number(info.bytesLivres) - Number(info.bytesPorCluster));
  if (disponivel < 1) throw new ErroZip("o disco não tem espaço livre para extrair o ZIP", "espaco");
  const teto = Number.isFinite(limiteBytes) && limiteBytes > 0 ? limiteBytes : MAX_DESCOMPRIMIDO_PADRAO;
  const limite = Math.min(teto, disponivel);
  const codigoLimite = disponivel <= teto ? "espaco" : "limite";

  // Descompacta e valida tudo antes de escrever qualquer coisa. Assim um ZIP
  // corrompido ou grande demais nao deixa arquivos pela metade.
  let total = 0;
  const dados = new Map();
  for (let i = 0; i < zip.entradas.length; i++) {
    const e = zip.entradas[i];
    if (e.ignorar || e.diretorio) continue;
    if (e.criptografado) {
      throw new ErroZip(`"${e.nome}" está criptografado (ZIP com senha/AES não é suportado)`, "criptografado");
    }
    if (e.metodo !== 0 && e.metodo !== 8) {
      throw new ErroZip(`"${e.nome}" usa o método de compressão ${e.metodo}, que não é suportado`, "metodo");
    }
    if (e.descomprimido > limite - total) {
      throw new ErroZip(
        codigoLimite === "espaco"
          ? `o ZIP extraído não cabe no disco (falta espaço): precisa de mais de ${limite} bytes`
          : `o ZIP descompacta para mais de ${limite} bytes`,
        codigoLimite,
      );
    }
    const comprimido = dadosDaEntrada(bytes, e);
    let conteudo;
    if (e.metodo === 0) {
      if (e.comprimido !== e.descomprimido) {
        throw new ErroZip(`"${e.nome}" tem tamanho comprimido diferente do descompactado`, "formato");
      }
      conteudo = comprimido;
    } else {
      conteudo = await inflar(comprimido, limite - total);
    }
    if (conteudo.length !== e.descomprimido) {
      throw new ErroZip(`"${e.nome}" descompactou ${conteudo.length} bytes, mas o ZIP dizia ${e.descomprimido}`, "formato");
    }
    if (crc32(conteudo) !== e.crc) {
      throw new ErroZip(`o CRC de "${e.nome}" não confere (arquivo corrompido)`, "crc");
    }
    total += conteudo.length;
    dados.set(i, conteudo);
  }

  const raiz = planejar(zip, fs, cluster, dados);
  const medida = medir(raiz, info);
  const necessario = medida.clusters * info.bytesPorCluster;
  if (necessario > disponivel) {
    throw new ErroZip(`o ZIP extraído precisa de ${necessario} bytes e o disco só tem ${disponivel} livres`, "espaco");
  }
  verificarCapacidade(raiz, fs, info);

  const criados = [];
  try {
    escrever(raiz, fs, criados);
  } catch (e) {
    const falhas = [];
    for (let i = criados.length - 1; i >= 0; i--) {
      try { fs.apagar(criados[i].clusterPai, criados[i].entrada); }
      catch (err) { falhas.push(err.message); }
    }
    if (falhas.length) e.message += ` (limpeza parcial: ${falhas.join("; ")})`;
    throw e;
  }

  return {
    arquivos: medida.arquivos,
    pastas: medida.pastas,
    bytes: medida.bytes,
    bytesZip: bytes.length,
    entradasIgnoradas: zip.entradas.filter((e) => e.ignorar).length,
  };
}

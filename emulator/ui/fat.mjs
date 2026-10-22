// fat.mjs — leitor/gravador de FAT12 e FAT16.
//
// E o que o reDOS usa para "gerenciar os proprios arquivos da maquina": listar,
// ler, gravar, criar pasta e apagar dentro da imagem do disco do DOS.
//
// Fala com um "dispositivo de blocos":
//     { get(offset, tamanho) -> Uint8Array,   set(offset, bytes) }
// Assim o mesmo codigo serve para a imagem viva do v86 (SyncBuffer) e para um
// arquivo .img lido no Node (testes). Nao entende LFN: trabalha em 8.3.

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0);

/** Uint8Array -> string (byte = caractere). Nao usar .toString("latin1"): em Uint8Array
 *  (diferente de Buffer) o argumento e ignorado e sai "82,69,68,...". */
const texto = (b, ini, fim) => {
  let s = "";
  for (let i = ini; i < fim; i++) s += String.fromCharCode(b[i]);
  return s;
};
const bytesDe = (s) => {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
};

const TIPOS_FAT = [0x01, 0x04, 0x06, 0x0b, 0x0c, 0x0e];
export const ATTR = { somenteLeitura: 0x01, oculto: 0x02, sistema: 0x04, volume: 0x08, diretorio: 0x10, arquivo: 0x20 };

const INVALIDOS = /["*+,/:;<=>?[\\\]|\x00-\x1f]/;

/** "relatorio.txt" -> { nome:"RELATORIO", ext:"TXT", completo:"RELATORIO.TXT" } (ou lanca) */
export function normalizar83(nome) {
  const limpo = String(nome).trim().toUpperCase();
  if (!limpo) throw new Error("nome vazio");
  const partes = limpo.split(".");
  const ext = partes.length > 1 ? partes.pop() : "";
  const base = partes.join(".");
  if (!base || base.length > 8) throw new Error("o nome (ate o ponto) precisa ter 1 a 8 caracteres");
  if (ext.length > 3) throw new Error("a extensao precisa ter ate 3 caracteres");
  if (INVALIDOS.test(base + ext)) throw new Error('nome com caractere proibido (" * + , / : ; < = > ? [ \\ ] |)');
  return { nome: base, ext, completo: ext ? `${base}.${ext}` : base };
}

/** fat.data(12345) -> "16/10/26 08:26"  (o formato do DOS) */
export function dataDOS(data, hora) {
  if (!data) return "";
  const dia = data & 31, mes = (data >> 5) & 15, ano = 1980 + ((data >> 9) & 127);
  const h = (hora >> 11) & 31, m = (hora >> 5) & 63;
  const p = (n) => String(n).padStart(2, "0");
  return `${p(dia)}/${p(mes)}/${String(ano).slice(2)} ${p(h)}:${p(m)}`;
}

function dataHoraAgora() {
  const d = new Date();
  const data = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  const hora = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  return { data, hora };
}

/**
 * Monta o sistema de arquivos de um dispositivo de blocos.
 * @param {{get:(o:number,n:number)=>Uint8Array, set:(o:number,b:Uint8Array)=>void}} dev
 */
export function abrirFS(dev) {
  const sec0 = dev.get(0, 512);
  if (sec0[510] !== 0x55 || sec0[511] !== 0xaa) throw new Error("o setor 0 nao tem assinatura de boot (55 AA)");

  // ---- particao (se nao achar, trata como superdisquete: base 0)
  let base = 0, particao = null;
  for (let i = 0; i < 4; i++) {
    const o = 0x1be + i * 16;
    const tipo = sec0[o + 4], lba = u32(sec0, o + 8), setores = u32(sec0, o + 12);
    if (tipo && lba && setores && TIPOS_FAT.includes(tipo)) {
      base = lba * 512;
      particao = { indice: i + 1, ativa: sec0[o] === 0x80, tipo, lba, setores, bytes: setores * 512 };
      break;
    }
  }

  const bpb = dev.get(base, 512);
  const bytesPorSetor = u16(bpb, 11);
  const setoresPorCluster = bpb[13];
  const reservados = u16(bpb, 14);
  const numFATs = bpb[16];
  const entradasRaiz = u16(bpb, 17);
  const setoresTotais = u16(bpb, 19) || u32(bpb, 32);
  const setoresPorFAT = u16(bpb, 22) || u32(bpb, 36);
  const setoresOcultos = u32(bpb, 28);
  const serial = u32(bpb, 39);
  const oem = texto(bpb, 3, 11).replace(/\0/g, "").trim();
  const rotuloBPB = texto(bpb, 43, 54).replace(/\0/g, "").trim();

  if (!bytesPorSetor || !setoresPorCluster) throw new Error("BPB invalido (bytes/setor ou setores/cluster zerados)");

  const setoresRaiz = Math.ceil((entradasRaiz * 32) / bytesPorSetor);
  const inicioDados = reservados + numFATs * setoresPorFAT + setoresRaiz; // em setores, relativo ao base
  const setoresDados = setoresTotais - inicioDados;
  const clusters = Math.floor(setoresDados / setoresPorCluster);
  const bits = clusters < 4085 ? 12 : 16;
  const bytesPorCluster = bytesPorSetor * setoresPorCluster;
  const entradasPorCluster = bytesPorCluster / 32;

  const offFAT = (copia) => base + reservados * bytesPorSetor + copia * setoresPorFAT * bytesPorSetor;
  const offRaiz = base + (reservados + numFATs * setoresPorFAT) * bytesPorSetor;
  const offCluster = (c) => base + (inicioDados + (c - 2) * setoresPorCluster) * bytesPorSetor;
  const fim = bits === 12 ? 0xfff : 0xffff;

  // ---------------------------------------------------------------- FAT em memoria
  const fatBytes = setoresPorFAT * bytesPorSetor;
  const fat = dev.get(offFAT(0), fatBytes).slice();
  const fatSujos = new Set(); // indices de setor (512 B) alterados dentro da FAT

  function lerFAT(n) {
    if (bits === 12) { const o = n + (n >> 1), w = fat[o] | (fat[o + 1] << 8); return (n & 1) ? (w >> 4) : (w & 0xfff); }
    return u16(fat, n * 2);
  }
  function gravarFAT(n, v) {
    if (bits === 12) {
      const o = n + (n >> 1), w = fat[o] | (fat[o + 1] << 8);
      const nw = (n & 1) ? ((w & 0x000f) | ((v & 0xfff) << 4)) : ((w & 0xf000) | (v & 0xfff));
      fat[o] = nw & 0xff; fat[o + 1] = (nw >> 8) & 0xff;
      fatSujos.add(o >> 9); fatSujos.add((o + 1) >> 9);
    } else {
      fat[n * 2] = v & 0xff; fat[n * 2 + 1] = (v >> 8) & 0xff;
      fatSujos.add((n * 2) >> 9); fatSujos.add((n * 2 + 1) >> 9);
    }
  }
  /** grava na imagem so os setores da FAT que mudaram (nas duas copias) */
  function aplicarFAT() {
    for (const setor of fatSujos) {
      const ini = setor * 512;
      const pedaco = fat.subarray(ini, Math.min(ini + 512, fat.length));
      for (let i = 0; i < numFATs; i++) dev.set(offFAT(i) + ini, pedaco);
    }
    fatSujos.clear();
  }

  const cadeia = (inicial, limite = 100000) => {
    const fora = [];
    let c = inicial;
    while (c >= 2 && c < clusters + 2 && fora.length < limite) {
      fora.push(c);
      const prox = lerFAT(c);
      if (prox >= 0xff8 || prox >= 0xfff8 || prox === 0) break;
      c = prox;
    }
    return fora;
  };
  const liberarCadeia = (inicial) => { for (const c of cadeia(inicial)) gravarFAT(c, 0); };

  let dica = 2;
  function clusterLivre() {
    for (let n = dica; n < clusters + 2; n++) if (!lerFAT(n)) { dica = n + 1; return n; }
    for (let n = 2; n < dica; n++) if (!lerFAT(n)) { dica = n + 1; return n; }
    return 0;
  }
  function clustersLivres() {
    let n = 0;
    for (let c = 2; c < clusters + 2; c++) if (!lerFAT(c)) n++;
    return n;
  }

  // ---------------------------------------------------------------- diretorios
  const offEntrada = (cluster, indice, dir) => {
    if (!cluster) return offRaiz + indice * 32;
    const porCluster = entradasPorCluster;
    const c = dir.cadeia[Math.floor(indice / porCluster)];
    if (!c) throw new Error("diretorio cheio");
    return offCluster(c) + (indice % porCluster) * 32;
  };
  function carregarDir(cluster) {
    if (!cluster) {
      const dados = dev.get(offRaiz, entradasRaiz * 32).slice();
      return { cluster: 0, dados, total: entradasRaiz, cadeia: null };
    }
    const cad = cadeia(cluster);
    const dados = new Uint8Array(cad.length * bytesPorCluster);
    cad.forEach((c, i) => dados.set(dev.get(offCluster(c), bytesPorCluster), i * bytesPorCluster));
    return { cluster, dados, total: cad.length * entradasPorCluster, cadeia: cad };
  }

  function interpretar(dados, indice) {
    const o = indice * 32;
    const primeiro = dados[o];
    if (primeiro === 0x00 || primeiro === 0xe5) return null;
    const attr = dados[o + 11];
    if (attr === 0x0f) return null; // entrada de nome longo (LFN) — nao usamos
    let nome = texto(dados, o, o + 8).replace(/[\s\0]+$/, "");
    if (nome.charCodeAt(0) === 0x05) nome = String.fromCharCode(0xe5) + nome.slice(1);
    const ext = texto(dados, o + 8, o + 11).replace(/[\s\0]+$/, "");
    const cluster = (u16(dados, o + 20) << 16) | u16(dados, o + 26);
    return {
      indice, nome, ext, nomeCompleto: ext ? `${nome}.${ext}` : nome,
      attr,
      volume: (attr & ATTR.volume) !== 0,
      diretorio: (attr & ATTR.diretorio) !== 0,
      somenteLeitura: (attr & ATTR.somenteLeitura) !== 0,
      oculto: (attr & ATTR.oculto) !== 0,
      sistema: (attr & ATTR.sistema) !== 0,
      cluster, tamanho: u32(dados, o + 28),
      data: u16(dados, o + 24), hora: u16(dados, o + 22),
      atual: nome === "." && (attr & ATTR.diretorio) !== 0,
      pai: nome === ".." && (attr & ATTR.diretorio) !== 0,
      arquivo: (attr & ATTR.diretorio) === 0 && dados[o] !== 0,
    };
  }

  /** entradas de um diretorio (cluster 0 = raiz). pula apagadas, LFN e o rotulo do volume */
  function listar(cluster = 0) {
    const dir = carregarDir(cluster);
    const fora = [];
    for (let i = 0; i < dir.total; i++) {
      const e = interpretar(dir.dados, i);
      if (e && !e.volume) fora.push(e);
    }
    return fora;
  }

  /** bytes de um arquivo */
  function ler(entrada) {
    if (entrada.diretorio) throw new Error(`${entrada.nomeCompleto} e um diretorio`);
    const cad = cadeia(entrada.cluster);
    const dados = new Uint8Array(entrada.tamanho);
    let escrito = 0;
    for (const c of cad) {
      if (escrito >= entrada.tamanho) break;
      const quanto = Math.min(bytesPorCluster, entrada.tamanho - escrito);
      dados.set(dev.get(offCluster(c), quanto), escrito);
      escrito += quanto;
    }
    if (escrito !== entrada.tamanho) throw new Error(`cadeia curta: li ${escrito} de ${entrada.tamanho} bytes`);
    return dados;
  }

  function escreverBytes(off, bytes) {
    dev.set(off, bytes);
  }

  function montarEntrada({ nome, ext }, attr, cluster, tamanho) {
    const b = new Uint8Array(32);
    b.fill(0x20, 0, 11); // nome (8) + extensao (3) preenchidos com espaco
    b.set(bytesDe(nome), 0);
    b.set(bytesDe(ext), 8);
    b[11] = attr;
    const { data, hora } = dataHoraAgora();
    b[22] = hora & 0xff; b[23] = (hora >> 8) & 0xff;
    b[24] = data & 0xff; b[25] = (data >> 8) & 0xff;
    b[20] = (cluster >> 16) & 0xff; b[21] = (cluster >> 24) & 0xff;
    b[26] = cluster & 0xff; b[27] = (cluster >> 8) & 0xff;
    b[28] = tamanho & 0xff; b[29] = (tamanho >> 8) & 0xff; b[30] = (tamanho >> 16) & 0xff; b[31] = (tamanho >> 24) & 0xff;
    return b;
  }

  /** apaga (libera a cadeia e marca 0xE5). em diretorio, apaga o conteudo recursivamente */
  function apagar(clusterPai, entrada) {
    if (entrada.pai || entrada.atual) throw new Error("nao da para apagar . ou ..");
    const dir = carregarDir(clusterPai);
    if (entrada.diretorio) {
      for (const filho of listar(entrada.cluster)) {
        if (filho.pai || filho.atual) continue;
        apagar(entrada.cluster, filho);
      }
    }
    liberarCadeia(entrada.cluster);
    aplicarFAT();
    const o = offEntrada(clusterPai, entrada.indice, dir);
    dev.set(o, new Uint8Array([0xe5]));
  }

  /** grava um arquivo no diretorio (substitui se ja existir). devolve a entrada criada */
  function gravar(clusterPai, nome, bytes) {
    const n83 = normalizar83(nome);
    const dados = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dir = carregarDir(clusterPai);
    if (listar(clusterPai).some((e) => e.diretorio && e.nome === n83.nome && e.ext === n83.ext)) {
      throw new Error(`ja existe um diretorio ${n83.completo} aqui`);
    }
    const existente = listar(clusterPai).find((e) => e.nome === n83.nome && e.ext === n83.ext && !e.diretorio);
    if (existente) {
      liberarCadeia(existente.cluster);
      aplicarFAT();
    }
    const quantos = Math.ceil(dados.length / bytesPorCluster); // 0 bytes => nenhum cluster
    const novos = [];
    for (let i = 0; i < quantos; i++) {
      const c = clusterLivre();
      if (!c) { for (const x of novos) gravarFAT(x, 0); aplicarFAT(); throw new Error("disco cheio"); }
      novos.push(c);
    }
    novos.forEach((c, i) => gravarFAT(c, i === novos.length - 1 ? fim : novos[i + 1]));
    aplicarFAT();
    novos.forEach((c, i) => {
      const pedaco = new Uint8Array(bytesPorCluster);
      pedaco.set(dados.subarray(i * bytesPorCluster, (i + 1) * bytesPorCluster));
      escreverBytes(offCluster(c), pedaco);
    });
    const nova = montarEntrada(n83, ATTR.arquivo, novos[0] || 0, dados.length);
    const livre = existente ? existente.indice : acharLivre(dir);
    escreverBytes(offEntrada(clusterPai, livre, dir), nova);
    return listar(clusterPai).find((e) => e.indice === livre) || null;
  }

  /** cria subdiretorio (com as entradas . e ..) */
  function criarPasta(clusterPai, nome) {
    const n83 = normalizar83(nome);
    const dir = carregarDir(clusterPai);
    if (listar(clusterPai).some((e) => e.diretorio && e.nome === n83.nome && e.ext === n83.ext)) {
      throw new Error(`${n83.completo} ja existe`);
    }
    const c = clusterLivre();
    if (!c) throw new Error("disco cheio");
    gravarFAT(c, fim);
    aplicarFAT();
    const vazio = new Uint8Array(bytesPorCluster);
    vazio.set(montarEntrada({ nome: ".", ext: "" }, ATTR.diretorio, c, 0), 0);
    vazio.set(montarEntrada({ nome: "..", ext: "" }, ATTR.diretorio, clusterPai || 0, 0), 32);
    escreverBytes(offCluster(c), vazio);
    const livre = acharLivre(dir);
    escreverBytes(offEntrada(clusterPai, livre, dir), montarEntrada(n83, ATTR.diretorio, c, 0));
    return listar(clusterPai).find((e) => e.indice === livre) || null;
  }

  function acharLivre(dir) {
    for (let i = 0; i < dir.total; i++) {
      const primeiro = dir.dados[i * 32];
      if (primeiro === 0x00 || primeiro === 0xe5) return i;
    }
    throw new Error("diretorio sem espaco livre");
  }

  function info() {
    const livres = clustersLivres();
    return {
      oem, rotulo: rotuloBPB, serial, fsTipo: bits === 12 ? "FAT12" : "FAT16",
      base, particao, setoresOcultos,
      bytesPorSetor, setoresPorCluster, bytesPorCluster,
      numFATs, setoresPorFAT, entradasRaiz,
      clusters, clustersLivres: livres,
      bytesLivres: livres * bytesPorCluster,
      bytesTotal: clusters * bytesPorCluster,
      capacidade: setoresTotais * bytesPorSetor,
    };
  }

  return { info, listar, ler, gravar, criarPasta, apagar, cadeia, normalizar83, aplicarFAT };
}

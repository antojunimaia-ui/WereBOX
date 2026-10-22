// Volume FAT16 sintetico para o INT 25h/26h (leitura/escrita absoluta de
// setor). O CHKDSK, SCANDISK, FORMAT, UNDELETE e UNFORMAT leem o setor de
// boot, a FAT e o diretorio raiz por este caminho: sem um volume coerente
// eles relatam "Invalid drive specification"/"Invalid media type".
//
// O leiaute tem de casar com o DPB (Machine.buildDosData) e com o AH=36h:
// 512 bytes/setor, 32 setores/cluster (16K), 1 setor reservado, 2 FATs de
// 126 setores, 512 entradas de diretorio raiz (32 setores) => dados no
// setor 285, ultimo cluster 32247 (504 MB no total).

export const BYTES_PER_SECTOR = 512;
export const SECTORS_PER_CLUSTER = 32;
export const RESERVED_SECTORS = 1;
export const NUM_FATS = 2;
export const ROOT_ENTRIES = 512;
export const SECTORS_PER_FAT = 126;
export const MAX_CLUSTER = 32247; // ultimo cluster valido (FAT16)
export const ROOT_DIR_SECTORS = (ROOT_ENTRIES * 32) / BYTES_PER_SECTOR;
export const DATA_START = RESERVED_SECTORS + NUM_FATS * SECTORS_PER_FAT + ROOT_DIR_SECTORS;
export const TOTAL_SECTORS = DATA_START + (MAX_CLUSTER - 1) * SECTORS_PER_CLUSTER;
export const SECTOR_BYTES = SECTORS_PER_CLUSTER * BYTES_PER_SECTOR;

const CLUSTER_BYTES = SECTORS_PER_CLUSTER * BYTES_PER_SECTOR;

function pad(s, n, ch = " ") {
  s = String(s).toUpperCase();
  return (s + ch.repeat(n)).slice(0, n);
}

// Divide um nome 8.3 ("COMMAND.COM") em [nome 8, ext 3].
function split83(name) {
  const i = name.lastIndexOf(".");
  const base = i < 0 ? name : name.slice(0, i);
  const ext = i < 0 ? "" : name.slice(i + 1);
  return [pad(base, 8), pad(ext, 3)];
}

export class VirtualDisk {
  constructor(fs, opts = {}) {
    this.serial = opts.serial ?? 0x1c4a2b7e;
    this.label = opts.label ?? "REDOS";
    this.bytesPerSector = BYTES_PER_SECTOR;
    this.sectorsPerCluster = SECTORS_PER_CLUSTER;
    this.sectorsPerFat = SECTORS_PER_FAT;
    this.rootEntries = ROOT_ENTRIES;
    this.totalSectors = TOTAL_SECTORS;
    this.dataStart = DATA_START;
    this.maxCluster = MAX_CLUSTER;
    this.files = [];
    let cluster = 2;
    const names = [...(fs ? fs.keys() : [])].sort();
    for (const name of names) {
      const data = (fs && fs.get(name)) || new Uint8Array(0);
      if (data.length === 0) { this.files.push({ name, data, start: 0, clusters: 0 }); continue; }
      const ncl = Math.ceil(data.length / CLUSTER_BYTES);
      if (cluster + ncl > MAX_CLUSTER + 1) break; // volume cheio
      this.files.push({ name, data, start: cluster, clusters: ncl });
      cluster += ncl;
    }
    this.usedClusters = cluster - 2;
    // mesma conta que o DOS faz a partir do BPB: setores de dados / setores
    // por cluster
    this.totalClusters = Math.floor((TOTAL_SECTORS - DATA_START) / SECTORS_PER_CLUSTER);
    this.freeClusters = this.totalClusters - this.usedClusters;
    // FAT (uma copia; o INT 25h entrega nos dois setores de FAT)
    this.fat = new Uint8Array(SECTORS_PER_FAT * BYTES_PER_SECTOR);
    const put = (i, v) => { this.fat[i * 2] = v & 0xff; this.fat[i * 2 + 1] = (v >> 8) & 0xff; };
    put(0, 0xfff8); put(1, 0xffff);
    for (const f of this.files) {
      for (let i = 0; i < f.clusters; i++) put(f.start + i, i === f.clusters - 1 ? 0xffff : f.start + i + 1);
    }
    // diretorio raiz (32 setores) com o rotulo + os arquivos
    this.root = new Uint8Array(ROOT_DIR_SECTORS * BYTES_PER_SECTOR);
    this._writeRootEntries();
  }

  fileEntry(name) { return this.files.find((f) => f.name === name) || null; }
  // Reconstroi o diretorio raiz (usado quando o rotulo muda via AH=69h).
  refresh() { this._writeRootEntries(); }
  clusterOf(name) { const f = this.fileEntry(name); return f ? f.start : 0; }
  sizeOf(name) { const f = this.fileEntry(name); return f ? f.data.length : 0; }

  _entry(off, name, ext, attr, start, size) {
    const r = this.root;
    for (let i = 0; i < 11; i++) r[off + i] = 0x20;
    for (let i = 0; i < name.length; i++) r[off + i] = name.charCodeAt(i);
    for (let i = 0; i < ext.length; i++) r[off + 8 + i] = ext.charCodeAt(i);
    r[off + 0x0b] = attr;
    r[off + 0x16] = 0x00; r[off + 0x17] = 0x60;   // hora 12:00
    r[off + 0x18] = 0x4e; r[off + 0x19] = 0x5d;   // data 2026-10-14 (DOS)
    r[off + 0x1a] = start & 0xff; r[off + 0x1b] = (start >> 8) & 0xff;
    r[off + 0x1c] = size & 0xff; r[off + 0x1d] = (size >> 8) & 0xff;
    r[off + 0x1e] = (size >> 16) & 0xff; r[off + 0x1f] = (size >> 24) & 0xff;
  }

  _writeRootEntries() {
    let off = 0;
    // entrada de rotulo de volume (atributo 0x08)
    const [ln, le] = split83(this.label);
    this._entry(off, ln, le, 0x08, 0, 0);
    off += 32;
    for (const f of this.files) {
      const [bn, ex] = split83(f.name);
      this._entry(off, bn, ex, 0x20, f.start, f.data.length);
      off += 32;
      if (off >= this.root.length) break;
    }
  }

  bootSector() {
    const b = new Uint8Array(BYTES_PER_SECTOR);
    const w = (o, v) => { b[o] = v & 0xff; b[o + 1] = (v >> 8) & 0xff; };
    const d = (o, v) => { b[o] = v & 0xff; b[o + 1] = (v >> 8) & 0xff; b[o + 2] = (v >> 16) & 0xff; b[o + 3] = (v >>> 24) & 0xff; };
    b[0] = 0xeb; b[1] = 0x3c; b[2] = 0x90;
    for (let i = 0; i < 8; i++) b[3 + i] = "MSDOS5.0".charCodeAt(i);
    w(0x0b, BYTES_PER_SECTOR);
    b[0x0d] = SECTORS_PER_CLUSTER;
    w(0x0e, RESERVED_SECTORS);
    b[0x10] = NUM_FATS;
    w(0x11, ROOT_ENTRIES);
    w(0x13, TOTAL_SECTORS > 0xffff ? 0 : TOTAL_SECTORS);
    b[0x15] = 0xf8; // media: disco fixo
    w(0x16, SECTORS_PER_FAT);
    w(0x18, 63);           // setores/trilha
    w(0x1a, 255);          // cabecas
    d(0x1c, 63);           // setores ocultos
    d(0x20, TOTAL_SECTORS);
    b[0x24] = 0x80;        // unidade de boot
    b[0x25] = 0x00;
    b[0x26] = 0x29;        // assinatura estendida
    d(0x27, this.serial);
    for (let i = 0; i < 11; i++) b[0x2b + i] = pad(this.label, 11).charCodeAt(i);
    for (let i = 0; i < 8; i++) b[0x36 + i] = "FAT16   ".charCodeAt(i);
    // rotina de boot: apenas uma mensagem + INT 18h
    const msg = "\r\nEste disco nao pode ser inicializado.\r\n";
    let p = 0x3e;
    b[p++] = 0x0e; b[p++] = 0x1f; b[p++] = 0xbe; b[p++] = 0x7c; b[p++] = 0xac; // mov si, 0x7c1f
    for (let i = 0; i < msg.length && p < 0x1f0; i++) b[p++] = msg.charCodeAt(i) & 0xff;
    b[0x1fe] = 0x55; b[0x1ff] = 0xaa;
    return b;
  }

  // Le o setor logico `n` (LBA) e devolve 512 bytes.
  readSector(n) {
    const out = new Uint8Array(BYTES_PER_SECTOR);
    if (n < 0 || n >= TOTAL_SECTORS) return out;
    if (n === 0) return this.bootSector();
    // FATs
    const fatStart = RESERVED_SECTORS;
    const rootStart = fatStart + NUM_FATS * SECTORS_PER_FAT;
    if (n >= fatStart && n < rootStart) {
      const k = (n - fatStart) % SECTORS_PER_FAT;
      out.set(this.fat.subarray(k * BYTES_PER_SECTOR, (k + 1) * BYTES_PER_SECTOR));
      return out;
    }
    // diretorio raiz
    if (n >= rootStart && n < rootStart + ROOT_DIR_SECTORS) {
      const k = n - rootStart;
      out.set(this.root.subarray(k * BYTES_PER_SECTOR, (k + 1) * BYTES_PER_SECTOR));
      return out;
    }
    // area de dados
    if (n >= DATA_START) {
      const cluster = 2 + Math.floor((n - DATA_START) / SECTORS_PER_CLUSTER);
      const off = ((n - DATA_START) % SECTORS_PER_CLUSTER) * BYTES_PER_SECTOR;
      const f = this.files.find((x) => cluster >= x.start && cluster < x.start + x.clusters);
      if (f) {
        const pos = (cluster - f.start) * CLUSTER_BYTES + off;
        if (pos < f.data.length) out.set(f.data.subarray(pos, Math.min(pos + BYTES_PER_SECTOR, f.data.length)));
      }
      return out;
    }
    return out;
  }

  // Escreve um setor (INT 26h). Nao persistimos o volume de verdade: aceita
  // e ignora, para que o FORMAT/SCANDISK avancem em vez de abortar.
  writeSector() {}
}

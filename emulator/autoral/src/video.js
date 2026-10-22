// Video texto 80x25 (modo 03h). A memoria de video em B800:0000 e' a fonte da
// verdade: INT 10h e a saida do DOS escrevem por aqui (write-through) e
// programas que desenham direto na VRAM sao capturados por syncFromMem(),
// chamado a cada fatia de CPU. Sem canvas aqui: o front web desenha; os testes
// leem getText().
export const VIDEO_BASE = 0xb8000;
export const VIDEO_ATTR = 0x07; // cinza claro em preto

export class Video {
  constructor(cols = 80, rows = 25, mem = null) {
    this.cols = cols;
    this.rows = rows;
    this.mem = mem || null;       // memoria ligada (opcional)
    this.base = VIDEO_BASE;
    this.attr = VIDEO_ATTR;
    this.clear();
  }
  get size() { return this.cols * this.rows; }

  // grava char+attr direto na VRAM (se houver memoria ligada)
  _poke(r, c, code, attr) {
    if (!this.mem) return;
    const p = this.base + (r * this.cols + c) * 2;
    this.mem.buf[p] = code & 0xff;
    this.mem.buf[p + 1] = attr & 0xff;
  }
  _set(r, c, code, attr) {
    this.cells[r][c] = code & 0xff;
    this.attrs[r][c] = attr & 0xff;
    this._poke(r, c, code, attr);
  }
  clear() {
    this.cells = Array.from({ length: this.rows }, () => Array(this.cols).fill(0x20));
    this.attrs = Array.from({ length: this.rows }, () => Array(this.cols).fill(this.attr));
    if (this.mem) {
      for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) this._poke(r, c, 0x20, this.attr);
    }
    this.cx = 0; this.cy = 0;
    this.dirty = true;
  }
  // captura escritas diretas na VRAM (editores/Jogos gravam em B800:0000)
  syncFromMem() {
    if (!this.mem) return false;
    let changed = false;
    const b = this.mem.buf;
    for (let r = 0; r < this.rows; r++) {
      const row = this.cells[r], ar = this.attrs[r];
      for (let c = 0; c < this.cols; c++) {
        const p = this.base + (r * this.cols + c) * 2;
        const ch = b[p], at = b[p + 1];
        if (row[c] !== ch || ar[c] !== at) { row[c] = ch; ar[c] = at; changed = true; }
      }
    }
    if (changed) this.dirty = true;
    return changed;
  }
  putChar(code, attr) {
    const a = attr == null ? this.attr : attr;
    if (code === 10) { this.cx = 0; this.cy++; }
    else if (code === 13) { this.cx = 0; }
    else if (code === 8) { if (this.cx > 0) this.cx--; }
    else if (code === 9) { this.cx = Math.min(this.cols - 1, this.cx + 8 - (this.cx % 8)); }
    else {
      if (this.cy >= this.rows) this.scroll();
      this._set(this.cy, this.cx, code, a);
      this.cx++;
      if (this.cx >= this.cols) { this.cx = 0; this.cy++; }
    }
    if (this.cy >= this.rows) this.scroll();
    this.dirty = true;
  }
  scroll() {
    this.cells.shift();
    this.cells.push(Array(this.cols).fill(0x20));
    this.attrs.shift();
    this.attrs.push(Array(this.cols).fill(this.attr));
    if (this.mem) { // acompanha na VRAM
      const stride = this.cols * 2;
      this.mem.buf.copyWithin(this.base, this.base + stride, this.base + stride * this.rows);
      const last = this.base + stride * (this.rows - 1);
      for (let c = 0; c < this.cols; c++) { this.mem.buf[last + c * 2] = 0x20; this.mem.buf[last + c * 2 + 1] = this.attr; }
    }
    this.cy = this.rows - 1;
  }
  writeString(s) { for (const ch of s) this.putChar(ch.charCodeAt(0)); }
  getText() {
    return this.cells.map(r => String.fromCharCode(...r).replace(/\s+$/, "")).join("\n").replace(/\n+$/, "");
  }
}

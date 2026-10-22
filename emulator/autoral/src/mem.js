// Memoria real-mode 8086: 1 MiB, acesso por seg:off e linear.
export class Memory {
  constructor(size = 0x100000) {
    this.buf = new Uint8Array(size);
  }
  get size() { return this.buf.length; }
  phys(seg, off) { return ((seg << 4) + off) & 0xfffff; }
  read8(seg, off) { return this.buf[this.phys(seg, off)]; }
  read16(seg, off) {
    const p = this.phys(seg, off);
    return this.buf[p] | (this.buf[(p + 1) & 0xfffff] << 8);
  }
  write8(seg, off, v) { this.buf[this.phys(seg, off)] = v & 0xff; }
  write16(seg, off, v) {
    const p = this.phys(seg, off);
    this.buf[p] = v & 0xff;
    this.buf[(p + 1) & 0xfffff] = (v >> 8) & 0xff;
  }
  loadLinear(addr, bytes, at = 0) {
    this.buf.set(bytes.subarray(0, Math.min(bytes.length, this.buf.length - addr)), addr);
  }
  readLinear(addr, len) { return this.buf.slice(addr, addr + len); }
}

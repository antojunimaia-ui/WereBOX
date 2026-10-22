// CPU 8086 real-mode — interpretador em evolucao (M2).
// Cobre: MOV/PUSH/POP/XCHG, ADD/ADC/SUB/SBB/AND/OR/XOR/CMP (+80/81/83,
// F6/F7), INC/DEC, shifts D0-D3, JMP/Jcc/CALL/RET/LOOP, string ops + REP,
// LEA/LDS/LES, INT/IRET/INTO, IN/OUT (stub), CLI/STI/CLD/STD/CLC/STC/CMC,
// CBW/CWD, DAA/DAS/AAA/AAS/AAM/AAD, PUSHA/POPA, 60/61, 68/6A push imm.
// Erros trazem seg:off + bytes + AH/AL para guiar o proximo passo.
import { Memory } from "./mem.js";

const REG16 = ["ax", "cx", "dx", "bx", "sp", "bp", "si", "di"];
const REG8 = ["al", "cl", "dl", "bl", "ah", "ch", "dh", "bh"];
const F_CF = 0x0001, F_PF = 0x0004, F_AF = 0x0010, F_ZF = 0x0040;
const F_SF = 0x0080, F_IF = 0x0200, F_DF = 0x0400, F_OF = 0x0800;

export class CPU {
  constructor(mem, hooks = {}) {
    this.mem = mem;
    this.hooks = hooks; // { int(n, cpu), in(port, cpu)->byte, out(port, val, cpu) }
    this.reset(0x1000);
    this.trace = null; // fn(info) — máquina liga quando REDOS_TRACE=1
  }
  reset(cs = 0x1000) {
    this.ax = 0; this.bx = 0; this.cx = 0; this.dx = 0;
    this.si = 0; this.di = 0; this.bp = 0; this.sp = 0xfffe;
    this.cs = cs; this.ds = cs; this.es = cs; this.ss = cs;
    this.ip = 0x0100;
    this.flags = 0x0002;
    this.halted = false; this.exited = false; this.exitCode = 0;
    this.steps = 0; this.segOverride = null; this.repPrefix = null;
  }
  // registradores 8 bit
  get ah() { return (this.ax >> 8) & 0xff; }
  set ah(v) { this.ax = (this.ax & 0x00ff) | ((v & 0xff) << 8); }
  get al() { return this.ax & 0xff; }
  set al(v) { this.ax = (this.ax & 0xff00) | (v & 0xff); }
  get bh() { return (this.bx >> 8) & 0xff; }
  set bh(v) { this.bx = (this.bx & 0x00ff) | ((v & 0xff) << 8); }
  get bl() { return this.bx & 0xff; }
  set bl(v) { this.bx = (this.bx & 0xff00) | (v & 0xff); }
  get ch() { return (this.cx >> 8) & 0xff; }
  set ch(v) { this.cx = (this.cx & 0x00ff) | ((v & 0xff) << 8); }
  get cl() { return this.cx & 0xff; }
  set cl(v) { this.cx = (this.cx & 0xff00) | (v & 0xff); }
  get dh() { return (this.dx >> 8) & 0xff; }
  set dh(v) { this.dx = (this.dx & 0x00ff) | ((v & 0xff) << 8); }
  get dl() { return this.dx & 0xff; }
  set dl(v) { this.dx = (this.dx & 0xff00) | (v & 0xff); }
  get cf() { return (this.flags & F_CF) ? 1 : 0; }
  get zf() { return (this.flags & F_ZF) ? 1 : 0; }
  get sf() { return (this.flags & F_SF) ? 1 : 0; }
  get of() { return (this.flags & F_OF) ? 1 : 0; }
  get df() { return (this.flags & F_DF) ? 1 : 0; }
  get if_() { return (this.flags & F_IF) ? 1 : 0; }

  fetch8() { const v = this.mem.read8(this.cs, this.ip); this.ip = (this.ip + 1) & 0xffff; return v; }
  fetch16() { const lo = this.fetch8(); return lo | (this.fetch8() << 8); }
  fetchs8() { const v = this.fetch8(); return v & 0x80 ? v - 0x100 : v; }
  push16(v) { this.sp = (this.sp - 2) & 0xffff; this.mem.write16(this.ss, this.sp, v); }
  pop16() { const v = this.mem.read16(this.ss, this.sp); this.sp = (this.sp + 2) & 0xffff; return v; }
  getReg8(i) { return this[REG8[i]]; }
  setReg8(i, v) { this[REG8[i]] = v & 0xff; }
  getReg16(i) { return this[REG16[i]]; }
  setReg16(i, v) {
    this[REG16[i]] = v & 0xffff;
    if (this.regHook) this.regHook(REG16[i], v & 0xffff, this);
  }

  // --- ModR/M ---
  modrm() {
    const b = this.fetch8();
    return { mod: (b >> 6) & 3, reg: (b >> 3) & 7, rm: b & 7 };
  }
  // endereco efetivo 16-bit; retorna {isReg, reg, seg, off}
  ea(m) {
    const { mod, rm } = m;
    if (mod === 3) return { isReg: true, reg: rm };
    let off = 0, seg = this.segOverride ?? this.ds;
    const bx = this.bx, bp = this.bp, si = this.si, di = this.di;
    switch (rm) {
      case 0: off = (bx + si) & 0xffff; break;
      case 1: off = (bx + di) & 0xffff; break;
      case 2: off = (bp + si) & 0xffff; seg = this.segOverride ?? this.ss; break;
      case 3: off = (bp + di) & 0xffff; seg = this.segOverride ?? this.ss; break;
      case 4: off = si; break;
      case 5: off = di; break;
      case 6: off = mod === 0 ? 0 : bp; if (mod !== 0 && !this.segOverride) seg = this.ss; break;
      case 7: off = bx; break;
    }
    if (mod === 0 && rm === 6) { off = this.fetch16(); }
    else if (mod === 1) { off = (off + this.fetchs8()) & 0xffff; }
    else if (mod === 2) { off = (off + this.fetch16()) & 0xffff; }
    return { isReg: false, seg, off };
  }
  readEA8(e) { return e.isReg ? this.getReg8(e.reg) : this.mem.read8(e.seg, e.off); }
  readEA16(e) { return e.isReg ? this.getReg16(e.reg) : this.mem.read16(e.seg, e.off); }
  writeEA8(e, v) { if (e.isReg) this.setReg8(e.reg, v); else this.mem.write8(e.seg, e.off, v); }
  writeEA16(e, v) { if (e.isReg) this.setReg16(e.reg, v); else this.mem.write16(e.seg, e.off, v); }

  // --- flags ---
  parity(v) { v &= 0xff; let p = 0; for (let i = 0; i < 8; i++) p ^= (v >> i) & 1; return p === 0; }
  setSZP8(v) {
    v &= 0xff;
    this.flags = (this.flags & ~(F_SF | F_ZF | F_PF)) |
      (v & 0x80 ? F_SF : 0) | (v === 0 ? F_ZF : 0) | (this.parity(v) ? F_PF : 0);
  }
  setSZP16(v) {
    v &= 0xffff;
    this.flags = (this.flags & ~(F_SF | F_ZF | F_PF)) |
      (v & 0x8000 ? F_SF : 0) | (v === 0 ? F_ZF : 0) | (this.parity(v & 0xff) ? F_PF : 0);
  }
  add8(d, s, carry = 0) {
    const r = d + s + carry, res = r & 0xff;
    const cf = r > 0xff ? F_CF : 0;
    const of = ((~(d ^ s) & (d ^ res)) & 0x80) ? F_OF : 0;
    const af = ((d & 0xf) + (s & 0xf) + carry > 0xf) ? F_AF : 0;
    this.flags = (this.flags & ~(F_CF | F_OF | F_AF)) | cf | of | af;
    this.setSZP8(res); return res;
  }
  add16(d, s, carry = 0) {
    const r = d + s + carry, res = r & 0xffff;
    const cf = r > 0xffff ? F_CF : 0;
    const of = ((~(d ^ s) & (d ^ res)) & 0x8000) ? F_OF : 0;
    const af = ((d & 0xf) + (s & 0xf) + carry > 0xf) ? F_AF : 0;
    this.flags = (this.flags & ~(F_CF | F_OF | F_AF)) | cf | of | af;
    this.setSZP16(res); return res;
  }
  sub8(d, s, borrow = 0) {
    const r = d - s - borrow, res = r & 0xff;
    const cf = r < 0 ? F_CF : 0;
    const of = (((d ^ s) & (d ^ res)) & 0x80) ? F_OF : 0;
    const af = ((d & 0xf) < ((s & 0xf) + borrow)) ? F_AF : 0;
    this.flags = (this.flags & ~(F_CF | F_OF | F_AF)) | cf | of | af;
    this.setSZP8(res); return res;
  }
  sub16(d, s, borrow = 0) {
    const r = d - s - borrow, res = r & 0xffff;
    const cf = r < 0 ? F_CF : 0;
    const of = (((d ^ s) & (d ^ res)) & 0x8000) ? F_OF : 0;
    const af = ((d & 0xf) < ((s & 0xf) + borrow)) ? F_AF : 0;
    this.flags = (this.flags & ~(F_CF | F_OF | F_AF)) | cf | of | af;
    this.setSZP16(res); return res;
  }
  logic8(op, d, s) {
    let r;
    if (op === "and") r = d & s; else if (op === "or") r = d | s; else r = d ^ s;
    r &= 0xff;
    this.flags = (this.flags & ~(F_CF | F_OF | F_AF)) | (op === "and" ? F_AF & 0 : 0);
    if (op === "and") this.flags |= 0; // AF indefinido; zera p/ determinismo
    this.setSZP8(r); return r;
  }
  logic16(op, d, s) {
    let r;
    if (op === "and") r = d & s; else if (op === "or") r = d | s; else r = d ^ s;
    r &= 0xffff;
    this.flags &= ~(F_CF | F_OF | F_AF);
    this.setSZP16(r); return r;
  }
  doShift(group, sub, v, count, bits) {
    count &= 0x1f; if (count === 0) return v;
    const mask = bits === 8 ? 0xff : 0xffff;
    const sign = bits === 8 ? 0x80 : 0x8000;
    let cf = 0;
    for (let i = 0; i < count; i++) {
      if (sub === 4) { cf = (v & sign) ? 1 : 0; v = ((v << 1) & mask); } // SHL
      else if (sub === 5) { cf = v & 1; v = (v >> 1); } // SHR
      else if (sub === 7) { cf = v & 1; v = ((v >> 1) | (v & sign)); } // SAR
      else if (sub === 0) { cf = (v & sign) ? 1 : 0; v = ((v << 1) & mask) | cf; } // ROL(1)
      else if (sub === 1) { cf = v & 1; v = ((v >> 1) | (cf ? sign : 0)); } // ROR(1)
      else if (sub === 2) { const nc = (v & sign) ? 1 : 0; v = ((v << 1) & mask) | (this.cf ? 1 : 0); cf = nc; } // RCL
      else if (sub === 3) { const nc = v & 1; v = ((v >> 1) | (this.cf ? sign : 0)); cf = nc; } // RCR
      this.flags = (this.flags & ~F_CF) | (cf ? F_CF : 0);
    }
    if (sub >= 4 && sub <= 7) { bits === 8 ? this.setSZP8(v) : this.setSZP16(v); this.flags &= ~F_AF; }
    return v & mask;
  }
  cond(code) {
    const cf = this.cf, zf = this.zf, sf = this.sf, of = this.of;
    const pf = (this.flags & F_PF) ? 1 : 0;
    switch (code) {
      case 0: return of === 1; case 1: return of === 0;
      case 2: return cf === 1; case 3: return cf === 0;
      case 4: return zf === 1; case 5: return zf === 0;
      case 6: return cf === 1 || zf === 1; case 7: return cf === 0 && zf === 0;
      case 8: return sf === 1; case 9: return sf === 0;
      case 10: return pf === 1; case 11: return pf === 0;
      case 12: return sf !== of; case 13: return sf === of;
      case 14: return zf === 1 || sf !== of; case 15: return zf === 0 && sf === of;
    }
  }
  stringStep(siSeg, diSeg) {
    const d = this.df ? -1 : 1;
    return { siSeg, diSeg, d };
  }

  step() {
    if (this.halted || this.exited) return false;
    this.segOverride = null; this.repPrefix = null;
    const startIp = this.ip;
    // prefixos
    for (;;) {
      const b = this.mem.read8(this.cs, this.ip);
      if (b === 0x26) { this.segOverride = this.es; this.ip = (this.ip + 1) & 0xffff; }
      else if (b === 0x2e) { this.segOverride = this.cs; this.ip = (this.ip + 1) & 0xffff; }
      else if (b === 0x36) { this.segOverride = this.ss; this.ip = (this.ip + 1) & 0xffff; }
      else if (b === 0x3e) { this.segOverride = this.ds; this.ip = (this.ip + 1) & 0xffff; }
      else if (b === 0xf2) { this.repPrefix = 0xf2; this.ip = (this.ip + 1) & 0xffff; }
      else if (b === 0xf3) { this.repPrefix = 0xf3; this.ip = (this.ip + 1) & 0xffff; }
      else if (b === 0xf0) { this.ip = (this.ip + 1) & 0xffff; } // LOCK: ignora
      else break;
    }
    const opPos = this.ip;
    const op = this.fetch8();
    this.steps++;
    const fail = (msg) => {
      const bytes = [];
      for (let i = 0; i < Math.min(8, (this.ip - startIp + 0x10000) & 0xffff); i++)
        bytes.push(this.mem.read8(this.cs, (startIp + i) & 0xffff).toString(16).padStart(2, "0"));
      throw new Error(`${msg}: opcode 0x${op.toString(16).padStart(2, "0")} em ${h(this.cs)}:${h((opPos) & 0xffff)} bytes[${bytes.join(" ")}] AX=${h(this.ax)} AH=${h(this.ah)} AL=${h(this.al)} BX=${h(this.bx)} CX=${h(this.cx)} DX=${h(this.dx)} SI=${h(this.si)} DI=${h(this.di)} DS=${h(this.ds)} ES=${h(this.es)} passo=${this.steps}`);
    };
    const dseg = () => this.segOverride ?? this.ds;
    // MOV reg,imm / PUSH / POP / XCHG / INC / DEC curtos
    if (op >= 0xb8 && op <= 0xbf) { this.setReg16(op - 0xb8, this.fetch16()); return true; }
    if (op >= 0xb0 && op <= 0xb7) { this.setReg8(op - 0xb0, this.fetch8()); return true; }
    if (op >= 0x50 && op <= 0x57) { this.push16(this.getReg16(op - 0x50)); return true; }
    if (op >= 0x58 && op <= 0x5f) { this.setReg16(op - 0x58, this.pop16()); return true; }
    if (op >= 0x40 && op <= 0x47) { const i = op - 0x40, cf = this.flags & 0x0001; this.setReg16(i, this.add16(this.getReg16(i), 1)); this.flags = (this.flags & ~0x0001) | cf; return true; }
    if (op >= 0x48 && op <= 0x4f) { const i = op - 0x48, cf = this.flags & 0x0001; this.setReg16(i, this.sub16(this.getReg16(i), 1)); this.flags = (this.flags & ~0x0001) | cf; return true; }
    if (op >= 0x70 && op <= 0x7f) { const d = this.fetchs8(); if (this.cond(op & 0xf)) this.ip = (this.ip + d) & 0xffff; return true; }
    if (op >= 0x90 && op <= 0x97 && op !== 0x90) { if (op === 0x90) return true; const t = this.ax; this.ax = this.getReg16(op - 0x90); this.setReg16(op - 0x90, t); return true; }

    switch (op) {
      case 0x00: case 0x01: case 0x02: case 0x03: case 0x04: case 0x05:
      case 0x08: case 0x09: case 0x0a: case 0x0b: case 0x0c: case 0x0d:
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15:
      case 0x18: case 0x19: case 0x1a: case 0x1b: case 0x1c: case 0x1d:
      case 0x20: case 0x21: case 0x22: case 0x23: case 0x24: case 0x25:
      case 0x28: case 0x29: case 0x2a: case 0x2b: case 0x2c: case 0x2d:
      case 0x30: case 0x31: case 0x32: case 0x33: case 0x34: case 0x35:
      case 0x38: case 0x39: case 0x3a: case 0x3b: case 0x3c: case 0x3d: {
        const is16 = (op & 1) === 1;
        const kind = ["add", "or", "adc", "sbb", "and", "sub", "xor", "cmp"][(op >> 3) & 7];
        const apply = (d, s, w) => {
          if (kind === "add") return w ? this.add16(d, s) : this.add8(d, s);
          if (kind === "adc") return w ? this.add16(d, s, this.cf) : this.add8(d, s, this.cf);
          if (kind === "sub" || kind === "cmp") return w ? this.sub16(d, s) : this.sub8(d, s);
          if (kind === "sbb") return w ? this.sub16(d, s, this.cf) : this.sub8(d, s, this.cf);
          return w ? this.logic16(kind, d, s) : this.logic8(kind, d, s);
        };
        if (op === 0x04 || op === 0x05 || op === 0x0c || op === 0x0d || op === 0x14 || op === 0x15 ||
            op === 0x1c || op === 0x1d || op === 0x24 || op === 0x25 || op === 0x2c || op === 0x2d ||
            op === 0x34 || op === 0x35 || op === 0x3c || op === 0x3d) {
          const w = (op & 1) === 1;
          if (!w) { const ib = this.fetch8(); const r = apply(this.al, ib, false); if (kind !== "cmp") this.al = r; }
          else { const iw = this.fetch16(); const r = apply(this.ax, iw, true); if (kind !== "cmp") this.ax = r; }
          return true;
        }
        const m = this.modrm(), e = this.ea(m);
        const dir = (op & 2) === 2;
        if (is16) {
          if (!dir) { const r = apply(this.readEA16(e), this.getReg16(m.reg), true); if (kind !== "cmp") this.writeEA16(e, r); }
          else { const r = apply(this.getReg16(m.reg), this.readEA16(e), true); if (kind !== "cmp") this.setReg16(m.reg, r); }
        } else {
          if (!dir) { const r = apply(this.readEA8(e), this.getReg8(m.reg), false); if (kind !== "cmp") this.writeEA8(e, r); }
          else { const r = apply(this.getReg8(m.reg), this.readEA8(e), false); if (kind !== "cmp") this.setReg8(m.reg, r); }
        }
        return true;
      }
      case 0x06: this.push16(this.es); return true;
      case 0x07: this.es = this.pop16(); return true;
      case 0x0e: this.push16(this.cs); return true;
      case 0x0f: fail("POP CS ilegal no 8086"); break;
      case 0x16: this.push16(this.ss); return true;
      case 0x17: this.ss = this.pop16(); return true;
      case 0x1e: this.push16(this.ds); return true;
      case 0x1f: this.ds = this.pop16(); return true;
      case 0x27: { // DAA
        let al = this.al, cf = this.cf;
        if ((al & 0x0f) > 9 || (this.flags & F_AF)) { al = (al + 6) & 0xff; this.flags |= F_AF; } else this.flags &= ~F_AF;
        if (al > 0x99 || cf) { al = (al + 0x60) & 0xff; this.flags |= F_CF; }
        this.al = al; this.setSZP8(al); return true;
      }
      case 0x2f: { // DAS
        let al = this.al; const cf = this.cf;
        if ((al & 0x0f) > 9 || (this.flags & F_AF)) { al = (al - 6) & 0xff; this.flags |= F_AF; } else this.flags &= ~F_AF;
        if (al > 0x99 || cf) { al = (al - 0x60) & 0xff; this.flags |= F_CF; }
        this.al = al; this.setSZP8(al); return true;
      }
      case 0x37: { // AAA
        if ((this.al & 0x0f) > 9 || (this.flags & F_AF)) {
          this.al = (this.al + 6) & 0xff; this.ah = (this.ah + 1) & 0xff;
          this.flags |= F_AF | F_CF;
        } else this.flags &= ~(F_AF | F_CF);
        this.al &= 0x0f; return true;
      }
      case 0x3f: { // AAS
        if ((this.al & 0x0f) > 9 || (this.flags & F_AF)) {
          this.al = (this.al - 6) & 0xff; this.ah = (this.ah - 1) & 0xff;
          this.flags |= F_AF | F_CF;
        } else this.flags &= ~(F_AF | F_CF);
        this.al &= 0x0f; return true;
      }
      case 0x60: for (const r of ["ax", "cx", "dx", "bx", "sp", "bp", "si", "di"]) this.push16(this[r]); return true;
      case 0x61: { const di = this.pop16(), si = this.pop16(), bp = this.pop16(); this.pop16(); const bx = this.pop16(), dx = this.pop16(), cx = this.pop16(), ax = this.pop16();
        this.di = di; this.si = si; this.bp = bp; this.bx = bx; this.dx = dx; this.cx = cx; this.ax = ax; return true; }
      case 0x68: this.push16(this.fetch16()); return true;
      case 0x6a: { const b = this.fetch8(); this.push16(b & 0x80 ? b | 0xff00 : b); return true; }
      case 0x80: case 0x82: { const m = this.modrm(), e = this.ea(m), sub = m.reg, ib = this.fetch8();
        const d = this.readEA8(e); let r = d;
        if (sub === 0) r = this.add8(d, ib); else if (sub === 1) r = this.logic8("or", d, ib);
        else if (sub === 2) r = this.add8(d, ib, this.cf); else if (sub === 3) r = this.sub8(d, ib, this.cf);
        else if (sub === 4) r = this.logic8("and", d, ib); else if (sub === 5) r = this.sub8(d, ib);
        else if (sub === 6) r = this.logic8("xor", d, ib); else if (sub === 7) { this.sub8(d, ib); return true; }
        else fail("grupo 80h invalido");
        this.writeEA8(e, r); return true;
      }
      case 0x81: { const m = this.modrm(), e = this.ea(m), sub = m.reg, iw = this.fetch16();
        const d = this.readEA16(e); let r = d;
        if (sub === 0) r = this.add16(d, iw); else if (sub === 1) r = this.logic16("or", d, iw);
        else if (sub === 2) r = this.add16(d, iw, this.cf); else if (sub === 3) r = this.sub16(d, iw, this.cf);
        else if (sub === 4) r = this.logic16("and", d, iw); else if (sub === 5) r = this.sub16(d, iw);
        else if (sub === 6) r = this.logic16("xor", d, iw); else if (sub === 7) { this.sub16(d, iw); return true; }
        else fail("grupo 81h invalido");
        this.writeEA16(e, r); return true;
      }
      case 0x83: { const m = this.modrm(), e = this.ea(m), sub = m.reg; let ib = this.fetch8(); ib = ib & 0x80 ? ib | 0xff00 : ib;
        const d = this.readEA16(e); let r = d;
        if (sub === 0) r = this.add16(d, ib); else if (sub === 1) r = this.logic16("or", d, ib);
        else if (sub === 2) r = this.add16(d, ib, this.cf); else if (sub === 3) r = this.sub16(d, ib, this.cf);
        else if (sub === 4) r = this.logic16("and", d, ib); else if (sub === 5) r = this.sub16(d, ib);
        else if (sub === 6) r = this.logic16("xor", d, ib); else if (sub === 7) { this.sub16(d, ib); return true; }
        else fail("grupo 83h invalido");
        this.writeEA16(e, r); return true;
      }
      case 0x84: case 0x85: { const m = this.modrm(), e = this.ea(m), w = op & 1;
        if (w) this.logic16("and", this.getReg16(m.reg), this.readEA16(e));
        else this.logic8("and", this.getReg8(m.reg), this.readEA8(e)); return true;
      }
      case 0x86: case 0x87: { const m = this.modrm(), e = this.ea(m), w = op & 1;
        if (w) { const a = this.getReg16(m.reg), b = this.readEA16(e); this.setReg16(m.reg, b); this.writeEA16(e, a); }
        else { const a = this.getReg8(m.reg), b = this.readEA8(e); this.setReg8(m.reg, b); this.writeEA8(e, a); }
        return true;
      }
      case 0x88: case 0x89: case 0x8a: case 0x8b: { const m = this.modrm(), e = this.ea(m), w = op & 1, dir = (op & 2) === 2;
        if (w) { if (!dir) this.writeEA16(e, this.getReg16(m.reg)); else this.setReg16(m.reg, this.readEA16(e)); }
        else { if (!dir) this.writeEA8(e, this.getReg8(m.reg)); else this.setReg8(m.reg, this.readEA8(e)); }
        return true;
      }
      case 0x8c: { const m = this.modrm(), e = this.ea(m); const sreg = [this.es, this.cs, this.ss, this.ds][m.reg]; this.writeEA16(e, sreg); return true; }
      case 0x8d: { const m = this.modrm(), e = this.ea(m); if (e.isReg) fail("LEA em registrador"); this.setReg16(m.reg, e.off); return true; }
      case 0x8e: { const m = this.modrm(), e = this.ea(m); const v = this.readEA16(e);
        if (m.reg === 0) this.es = v; else if (m.reg === 2) this.ss = v; else if (m.reg === 3) this.ds = v;
        else fail("MOV segregado ilegal (CS)"); return true;
      }
      case 0x8f: { const m = this.modrm(), e = this.ea(m); if (m.reg !== 0) fail("grupo 8Fh so POP"); this.writeEA16(e, this.pop16()); return true; }
      case 0x90: return true;
      case 0x98: this.ax = (this.al & 0x80) ? (this.al | 0xff00) : this.al; return true;
      case 0x99: this.dx = (this.ax & 0x8000) ? 0xffff : 0; return true;
      case 0x9e: { // SAHF: AH -> flags (SF/ZF/AF/PF/CF)
        const ah = this.ah;
        this.flags = (this.flags & 0xff02) |
          (ah & 0x80 ? F_SF : 0) | (ah & 0x40 ? F_ZF : 0) |
          (ah & 0x10 ? F_AF : 0) | (ah & 0x04 ? F_PF : 0) | (ah & 0x01 ? F_CF : 0);
        return true;
      }
      case 0x9f: { // LAHF: flags -> AH
        const f = this.flags;
        this.ah = (f & F_SF ? 0x80 : 0) | (f & F_ZF ? 0x40 : 0) |
          (f & F_AF ? 0x10 : 0) | (f & F_PF ? 0x04 : 0) | 0x02 | (f & F_CF ? 0x01 : 0);
        return true;
      }
      case 0x9c: this.push16(this.flags | 0xf000); return true;
      case 0x9d: { const v = this.pop16(); this.flags = (v & 0x0fd5) | 0x0002; return true; }
      case 0x9a: { const off = this.fetch16(), seg = this.fetch16(); this.push16(this.cs); this.push16(this.ip); this.cs = seg; this.ip = off; return true; }
      case 0xa0: this.al = this.mem.read8(dseg(), this.fetch16()); return true;
      case 0xa1: this.ax = this.mem.read16(dseg(), this.fetch16()); return true;
      case 0xa2: this.mem.write8(dseg(), this.fetch16(), this.al); return true;
      case 0xa3: this.mem.write16(dseg(), this.fetch16(), this.ax); return true;
      case 0xa8: this.logic8("and", this.al, this.fetch8()); return true; // TEST AL,imm8
      case 0xa9: this.logic16("and", this.ax, this.fetch16()); return true; // TEST AX,imm16
      case 0xa4: case 0xa5: case 0xaa: case 0xab: case 0xac: case 0xad:
      case 0xa6: case 0xa7: case 0xae: case 0xaf: {
        const w = (op & 1) === 1;
        const rep = this.repPrefix;
        const iter = () => {
          const sSeg = this.segOverride ?? this.ds;
          if (op === 0xa4) { this.mem.write8(this.es, this.di, this.mem.read8(sSeg, this.si)); }
          else if (op === 0xa5) { this.mem.write16(this.es, this.di, this.mem.read16(sSeg, this.si)); }
          else if (op === 0xaa) { this.mem.write8(this.es, this.di, this.al); }
          else if (op === 0xab) { this.mem.write16(this.es, this.di, this.ax); }
          else if (op === 0xac) { this.al = this.mem.read8(sSeg, this.si); }
          else if (op === 0xad) { this.ax = this.mem.read16(sSeg, this.si); }
          else if (op === 0xa6) { const a = this.mem.read8(sSeg, this.si), b = this.mem.read8(this.es, this.di); this.sub8(a, b); }
          else if (op === 0xa7) { const a = this.mem.read16(sSeg, this.si), b = this.mem.read16(this.es, this.di); this.sub16(a, b); }
          else if (op === 0xae) { const b = this.mem.read8(this.es, this.di); this.sub8(this.al, b); }
          else if (op === 0xaf) { const b = this.mem.read16(this.es, this.di); this.sub16(this.ax, b); }
          const d = this.df ? -1 : 1;
          const st = (op === 0xa4 || op === 0xac || op === 0xa6 || op === 0xaa || op === 0xae) ? 1 : 2;
          if (op === 0xa4 || op === 0xa5 || op === 0xac || op === 0xad || op === 0xa6 || op === 0xa7) {
            this.si = (this.si + d * st) & 0xffff;
            if (this.regHook) this.regHook("si+str", this.si, this);
          }
          if (op === 0xa4 || op === 0xa5 || op === 0xaa || op === 0xab || op === 0xa6 || op === 0xa7 || op === 0xae || op === 0xaf) {
            this.di = (this.di + d * st) & 0xffff;
            if (this.regHook) this.regHook("di+str", this.di, this);
          }
        };
        if (!rep) { iter(); return true; }
        if (op === 0xa6 || op === 0xa7 || op === 0xae || op === 0xaf) {
          // REPE/REPNE CMPS/SCAS
          while (this.cx !== 0) {
            iter(); this.cx = (this.cx - 1) & 0xffff;
            const z = this.zf;
            if ((rep === 0xf3 && !z) || (rep === 0xf2 && z)) break;
            if (this.cx === 0) break;
          }
        } else {
          while (this.cx !== 0) { iter(); this.cx = (this.cx - 1) & 0xffff; }
        }
        return true;
      }
      case 0xc2: { const i = this.fetch16(); this.ip = this.pop16(); this.sp = (this.sp + i) & 0xffff; return true; }
      case 0xc3: this.ip = this.pop16(); return true;
      case 0xc4: { const m = this.modrm(), e = this.ea(m); if (e.isReg) fail("LES em reg"); this.setReg16(m.reg, this.mem.read16(e.seg, e.off)); this.es = this.mem.read16(e.seg, (e.off + 2) & 0xffff); return true; }
      case 0xc5: { const m = this.modrm(), e = this.ea(m); if (e.isReg) fail("LDS em reg"); this.setReg16(m.reg, this.mem.read16(e.seg, e.off)); this.ds = this.mem.read16(e.seg, (e.off + 2) & 0xffff); return true; }
      case 0xc6: { const m = this.modrm(), e = this.ea(m); if (m.reg !== 0) fail("grupo C6h"); this.writeEA8(e, this.fetch8()); return true; }
      case 0xc7: { const m = this.modrm(), e = this.ea(m); if (m.reg !== 0) fail("grupo C7h"); this.writeEA16(e, this.fetch16()); return true; }
      case 0xca: { const i = this.fetch16(); this.ip = this.pop16(); this.cs = this.pop16(); this.sp = (this.sp + i) & 0xffff; return true; }
      case 0xcb: this.ip = this.pop16(); this.cs = this.pop16(); return true;
      case 0xcc: if (this.hooks.int) this.hooks.int(3, this); return true;
      case 0xcd: { const n = this.fetch8(); if (this.hooks.int) this.hooks.int(n, this); return true; }
      case 0xce: if (this.of && this.hooks.int) this.hooks.int(4, this); return true;
      case 0xcf: { this.ip = this.pop16(); this.cs = this.pop16(); const f = this.pop16(); this.flags = (f & 0x0fd5) | 0x0002; return true; }
      case 0xc8: { // ENTER imm16, imm8 (80186+): o EDIT/QBASIC usam p/ montar frame
        const size = this.fetch16(), level = this.fetch8() & 0x1f;
        this.push16(this.bp);
        const frame = this.sp;
        if (level > 0) {
          for (let i = 1; i < level; i++) {
            this.bp = (this.bp - 2) & 0xffff;
            this.push16(this.mem.read16(this.ss, this.bp));
          }
          this.push16(frame);
        }
        this.bp = frame;
        this.sp = (this.sp - size) & 0xffff;
        return true;
      }
      case 0xc9: this.sp = this.bp; this.bp = this.pop16(); return true; // LEAVE
      case 0x69: case 0x6b: { // IMUL reg, r/m, imm16 (186): produto com sinal
        const m = this.modrm(), e = this.ea(m);
        let imm = op === 0x69 ? this.fetch16() : this.fetch8();
        if (op === 0x6b && (imm & 0x80)) imm |= 0xff00;
        const a = this.readEA16(e);
        const sa = a & 0x8000 ? a - 0x10000 : a, si = imm & 0x8000 ? imm - 0x10000 : imm;
        const r = sa * si;
        this.setReg16(m.reg, r & 0xffff);
        if (r < -32768 || r > 32767) this.flags |= F_CF | F_OF; else this.flags &= ~(F_CF | F_OF);
        return true;
      }
      case 0xd0: case 0xd1: { const m = this.modrm(), e = this.ea(m); // D0/D1: conta 1; D2/D3: conta CL
        if ((op & 1) === 0) this.writeEA8(e, this.doShift(0, m.reg, this.readEA8(e), 1, 8));
        else this.writeEA16(e, this.doShift(0, m.reg, this.readEA16(e), 1, 16)); return true; }
      case 0xd2: case 0xd3: { const m = this.modrm(), e = this.ea(m); const cnt = this.cl;
        if ((op & 1) === 0) this.writeEA8(e, this.doShift(0, m.reg, this.readEA8(e), cnt, 8));
        else this.writeEA16(e, this.doShift(0, m.reg, this.readEA16(e), cnt, 16)); return true; }
      case 0xc0: case 0xc1: { const m = this.modrm(), e = this.ea(m), cnt = this.fetch8();
        if ((op & 1) === 0) this.writeEA8(e, this.doShift(0, m.reg, this.readEA8(e), cnt, 8));
        else this.writeEA16(e, this.doShift(0, m.reg, this.readEA16(e), cnt, 16)); return true; }
      case 0xd4: { const b = this.fetch8(); if (b !== 0x0a) fail("AAM so base 0Ah"); const q = Math.floor(this.al / 10); this.ah = q; this.al = this.al % 10; this.setSZP8(this.al); return true; }
      case 0xd5: { const b = this.fetch8(); if (b !== 0x0a) fail("AAD so base 0Ah"); this.al = (this.al + this.ah * 10) & 0xff; this.ah = 0; this.setSZP8(this.al); return true; }
      case 0xd7: this.al = this.mem.read8(dseg(), (this.bx + this.al) & 0xffff); return true;
      case 0xe0: case 0xe1: case 0xe2: case 0xe3: { const d = this.fetchs8();
        this.cx = (this.cx - 1) & 0xffff;
        const take = op === 0xe0 ? (this.cx !== 0 && !this.zf) : op === 0xe1 ? (this.cx !== 0 && this.zf) : op === 0xe2 ? (this.cx !== 0) : (this.cx === 0xffff ? true : (this.cx + 1 - 1, this.cx === 0xffff));
        // JCXZ (E3) nao decrementa:
        if (op === 0xe3) { this.cx = (this.cx + 1) & 0xffff; if (this.cx === 0) this.ip = (this.ip + d) & 0xffff; return true; }
        if (take) this.ip = (this.ip + d) & 0xffff; return true;
      }
      case 0xe4: { const p = this.fetch8(); this.al = this.hooks.in ? this.hooks.in(p, this) & 0xff : 0xff; return true; }
      case 0xe5: { const p = this.fetch8(); const v = this.hooks.in ? this.hooks.in(p | (this.hooks.in16 ? 0 : 0), this) : 0; this.ax = v & 0xffff; return true; }
      case 0xe6: { const p = this.fetch8(), v = this.fetch8(); if (this.hooks.out) this.hooks.out(p, v, this); return true; }
      case 0xe7: { const p = this.fetch8(); if (this.hooks.out) this.hooks.out(p, this.ax, this); return true; }
      case 0xe8: { const d = this.fetch16(); const s = d & 0x8000 ? d - 0x10000 : d; this.push16(this.ip); this.ip = (this.ip + s) & 0xffff; return true; }
      case 0xe9: { const d = this.fetch16(); const s = d & 0x8000 ? d - 0x10000 : d; this.ip = (this.ip + s) & 0xffff; return true; }
      case 0xea: { const off = this.fetch16(), seg = this.fetch16(); this.ip = off; this.cs = seg; return true; }
      case 0xeb: { const d = this.fetchs8(); this.ip = (this.ip + d) & 0xffff; return true; }
      case 0xec: this.al = this.hooks.in ? this.hooks.in(this.dx, this) & 0xff : 0xff; return true;
      case 0xed: this.ax = this.hooks.in ? (this.hooks.in(this.dx, this) & 0xffff) : 0xffff; return true;
      case 0xee: if (this.hooks.out) this.hooks.out(this.dx, this.al, this); return true;
      case 0xef: if (this.hooks.out) this.hooks.out(this.dx, this.ax, this); return true;
      case 0xf4: this.halted = true; return false;
      case 0xf5: this.flags ^= F_CF; return true;
      case 0xf6: { const m = this.modrm(), e = this.ea(m), sub = m.reg;
        if (sub === 0 || sub === 1) { const ib = this.fetch8(); this.logic8("and", this.readEA8(e), ib); return true; }
        const v = this.readEA8(e);
        if (sub === 2) { this.writeEA8(e, (~v) & 0xff); return true; }
        if (sub === 3) { this.writeEA8(e, ((~v + 1) & 0xff)); const c = v === 0 ? 0 : 1; this.flags = (this.flags & ~F_CF) | (c ? F_CF : 0); this.setSZP8((~v + 1) & 0xff); return true; }
        if (sub === 4) { const a = this.al, r = (a * v) & 0xffff; this.ax = r; this.flags = (this.flags & ~(F_CF | F_OF)) | (this.ah !== 0 ? F_CF | F_OF : 0); return true; }
        if (sub === 5) { // IMUL r/m8: AX = AL * r/m8 com sinal
          const a = (this.al & 0x80) ? this.al - 0x100 : this.al, b = (v & 0x80) ? v - 0x100 : v;
          const r = a * b; this.ax = r & 0xffff;
          const fits = (this.al & 0x80) ? this.ah === 0xff : this.ah === 0x00;
          this.flags = (this.flags & ~(F_CF | F_OF)) | (fits ? 0 : F_CF | F_OF); return true; }
        if (sub === 6) { if (v === 0) fail("DIV0 (8bit)"); const q = Math.floor(this.ax / v), r = this.ax % v;
          if (q > 0xff) fail("DIV overflow (8bit)"); this.al = q; this.ah = r; return true; }
        if (sub === 7) { if (v === 0) fail("IDIV0 (8bit)"); const a = (this.ax & 0x8000) ? this.ax - 0x10000 : this.ax, b = (v & 0x80) ? v - 0x100 : v;
          const q = Math.trunc(a / b), r = a % b;
          if (q < -128 || q > 127) fail("IDIV overflow (8bit)"); this.al = q & 0xff; this.ah = r & 0xff; return true; }
        fail("grupo F6h invalido");
      }
      case 0xf7: { const m = this.modrm(), e = this.ea(m), sub = m.reg;
        if (sub === 0 || sub === 1) { const iw = this.fetch16(); this.logic16("and", this.readEA16(e), iw); return true; }
        const v = this.readEA16(e);
        if (sub === 2) { this.writeEA16(e, (~v) & 0xffff); return true; }
        if (sub === 3) { const r = ((~v + 1) & 0xffff); this.writeEA16(e, r); this.flags = (this.flags & ~F_CF) | (v === 0 ? 0 : F_CF); this.setSZP16(r); return true; }
        if (sub === 4) { const r = (this.ax * v) >>> 0; this.ax = r & 0xffff; this.dx = (r >>> 16) & 0xffff;
          this.flags = (this.flags & ~(F_CF | F_OF)) | (this.dx !== 0 ? F_CF | F_OF : 0); return true; }
        if (sub === 5) { // IMUL r/m16: DX:AX = AX * r/m16 com sinal
          const a = (this.ax & 0x8000) ? this.ax - 0x10000 : this.ax, b = (v & 0x8000) ? v - 0x10000 : v;
          const r = a * b; this.ax = r & 0xffff; this.dx = (r >> 16) & 0xffff;
          const fits = (this.ax & 0x8000) ? this.dx === 0xffff : this.dx === 0x0000;
          this.flags = (this.flags & ~(F_CF | F_OF)) | (fits ? 0 : F_CF | F_OF); return true; }
        if (sub === 6) { if (v === 0) fail("DIV0 (16bit)"); const num = this.dx * 0x10000 + this.ax; const q = Math.floor(num / v), r = num % v;
          if (q > 0xffff) fail("DIV overflow (16bit)"); this.ax = q; this.dx = r; return true; }
        if (sub === 7) { if (v === 0) fail("IDIV0 (16bit)"); const hi = (this.dx & 0x8000) ? this.dx - 0x10000 : this.dx;
          const a = (this.ax & 0x8000) ? this.ax - 0x10000 : this.ax, b = (v & 0x8000) ? v - 0x10000 : v;
          const num = hi * 0x10000 + a; const q = Math.trunc(num / b), r = num % b;
          if (q < -32768 || q > 32767) fail("IDIV overflow (16bit)"); this.ax = q & 0xffff; this.dx = r & 0xffff; return true; }
        fail("grupo F7h invalido");
      }
      case 0xf8: this.flags &= ~F_CF; return true;
      case 0xf9: this.flags |= F_CF; return true;
      case 0xfa: this.flags &= ~F_IF; return true;
      case 0xfb: this.flags |= F_IF; return true;
      case 0xfc: this.flags &= ~F_DF; return true;
      case 0xfd: this.flags |= F_DF; return true;
      case 0xfe: { const m = this.modrm(), e = this.ea(m), cf = this.flags & 0x0001;
        if (m.reg === 0) this.writeEA8(e, this.add8(this.readEA8(e), 1));
        else if (m.reg === 1) this.writeEA8(e, this.sub8(this.readEA8(e), 1));
        else fail("grupo FEh"); this.flags = (this.flags & ~0x0001) | cf; return true; }
      case 0xff: { const m = this.modrm(), e = this.ea(m);
        if (m.reg === 0 || m.reg === 1) { const cf = this.flags & 0x0001;
          this.writeEA16(e, m.reg === 0 ? this.add16(this.readEA16(e), 1) : this.sub16(this.readEA16(e), 1));
          this.flags = (this.flags & ~0x0001) | cf;
        }
        else if (m.reg === 2) { this.push16(this.ip); this.ip = this.readEA16(e); }
        else if (m.reg === 3) { const off = this.readEA16(e); const seg = e.isReg ? this.cs : this.mem.read16(e.seg, (e.off + 2) & 0xffff); this.push16(this.cs); this.push16(this.ip); this.cs = seg; this.ip = off; }
        else if (m.reg === 4) { this.ip = this.readEA16(e); }
        else if (m.reg === 5) { const off = this.readEA16(e); const seg = e.isReg ? this.cs : this.mem.read16(e.seg, (e.off + 2) & 0xffff); this.ip = off; this.cs = seg; }
        else if (m.reg === 6) this.push16(this.readEA16(e));
        else fail("grupo FFh"); return true; }
      default: fail("opcode nao implementado");
    }
    return true;
  }
  run(maxSteps = 100000) {
    let n = 0;
    while (!this.halted && !this.exited && n < maxSteps) { this.step(); n++; }
    if (!this.halted && !this.exited && n >= maxSteps) throw new Error(`limite de passos (${maxSteps}) excedido em ${h(this.cs)}:${h(this.ip)} AX=${h(this.ax)}`);
    return { steps: n, exited: this.exited, exitCode: this.exitCode, halted: this.halted };
  }
}

const h = v => v.toString(16).padStart(4, "0").toUpperCase();
export { Memory };

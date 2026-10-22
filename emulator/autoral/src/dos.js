// Servicos DOS/BIOS — dispatcher em evolucao (M2).
// Estrategia: implementar de verdade o que e trivial (console, exit,
// versao, video teletype, teclado da fila), retornar sucesso plausivel
// p/ sondagens (vetores, memoria, equipamento) e FALHAR com mensagem
// acionavel no resto — cada falha vira o proximo teste/implementacao.
// Tudo que chega aqui e logado em state.intLog p/ dirigir o trabalho.
import { VIDEO_BASE } from "./video.js";

// Sentinela: a CPU parou esperando teclado (quem dirige o emulador decide o
// que fazer — o CLI le' uma linha, a pagina web espera o teclado).
export const INPUT_WAIT = { wait: true };

const H = v => v.toString(16).padStart(2, "0").toUpperCase();
const H4 = v => v.toString(16).padStart(4, "0").toUpperCase();

// Scan codes Set 1 p/ teclas ASCII (usado por pushKeys e pelo fluxo roteirizado).
export function keyCode(c) {
  if (c === 0x0d) return 0x1c0d;
  if (c === 0x1b) return 0x011b;
  if (c === 0x08) return 0x0e08;
  if (c === 0x09) return 0x0f09;
  const SCAN = {
    a: 0x1e, b: 0x30, c: 0x2e, d: 0x20, e: 0x12, f: 0x21, g: 0x22, h: 0x23,
    i: 0x17, j: 0x24, k: 0x25, l: 0x26, m: 0x32, n: 0x31, o: 0x18, p: 0x19,
    q: 0x10, r: 0x13, s: 0x1f, t: 0x14, u: 0x16, v: 0x2f, w: 0x11, x: 0x2d,
    y: 0x15, z: 0x2c, "0": 0x0b, "1": 0x02, "2": 0x03, "3": 0x04, "4": 0x05,
    "5": 0x06, "6": 0x07, "7": 0x08, "8": 0x09, "9": 0x0a, " ": 0x39,
  };
  const s = SCAN[String.fromCharCode(c).toLowerCase()] ?? 0x00;
  return (s << 8) | (c & 0xff);
}

export function handleInterrupt(n, cpu, mem, video, state) {
  state.intLog.push({ n, ah: cpu.ah, al: cpu.al, ax: cpu.ax, step: cpu.steps });
  if (state.intLog.length > 2000) state.intLog.shift();
  const ok = () => { cpu.flags &= ~0x0001; };
  const fail = (msg) => { throw new Error(`${msg}: INT ${H(n)}h/AH=${H(cpu.ah)}h AL=${H(cpu.al)}h em ${H4(cpu.cs)}:${H4(cpu.ip)} passo=${cpu.steps}`); };

  // Entrada INTERATIVA (CLI/navegador): se o programa pede teclado e nao ha' o
  // que ele precisa, NAO inventamos um Enter (era o que fazia cada caractere
  // digitado virar um comando sozinho). Rebobinamos o IP e reexecutamos o
  // proprio INT quando a tecla chegar.
  // Leitura de UMA tecla (INT 16h/AH=00h, INT 21h/AH=01h,07h,08h,0Ch+AL) e'
  // pausada aqui; AH=0Ah tem o seu proprio ponto de pausa (retomavel) para
  // poder ecoar caractere por caractere.
  if (state.interactive) {
    const scripted = state.inputLine.length > 0 || state.inLine != null;
    let oneKey = false;
    if (n === 0x16) oneKey = cpu.ah === 0x00 || cpu.ah === 0x10;
    else if (n === 0x21) {
      const sub = cpu.ah === 0x0c ? cpu.al : cpu.ah;                         // AH=0Ch: subfuncao em AL
      oneKey = sub === 0x01 || sub === 0x07 || sub === 0x08;
    }
    if (oneKey && !state.keys.length && !scripted) { cpu.ip = (cpu.ip - 2) & 0xffff; throw INPUT_WAIT; }
  }

  switch (n) {
    case 0x20: cpu.exited = true; cpu.exitCode = 0; return;
    case 0x10: return int10(cpu, mem, video, ok, fail);
    case 0x11: cpu.ax = 0x0020; ok(); return; // equipamento: basico
    case 0x12: cpu.ax = 0x0280; ok(); return; // 640K
    case 0x13: return int13(cpu, ok, fail);
    // INT 15h: BIOS estendida. O MEM usa p/ o mapa de memoria (EBDA, memoria
    // estendida, tabela de configuracao do sistema). Funcoes desconhecidas
    // devolvem CF=1/AH=86h ("nao suportada") em vez de derrubar a maquina.
    case 0x15: {
      const ah = cpu.ah;
      if (ah === 0x86) { ok(); return; }               // espera CX:DX microssegundos
      if (ah === 0x88) { cpu.ax = 0x0000; ok(); return; } // memoria estendida (KB)
      if (ah === 0xc0) { cpu.flags |= 0x0001; return; }   // tabela de configuracao: ausente
      if (ah === 0xc1) { cpu.es = 0x9fc0; ok(); return; } // segmento da EBDA
      cpu.ah = 0x86; cpu.flags |= 0x0001; return;         // generico: nao suportada
    }
    case 0x16: return int16(cpu, state, ok, fail);
    case 0x1a: { // relogio: le o tick 40:6C que Machine.run avanca
      if (cpu.ah === 0x00) {
        const p = (0x40 << 4) + 0x6c;
        const lo = mem.buf[p] | (mem.buf[p + 1] << 8);
        const hi = mem.buf[p + 2] | (mem.buf[p + 3] << 8);
        cpu.cx = hi; cpu.dx = lo; cpu.al = 0; ok(); return;
      }
      // funcao desconhecida: CF=1/AL=0 em vez de derrubar a maquina
      cpu.ax = 0x0000; cpu.flags |= 0x0001; return;
    }
    case 0x21: return int21(cpu, mem, video, state, ok, fail);
    // INT 25h/26h: leitura/escrita absoluta de setor. O CHKDSK/SCANDISK/
    // FORMAT/UNDELETE leem o setor de boot, a FAT e o diretorio raiz por
    // aqui. Convencao especial: o handler devolve CF nos flags E *empilha*
    // uma copia dos flags (o chamador da' "pop" para limpar a pilha).
    case 0x25: case 0x26: {
      const writing = n === 0x26;
      const disk = state.disk;
      let start, count, bufSeg, bufOff;
      if (cpu.cx === 0xffff) {
        // DOS 4+: bloco de parametros em DS:BX
        const p = ((cpu.ds << 4) + cpu.bx) & 0xfffff;
        start = (mem.buf[p] | (mem.buf[p + 1] << 8) | (mem.buf[p + 2] << 16) | (mem.buf[p + 3] << 24)) >>> 0;
        count = mem.buf[p + 4] | (mem.buf[p + 5] << 8);
        bufOff = mem.buf[p + 6] | (mem.buf[p + 7] << 8);
        bufSeg = mem.buf[p + 8] | (mem.buf[p + 9] << 8);
      } else {
        start = cpu.dx; count = cpu.cx; bufSeg = cpu.ds; bufOff = cpu.bx;
      }
      if (!disk || cpu.al > 0x05 || count === 0) {
        // unidade inexistente / pedido invalido
        state.lastError = 15; cpu.ax = 0x000f; cpu.flags |= 0x0001;
      } else if (writing) {
        // nao persistimos escritas: aceita p/ o FORMAT avancar
        cpu.ax = 0x0000; cpu.flags &= ~0x0001;
      } else {
        for (let i = 0; i < count; i++) {
          const sec = disk.readSector(start + i);
          const dst = (((bufSeg << 4) + bufOff + i * 512) & 0xfffff);
          mem.buf.set(sec.subarray(0, Math.min(512, mem.buf.length - dst)), dst);
        }
        cpu.ax = 0x0000; cpu.flags &= ~0x0001;
      }
      cpu.push16(cpu.flags & 0xffff);
      return;
    }
    case 0x27: { // TSR: termina mas fica residente (memoria e vetores ficam)
      state.tsr = true;
      state.tsrKeep = cpu.dx; // DX = bytes a manter (contando o PSP)
      cpu.exited = true; cpu.exitCode = 0;
      return;
    }
    case 0x2f: { // multiplex: p/ funcoes desconhecidas preserva regs
      if (cpu.ah === 0x12 && (cpu.ax & 0xff) === 0x2e) {
        // INT 2F AX=122Eh: o DOS devolve ES:DI = ponteiro para o texto da
        // mensagem de erro numero DL. As ferramentas da Microsoft (XCOPY,
        // ATTRIB, TREE, FIND, COMMAND) chamam 5x no startup (DL=0,2,4,6,8)
        // e guardam os ponteiros. Devolver ES:DI=0:0 (o que faziamos) deixa
        // ponteiro NULO e o runtime le lixo => "Invalid drive specification".
        const MSGS = [
          "Access denied",
          "Invalid drive specification",
          "File not found",
          "Invalid parameter",
          "Insufficient memory",
        ];
        for (let i = 0; i < MSGS.length; i++) {
          const s = MSGS[i];
          const base = ((state.dosSeg ?? 0x0070) << 4) + 0x0200;
          for (let k = 0; k < s.length; k++) mem.buf[base + i * 0x20 + k] = s.charCodeAt(k);
          mem.buf[base + i * 0x20 + s.length] = 0;
        }
        cpu.es = state.dosSeg ?? 0x0070;
        cpu.di = 0x0200 + ((cpu.dl >> 1) % 5) * 0x20;
        cpu.ax = 0x122e;
        ok(); return;
      }
      // (cadeia vazia = ninguem instalado; o programa decide pelo eco)
      if (cpu.ah === 0x16 || (cpu.ax & 0xff00) === 0x1100 || (cpu.ax & 0xff00) === 0x1200) { cpu.al = 0x00; ok(); return; }
      return; // preserva registradores, sem tocar CF
    }
    case 0x33: cpu.ax = 0x0000; ok(); return; // mouse ausente
    // Interrupcao nao tratada: apenas retorna (no-op). Preservar registradores
    // e o comportamento correto p/ INTs de sistema (22h/23h/24h/28h/1Ch...).
    default: return;
  }
}

function int10(cpu, mem, video, ok, fail) {
  const ah = cpu.ah;
  if (ah === 0x0e) { video.putChar(cpu.al & 0xff); state_out(cpu, mem, video); ok(); return; }
  if (ah === 0x03) { cpu.dh = video.cy; cpu.dl = video.cx; cpu.ch = 0; cpu.cl = 7; ok(); return; }
  if (ah === 0x02) { video.cy = cpu.dh % 25; video.cx = cpu.dl % 80; ok(); return; }
  if (ah === 0x06 || ah === 0x07) { if (cpu.al === 0) video.clear(); ok(); return; }
  if (ah === 0x0f) { cpu.al = 0x03; cpu.ah = 80; cpu.bh = 0; ok(); return; }
  if (ah === 0x00) { video.clear(); ok(); return; }
  if (ah === 0x09 || ah === 0x0a) { video.putChar(cpu.al & 0xff); ok(); return; }
  if (ah === 0x0b || ah === 0x05) { ok(); return; } // paleta/pagina: no-op
  if (ah === 0x01) { ok(); return; } // forma do cursor
  if (ah === 0x10 || ah === 0x11 || ah === 0x12 || ah === 0x1a) { ok(); return; } // paleta/fontes/VGA
  if (ah === 0x13) { // escrever texto com atributo
    const row = cpu.dh, col = cpu.dl;
    video.cy = row % 25; video.cx = col % 80;
    let p = ((cpu.bp) + (cpu.es << 4)) >>> 0;
    const n = cpu.cx;
    for (let i = 0; i < n; i++) video.putChar(mem.buf[(p + i) >>> 0] & 0xff);
    ok(); return;
  }
  ok(); return; // funcao desconhecida: no-op (nao derruba a maquina)
}
function state_out() {}

// Funde o bloco livre `fs` com vizinhos livres seguintes (cadeia MCB).
function mergeFree(mem, fs) {
  for (let g = 0; g < 64; g++) {
    const fp = fs << 4;
    if (fp < 0 || fp > mem.buf.length - 16) break;
    if (mem.buf[fp] !== 0x4d && mem.buf[fp] !== 0x5a) break;
    const fsize = mem.buf[fp + 3] | (mem.buf[fp + 4] << 8);
    const ns = fs + fsize + 1, np2 = ns << 4;
    if (np2 < 0 || np2 > mem.buf.length - 16) break;
    if (mem.buf[np2] !== 0x4d && mem.buf[np2] !== 0x5a) break;
    if ((mem.buf[np2 + 1] | (mem.buf[np2 + 2] << 8)) !== 0) break;
    const nsize = mem.buf[np2 + 3] | (mem.buf[np2 + 4] << 8);
    const total = fsize + 1 + nsize;
    mem.buf[fp + 3] = total & 0xff; mem.buf[fp + 4] = (total >> 8) & 0xff;
    mem.buf[fp] = mem.buf[np2];
    mem.buf.fill(0, np2, np2 + 16);
  }
}

// Encolhe o bloco `mcb` para `paras` paragrafos e devolve o resto como bloco
// livre (com merge). Usado pelo TSR (INT 27h / INT 21h/AH=31h), que pede para
// manter apenas a parte residente: sem isto o TSR fica com o bloco INTEIRO que
// o DOS deu ao filho (o maior livre) e o COMMAND.COM nao consegue mais
// recarregar a parte transiente ("Memory allocation error").
function shrinkBlock(mem, mcb, paras) {
  const p = mcb << 4;
  if (p < 0 || p > mem.buf.length - 16) return;
  const t = mem.buf[p];
  if (t !== 0x4d && t !== 0x5a) return;
  const size = mem.buf[p + 3] | (mem.buf[p + 4] << 8);
  if (paras < 0x10 || paras >= size) return; // nunca menos que o PSP
  mem.buf[p + 3] = paras & 0xff; mem.buf[p + 4] = (paras >> 8) & 0xff;
  const rest = size - paras - 1;
  if (rest <= 0) return;
  const np = (mcb + paras + 1) << 4;
  mem.buf[np] = t;
  mem.buf[np + 1] = 0; mem.buf[np + 2] = 0;
  mem.buf[np + 3] = rest & 0xff; mem.buf[np + 4] = (rest >> 8) & 0xff;
  mem.buf.fill(0, np + 5, np + 16);
  if (t === 0x5a) mem.buf[p] = 0x4d;
  mergeFree(mem, mcb + paras + 1);
}

// Libera o bloco `mcb` (merge com anterior livre + seguintes).
function freeBlock(mem, mcb) {
  const p = mcb << 4;
  mem.buf[p + 1] = 0; mem.buf[p + 2] = 0;
  // acha predecessor livre: caminha desde o inicio
  let seg = mem.buf[0x4fe] | (mem.buf[0x4ff] << 8);
  for (let g = 0; g < 64; g++) {
    const bp = seg << 4;
    if (bp < 0 || bp > mem.buf.length - 16) break;
    const t = mem.buf[bp];
    if (t !== 0x4d && t !== 0x5a) break;
    const size = mem.buf[bp + 3] | (mem.buf[bp + 4] << 8);
    const owner = mem.buf[bp + 1] | (mem.buf[bp + 2] << 8);
    const next = seg + size + 1;
    if (next === mcb && owner === 0) {
      // absorve mcb no predecessor
      const msize = mem.buf[p + 3] | (mem.buf[p + 4] << 8);
      const total = size + 1 + msize;
      mem.buf[bp + 3] = total & 0xff; mem.buf[bp + 4] = (total >> 8) & 0xff;
      mem.buf[bp] = mem.buf[p];
      mem.buf.fill(0, p, p + 16);
      mergeFree(mem, seg);
      return;
    }
    if (t === 0x5a) break;
    seg = next;
  }
  mergeFree(mem, mcb);
}

// INT 21h AH=4Bh EXEC — carrega e executa um .COM/.EXE filho e volta.
// Usa state.machine (ligado por Machine). Profundidade limitada.
// DOS anexa o caminho completo do programa logo apos o terminador duplo-NUL
// do bloco de ambiente do filho. Varios programas (ex.: MSCDEX.EXE) reabrem o
// proprio arquivo por esse caminho; sem ele leem lixo e desistem em silencio.
function appendEnvPath(mem, envSeg, path) {
  if (!envSeg || !path) return;
  const b0 = envSeg << 4;
  // limite = tamanho do bloco (MCB do ambiente); fallback generoso
  let limit = 0x100;
  let seg = mem.buf[0x4fe] | (mem.buf[0x4ff] << 8);
  for (let g = 0; g < 64; g++) {
    const b = seg << 4;
    const size = mem.buf[b + 3] | (mem.buf[b + 4] << 8);
    if (seg === envSeg) { limit = (size - 1) << 4; break; }
    if (mem.buf[b] === 0x5a) break;
    seg = seg + size + 1;
  }
  let i = 0;
  while (i + 1 < limit && !(mem.buf[b0 + i] === 0 && mem.buf[b0 + i + 1] === 0)) i++;
  if (i + 1 >= limit) return;
  const at = i + 2; // logo apos o par de NULs
  const s = String(path).toUpperCase();
  if (at + s.length + 1 > limit) return; // nao cabe: nao corrompe vizinhos
  for (let k = 0; k < s.length; k++) mem.buf[b0 + at + k] = s.charCodeAt(k) & 0xff;
  mem.buf[b0 + at + s.length] = 0;
}

function execLoad(cpu, mem, video, state, ok, fail) {
  const M = state.machine;
  if (!M) { cpu.flags |= 0x0001; cpu.ax = 1; return; }
  if (cpu.al !== 0x00) { cpu.flags |= 0x0001; cpu.ax = 1; return; } // so EXEC normal
  let p = "";
  for (let i = 0; i < 128; i++) {
    const c = mem.read8(cpu.ds, (cpu.dx + i) & 0xffff);
    if (c === 0) break;
    p += String.fromCharCode(c);
  }
  const name = p.toUpperCase().replace(/\//g, "\\").split("\\").filter(Boolean).pop() || "";
  const file = state.fs.get(name) || state.fs.get(name + ".EXE") || state.fs.get(name + ".COM");
  if (!file) { state.lastError = 2; cpu.flags |= 0x0001; cpu.ax = 2; return; }
  if ((state.execDepth ?? 0) >= 8) { cpu.flags |= 0x0001; cpu.ax = 8; return; }
  // bloco de parametros em ES:BX
  const es = cpu.es, bx = cpu.bx;
  const r16 = (o) => mem.read16(es, (bx + o) & 0xffff);
  const envSeg = r16(0), tailOff = r16(2), tailSeg = r16(4);
  const tailLen = Math.min(mem.read8(tailSeg, tailOff), 126);
  // snapshot
  const snapMem = mem.buf.slice();
  const regs = ["ax", "bx", "cx", "dx", "si", "di", "bp", "sp", "cs", "ds", "es", "ss", "ip", "flags"];
  const snapCpu = {};
  for (const r of regs) snapCpu[r] = cpu[r];
  const snap = {
    psp: state.psp, dtaSeg: state.dtaSeg, dtaOff: state.dtaOff,
    handles: new Map(state.handles), nextHandle: state.nextHandle,
    findCtx: state.findCtx, lastExit: state.lastExit,
    lineRead: state.lineRead, // linha em construcao (entrada interativa)
  };
  let retAx = 0, retCF = 0;
  let bestSeg = 0; // MCB do bloco dado ao filho (usado pelo TSR)
  state.tsr = false;
  try {
    state.execDepth = (state.execDepth ?? 0) + 1;
    const need = ((file.length + 0x100 + 0xf) >> 4) + 0x11;
    // DOS aloca o MAIOR bloco livre para o filho (nao o tamanho exato do
    // arquivo). Todo programa .COM/.EXE comeca encolhendo o proprio bloco
    // com AH=4A; se alocarmos so o tamanho do arquivo, esse AH=4A pede
    // CRESCER e falha => "Extended Error 8" (ATTRIB, XCOPY, ...).
    let seg = mem.buf[0x4fe] | (mem.buf[0x4ff] << 8), found = 0, best = 0;
    for (let g = 0; g < 64; g++) {
      const b = seg << 4;
      const type = mem.buf[b], owner = mem.buf[b + 1] | (mem.buf[b + 2] << 8);
      const size = mem.buf[b + 3] | (mem.buf[b + 4] << 8);
      if (owner === 0 && size > best) { best = size; bestSeg = seg; }
      if (type === 0x5a) break;
      seg = seg + size + 1;
    }
    if (best >= need) {
      found = bestSeg + 1;
      const b = bestSeg << 4;
      mem.buf[b + 1] = (bestSeg + 1) & 0xff; mem.buf[b + 2] = ((bestSeg + 1) >> 8) & 0xff; // dono = PSP do filho
    }
    if (!found) { cpu.flags |= 0x0001; cpu.ax = 8; cpu.bx = best; return; }
    // PSP filho
    const base = found << 4;
    mem.buf.fill(0, base, base + 0x100);
    mem.buf[base] = 0xcd; mem.buf[base + 1] = 0x20;
    mem.buf[base + 2] = 0xff; mem.buf[base + 3] = 0x9f;
    mem.buf[base + 0x16] = state.psp & 0xff; mem.buf[base + 0x17] = (state.psp >> 8) & 0xff;
    mem.buf[base + 0x2c] = (envSeg || state.envSeg || 0) & 0xff;
    mem.buf[base + 0x2d] = ((envSeg || state.envSeg || 0) >> 8) & 0xff;
    mem.buf[base + 0x80] = tailLen;
    for (let i = 0; i < tailLen; i++) mem.buf[base + 0x81 + i] = mem.read8(tailSeg, (tailOff + 1 + i) & 0xffff);
    mem.buf[base + 0x81 + tailLen] = 0x0d;
    state.psp = found; state.dtaSeg = found; state.dtaOff = 0x0080;
    // caminho completo do programa (o DOS grava no bloco de ambiente do filho)
    let fullPath = p.replace(/\//g, "\\");
    if (!/^[A-Za-z]:/.test(fullPath)) {
      fullPath = "C:" + (fullPath.startsWith("\\") ? "" : "\\" + (state.cwd ? state.cwd + "\\" : "")) + fullPath;
    }
    appendEnvPath(mem, envSeg || state.envSeg || 0, fullPath);
    // carrega imagem
    const isMz = file.length > 2 && file[0] === 0x4d && file[1] === 0x5a;
    if (isMz) {
      const u = (o) => file[o] | (file[o + 1] << 8);
      const hdr = u(0x08) * 16, imgSeg = found + 0x10;
      const img = file.slice(hdr);
      for (let i = 0; i < img.length; i++) mem.buf[((imgSeg << 4) + i) & 0xfffff] = img[i];
      const tab = u(0x18);
      for (let i = 0; i < u(0x06); i++) {
        const off = file[tab + i * 4] | (file[tab + i * 4 + 1] << 8);
        const s = file[tab + i * 4 + 2] | (file[tab + i * 4 + 3] << 8);
        const lin = (((imgSeg + s) << 4) + off) & 0xfffff;
        const v = (mem.buf[lin] | (mem.buf[lin + 1] << 8)) + imgSeg;
        mem.buf[lin] = v & 0xff; mem.buf[lin + 1] = (v >> 8) & 0xff;
      }
      cpu.cs = imgSeg + u(0x16); cpu.ip = u(0x14);
      cpu.ss = imgSeg + u(0x0e); cpu.sp = u(0x10);
      cpu.ds = found; cpu.es = found;
    } else {
      for (let i = 0; i < file.length; i++) mem.buf[((found << 4) + 0x100 + i) & 0xfffff] = file[i];
      cpu.cs = found; cpu.ip = 0x0100;
      cpu.ds = found; cpu.es = found; cpu.ss = found; cpu.sp = 0xfffe;
    }
    // Registradores iniciais do filho, como o DOS entrega:
    // AX=0 (sucesso do EXEC; o main do XCOPY testa "cmp ax,0" e sem isto
    // imprime "Invalid drive specification"), BX/CX/DX/SI/DI/BP zerados.
    // (Para .COM o DOS tambem usa AL/AH p/ validade dos FCBs do PSP: como
    // os FCBs estao zerados, drive 0 = valido => AL=AH=0.)
    cpu.ax = 0x0000; cpu.bx = 0; cpu.cx = 0; cpu.dx = 0;
    cpu.si = 0; cpu.di = 0; cpu.bp = 0;
    cpu.flags = 0x0002; cpu.halted = false; cpu.exited = false;
    cpu.run(20000000);
    state.lastExit = cpu.exitCode;
    retAx = cpu.exitCode; retCF = 0;
  } finally {
    state.execDepth = (state.execDepth ?? 1) - 1;
    // TSR (INT 27h / INT 21h/AH=31h): a memoria do filho FICA residente
    // (codigo + vetores que ele instalou). Nos demais casos desfazemos tudo.
    if (!state.tsr) {
      // A tela NAO e' desfeita: no DOS real o que o filho desenhou permanece
      // depois que ele sai. Sem isto o snapshot do EXEC revertia a VRAM (B800)
      // e a saida do CHKDSK/DIR sumia da tela (aparecia so' no state.stdout).
      snapMem.set(mem.buf.subarray(VIDEO_BASE, VIDEO_BASE + 80 * 25 * 2), VIDEO_BASE);
      mem.buf.set(snapMem);
    }
    else if (state.tsrKeep > 0) shrinkBlock(mem, bestSeg, Math.ceil(state.tsrKeep / 16));
    state.tsr = false;
    state.tsrKeep = 0;
    for (const r of regs) cpu[r] = snapCpu[r];
    state.psp = snap.psp; state.dtaSeg = snap.dtaSeg; state.dtaOff = snap.dtaOff;
    state.handles = snap.handles; state.nextHandle = snap.nextHandle;
    state.findCtx = snap.findCtx; state.lastExit = snap.lastExit;
    state.lineRead = snap.lineRead;
  }
  cpu.ax = retAx;
  if (retCF) cpu.flags |= 0x0001; else cpu.flags &= ~0x0001;
  cpu.exited = false; cpu.halted = false; // volta ao pai (regs ja restaurados)
}

function int13(cpu, ok, fail) {
  // disco: sem midia real ainda — retorna sucesso vazio p/ reset,
  // falha controlada p/ leitura (vira FAT virtual no M4).
  if (cpu.ah === 0x00) { ok(); return; }
  if (cpu.ah === 0x08) { cpu.ah = 0; cpu.bl = 4; cpu.ch = 0; cpu.cl = 1; cpu.dh = 0; cpu.dl = 1; cpu.flags &= ~0x0001; return; }
  if (cpu.ah === 0x15) { cpu.ah = 0; ok(); return; }
  cpu.ah = 1; cpu.flags |= 0x0001; // erro generico, CF=1
  // nao lanca: deixa o programa tratar o erro como disco ausente
}

function int16(cpu, state, ok, fail) {
  const ah = cpu.ah;
  if (ah === 0x01) { // status: ZF=1 sem tecla
    if (state.keys.length) { const k = state.keys[0]; cpu.flags &= ~0x0040; cpu.ax = k; }
    else cpu.flags |= 0x0040;
    return;
  }
  if (ah === 0x00 || ah === 0x10) { // bloqueante
    if (!state.keys.length) {
      // fluxo roteirizado (nao sofre flush)
      const line = state.inLine != null ? null : (state.inputLine && state.inputLine.length ? state.inputLine.shift() : null);
      if (line != null) { state.inLine = line; state.inPos = 0; }
      if (state.inLine != null) {
        let c;
        if (state.inPos >= state.inLine.length) { state.inLine = null; c = 0x1c0d; }
        else c = keyCode(state.inLine.charCodeAt(state.inPos++));
        state.keys.push(c);
      }
    }
    if (!state.keys.length) { cpu.flags |= 0x0040; cpu.ax = 0x0000; return; } // fila vazia: retorna nulo p/ teste headless
    cpu.ax = state.keys.shift(); cpu.flags &= ~0x0040; ok(); return;
  }
  if (ah === 0x02 || ah === 0x12) { cpu.al = 0; ok(); return; } // shift flags
  // funcao desconhecida (ex.: 6Fh usada por alguns TSRs): "nenhuma tecla"
  cpu.ax = 0x0000; cpu.flags |= 0x0040; return;
}

function int21(cpu, mem, video, state, ok, fail) {
  const ah = cpu.ah;
  const put = (s) => { video.writeString(s); state.stdout += s; };
  // usuario roteirizado: fluxo de digitacao (sobrevive ao flush do AH=0C;
  // o flush so limpa o type-ahead real). Linhas viram chars + CR.
  const nextScripted = () => {
    if (state.inLine == null) {
      if (!state.inputLine.length) return null;
      state.inLine = state.inputLine.shift(); state.inPos = 0;
    }
    if (state.inPos >= state.inLine.length) {
      state.inLine = null;
      return 0x0d; // Enter no fim da linha (ASCII puro)
    }
    return state.inLine.charCodeAt(state.inPos++) & 0xff;
  };
  const feedKeys = () => {
    const c = nextScripted();
    if (c != null) state.keys.push(keyCode(c));
  };
  const asciz = (seg, off, max = 128) => {
    let s = "";
    for (let i = 0; i < max; i++) {
      const c = mem.read8(seg, (off + i) & 0xffff);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const base = (p) => {
    p = p.toUpperCase().replace(/\//g, "\\");
    if (p.length > 1 && p[1] === ":") p = p.slice(2);
    const parts = p.split("\\").filter(x => x.length);
    return parts.length ? parts[parts.length - 1] : "";
  };
  // normaliza um path de diretorio relativo a `cwd` (sem drive): resolve . e ..
  // Um path ABSOLUTO (com "\" inicial, ou "C:\") reinicia a partir da raiz;
  // "C:" sozinho continua significando "diretorio atual do drive C".
  const normDir = (p, cwd) => {
    p = p.toUpperCase().replace(/\//g, "\\");
    if (p.length > 1 && p[1] === ":") p = p.slice(2);
    const rooted = p.startsWith("\\");
    let parts = p.split("\\").filter(x => x.length);
    if (!parts.length) return { ok: true, dir: rooted ? "" : cwd }; // vazio/C: = cwd
    let stack = rooted ? [] : cwd ? cwd.split("\\") : [];
    for (const seg of parts) {
      if (seg === ".") continue;
      if (seg === "..") { if (!stack.length && !rooted) return { ok: false, dir: "" }; stack.pop(); continue; }
      if (!/^[A-Z0-9_$~!#%&'()@^`{}-]{1,8}$/.test(seg)) return { ok: false, dir: "" };
      stack.push(seg);
    }
    return { ok: true, dir: stack.join("\\") };
  };
  const dirOf = (fname) => ""; // fs virtual e flat (raiz); arquivos em subdir: "DIR\\NOME"
  const wildMatch = (pat, name) => {
    // Semantica FCB: partes space-padded (8/3), '?' casa ate padding,
    // '*' casa o resto. "*" sem ponto equivale a "*.*".
    const split = (s) => { const i = s.indexOf("."); return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)]; };
    let [pn, pe] = split(pat.toUpperCase());
    const [nn, ne] = split(name.toUpperCase());
    if (!pat.includes(".")) pe = "*";
    const part = (p0, n0, len) => {
      const p8 = (p0 + "        ").slice(0, len), n8 = (n0 + "        ").slice(0, len);
      const star = p8.indexOf("*");
      const lim = star < 0 ? len : star;
      for (let i = 0; i < lim; i++) if (p8[i] !== "?" && p8[i] !== n8[i]) return false;
      return true;
    };
    return part(pn, nn, 8) && part(pe, ne, 3);
  };
  const fillDta = (name, size) => {
    const seg = state.dtaSeg, off = state.dtaOff;
    const w8 = (o, v) => mem.write8(seg, (off + o) & 0xffff, v);
    w8(0x15, 0x20);
    w8(0x16, 0); w8(0x17, 0); w8(0x18, 0); w8(0x19, 0);
    w8(0x1a, size & 0xff); w8(0x1b, (size >> 8) & 0xff);
    w8(0x1c, (size >> 16) & 0xff); w8(0x1d, (size >> 24) & 0xff);
    for (let i = 0; i < name.length && i < 12; i++) w8(0x1e + i, name.charCodeAt(i) & 0x7f);
    w8(0x1e + Math.min(name.length, 12), 0);
  };
  switch (ah) {
    case 0x0b: cpu.al = state.keys.length ? 0xff : 0x00; ok(); return; // stdin status
    case 0x0c: // flush + executa AL como subfuncao
      if (!state.lineRead) state.keys = []; // ao retomar uma linha nao damos flush de novo
      cpu.ah = cpu.al;
      return int21(cpu, mem, video, state, ok, fail);
    case 0x01: case 0x07: case 0x08: { // console in (07/08 sem eco)
      feedKeys();
      const k = state.keys.length ? state.keys.shift() : 0x0d;
      cpu.al = k & 0xff; if (ah === 0x01 && state.echoInput !== false) put(String.fromCharCode(cpu.al)); ok(); return;
    }
    case 0x02: put(String.fromCharCode(cpu.dl & 0xff)); cpu.al = cpu.dl; ok(); return;
    case 0x06: { // direto: DL=FF entrada, senao saida
      if ((cpu.dl & 0xff) === 0xff) {
        feedKeys();
        if (!state.keys.length) { cpu.flags |= 0x0040; cpu.al = 0; return; }
        cpu.al = state.keys.shift() & 0xff; cpu.flags &= ~0x0040; return;
      }
      put(String.fromCharCode(cpu.dl & 0xff)); ok(); return;
    }
    case 0x09: { // print '$'
      let p = ((cpu.ds << 4) + cpu.dx) & 0xfffff, out = "";
      for (let i = 0; i < 8192; i++) {
        const c = mem.buf[p]; p = (p + 1) & 0xfffff;
        if (c === 0x24) break;
        out += String.fromCharCode(c);
      }
      put(out); ok(); return;
    }
    case 0x0a: { // buffered input: DS:DX -> [max][len][bytes] (ate CR)
      const seg = cpu.ds, off = cpu.dx;
      const max = mem.read8(seg, off);
      // RETOMAVEL: se pausamos no meio da linha (esperando tecla), continuamos
      // de onde paramos — e' o que faz cada caractere ecoar na hora, como no
      // DOS real, em vez de a linha inteira aparecer so' no Enter.
      const resume = state.lineRead && state.lineRead.seg === seg && state.lineRead.off === off;
      let n = resume ? state.lineRead.n : 0;
      for (;;) {
        let c;
        if (state.keys.length) c = state.keys.shift() & 0xff;
        else {
          c = nextScripted();
          if (c == null) {
            if (state.interactive) { // sem tecla ainda: guarda o progresso e espera
              state.lineRead = { seg, off, n };
              cpu.ip = (cpu.ip - 2) & 0xffff;
              throw INPUT_WAIT;
            }
            c = 0x0d; // modo roteirizado: fila vazia fecha a linha
          }
        }
        if (c === 0x0d) break;
        if (c === 0x08) { // backspace: apaga o ultimo caractere (como o DOS faz)
          if (n > 0) { n--; if (state.echoInput !== false) put("\b \b"); }
          continue;
        }
        if (n < max) { mem.write8(seg, (off + 2 + n) & 0xffff, c); if (state.echoInput !== false) put(String.fromCharCode(c)); n++; }
      }
      state.lineRead = null;
      mem.write8(seg, (off + 1) & 0xffff, n);
      if (n < max) mem.write8(seg, (off + 2 + n) & 0xffff, 0x0d); // CR apos o texto (o DOS faz isso)
      if (state.echoInput !== false) put("\r\n");
      ok(); return;
    }
    case 0x17: { // RENAME via FCB: antigo em DS:DX, novo em DS:DX+16 (16 bytes depois)
      const fcbName = (off) => {
        let n = "";
        for (let i = 0; i < 8; i++) { const c = mem.read8(cpu.ds, (off + 1 + i) & 0xffff); if (c === 0 || c === 0x20) break; n += String.fromCharCode(c); }
        let e = "";
        for (let i = 0; i < 3; i++) { const c = mem.read8(cpu.ds, (off + 9 + i) & 0xffff); if (c === 0 || c === 0x20) break; e += String.fromCharCode(c); }
        return n + (e ? "." + e : "");
      };
      const oldN = fcbName(cpu.dx), newN = fcbName((cpu.dx + 16) & 0xffff);
      if (!state.fs.has(oldN) || state.fs.has(newN) || !newN) { cpu.al = 0xff; ok(); return; }
      state.fs.set(newN, state.fs.get(oldN));
      state.fs.delete(oldN);
      cpu.al = 0x00; ok(); return;
    }
    case 0x13: { // DELETE FILE via FCB (DS:DX); aceita curingas
      const fcb = cpu.dx;
      let raw = "";
      for (let i = 0; i < 11; i++) raw += String.fromCharCode(mem.read8(cpu.ds, (fcb + 1 + i) & 0xffff));
      const nm = raw.slice(0, 8).trim(), ex = raw.slice(8).trim();
      let pat = ex ? nm + "." + ex : nm;
      if (!pat.replace(/[?*]/g, "")) pat = "*.*";
      const victims = [...state.fs.keys()].filter(n => wildMatch(pat, n));
      if (!victims.length) { state.lastError = 2; cpu.al = 0xff; ok(); return; }
      for (const v of victims) state.fs.delete(v);
      cpu.al = 0x00; ok(); return;
    }
    case 0x0f: case 0x10: case 0x16: case 0x23: case 0x14: case 0x15: case 0x21: case 0x22: {
      // Familia FCB classica (o LABEL usa AH=0Fh; ferramentas antigas usam o
      // resto): o proprio FCB em DS:DX guarda o estado (bloco/registro atual,
      // tamanho do registro, tamanho do arquivo, registro aleatorio).
      const fcb = cpu.dx;
      const fcbName = () => {
        let raw = "";
        for (let i = 0; i < 11; i++) raw += String.fromCharCode(mem.read8(cpu.ds, (fcb + 1 + i) & 0xffff));
        const nm = raw.slice(0, 8).trim(), ex = raw.slice(8).trim();
        return ex ? nm + "." + ex : nm;
      };
      const r8 = (o) => mem.read8(cpu.ds, (fcb + o) & 0xffff);
      const r16 = (o) => mem.read16(cpu.ds, (fcb + o) & 0xffff);
      const w8 = (o, v) => mem.write8(cpu.ds, (fcb + o) & 0xffff, v & 0xff);
      const w16 = (o, v) => mem.write16(cpu.ds, (fcb + o) & 0xffff, v & 0xffff);
      const name = fcbName();
      const exists = state.fs.has(name);
      if (ah === 0x0f || ah === 0x16) { // OPEN / CREATE (cria/trunca)
        if (ah === 0x0f && (!exists || !name)) { state.lastError = 2; cpu.al = 0xff; ok(); return; }
        if (ah === 0x16) state.fs.set(name, new Uint8Array(0));
        const size = state.fs.get(name).length;
        if (r16(0x0e) === 0) w16(0x0e, 128);       // tamanho de registro padrao
        w16(0x0c, 0); w8(0x20, 0); w8(0x21, 0); w8(0x22, 0); w8(0x23, 0); w8(0x24, 0);
        w16(0x10, size & 0xffff); w16(0x12, (size >>> 16) & 0xffff);
        w16(0x14, 0x5d4e); w16(0x16, 0x6000);      // data/hora da abertura
        cpu.al = 0x00; ok(); return;
      }
      if (ah === 0x10) { cpu.al = exists || !name ? 0x00 : 0xff; ok(); return; } // CLOSE
      if (!name || !exists) { cpu.al = 0xff; ok(); return; }
      const data = state.fs.get(name);
      const rs = r16(0x0e) || 128;
      // registro atual: bloco*128 + registro (sequencial) ou o campo aleatorio
      let rec;
      if (ah === 0x21 || ah === 0x22) rec = r8(0x21) | (r8(0x22) << 8) | (r8(0x23) << 16) | (r8(0x24) << 24);
      else rec = r16(0x0c) * 128 + r8(0x20);
      if (ah === 0x23) { // FILE SIZE: deixa o tamanho no registro aleatorio
        const nrec = Math.ceil(data.length / rs);
        w8(0x21, nrec & 0xff); w8(0x22, (nrec >> 8) & 0xff); w8(0x23, (nrec >> 16) & 0xff); w8(0x24, (nrec >> 24) & 0xff);
        cpu.al = 0x00; ok(); return;
      }
      const pos = rec * rs;
      if (ah === 0x14 || ah === 0x21) { // LER
        if (pos >= data.length) { cpu.al = 0x01; ok(); return; } // EOF
        const n = Math.min(rs, data.length - pos);
        for (let i = 0; i < n; i++) mem.write8(state.dtaSeg, (state.dtaOff + i) & 0xffff, data[pos + i]);
        cpu.al = n === rs ? 0x00 : 0x03; // 3 = registro parcial
      } else { // ESCREVER
        const out = new Uint8Array(Math.max(data.length, pos + rs));
        out.set(data);
        for (let i = 0; i < rs; i++) out[pos + i] = mem.read8(state.dtaSeg, (state.dtaOff + i) & 0xffff);
        state.fs.set(name, out);
        cpu.al = 0x00;
      }
      // avanca o registro atual
      rec++;
      if (ah === 0x21 || ah === 0x22) { w8(0x21, rec & 0xff); w8(0x22, (rec >> 8) & 0xff); w8(0x23, (rec >> 16) & 0xff); w8(0x24, (rec >> 24) & 0xff); }
      else { w16(0x0c, (rec >> 7) & 0xffff); w8(0x20, rec & 0x7f); }
      ok(); return;
    }
    case 0x11: case 0x12: { // DIR via FCB (DS:DX): AL=00 achou, FF nao      // FCB estendido: [0]=FF, [6]=attr, nome em +8 (drive +7, nome +8..15, ext +16..18)
      let fcb = cpu.dx, attr = -1, ext = false;
      if (mem.read8(cpu.ds, cpu.dx) === 0xff) {
        ext = true;
        attr = mem.read8(cpu.ds, (cpu.dx + 6) & 0xffff);
        fcb = (cpu.dx + 7) & 0xffff;
      }
      // bit volume (0x08) sozinho: busca pelo rotulo de volume. O nosso
      // volume sintetico (state.disk) tem rotulo + numero de serie, entao
      // devolvemos a entrada de diretorio do rotulo (o DIR/CHKDSK imprimem
      // "Volume in drive C is X" e "Volume Serial Number is ...").
      if (ah === 0x11 && attr !== -1 && (attr & 0x08) && !(attr & 0x37 & ~0x08)) {
        const lbl = state.disk && state.disk.label ? state.disk.label : "";
        state.findCtx = null;
        if (!lbl) { state.lastError = 2; cpu.al = 0xff; ok(); return; }
        const seg0 = state.dtaSeg, off0 = state.dtaOff;
        const w0 = (o, v) => mem.write8(seg0, (off0 + o) & 0xffff, v & 0xff);
        const b0 = ext ? 8 : 1;
        if (ext) { w0(0x00, 0xff); w0(0x01, 0x08); for (let i = 2; i <= 6; i++) w0(i, 0); w0(0x07, 0); }
        else w0(0x00, 0);
        const [ln, le] = [lbl.padEnd(8, " ").slice(0, 8), "   "];
        for (let i = 0; i < 8; i++) w0(b0 + i, ln.charCodeAt(i));
        for (let i = 0; i < 3; i++) w0(b0 + 8 + i, le.charCodeAt(i));
        w0(b0 + 0x0b, 0x08);
        for (let i = 0x0c; i <= 0x15; i++) w0(b0 + i, 0);
        mem.write16(seg0, (off0 + b0 + 0x16) & 0xffff, 0x6000);
        mem.write16(seg0, (off0 + b0 + 0x18) & 0xffff, 0x5d4e);
        mem.write16(seg0, (off0 + b0 + 0x1a) & 0xffff, 0);
        mem.write16(seg0, (off0 + b0 + 0x1c) & 0xffff, 0);
        mem.write16(seg0, (off0 + b0 + 0x1e) & 0xffff, 0);
        cpu.al = 0x00; ok(); return;
      }
      let pat;
      if (ah === 0x11) {
        let raw = "";
        for (let i = 0; i < 11; i++) raw += String.fromCharCode(mem.read8(cpu.ds, (fcb + 1 + i) & 0xffff));
        const nm = raw.slice(0, 8).trim(), ex = raw.slice(8).trim();
        pat = ex ? nm + "." + ex : nm;
        if (!pat.replace(/[?*]/g, "")) pat = "*.*";
        const names = [...state.fs.keys()].filter(n => wildMatch(pat, n)).sort();
        state.findCtx = { names, idx: -1 };
      }
      const ctx = state.findCtx;
      const next = (ctx ? ctx.idx : -1) + 1;
      if (!ctx || next >= ctx.names.length) {
        // DOS: sem mais entradas -> erro estendido 0x12 (18). O COMMAND.COM usa
        // AH=59h para decidir se imprime mensagem de erro ou so termina a lista.
        state.lastError = ah === 0x11 ? 2 : 18;
        cpu.al = 0xff; ok(); return;
      }
      ctx.idx = next;
      const name = ctx.names[next];
      const seg = state.dtaSeg, off = state.dtaOff;
      const w8 = (o, v) => mem.write8(seg, (off + o) & 0xffff, v & 0xff);
      const parts = name.split(".");
      const nn = (parts[0] || "").padEnd(8, " "), xx = (parts[1] || "").padEnd(3, " ");
      const drive = mem.read8(cpu.ds, fcb & 0xffff) & 0xff;
      const size = state.fs.get(name).length;
      const start = state.disk ? state.disk.clusterOf(name) : 0;
      // O DTA recebe a unidade (ou o cabecalho do FCB estendido + unidade)
      // seguida da *entrada de diretorio* de 32 bytes do arquivo (RBIL
      // #01352). O COMMAND (DIR) faz busca estendida e le nome@+8/ext@+0x10/
      // attr@+0x13/hora@+0x1E/data@+0x20/tamanho@+0x24; o CHKDSK faz busca
      // normal e le o cluster inicial em +0x1A (nome@+1, attr@+0xC,
      // hora@+0x16, data@+0x18, tamanho@+0x1C).
      if (ext) { w8(0x00, 0xff); w8(0x01, 0x20); for (let i = 2; i <= 6; i++) w8(i, 0); w8(0x07, drive); }
      else w8(0x00, drive);
      const b = ext ? 8 : 1;
      const w16b = (o, v) => mem.write16(seg, (off + b + o) & 0xffff, v & 0xffff);
      for (let i = 0; i < 8; i++) w8(b + i, nn.charCodeAt(i) & 0x7f);
      for (let i = 0; i < 3; i++) w8(b + 8 + i, xx.charCodeAt(i) & 0x7f);
      w8(b + 0x0b, 0x20);                              // atributo: arquivo
      for (let i = 0x0c; i <= 0x15; i++) w8(b + i, 0); // reservado
      w16b(0x16, 0x6000);                              // hora 12:00
      w16b(0x18, 0x5d4e);                              // data 2026-10-14
      w16b(0x1a, start);                               // cluster inicial
      w16b(0x1c, size & 0xffff);                       // tamanho (dword)
      w16b(0x1e, (size >>> 16) & 0xffff);
      cpu.al = 0x00; ok(); return;
    }
    case 0x25: ok(); return; // set vetor (ignora)
    case 0x2e: state.verify = (cpu.al & 1) !== 0; cpu.ax = 0; ok(); return; // SET VERIFY
    case 0x54: cpu.al = state.verify ? 1 : 0; cpu.ah = 0; ok(); return; // GET VERIFY
    case 0x68: { // COMMIT FILE ("fflush"): BX = handle, so' descarrega buffers
      const h = cpu.bx;
      if (h > 4 && !state.handles.has(h)) { state.lastError = 6; cpu.ax = 6; cpu.flags |= 0x0001; return; }
      cpu.ax = 0; ok(); return;
    }
    case 0x60: { // TRUENAME: DS:SI -> ES:DI (path canonico ASCIZ)
      let p = asciz(cpu.ds, cpu.si);
      if (!/^[a-zA-Z]:/.test(p)) p = "C:\\" + p; // assume drive atual
      p = p.replace(/\//g, "\\").toUpperCase();
      let i = 0;
      for (; i < p.length && i < 64; i++) mem.write8(cpu.es, (cpu.di + i) & 0xffff, p.charCodeAt(i));
      mem.write8(cpu.es, (cpu.di + i) & 0xffff, 0);
      ok(); return;
    }
    case 0x29: { // PARSE FILENAME -> FCB (DS:SI texto, ES:DI FCB, AL controle)
      const SEP = new Set([0x20, 0x09, 0x2c, 0x3b, 0x3d, 0x5c]); // espaco tab , ; = \
      const ILL = new Set([0x2f, 0x22, 0x5b, 0x5d, 0x7c, 0x3c, 0x3e, 0x2b]); // / " [ ] | < > +
      const rd = (seg, off) => mem.read8(seg, (off) & 0xffff);
      let p = cpu.si, wild = false, badDrive = false;
      if (cpu.al & 0x01) { while (SEP.has(rd(cpu.ds, p))) p = (p + 1) & 0xffff; }
      const c0 = rd(cpu.ds, p), c1 = rd(cpu.ds, (p + 1) & 0xffff);
      if (c1 === 0x3a) {
        const up = (c0 >= 0x61 && c0 <= 0x7a) ? c0 - 0x20 : c0;
        if (up >= 0x41 && up <= 0x5a) {
          mem.write8(cpu.es, cpu.di, up - 0x41 + 1);
          p = (p + 2) & 0xffff;
        } else { badDrive = true; p = (p + 2) & 0xffff; }
      } else if (!(cpu.al & 0x02)) mem.write8(cpu.es, cpu.di, 0);
      // pula diretorios: o FCB guarda so o basename; encontra o ultimo '\'
      {
        let scan = p, lastSep = -1;
        for (;;) { const c = rd(cpu.ds, scan); if (c === 0x00 || c === 0x0d || c === 0x0a || SEP.has(c)) break; if (c === 0x5c || c === 0x2f) lastSep = scan; scan = (scan + 1) & 0xffff; }
        if (lastSep >= 0) p = (lastSep + 1) & 0xffff;
      }
      const getpart = (max) => {
        let out = "", star = false;
        for (let i = 0; i < max; i++) {
          const c = rd(cpu.ds, p);
          if (c === 0x00 || c === 0x0d || c === 0x0a) break;
          if (c === 0x2e || SEP.has(c) || ILL.has(c)) break;
          if (c === 0x2a) { star = true; wild = true; p = (p + 1) & 0xffff; break; }
          let ch = c;
          if (ch === 0x3f) wild = true;
          else if (ch >= 0x61 && ch <= 0x7a) ch -= 0x20;
          out += String.fromCharCode(ch);
          p = (p + 1) & 0xffff;
        }
        if (star) while (out.length < max) out += "?";
        return out;
      };
      const nm = getpart(8);
      let ex = "";
      if (rd(cpu.ds, p) === 0x2e) { p = (p + 1) & 0xffff; ex = getpart(3); }
      // AL bit 2 (0x04) / bit 3 (0x08) = "nao altera o nome/extensao A MENOS QUE
      // o texto especifique um". O COMMAND.COM depende disso: antes de listar,
      // ele chama AH=29 com AL=0x0E para reconstruir o FCB de busca do DIR
      // (o nome tinha sido trocado por ????????.??? na busca do volume). Se
      // tratarmos os bits como "nunca grava", o DIR perde o filtro e lista tudo.
      if (!(cpu.al & 0x04) || nm.length) for (let i = 0; i < 8; i++) mem.write8(cpu.es, (cpu.di + 1 + i) & 0xffff, i < nm.length ? nm.charCodeAt(i) : 0x20);
      if (!(cpu.al & 0x08) || ex.length) for (let i = 0; i < 3; i++) mem.write8(cpu.es, (cpu.di + 9 + i) & 0xffff, i < ex.length ? ex.charCodeAt(i) : 0x20);
      cpu.si = p;
      cpu.al = badDrive ? 0xff : (wild ? 0x01 : 0x00);
      ok(); return;
    }    case 0x35: cpu.es = 0x0000; cpu.bx = 0x0000; ok(); return; // get vetor
    // AH=30: versao do DOS. Estes binarios da ISO (COMMAND.COM e XCOPY.EXE
    // conferem com "cmp ax,0x1606" e o COMMAND TRAVA se nao for igual)
    // esperam exatamente este AX. Ou seja: o DOS desta midia reporta 0x1606.
    case 0x30: cpu.al = 6; cpu.ah = 22; cpu.bx = 0; cpu.cx = 0; ok(); return; // DOS 6.22 (desta midia)
    case 0x33: if (cpu.al === 0x00) cpu.dl = 0; ok(); return; // Ctrl-Break
    case 0x50: state.psp = cpu.bx; ok(); return; // SET PSP
    case 0x51: case 0x62: cpu.bx = state.psp ?? 0x1000; ok(); return; // GET PSP
    // AH=52: SYSVARS "list of lists". ES:BX -> LoL no segmento de dados do
    // DOS (montado em Machine.buildDosData). O SHARE.EXE confere
    // "cmp byte es:[4],1" logo depois desta chamada (baixa do tamanho do 1o
    // bloco do DOS): por isso o 1o MCB (DOS_SEG:0000) tem 01h no byte alto.
    case 0x52: {
      const seg = state.dosSeg ?? 0x0060, off = state.lolOff ?? 0x0030;
      const first = (mem.buf[0x4fe] | (mem.buf[0x4ff] << 8)) || seg;
      mem.write16(seg, (off - 2) & 0xffff, first); // LoL[-2]: 1o MCB
      cpu.es = seg; cpu.bx = off; ok(); return;
    }
    // AH=1F: DPB do drive padrao; AH=32: DPB de um drive especifico.
    case 0x1f: {
      cpu.ds = state.dosSeg ?? 0x0060; cpu.bx = state.dpbOff ?? 0x0300;
      ok(); return;
    }
    case 0x32: {
      const seg = state.dosSeg ?? 0x0060, off = state.dpbOff ?? 0x0300;
      const drvByte = cpu.dl === 0 ? 0x02 : (cpu.dl - 1); // 0=A:, 2=C:
      if (cpu.dl > 0x05) { cpu.al = 0xff; ok(); return; } // drive invalido
      mem.write8(seg, off, drvByte);
      cpu.ds = seg; cpu.bx = off; cpu.al = 0x00; ok(); return;
    }
    case 0x26: ok(); return; // CREATE PSP (stub)
    case 0x48: { // ALLOC BX paragrafos — caminha a cadeia MCB real
      const mrd = (seg) => ({
        type: mem.buf[(seg << 4)],
        owner: mem.buf[(seg << 4) + 1] | (mem.buf[(seg << 4) + 2] << 8),
        size: mem.buf[(seg << 4) + 3] | (mem.buf[(seg << 4) + 4] << 8),
      });
      const walk = (fn) => {
        let seg = mem.buf[0x4fe] | (mem.buf[0x4ff] << 8);
        for (let guard = 0; guard < 64; guard++) {
          const bp = seg << 4;
          if (bp < 0 || bp > mem.buf.length - 16) break;
          const type = mem.buf[bp];
          if (type !== 0x4d && type !== 0x5a) break; // cadeia corrompida
          if (fn(seg, mrd(seg))) return true;
          if (type === 0x5a) break;
          seg = seg + mrd(seg).size + 1;
        }
        return false;
      };
      if (cpu.bx === 0) { // sonda de zero paras: devolve o 1o livre SEM dividir
        let out = 0;
        walk((seg, m) => { if (m.owner === 0) { out = seg + 1; return true; } return false; });
        if (!out) { cpu.flags |= 0x0001; cpu.ax = 8; cpu.bx = 0; return; }
        cpu.ax = out; ok(); return;
      }
      let seg = mem.buf[0x4fe] | (mem.buf[0x4ff] << 8), best = 0;
      for (let guard = 0; guard < 64; guard++) {
        const bp = seg << 4;
        if (bp < 0 || bp > mem.buf.length - 16) break;
        const type = mem.buf[bp];
        if (type !== 0x4d && type !== 0x5a) break; // cadeia corrompida: para em vez de passear no codigo
        const m = mrd(seg);
        if (m.owner === 0 && m.size >= cpu.bx) { cpu.ax = seg + 1; state.lastAlloc = seg + 1;
          // divide o bloco
          const rest = m.size - cpu.bx;
          const p = seg << 4;
          mem.buf[p + 1] = state.psp & 0xff; mem.buf[p + 2] = (state.psp >> 8) & 0xff;
          mem.buf[p + 3] = cpu.bx & 0xff; mem.buf[p + 4] = (cpu.bx >> 8) & 0xff;
          if (rest > 1) {
            const ns = seg + 1 + cpu.bx, np = ns << 4;
            mem.buf[np] = mem.buf[p]; // herda M/Z
            mem.buf[np + 1] = 0; mem.buf[np + 2] = 0;
            const rs = rest - 1;
            mem.buf[np + 3] = rs & 0xff; mem.buf[np + 4] = (rs >> 8) & 0xff;
            mem.buf.fill(0, np + 5, np + 16);
            mem.buf[p] = 0x4d; // 'M'
          }
          ok(); return;
        }
        if (m.owner === 0 && m.size > best) { best = m.size; }
        if (m.type === 0x5a) break; // 'Z'
        seg = seg + m.size + 1;
      }
      cpu.flags |= 0x0001; cpu.ax = 8; cpu.bx = best; return; // sem memoria (BX=maior livre)
    }
    case 0x49: { // FREE: ES=bloco (marca livre + funde vizinhos livres)
      const mcb = cpu.es - 1, p = mcb << 4;
      if (p < 0 || p > mem.buf.length - 16) { cpu.flags |= 0x0001; cpu.ax = 9; return; }
      const t = mem.buf[p];
      if (t !== 0x4d && t !== 0x5a) { state.lastError = 7; cpu.flags |= 0x0001; cpu.ax = 7; return; }
      mem.buf[p + 1] = 0; mem.buf[p + 2] = 0;
      freeBlock(mem, mcb);
      ok(); return;
    }
    case 0x4a: { // RESIZE: ES=bloco (MCB esta em ES-1), BX=novos paragrafos
      const mcb = cpu.es - 1;
      const p = (mcb << 4);
      if (p < 0 || p > mem.buf.length - 16) { cpu.flags |= 0x0001; cpu.ax = 9; return; }
      const t = mem.buf[p];
      if (t !== 0x4d && t !== 0x5a) { state.lastError = 7; cpu.flags |= 0x0001; cpu.ax = 7; return; }
      const oldSize = mem.buf[p + 3] | (mem.buf[p + 4] << 8);
      if (cpu.bx === oldSize) { ok(); return; }
      if (cpu.bx > oldSize) {
        // CRESCER: absorve total ou parcialmente os blocos LIVRES seguintes
        // (DOS real). Sem isto o COMMAND.COM nao re-expande seu bloco apos
        // EXEC e imprime "Extended Error 8" (ATTRIB, XCOPY, ...).
        const frees = [];
        let cur = mcb + oldSize + 1;
        for (let g = 0; g < 64; g++) {
          const bp = cur << 4;
          if (bp < 0 || bp > mem.buf.length - 16) break;
          const ft = mem.buf[bp];
          if (ft !== 0x4d && ft !== 0x5a) break;
          const fowner = mem.buf[bp + 1] | (mem.buf[bp + 2] << 8);
          const fsize = mem.buf[bp + 3] | (mem.buf[bp + 4] << 8);
          if (fowner !== 0) break; // nao e livre: nao da p/ absorver
          frees.push({ seg: cur, size: fsize, type: ft });
          if (ft === 0x5a) break;
          cur = cur + fsize + 1;
        }
        let total = 0;
        for (const f of frees) total += f.size + 1;
        if (cpu.bx > oldSize + total) { // sem espaco: BX = maior tamanho possivel
          state.lastError = 8; cpu.flags |= 0x0001; cpu.ax = 8; cpu.bx = oldSize + total; return;
        }
        let need = cpu.bx - oldSize, lastZ = false;
        for (const f of frees) {
          if (need <= 0) break;
          if (need >= f.size + 1) { // absorve o bloco livre inteiro (MCB vira area util)
            need -= f.size + 1;
            lastZ = (f.type === 0x5a);
            const bp = f.seg << 4;
            mem.buf.fill(0, bp, bp + 16);
          } else { // absorve parte: reduz o MCB livre no lugar
            const np = (f.seg + need) << 4;
            mem.buf[np] = f.type; mem.buf[np + 1] = 0; mem.buf[np + 2] = 0;
            const rs = f.size - need;
            mem.buf[np + 3] = rs & 0xff; mem.buf[np + 4] = (rs >> 8) & 0xff;
            mem.buf.fill(0, np + 5, np + 16);
            need = 0; lastZ = false; break;
          }
        }
        mem.buf[p + 3] = cpu.bx & 0xff; mem.buf[p + 4] = (cpu.bx >> 8) & 0xff;
        mem.buf[p] = lastZ ? 0x5a : 0x4d; // virou o ultimo bloco?
        ok(); return;
      }
      const oldEnd = mcb + oldSize + 1;
      mem.buf[p + 3] = cpu.bx & 0xff; mem.buf[p + 4] = (cpu.bx >> 8) & 0xff;
      const rest = oldEnd - (mcb + cpu.bx + 1);
      if (rest > 0) {
        const np = ((mcb + cpu.bx + 1) << 4);
        mem.buf[np] = t; // herda o tipo do bloco original (M/Z): NAO forcar Z,
                         // senao a cadeia de MCBs e truncada e os blocos
                         // seguintes somem (COMMAND.COM quebrava aqui).
        mem.buf[np + 1] = 0; mem.buf[np + 2] = 0;
        const rs = rest - 1;
        mem.buf[np + 3] = rs & 0xff; mem.buf[np + 4] = (rs >> 8) & 0xff;
        mem.buf.fill(0, np + 5, np + 16);
        if (t === 0x5a) mem.buf[p] = 0x4d;
        mergeFree(mem, mcb + cpu.bx + 1);
      }
      ok(); return;
    }
    case 0x4b: return execLoad(cpu, mem, video, state, ok, fail);
    case 0x1a: state.dtaSeg = cpu.ds; state.dtaOff = cpu.dx; ok(); return;
    case 0x2f: cpu.es = state.dtaSeg ?? cpu.ds; cpu.bx = state.dtaOff ?? 0x0080; ok(); return;
    case 0x19: cpu.al = 0x02; ok(); return; // drive padrao = C:
    case 0x0e: cpu.al = 0x05; ok(); return; // seleciona drive, diz que ha 5
    case 0x0d: ok(); return; // RESET DISCO: só descarrega buffers (o CHKDSK chama)
    case 0x43: { // GET/SET FILE ATTRIBUTES
      const name = base(asciz(cpu.ds, cpu.dx));
      if (cpu.al === 0x00) {
        if (!state.fs.has(name)) { state.lastError = 2; cpu.flags |= 0x0001; cpu.ax = 2; return; }
        cpu.cx = 0x20; // arquivo normal
        ok(); return;
      }
      if (cpu.al === 0x01) { ok(); return; } // set: ignora
      cpu.flags |= 0x0001; cpu.ax = 1; return;
    }
    case 0x57: { // GET/SET FILE DATE/TIME (BX = handle)
      const f = state.handles.get(cpu.bx);
      if (cpu.al === 0x00) {
        if (!f) { state.lastError = 6; cpu.flags |= 0x0001; cpu.ax = 6; return; }
        cpu.cx = f.time ?? 0x6000; cpu.dx = f.date ?? 0x5d4e; ok(); return;
      }
      if (cpu.al === 0x01) {
        if (!f) { state.lastError = 6; cpu.flags |= 0x0001; cpu.ax = 6; return; }
        f.time = cpu.cx; f.date = cpu.dx; ok(); return;
      }
      cpu.flags |= 0x0001; cpu.ax = 1; return;
    }
    case 0x47: { // GET CWD -> sem drive, ASCIZ em DS:SI
      const seg = cpu.ds, off = cpu.si;
      const d = state.cwd ?? "";
      let i = 0;
      for (; i < d.length && i < 63; i++) mem.write8(seg, (off + i) & 0xffff, d.charCodeAt(i));
      mem.write8(seg, (off + i) & 0xffff, 0);
      cpu.ax = 0x0100; ok(); return;
    }
    case 0x2a: cpu.cx = 2026; cpu.dh = 10; cpu.dl = 14; cpu.al = 3; ok(); return; // DATA
    case 0x2c: cpu.ch = 12; cpu.cl = 0; cpu.dh = 0; cpu.dl = 0; ok(); return; // HORA
    // AH=2Bh: SET DATA. Tambem e o teste de instalacao do DESQview/2:
    // AX=2B01h com CX='DE' DX='SQ' (o CHKDSK e o FORMAT sondam isso).
    case 0x2b: {
      if (cpu.al === 0x01 && cpu.cx === 0x4445 && cpu.dx === 0x5351) { cpu.al = 0x00; ok(); return; } // sem DESQview
      if (cpu.al !== 0x00) { cpu.al = 0xff; ok(); return; }
      cpu.al = 0x00; ok(); return; // aceita a data
    }
    case 0x2d: cpu.al = 0x00; ok(); return; // SET HORA (aceita)
    // AH=36: espaco livre. AX=setores/cluster, BX=clusters livres,
    // CX=bytes/setor, DX=clusters totais. Tem de casar com o DPB de
    // Machine.buildDosData (senao o CHKDSK/DIR "Total" divergem).
    case 0x36: {
      if (cpu.dl > 0x05) { cpu.ax = 0xffff; cpu.flags |= 0x0001; cpu.ax = 0x000f; return; }
      const d = state.disk;
      cpu.ax = d ? d.sectorsPerCluster : 32;
      cpu.bx = d ? d.freeClusters : 0x7df0;
      cpu.cx = d ? d.bytesPerSector : 512;
      cpu.dx = d ? d.totalClusters : 0x7df7;
      ok(); return;
    }
    case 0x4e: { // FINDFIRST CX=attr DS:DX=filespec
      const pat = base(asciz(cpu.ds, cpu.dx));
      const names = [...state.fs.keys()].filter(n => wildMatch(pat, n)).sort();
      if (!names.length) { state.lastError = 2; cpu.flags |= 0x0001; cpu.ax = 2; return; }
      state.findCtx = { names, idx: 0 };
      fillDta(names[0], state.fs.get(names[0]).length);
      cpu.ax = 0; ok(); return;
    }
    case 0x4f: { // FINDNEXT
      const ctx = state.findCtx;
      if (!ctx || ctx.idx + 1 >= ctx.names.length) { state.lastError = 18; cpu.flags |= 0x0001; cpu.ax = 18; return; }
      ctx.idx++;
      fillDta(ctx.names[ctx.idx], state.fs.get(ctx.names[ctx.idx]).length);
      cpu.ax = 0; ok(); return;
    }
    case 0x3c: { // CREATE DS:DX CX=attr
      const name = base(asciz(cpu.ds, cpu.dx));
      if (!name) { cpu.flags |= 0x0001; cpu.ax = 3; return; }
      state.fs.set(name, new Uint8Array(0));
      const h = state.nextHandle++;
      state.handles.set(h, { name, pos: 0, writable: true });
      cpu.ax = h; ok(); return;
    }
    case 0x3d: { // OPEN DS:DX AL=modo
      const name = base(asciz(cpu.ds, cpu.dx));
      if (!state.fs.has(name)) { cpu.flags |= 0x0001; cpu.ax = 2; return; }
      const h = state.nextHandle++;
      state.handles.set(h, { name, pos: 0, writable: (cpu.al === 1 || cpu.al === 2) });
      cpu.ax = h; ok(); return;
    }
    case 0x3e: { // CLOSE BX
      // handles 0-4 sao os dispositivos pre-abertos (CON/AUX/PRN): fecha-los
      // sempre da certo (o COMMAND.COM fecha 1/2 ao redirecionar).
      if (cpu.bx <= 4) { ok(); return; }
      if (!state.handles.has(cpu.bx)) { cpu.flags |= 0x0001; cpu.ax = 6; return; }
      state.handles.delete(cpu.bx); ok(); return;
    }
    case 0x3f: { // READ BX CX DS:DX
      const f = state.handles.get(cpu.bx);
      if (!f) { cpu.flags |= 0x0001; cpu.ax = 6; return; }
      const data = state.fs.get(f.name) || new Uint8Array(0);
      const n = Math.max(0, Math.min(cpu.cx, data.length - f.pos));
      for (let i = 0; i < n; i++) mem.write8(cpu.ds, (cpu.dx + i) & 0xffff, data[f.pos + i]);
      f.pos += n; cpu.ax = n; ok(); return;
    }
    case 0x40: { // WRITE BX CX DS:DX (1/2=stdout, resto=arquivo)
      const h = cpu.bx, len = cpu.cx;
      const f = state.handles.get(h);
      if (h === 1 || h === 2 || !f) {
        if (!f && h !== 1 && h !== 2) { cpu.flags |= 0x0001; cpu.ax = 6; return; }
        let p = ((cpu.ds << 4) + cpu.dx) & 0xfffff, out = "";
        for (let i = 0; i < len; i++) out += String.fromCharCode(mem.buf[(p + i) & 0xfffff]);
        if (h === 1 || h === 2) put(out);
        cpu.ax = len; ok(); return;
      }
      if (!f.writable) { cpu.flags |= 0x0001; cpu.ax = 5; return; }
      let data = state.fs.get(f.name) || new Uint8Array(0);
      const end = f.pos + len;
      if (end > data.length) { const nd = new Uint8Array(end); nd.set(data); data = nd; state.fs.set(f.name, data); }
      for (let i = 0; i < len; i++) data[f.pos + i] = mem.read8(cpu.ds, (cpu.dx + i) & 0xffff);
      f.pos = end; cpu.ax = len; ok(); return;
    }
    case 0x42: { // LSEEK BX AL CX:DX
      const f = state.handles.get(cpu.bx);
      if (!f) { cpu.flags |= 0x0001; cpu.ax = 6; return; }
      const data = state.fs.get(f.name) || new Uint8Array(0);
      let off = (cpu.cx << 16) | cpu.dx;
      if (off & 0x80000000) off -= 0x100000000;
      let np = cpu.al === 0 ? off : cpu.al === 1 ? f.pos + off : data.length + off;
      if (np < 0) { cpu.flags |= 0x0001; cpu.ax = 1; return; }
      f.pos = np; cpu.dx = (np >> 16) & 0xffff; cpu.ax = np & 0xffff; ok(); return;
    }
    case 0x41: { // UNLINK DS:DX
      const name = base(asciz(cpu.ds, cpu.dx));
      if (!state.fs.has(name)) { cpu.flags |= 0x0001; cpu.ax = 2; return; }
      state.fs.delete(name); ok(); return;
    }
    case 0x3b: { // CHDIR DS:DX
      const p = normDir(asciz(cpu.ds, cpu.dx), state.cwd);
      if (!p.ok || !state.dirs.has(p.dir)) { state.lastError = 3; cpu.flags |= 0x0001; cpu.ax = 3; return; }
      state.cwd = p.dir; cpu.ax = 0; ok(); return;
    }
    case 0x39: { // MKDIR DS:DX
      const p = normDir(asciz(cpu.ds, cpu.dx), state.cwd);
      if (!p.ok) { cpu.flags |= 0x0001; cpu.ax = 3; return; }
      if (state.dirs.has(p.dir) || state.fs.has(p.dir)) { cpu.flags |= 0x0001; cpu.ax = 5; return; }
      state.dirs.add(p.dir); cpu.ax = 0; ok(); return;
    }
    case 0x3a: { // RMDIR DS:DX
      const p = normDir(asciz(cpu.ds, cpu.dx), state.cwd);
      if (!p.ok || p.dir === "" || !state.dirs.has(p.dir)) { cpu.flags |= 0x0001; cpu.ax = 3; return; }
      const pre = p.dir + "\\";
      for (const d of state.dirs) if (d.startsWith(pre)) { cpu.flags |= 0x0001; cpu.ax = 5; return; } // nao vazio
      for (const f of state.fs.keys()) if (dirOf(f).startsWith(pre)) { cpu.flags |= 0x0001; cpu.ax = 5; return; }
      state.dirs.delete(p.dir); cpu.ax = 0; ok(); return;
    }
    case 0x38: { // COUNTRY: preenche o buffer do chamador em DS:DX, preserva tudo
      // (NUNCA clobberar DS/ES aqui: o COMMAND depende deles apos a chamada.
      // Modo 0 = legado minimo, mantido p/ bissectar.)
      if (cpu.al !== 0x00) { cpu.flags |= 0x0001; cpu.ax = 0x0c; return; }
      if ((state.countryMode ?? 2) === 0) {
        cpu.bx = 1; cpu.dx = 437; cpu.ax = 0; ok(); return;
      }
      const W = (seg, off, v) => { mem.write8(seg, off, v & 0xff); mem.write8(seg, (off + 1) & 0xffff, (v >> 8) & 0xff); };
      const S = (seg, off, s, n) => { for (let i = 0; i < n; i++) mem.write8(seg, (off + i) & 0xffff, i < s.length ? s.charCodeAt(i) & 0x7f : 0); };
      // preenche o buffer do chamador em DS:DX, preserva tudo
      const seg = cpu.ds, off = cpu.dx;
      for (let i = 0; i < 32; i++) mem.write8(seg, (off + i) & 0xffff, 0);
      W(seg, off + 0x00, 0x0000);
      S(seg, off + 0x02, "$", 5); S(seg, off + 0x07, ",", 2); S(seg, off + 0x09, ".", 2);
      S(seg, off + 0x0b, "-", 2); S(seg, off + 0x0d, ":", 2);
      mem.write8(seg, (off + 0x0f) & 0xffff, 0x00); mem.write8(seg, (off + 0x10) & 0xffff, 0x02); mem.write8(seg, (off + 0x11) & 0xffff, 0x00);
      cpu.bx = 1; cpu.ax = 0; ok(); return;
    }
    case 0x44: { // IOCTL
      if (cpu.al === 0x00) { // info do dispositivo p/ o HANDLE em BX
        // 0-4 = dispositivos pre-abertos do DOS (CON/AUX/PRN);
        // >=5 = arquivo aberto por nos. Devolver 0x80D3 (console) para
        // TODO handle fazia o XCOPY tratar o arquivo aberto como o CON
        // => "Cannot XCOPY from a reserved device".
        const h = cpu.bx;
        if (h > 4 && !state.handles.has(h)) { state.lastError = 6; cpu.flags |= 0x0001; cpu.ax = 6; return; }
        cpu.dx = h > 4 ? 0x0002 /* arquivo na unidade C: (2) */ : 0x80d3 /* console */;
        cpu.ax = 0; ok(); return;
      }
      if (cpu.al === 0x01) { // info do dispositivo p/ uma UNIDADE (BX=0 padrao, 1=A:...)
        const drv = cpu.bx & 0xff;
        if (drv === 0 || drv <= 5) { // temos 5 unidades (ver AH=0Eh)
          cpu.dx = (state.ioctlDriveInfo ?? 0x0840); cpu.ax = 0; ok(); return;
        }
        state.lastError = 15; cpu.flags |= 0x0001; cpu.ax = 15; return;
      }
      if (cpu.al === 0x08) { // BL = unidade (1=A:): removivel?
        const drv = cpu.bx & 0xff;
        // A:/B: = disquete removivel; C: em diante = fixo. O CHKDSK usa isto
        // para decidir se ha "midia" na unidade (se dissermos removivel, ele
        // reclama de "Invalid media type").
        cpu.ax = (drv === 1 || drv === 2) ? 0 : 1; ok(); return;
      }
      if (cpu.al === 0x09) { // BL = unidade: e remota (rede)?
        const drv = cpu.bx & 0xff;
        if (drv >= 0x06) { state.lastError = 15; cpu.flags |= 0x0001; cpu.ax = 15; return; }
        cpu.dx = (state.ioctlDriveInfo ?? 0x0840) & 0xefff; // bit 12=0 => local
        cpu.ax = 0; ok(); return;
      }
      if (cpu.al === 0x07 || cpu.al === 0x0b) { cpu.al = 0x00; ok(); return; } // output/input status: pronto
      cpu.flags |= 0x0001; cpu.ax = 1; return;
    }
    case 0x65: cpu.flags |= 0x0001; cpu.ax = 1; return; // EXTENDED COUNTRY: nao suportado
    case 0x66: { // GET/SET GLOBAL CODE PAGE TABLE (o EDIT/QBASIC consultam)
      if (cpu.al === 0x01) { cpu.bx = 0x01b5; cpu.dx = 0x01b5; cpu.ax = 0; ok(); return; } // 437 = EUA
      if (cpu.al === 0x02) { cpu.ax = 0; ok(); return; }                                  // SET: aceita
      state.lastError = 1; cpu.flags |= 0x0001; cpu.ax = 1; return;
    }
    case 0x6c: { // EXTENDED OPEN/CREATE: nome ASCIZ em DS:SI (BX=modo, CX=attr, DL=acao)
      const name = base(asciz(cpu.ds, cpu.si));
      const has = state.fs.has(name);
      const dl = cpu.dl & 0xff, act = dl & 0x0f; // 1=abrir, 2=criar, 3=truncar; bit4=checa existencia
      if (has && act === 0 && (dl & 0x10)) { cpu.cx = 1; ok(); return; } // so checa existencia
      if (has && act === 0) { cpu.flags |= 0x0001; cpu.ax = 1; return; } // nenhuma acao pedida
      if (!has && act === 0) { state.lastError = 2; cpu.flags |= 0x0001; cpu.ax = 2; return; }
      if (!has && act !== 2) { state.lastError = 2; cpu.flags |= 0x0001; cpu.ax = 2; return; } // abre/truncar exige existir
      if (act === 3 && has) state.fs.set(name, new Uint8Array(0)); // truncar
      if (act === 2) state.fs.set(name, new Uint8Array(0)); // criar (DOS: falharia se existisse em modo exclusivo; ok p/ COMMAND.COM)
      const h = state.nextHandle++;
      state.handles.set(h, { name, pos: 0, writable: act !== 1 || true });
      cpu.ax = h;
      cpu.cx = has ? (act === 3 ? 3 : 1) : 2; // 1=aberto, 2=criado, 3=truncado
      ok(); return;
    }
    case 0x69: { // DOS 4+ interno: numero de serie / rotulo (Buffer = #01766)
      const d = state.disk;
      // BL = unidade (0=padrao, 1=A:); so' temos C: como disco real
      if ((cpu.bx & 0xff) > 0x05 || !d) { state.lastError = 15; cpu.flags |= 0x0001; cpu.ax = 15; return; }
      const p = ((cpu.ds << 4) + cpu.dx) & 0xfffff;
      const w16 = (o, v) => { mem.buf[p + o] = v & 0xff; mem.buf[p + o + 1] = (v >> 8) & 0xff; };
      const w32 = (o, v) => { w16(o, v & 0xffff); w16(o + 2, (v >>> 16) & 0xffff); };
      const str = (o, s) => { for (let i = 0; i < s.length; i++) mem.buf[p + o + i] = s.charCodeAt(i); };
      if (cpu.al === 0x01) { // SET: o LABEL grava o rotulo no BPB estendido
        let lbl = "";
        for (let i = 0; i < 11; i++) lbl += String.fromCharCode(mem.buf[p + 6 + i]);
        d.label = lbl.trim();
        d.refresh();
        cpu.ax = 0; ok(); return;
      }
      if (cpu.al !== 0x00) { state.lastError = 1; cpu.flags |= 0x0001; cpu.ax = 1; return; }
      w16(0x00, 0x0000);          // nivel de informacao
      w32(0x02, d.serial);        // numero de serie
      str(0x06, (d.label ? d.label.padEnd(11, " ") : "NO NAME    ").slice(0, 11));
      str(0x11, "FAT16   ");      // tipo de sistema de arquivos
      cpu.ax = 0x0000; ok(); return;
    }
    // AH=58h: estrategia de alocacao e link de UMBs (o MEM consulta).
    case 0x58: {
      if (cpu.al === 0x00) { cpu.ax = state.allocStrategy ?? 0; ok(); return; } // GET STRATEGY
      if (cpu.al === 0x01) { state.allocStrategy = cpu.bx; ok(); return; }       // SET STRATEGY
      if (cpu.al === 0x02) { cpu.al = state.umbLink ? 0x01 : 0x00; ok(); return; } // GET UMB LINK
      if (cpu.al === 0x03) { state.umbLink = cpu.bx !== 0; ok(); return; }        // SET UMB LINK
      state.lastError = 1; cpu.flags |= 0x0001; cpu.ax = 1; return;
    }
    case 0x59: cpu.ax = state.lastError ?? 1; cpu.bh = 0x01; cpu.bl = 0x01; cpu.ch = 0x01; cpu.cl = 0x01; ok(); return; // EXTENDED ERROR
    case 0x5d: state.lastError = 1; cpu.flags |= 0x0001; cpu.ax = 1; return; // 5Dxx: nao suportado (fallback)
    case 0x63: { // DBCS: tabela de lead bytes (INT 21/AH=63h)
      // O COMMAND.COM guarda DS:SI desta chamada como a *tabela de
      // classificacao de caracteres* usada no parser (rotina que varre
      // pares inicio/fim de faixa terminados por 0x0000). Se falharmos
      // aqui, ele guarda lixo e o parser varre ~64K de memoria.
      // Code page SBCS => tabela vazia (somente o terminador).
      if (cpu.al === 0x00) { // GET: DS:SI -> tabela de lead bytes (SBCS: vazia)
        const seg = state.dosSeg ?? 0x0070, off = 0x0100;
        mem.write8(seg, 0x0100, 0x00); mem.write8(seg, 0x0101, 0x00);
        cpu.ds = seg; cpu.si = off;
        cpu.ax = 0x0000; ok(); return;
      }
      if (cpu.al === 0x01) { ok(); return; } // SET: aceita e ignora (SBCS)
      state.lastError = 1; cpu.flags |= 0x0001; cpu.ax = 1; return;
    }
    case 0x4c: cpu.exited = true; cpu.exitCode = cpu.al; return;
    case 0x31: { // KEEP PROCESS (TSR): termina ficando residente
      state.tsr = true;
      state.tsrKeep = cpu.dx * 16; // DX = paragrafos a manter (contando o PSP)
      cpu.exited = true; cpu.exitCode = cpu.al;
      return;
    }
    case 0x4d: cpu.ax = (state.lastExit & 0xff); ok(); return;
    case 0x71: case 0x72: // LFN (DOS 7+/Windows 95): nao temos nomes longos
      state.lastError = 0x7100; cpu.flags |= 0x0001; cpu.ax = 0x7100; return;
    case 0x00: cpu.exited = true; cpu.exitCode = 0; return;
    default: return fail("INT 21h funcao");
  }
}

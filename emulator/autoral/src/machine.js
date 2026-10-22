// Machine: memoria + cpu + video + DOS. Carrega .COM (ORG 100h) com PSP.
import { Memory } from "./mem.js";
import { CPU } from "./cpu.js";
import { Video } from "./video.js";
import { handleInterrupt, keyCode } from "./dos.js";
import { VirtualDisk } from "./disk.js";

export const LOAD_SEG = 0x1000; // .COM -> 0x10000 linear, IP=0x100
export const ENV_SEG = 0x0e00;  // bloco de ambiente (linear 0xE000, 512 bytes)
export const DOS_SEG = 0x0070;  // segmento de dados do DOS (SYSVARS) = 1o MCB
export const LOL_OFF = 0x0030;  // offset da "list of lists" dentro de DOS_SEG
const DPB_OFF = 0x0300;        // Drive Parameter Block (drive C:)
const CLOCK_OFF = 0x0340;      // cabecalho do device driver CLOCK$
const CON_OFF = 0x0360;        // cabecalho do device driver CON
const BDEV_OFF = 0x0380;       // cabecalho do device driver de bloco
const SFT_OFF = 0x0400;        // 1a System File Table (SHARE poe os ganchos
                               // dele 3Ch bytes antes: 0x03C4..0x03FF)
const DBUF_OFF = 0x0550;       // registro de informacao dos buffers de disco
const BUFHASH_OFF = 0x0590;    // array de cabecas de hash dos buffers
const CDS_OFF = 0x0600;        // array de Current Directory Structures
const FCB_OFF = 0x0800;        // tabela de FCBs de sistema (8 entradas 3Bh)

const ENCODER_STRINGS = [
  "COMSPEC=C:\\COMMAND.COM",
  "PATH=C:\\",
  "PROMPT=$p$g",
  "TEMP=C:\\DOS",
  "BLASTER=A220 I7 D1",
];

export class Machine {
  constructor() {
    this.mem = new Memory();
    this.video = new Video(80, 25, this.mem);
    this.state = {
      stdout: "", keys: [], inputLine: [], intLog: [], lastExit: 0,
      ports: new Map(), fs: new Map(), handles: new Map(), nextHandle: 5,
      dirs: new Set([""]), cwd: "", // "" = raiz (C:\)
      findCtx: null, dtaSeg: LOAD_SEG, dtaOff: 0x0080, psp: LOAD_SEG,
      nextSeg: 0x2000, envSeg: ENV_SEG, machine: this,
    };
    this.cpu = new CPU(this.mem, {
      int: (n, cpu) => handleInterrupt(n, cpu, this.mem, this.video, this.state),
      in: (port) => (port === 0x60 ? 0x1c : 0xff),
      out: () => {},
    });
  }
  // monta um arquivo no drive C: virtual (nome 8.3, case-insensitive)
  mountFile(name, bytes) {
    this.state.fs.set(name.toUpperCase(), bytes);
  }
  // fila de teclas scancode em AX (ex.: 0x1c0d = Enter). Para testes,
  // pushKeys("VER\r") converte cada char em AX simples.
  pushKeys(s) {
    for (const ch of s) this.state.keys.push(keyCode(ch.charCodeAt(0)));
    this.syncBdaKeys();
  }
  pushInputLine(s) { this.state.inputLine.push(s); }
  syncBdaKeys() {
    // espelha a fila de teclas no buffer circular do BIOS (40:1E),
    // porque o COMMAND pesquisa head/tail (40:1A/1C) direto.
    const seg = 0x40, base = seg << 4;
    const n = Math.min(this.state.keys.length, 15);
    for (let i = 0; i < n; i++) {
      const w = this.state.keys[i] & 0xffff, p = base + 0x1e + i * 2;
      this.mem.buf[p] = w & 0xff; this.mem.buf[p + 1] = (w >> 8) & 0xff;
    }
    const head = base + 0x1a, tail = base + 0x1c;
    this.mem.buf[head] = 0x1e; this.mem.buf[head + 1] = 0x00;
    const t = (0x1e + n * 2) & 0xffff;
    this.mem.buf[tail] = t & 0xff; this.mem.buf[tail + 1] = (t >> 8) & 0xff;
  }
  buildEnv() {
    // bloco de ambiente DOS: strings NUL + NUL + word reservas + path programa
    const base = ENV_SEG << 4;
    let p = base;
    for (const s of ENCODER_STRINGS) {
      for (let i = 0; i < s.length; i++) this.mem.buf[p++] = s.charCodeAt(i) & 0x7f;
      this.mem.buf[p++] = 0;
    }
    this.mem.buf[p++] = 0;
    this.mem.buf[p++] = 1; this.mem.buf[p++] = 0; // 1 string extra
    const prog = "C:\\COMMAND.COM";
    for (let i = 0; i < prog.length; i++) this.mem.buf[p++] = prog.charCodeAt(i) & 0x7f;
    this.mem.buf[p++] = 0;
  }
  buildPsp(seg) {
    const base = seg << 4;
    this.mem.buf.fill(0, base, base + 0x100);
    this.mem.buf[base + 0] = 0xcd; this.mem.buf[base + 1] = 0x20; // INT 20
    this.mem.buf[base + 2] = 0xff; this.mem.buf[base + 3] = 0x9f; // topo: 640K
    this.mem.buf[base + 5] = 0x9d; this.mem.buf[base + 6] = 0xf0; // far call DOS (CP/M-like)
    this.mem.buf[base + 0x80] = 0; this.mem.buf[base + 0x81] = 0x0d; // cauda vazia
    // PSP:2C = segmento do ambiente
    this.mem.buf[base + 0x2c] = this.state.envSeg & 0xff;
    this.mem.buf[base + 0x2d] = (this.state.envSeg >> 8) & 0xff;
  }
  buildDosTables() {
    // MCB chain plausivel: DOS em 0060h, livre ate 9FFFh (640K).
    // LoL (list of lists) dentro do segmento de dados do DOS (DOS_SEG),
    // com o 1o MCB em [BX-2] (linear 0x4FE).
    const W = (lin, v) => { this.mem.buf[lin] = v & 0xff; this.mem.buf[lin + 1] = (v >> 8) & 0xff; };
    // Area de dados do BIOS (40:00..40:FF): varios programas (MEM, CHKDSK,
    // editores de video) leem daqui em vez de chamar INT 12h. O total de
    // memoria em 40:13 = 640K e o que o MEM usa; sem isso ele dividia por 0.
    this.mem.buf.fill(0, 0x400, 0x4fe);
    W(0x400, 0x3f8); W(0x402, 0x2f8); W(0x404, 0x3e8); W(0x406, 0x2e8); // COM1..4
    W(0x408, 0x378); W(0x40a, 0x278);                                  // LPT1..2
    W(0x410, 0x0021); // equipamento: 1 floppy, 80x25 cor, 1 drive de disquete
    W(0x413, 0x027f); // memoria convencional em K (639K + 1K de EBDA)
    // EBDA (Extended BIOS Data Area) em 9FC0h: o MEM localiza por INT 15h/AH=C1h
    // e usa p/ calcular a memoria "Reserved" (a area entre o fim da memoria
    // convencional e 1MB). O 1o word = tamanho da EBDA em KB.
    W(0x9fc0, 0x0001);
    W(0x41a, 0x001e); W(0x41c, 0x001e); // fila de teclado vazia (40:1E/40:1C)
    W(0x449, 0x0003);  // modo de video atual: 80x25 texto colorido
    W(0x44a, 0x0050);  // colunas
    W(0x44c, 0x1000);  // tamanho da pagina de video
    W(0x44e, 0x0000); W(0x462, 0x0000); // offset/pagina ativa
    W(0x463, 0x03d4); W(0x465, 0x0029); // porta CRTC/modo
    W(0x475, 0x0001);  // 1 disco rigido
    W(0x4fe, DOS_SEG); // LoL[−2]: primeiro MCB
    const mcb = (seg, type, owner, paras, name) => {
      const p = seg << 4;
      this.mem.buf[p] = type.charCodeAt(0);
      W(p + 1, owner); W(p + 3, paras);
      this.mem.buf.fill(0, p + 5, p + 16);
      if (name) for (let i = 0; i < name.length && i < 8; i++) this.mem.buf[p + 8 + i] = name.charCodeAt(i);
    };
    // O 1o bloco do DOS tem 256 paragrafos (01h no byte alto do tamanho) de
    // proposito: o SHARE.EXE faz, logo depois de INT 21/AH=52h,
    // "cmp byte es:[4],1" e aborta com "Incorrect DOS version" se nao for 1.
    // Em DOS 3.1+ ES aponta para o 1o MCB e [ES+4] e' o byte alto do tamanho
    // (em paragrafos) do 1o sub-segmento dos dados do DOS -- 01h no MS-DOS
    // 6.22 de referencia (bloco de ~4K: drivers + tabelas).
    mcb(DOS_SEG, "M", 0x0008, 0x0100, "SD");          // dados do DOS (1o bloco)
    mcb(DOS_SEG + 0x101, "M", 0x0008, 0x0fff - (DOS_SEG + 0x101) - 1, "SD"); // resto do DOS
    mcb(0x0fff, "M", 0x1000, 0x0e00); // nosso PSP+programa (1000..1DFF)
    mcb(0x1e00, "Z", 0x0000, 0x81bf); // livre ate 9FBF (a EBDA fica em 9FC0)
    this.buildDosData();
  }
  // SYSVARS: a "list of lists" (INT 21/AH=52h) e tudo o que ela aponta --
  // DPB, SFT, cabecalhos de device driver, array de CDS, tabela de FCBs.
  // Fica dentro do 1o bloco (propriedade do DOS), entao o alocador nunca
  // entrega esta area a um programa.
  buildDosData() {
    const base = DOS_SEG << 4;
    const W = (off, v) => { this.mem.buf[base + off] = v & 0xff; this.mem.buf[base + off + 1] = (v >> 8) & 0xff; };
    const B = (off, v) => { this.mem.buf[base + off] = v & 0xff; };
    const S = (off, s) => { for (let i = 0; i < s.length; i++) this.mem.buf[base + off + i] = s.charCodeAt(i); };
    const P = (off, off16) => { W(off, off16); W(off + 2, DOS_SEG); }; // ptr DOS_SEG:off16
    const D = DPB_OFF, L = LOL_OFF;
    // ---- list of lists ----
    W(L - 2, DOS_SEG);                 // segmento do 1o MCB
    P(L + 0x00, D);                    // -> primeiro DPB
    P(L + 0x04, SFT_OFF);              // -> primeira SFT (o SHARE instala os
                                       //    ganchos dele 3Ch bytes antes)
    P(L + 0x08, CLOCK_OFF);            // -> cabecalho do CLOCK$
    P(L + 0x0c, CON_OFF);              // -> cabecalho do CON
    W(L + 0x10, 0x0200);               // maior bytes/setor
    P(L + 0x12, DBUF_OFF);             // -> registro de buffers de disco
    P(L + 0x16, CDS_OFF);              // -> array de CDS (drives)
    P(L + 0x1a, FCB_OFF);              // -> tabela de FCBs de sistema
    W(L + 0x1e, 0x0000);               // FCBs protegidos
    B(L + 0x20, 0x01);                 // dispositivos de bloco instalados
    B(L + 0x21, 0x05);                 // letras de drive (= AH=0Eh)
    // NUL: primeiro driver da cadeia, embutido aqui (18 bytes)
    W(L + 0x22, 0xffff); W(L + 0x24, 0xffff); // proximo = FFFF:FFFF (ultimo)
    W(L + 0x26, 0x8004);               // atributos: char device + NUL
    W(L + 0x28, 0x0000); W(L + 0x2a, 0x0000); // strategy/interrupt (nao usado)
    S(L + 0x2c, "NUL     ");
    B(L + 0x34, 0x00);                 // drives JOIN'ed
    W(L + 0x35, 0x0000);               // nomes especiais (0 = nenhum)
    W(L + 0x37, 0x0000); W(L + 0x39, 0x0000); // lista do SETVER (0000:0000)
    W(L + 0x3b, 0x0000);               // offset da rotina de A20 (DOS=HIGH)
    W(L + 0x3d, 0x0000);               // PSP se o DOS esta' na HMA
    W(L + 0x3f, 0x000f);               // BUFFERS=x
    W(L + 0x41, 0x0008);               // buffers de lookahead
    B(L + 0x43, 0x03);                 // drive de boot (3 = C:)
    B(L + 0x44, 0x00);                 // "usa movimentos DWORD" (386)
    W(L + 0x45, 0x0000);               // memoria estendida em KB
    // ---- tabela DBCS (INT 21/AH=63h AL=0): 0x0070:0000 = DOS_SEG:0100h ----
    W(0x0100, 0x0000);
    // ---- (0x0200..0x029F tem as mensagens do INT 2F/AX=122Eh) ----
    // ---- CLOCK$ e CON: cabecalhos de device driver ----
    W(CLOCK_OFF + 0x00, 0xffff); W(CLOCK_OFF + 0x02, 0xffff);
    W(CLOCK_OFF + 0x04, 0x8008); // char device + CLOCK$
    W(CLOCK_OFF + 0x06, 0x0000); W(CLOCK_OFF + 0x08, 0x0000);
    S(CLOCK_OFF + 0x0a, "CLOCK$  ");
    W(CON_OFF + 0x00, 0xffff); W(CON_OFF + 0x02, 0xffff);
    W(CON_OFF + 0x04, 0x8013);   // char device + stdin + stdout + special
    W(CON_OFF + 0x06, 0x0000); W(CON_OFF + 0x08, 0x0000);
    S(CON_OFF + 0x0a, "CON     ");
    // ---- driver de bloco (o DPB aponta para ele) ----
    W(BDEV_OFF + 0x00, 0xffff); W(BDEV_OFF + 0x02, 0xffff);
    W(BDEV_OFF + 0x04, 0x4002);  // bloco + IOCTL + setores de 32 bits
    W(BDEV_OFF + 0x06, 0x0000); W(BDEV_OFF + 0x08, 0x0000);
    B(BDEV_OFF + 0x0a, 0x01);    // 1 sub-unidade (1 drive)
    // ---- DPB do drive C: (FAT16, 504MB, clusters de 16K) ----
    B(D + 0x00, 0x02);           // drive C:
    B(D + 0x01, 0x80);           // unidade (80h = 1o disco rigido)
    W(D + 0x02, 0x0200);         // 512 bytes/setor
    B(D + 0x04, 0x1f);           // setores/cluster - 1 (32)
    B(D + 0x05, 0x05);           // shift p/ converter clusters em setores
    W(D + 0x06, 0x0001);         // setores reservados
    B(D + 0x08, 0x02);           // 2 FATs
    W(D + 0x09, 0x0200);         // 512 entradas no diretorio raiz
    W(D + 0x0b, 0x011d);         // 1o setor de dados (285)
    W(D + 0x0d, 0x7df8);         // maior cluster + 1 (32248)
    W(D + 0x0f, 0x007e);         // setores por FAT (126)
    W(D + 0x11, 0x00fd);         // 1o setor do diretorio raiz (253)
    W(D + 0x13, BDEV_OFF); W(D + 0x15, DOS_SEG); // endereco do driver
    B(D + 0x17, 0xf8);           // media ID: disco fixo
    B(D + 0x18, 0x00);           // 00h = disco ja' acessado
    W(D + 0x19, 0xffff); W(D + 0x1b, 0xffff); // proximo DPB: nenhum
    W(D + 0x1d, 0x0000);         // cluster p/ comecar a busca de espaco livre
    // Disco virtual (INT 25h/26h): o volume FAT16 e' construido a partir dos
    // arquivos montados, entao a FAT e o diretorio raiz batem com o DIR.
    const disk = new VirtualDisk(this.state.fs);
    this.state.disk = disk;
    W(D + 0x1f, disk.freeClusters); // clusters livres
    // ---- SFT: 5 entradas (CON, CON, AUX, PRN, NUL) ----
    W(SFT_OFF + 0x00, 0xffff); W(SFT_OFF + 0x02, 0xffff); // ultima SFT
    W(SFT_OFF + 0x04, 0x0005);                            // 5 arquivos
    const FILES = [["CON", CON_OFF, 0x80d0], ["CON", CON_OFF, 0x80d1],
                   ["AUX", 0x0000, 0x80d2], ["PRN", 0x0000, 0x80d3],
                   ["NUL", 0x0000, 0x80d4]];
    for (let i = 0; i < FILES.length; i++) {
      const e = SFT_OFF + 0x06 + i * 0x3b, nm = FILES[i][0], drvOff = FILES[i][1], info = FILES[i][2];
      W(e + 0x00, 1);              // 1 handle refere este arquivo
      W(e + 0x02, 0x0002);         // modo de abertura: leitura/escrita
      B(e + 0x04, 0x00);           // atributo
      W(e + 0x05, info);           // device info word (char device)
      W(e + 0x07, drvOff); W(e + 0x09, DOS_SEG); // ponteiro p/ o driver
      S(e + 0x20, (nm + "           ").slice(0, 11)); // nome em formato FCB
    }
    // ---- registro de informacao dos buffers de disco ----
    W(DBUF_OFF + 0x00, BUFHASH_OFF); W(DBUF_OFF + 0x02, DOS_SEG); // -> cadeias
    W(DBUF_OFF + 0x04, 0x000f);  // 15 buffers
    W(DBUF_OFF + 0x06, 0x0000);  // nenhum sujo
    B(DBUF_OFF + 0x0a, 0x04);    // tamanho do buffer (setores)
    for (let i = 0; i < 8; i++) W(BUFHASH_OFF + i * 2, 0xffff); // cadeias vazias
    // ---- array de CDS (5 letras de drive) ----
    for (let i = 0; i < 5; i++) {
      const c = CDS_OFF + i * 0x58, ch = String.fromCharCode(0x41 + i);
      S(c + 0x00, ch + ":\\");
      W(c + 0x43, 0x4000);                 // atributos: drive fisico
      W(c + 0x45, D); W(c + 0x47, DOS_SEG); // -> DPB
      W(c + 0x49, 0x0000);                 // cluster do diretorio corrente
      W(c + 0x4b, 0xffff); W(c + 0x4d, 0xffff);
      W(c + 0x4f, 0x0002);                 // esconde o "X:" no GETDIR/CHDIR
    }
    // ---- tabela de FCBs de sistema: 8 entradas de 3Bh bytes ----
    // O contador em +4 PRECISA ser != 0: o SHARE.EXE percorre as entradas
    // zerando os contadores de LRU (+15h/+17h) com "loop", e "loop" com
    // CX=0 da' 65536 voltas, destruindo a memoria toda.
    W(FCB_OFF + 0x00, 0xffff); W(FCB_OFF + 0x02, 0xffff); // nenhuma proxima
    W(FCB_OFF + 0x04, 0x0008);                            // 8 entradas
    this.mem.buf.fill(0, base + FCB_OFF + 0x06, base + FCB_OFF + 0x06 + 8 * 0x3b);
    // deixa a LoL acessivel ao INT 21/AH=52h
    this.state.dosSeg = DOS_SEG;
    this.state.lolOff = LOL_OFF;
    this.state.dpbOff = DPB_OFF;
  }
  loadCom(bytes) {
    if (bytes.length > 0xf000) throw new Error(".COM grande demais p/ o nucleo atual");
    const seg = LOAD_SEG, base = (seg << 4);
    this.buildEnv();
    this.buildPsp(seg);
    this.buildDosTables();
    this.mem.loadLinear(base + 0x100, bytes);
    this.cpu.reset(seg);
    this.cpu.ds = seg; this.cpu.es = seg; this.cpu.ss = seg;
    this.cpu.sp = 0xfffe;
    this.video.clear();
    this.state.stdout = ""; this.state.intLog = []; this.state.lastExit = 0;
    this.state.handles = new Map(); this.state.nextHandle = 5; this.state.findCtx = null;
    this.state.dtaSeg = seg; this.state.dtaOff = 0x0080;
    this.state.psp = seg; this.state.nextSeg = 0x2000;
    this.booted = false;
  }
  run(maxSteps = 100000) {
    // boot: se existir AUTOEXEC.BAT, o shell o executa como primeira linha
    // (o DOS faz isso no shell primario; aqui pedimos ao proprio COMMAND.COM)
    if (!this.booted) {
      this.booted = true;
      const seg = this.state.psp, base = (seg << 4), n = this.mem.buf[base + 0x80];
      let tail = "";
      for (let i = 0; i < n && i < 126; i++) tail += String.fromCharCode(this.mem.buf[base + 0x81 + i]);
      // se o shell foi iniciado com /P ele mesmo roda o AUTOEXEC; nao duplicar
      if (!/\/p/i.test(tail) && this.state.fs.has("AUTOEXEC.BAT")) this.state.inputLine.unshift("AUTOEXEC.BAT");
    }
    // fatiado: a cada fatia avanca o tick do BIOS 40:6Ch (~18.2/s)
    let done = 0, r = { steps: 0, exited: false, exitCode: 0, halted: false };
    while (done < maxSteps) {
      this.syncBdaKeys(); // fila -> BDA antes de cada fatia
      const slice = Math.min(20000, maxSteps - done);
      try {
        r = this.cpu.run(slice);
      } catch (e) {
        if (!String(e.message).startsWith("limite de passos")) throw e;
        r = { steps: slice, exited: false, exitCode: 0, halted: false }; // fatia cheia, segue
      }
      done += slice;
      this.video.syncFromMem(); // captura desenho direto na VRAM (B800)
      if (r.exited || r.halted) break;
      const p = (0x40 << 4) + 0x6c;
      let t = (this.mem.buf[p] | (this.mem.buf[p + 1] << 8) | (this.mem.buf[p + 2] << 16) | (this.mem.buf[p + 3] << 24)) >>> 0;
      t = (t + 1) >>> 0;
      this.mem.buf[p] = t & 0xff; this.mem.buf[p + 1] = (t >> 8) & 0xff;
      this.mem.buf[p + 2] = (t >> 16) & 0xff; this.mem.buf[p + 3] = (t >> 24) & 0xff;
    }
    this.state.lastExit = this.cpu.exitCode;
    return { steps: this.cpu.steps, exited: this.cpu.exited, exitCode: this.cpu.exitCode, halted: this.cpu.halted };
  }
  get text() { return this.video.getText(); }
  lastFault(n = 5) { return this.state.intLog.slice(-n); }

  loadFile(bytes) {
    if (bytes.length > 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return this.loadExe(bytes);
    return this.loadCom(bytes);
  }
  loadExe(bytes) {
    const u16 = (o) => bytes[o] | (bytes[o + 1] << 8);
    const relocs = u16(0x06), hdrParas = u16(0x08);
    const ss0 = u16(0x0e), sp0 = u16(0x10), ip0 = u16(0x14), cs0 = u16(0x16);
    const imgOff = hdrParas * 16;
    const seg = LOAD_SEG, imgSeg = seg + 0x10;
    const image = bytes.slice(imgOff);
    if (image.length > 0xe000) throw new Error("EXE grande demais p/ o nucleo atual");
    this.buildEnv();
    this.buildPsp(seg);
    this.buildDosTables();
    this.mem.loadLinear(imgSeg << 4, image);
    // relocacoes: [off:seg] += imgSeg
    const tab = u16(0x18);
    for (let i = 0; i < relocs; i++) {
      const off = bytes[tab + i * 4] | (bytes[tab + i * 4 + 1] << 8);
      const s = bytes[tab + i * 4 + 2] | (bytes[tab + i * 4 + 3] << 8);
      const lin = ((imgSeg + s) << 4) + off;
      const v = (this.mem.buf[lin] | (this.mem.buf[lin + 1] << 8)) + imgSeg;
      this.mem.buf[lin] = v & 0xff; this.mem.buf[lin + 1] = (v >> 8) & 0xff;
    }
    this.cpu.reset(imgSeg + cs0);
    this.cpu.ip = ip0;
    this.cpu.ds = seg; this.cpu.es = seg;
    this.cpu.ss = imgSeg + ss0; this.cpu.sp = sp0;
    this.video.clear();
    this.state.stdout = ""; this.state.intLog = []; this.state.lastExit = 0;
    this.state.handles = new Map(); this.state.nextHandle = 5; this.state.findCtx = null;
    this.state.dtaSeg = seg; this.state.dtaOff = 0x0080;
    this.state.psp = seg; this.state.nextSeg = 0x2000;
  }
}

// HELLO.COM de teste:
//   100: B4 09        MOV AH,09
//   102: BA 0C 01    MOV DX,010C
//   105: CD 21        INT 21
//   107: B8 00 4C    MOV AX,4C00
//   10A: CD 21        INT 21
//   10C: "Hello reDOS!$"
export function helloCom() {
  const code = [0xb4, 0x09, 0xba, 0x0c, 0x01, 0xcd, 0x21, 0xb8, 0x00, 0x4c, 0xcd, 0x21];
  const msg = [...Buffer.from("Hello reDOS!$", "ascii")];
  return Uint8Array.from([...code, ...msg]);
}

import assert from "node:assert";
import { Machine, helloCom } from "../src/machine.js";

// 1. HELLO.COM imprime e sai com codigo 0
{
  const m = new Machine();
  m.loadCom(helloCom());
  const r = m.run();
  assert.equal(r.exited, true, "deveria ter saido via INT 21h/4C");
  assert.equal(r.exitCode, 0);
  assert.match(m.state.stdout, /Hello reDOS!/);
  assert.match(m.text, /Hello reDOS!/);
  console.log("ok 1 - hello.com:", JSON.stringify(m.state.stdout));
}

// 2. INT 21h com AH desconhecida falha com mensagem util
{
  const m = new Machine();
  m.loadCom(Uint8Array.from([0xb4, 0x99, 0xcd, 0x21])); // AH=99h
  assert.throws(() => m.run(), /INT 21h funcao: INT 21h\/AH=99h/);
  console.log("ok 2 - erro de AH desconhecida e acionavel");
}

// 3. Opcode desconhecido falha com endereco seg:off
{
  const m = new Machine();
  m.loadCom(Uint8Array.from([0x0f, 0x0b])); // 0F 0B = UD2, fora do 8086
  assert.throws(() => m.run(), /0x0f.*1000:0100/i);
  console.log("ok 3 - opcode desconhecido informa seg:off");
}

// 4. MOV/ADD/Jcc/CALL-RET/STOS (fumaca do M2)
{
  const m = new Machine();
  // MOV CX,3; loop: INC AX; LOOP; STOSB x2; RET->HLT
  const prog = Uint8Array.from([
    0xb8, 0x00, 0x00,       // MOV AX,0
    0xb9, 0x03, 0x00,       // MOV CX,3
    0x40,                   // INC AX (loop top)
    0xe2, 0xfd,             // LOOP -3
    0xbf, 0x00, 0x00,       // MOV DI,0
    0xb0, 0x41,             // MOV AL,'A'
    0xaa,                   // STOSB
    0xaa,                   // STOSB
    0xb8, 0x00, 0x4c, 0xcd, 0x21, // EXIT
  ]);
  m.loadCom(prog);
  // aponta ES:DI para area livre apos o codigo
  m.cpu.es = 0x1000; m.cpu.di = 0x0200;
  m.run();
  assert.equal(m.cpu.ax & 0xff00, 0x4c00);
  assert.equal(m.cpu.cx, 0);
  console.log("ok 4 - M2 fumaca (loop+stos) passou");
}

// 5. COMMAND.COM real: relocacao + version check (trava de progresso M3)
// Roda os primeiros 500 passos sem falha de CPU: JMP inicial, SET PSP,
// GET VERSION, CALL FAR indireto p/ segmento relocado (CS=126E), TEST AX.
{
  const fs = await import("node:fs");
  const bytes = new Uint8Array(fs.readFileSync(new URL("../../../Systems/MS-DOS%206.22/extracted/COMMAND.COM", import.meta.url)));
  const m = new Machine();
  m.loadCom(bytes);
  let fault = null, sawReloc = false;
  try {
    for (let i = 0; i < 500 && !m.cpu.exited; i++) {
      m.cpu.step();
      if (m.cpu.cs === 0x126e) sawReloc = true;
    }
  } catch (e) { fault = e; }
  assert.equal(fault, null, "CPU deve aguentar 500 passos do COMMAND real: " + (fault && fault.message));
  assert.ok(sawReloc, "segmento relocado 126E deve ser visitado");
  const kinds = m.state.intLog.map(e => e.n.toString(16) + "/" + e.ah.toString(16));
  assert.ok(kinds.includes("21/50"), "SET PSP visto: " + kinds.join(" "));
  assert.ok(kinds.includes("21/30"), "GET VERSION visto: " + kinds.join(" "));
  console.log("ok 5 - COMMAND.COM: 500 passos, visitou CS=126E, INT 21/50+30");
}

// 6. Arquivos virtuais: CREATE/WRITE/READ/SEEK + FINDFIRST/NEXT
{
  const { Memory } = await import("../src/mem.js");
  const { CPU } = await import("../src/cpu.js");
  const { Video } = await import("../src/video.js");
  const { handleInterrupt } = await import("../src/dos.js");
  const mem = new Memory(), video = new Video();
  const state = { stdout: "", keys: [], inputLine: [], intLog: [], lastExit: 0, fs: new Map(), handles: new Map(), nextHandle: 5, dtaSeg: 0x1000, dtaOff: 0x80, psp: 0x1000 };
  const cpu = new CPU(mem, { int: (n, c) => handleInterrupt(n, c, mem, video, state) });
  const dos = (ah, al = 0) => { cpu.ah = ah; cpu.al = al; handleInterrupt(0x21, cpu, mem, video, state); assert.equal(cpu.flags & 1, 0, "CF deve estar limpo"); };
  const asciz = (s, seg = 0x1000, off = 0x200) => {
    for (let i = 0; i < s.length; i++) mem.write8(seg, off + i, s.charCodeAt(i));
    mem.write8(seg, off + s.length, 0);
    cpu.ds = seg; cpu.dx = off;
  };
  // CREATE + WRITE + CLOSE + OPEN + READ
  asciz("NOTA.TXT"); dos(0x3c); const h = cpu.ax;
  const payload = "ola redos";
  for (let i = 0; i < payload.length; i++) mem.write8(0x1000, 0x300 + i, payload.charCodeAt(i));
  cpu.bx = h; cpu.cx = payload.length; cpu.dx = 0x300; dos(0x40);
  cpu.bx = h; dos(0x3e);
  asciz("nota.txt"); dos(0x3d); const h2 = cpu.ax; // case-insensitive
  cpu.bx = h2; cpu.cx = 64; cpu.dx = 0x400; dos(0x3f);
  assert.equal(cpu.ax, payload.length);
  let back = "";
  for (let i = 0; i < payload.length; i++) back += String.fromCharCode(mem.read8(0x1000, 0x400 + i));
  assert.equal(back, payload);
  // SEEK pro inicio + FINDFIRST *.TXT
  cpu.bx = h2; cpu.al = 0; cpu.cx = 0; cpu.dx = 0; dos(0x42);
  assert.equal(cpu.ax, 0);
  asciz("*.TXT"); cpu.cx = 0; dos(0x4e);
  let found = "";
  for (let i = 0; i < 8; i++) found += String.fromCharCode(mem.read8(state.dtaSeg, (state.dtaOff + 0x1e + i) & 0xffff));
  assert.match(found, /NOTA\.TXT/);
  console.log("ok 6 - CREATE/WRITE/READ/SEEK/FIND:", JSON.stringify(back), "/", JSON.stringify(found.replace(/\0.*$/, "")));
}

// 7. FIND.EXE real (MZ): loader + relocs + parse + exit, de ponta a ponta
{
  const fs = await import("node:fs");
  const m = new Machine();
  const bytes = new Uint8Array(fs.readFileSync(new URL("../../../Systems/MS-DOS%206.22/extracted/FIND.EXE", import.meta.url)));
  assert.ok(bytes[0] === 0x4d && bytes[1] === 0x5a, "FIND.EXE deve ser MZ");
  m.loadFile(bytes);
  assert.equal(m.cpu.ds, 0x1000, "DS aponta p/ o PSP");
  m.run(2000000);
  assert.ok(m.cpu.exited, "FIND.EXE deve sair via INT 21h/4C");
  assert.match(m.state.stdout, /FIND: /);
  console.log("ok 7 - FIND.EXE (MZ):", JSON.stringify(m.state.stdout.split("\r\n")[0]), "exit=" + m.cpu.exitCode);
}

// 8. TREE.COM real: lista o drive virtual — comportamento genuino
{
  const fs = await import("node:fs");
  const m = new Machine();
  for (const f of fs.readdirSync(new URL("../../../Systems/MS-DOS%206.22/extracted/", import.meta.url)).map(String)) {
    const p = new URL("../../../Systems/MS-DOS%206.22/extracted/" + f, import.meta.url);
    m.mountFile(f, new Uint8Array(fs.readFileSync(p)));
  }
  m.loadFile(new Uint8Array(fs.readFileSync(new URL("../../../Systems/MS-DOS%206.22/extracted/TREE.COM", import.meta.url))));
  m.run(5000000);
  assert.ok(m.cpu.exited, "TREE.COM deve sair via INT 21h/4C");
  assert.match(m.state.stdout, /Directory PATH listing/);
  console.log("ok 8 - TREE.COM lista C::", JSON.stringify(m.state.stdout.split("\r\n").slice(0, 3).join(" | ")));
}

// 9. EXEC: pai .COM executa filho .COM (retorna 7), volta e continua
{
  const m = new Machine();
  const child = [
    0xb4, 0x09, 0xba, 0x0c, 0x01, 0xcd, 0x21, // AH=09 DX=010C
    0xb8, 0x07, 0x4c, 0xcd, 0x21,             // AX=4C07
    ...[...Buffer.from("FILHO$", "ascii")],
  ];
  m.mountFile("FILHO.COM", Uint8Array.from(child));
  const P = {
    parm: 0x200, tail: 0x220, path: 0x240, ok: 0x250, fail: 0x13c,
  };
  const parent = [
    0xc7, 0x06, 0x00, 0x02, 0x00, 0x00,       // [0200]=0 env
    0xc7, 0x06, 0x02, 0x02, 0x20, 0x02,       // [0202]=0220 tail
    0x8c, 0x1e, 0x04, 0x02,                   // [0204]=DS
    0xc6, 0x06, 0x20, 0x02, 0x00,             // tail len=0
    0xc6, 0x06, 0x21, 0x02, 0x0d,             // tail CR
    0xb8, 0x00, 0x4b,                         // AX=4B00
    0xba, 0x40, 0x02,                         // DX=0240 path
    0xbb, 0x00, 0x02,                         // BX=0200 parm
    0x1e, 0x07,                               // PUSH DS; POP ES
    0xcd, 0x21,                               // INT 21
    0x72, 0x11,                               // JC fail
    0x3d, 0x07, 0x00,                         // CMP AX,7
    0x75, 0x0c,                               // JNZ fail
    0xb4, 0x09, 0xba, 0x50, 0x02, 0xcd, 0x21, // print OK
    0xb8, 0x00, 0x4c, 0xcd, 0x21,             // exit 0
    0xb8, 0x01, 0x4c, 0xcd, 0x21,             // fail: exit 1
  ];
  const prog = new Uint8Array(0x260).fill(0x90);
  prog.set(parent, 0);
  const fname = [...Buffer.from("FILHO.COM\0", "ascii")];
  prog.set(fname, P.path - 0x100);
  prog.set([...Buffer.from("OK$", "ascii")], P.ok - 0x100);
  m.loadCom(prog);
  m.run(5000000);
  assert.ok(m.cpu.exited, "pai deve sair");
  assert.equal(m.cpu.exitCode, 0, "exit 0, stdout=" + JSON.stringify(m.state.stdout));
  assert.match(m.state.stdout, /FILHO/);
  assert.match(m.state.stdout, /OK/);
  console.log("ok 9 - EXEC pai->filho:", JSON.stringify(m.state.stdout));
}

// 10. D1 = shift por 1 (nao por CL!): regressao do checksum do COMMAND.COM
// 0x9D53 >> 1 deve dar 0x4EA9 (SHR CX,1), nao 0 (que seria >>0x53).
{
  const { Memory } = await import("../src/mem.js");
  const { CPU } = await import("../src/cpu.js");
  const mem = new Memory();
  const cpu = new CPU(mem, {});
  cpu.reset(0x1000);
  // MOV CX,9D53h ; SHR CX,1 ; HLT
  const prog = Uint8Array.from([0xb9, 0x53, 0x9d, 0xd1, 0xe9, 0xf4]);
  mem.loadLinear((0x1000 << 4) + 0x100, prog);
  cpu.run(10);
  assert.equal(cpu.cx, 0x4ea9, "SHR CX,1 de 0x9D53 = 0x4EA9, obtido " + cpu.cx.toString(16));
  console.log("ok 10 - D1 conta 1:", "CX=0x" + cpu.cx.toString(16));
}

// 11. CMPSB compara [SI] com [DI] (nao AL!): regressao do dispatch interno
{
  const { Memory } = await import("../src/mem.js");
  const { CPU } = await import("../src/cpu.js");
  const mem = new Memory();
  const cpu = new CPU(mem, {});
  cpu.reset(0x1000);
  // DS:SI="VER" em 0200, ES:DI="VER" em 0300; REPE CMPSB x3
  for (let i = 0; i < 3; i++) { mem.write8(0x1000, 0x200 + i, "VER".charCodeAt(i)); mem.write8(0x1000, 0x300 + i, "VER".charCodeAt(i)); }
  cpu.ds = 0x1000; cpu.es = 0x1000; cpu.si = 0x200; cpu.di = 0x300;
  cpu.cx = 3; cpu.al = 0x02; // AL diferente de proposito: nao pode influenciar
  // F3 A6 ; HLT
  mem.write8(0x1000, 0x100, 0xf3); mem.write8(0x1000, 0x101, 0xa6); mem.write8(0x1000, 0x102, 0xf4);
  cpu.run(10);
  assert.equal(cpu.cx, 0, "REPE CMPSB deve zerar CX ao casar 3 bytes");
  assert.equal(cpu.zf, 1, "ZF=1 ao final do match");
  assert.equal(cpu.al, 0x02, "AL intocado pelo CMPSB");
  console.log("ok 11 - CMPSB [SI] vs [DI], CX=0 ZF=1");
}

// 12. FINDFIRST "*" casa tudo (inclusive COM extensao) + lastError=18 no fim
{
  const { Memory } = await import("../src/mem.js");
  const { CPU } = await import("../src/cpu.js");
  const { Video } = await import("../src/video.js");
  const { handleInterrupt } = await import("../src/dos.js");
  const mem = new Memory(), video = new Video();
  const state = { stdout: "", keys: [], inputLine: [], intLog: [], lastExit: 0, fs: new Map(), handles: new Map(), nextHandle: 5, dtaSeg: 0x1000, dtaOff: 0x80, psp: 0x1000 };
  const cpu = new CPU(mem, { int: (n, c) => handleInterrupt(n, c, mem, video, state) });
  state.fs.set("A.TXT", new Uint8Array([1, 2, 3]));
  state.fs.set("B.COM", new Uint8Array([4, 5]));
  state.fs.set("LEIAME", new Uint8Array([6]));
  const spec = (s, seg = 0x1000, off = 0x200) => {
    for (let i = 0; i < s.length; i++) mem.write8(seg, off + i, s.charCodeAt(i));
    mem.write8(seg, off + s.length, 0);
    cpu.ds = seg; cpu.dx = off;
  };
  const dos = (ah) => { cpu.ah = ah; handleInterrupt(0x21, cpu, mem, video, state); };
  spec("*"); cpu.cx = 0; dos(0x4e);
  assert.equal(cpu.flags & 1, 0, "FINDFIRST * deve achar");
  let got = [];
  for (let i = 0; i < 5; i++) {
    let nm = "";
    for (let j = 0; j < 13; j++) {
      const c = mem.read8(state.dtaSeg, (state.dtaOff + 0x1e + j) & 0xffff);
      if (!c) break;
      nm += String.fromCharCode(c);
    }
    got.push(nm);
    cpu.ax = 0; dos(0x4f);
    if (cpu.flags & 1) break;
  }
  assert.deepEqual(got, ["A.TXT", "B.COM", "LEIAME"]);
  assert.equal(state.lastError, 18, "fim da busca marca lastError=18");
  // "????????" (forma FCB do *) casa nomes curtos via padding
  spec("????????"); cpu.cx = 0; dos(0x4e);
  assert.equal(cpu.flags & 1, 0, "???????? deve achar A.TXT");
  console.log("ok 12 - FINDFIRST * acha tudo:", JSON.stringify(got));
}

// 13. DIR completo no COMMAND.COM real: 43 arquivos, tamanhos certos, totais, EXIT limpo
{
  const fs = await import("node:fs");
  const m = new Machine();
  for (const f of fs.readdirSync(new URL("../../../Systems/MS-DOS%206.22/extracted/", import.meta.url)).map(String)) {
    const p = new URL("../../../Systems/MS-DOS%206.22/extracted/" + f, import.meta.url);
    m.mountFile(f, new Uint8Array(fs.readFileSync(p)));
  }
  m.loadFile(new Uint8Array(fs.readFileSync(new URL("../../../Systems/MS-DOS%206.22/extracted/COMMAND.COM", import.meta.url))));
  m.pushInputLine("DIR");
  m.pushInputLine("EXIT");
  m.run(120000000);
  assert.ok(m.cpu.exited, "shell deve sair via EXIT");
  assert.match(m.state.stdout, /Directory of C:/);
  assert.match(m.state.stdout, /ATTRIB +EXE +11,208/);
  assert.match(m.state.stdout, /COMMAND +COM +54,645/);
  assert.match(m.state.stdout, /XCOPY +EXE +16,930/);
  assert.match(m.state.stdout, /43 file\(s\)/);
  console.log("ok 13 - DIR: 43 arquivos, tamanhos certos, EXIT limpo");
}

// 14. REGRESSAO: programa externo DENTRO de um .BAT nao pode quebrar o lote.
// O COMMAND.COM guarda DS:SI devolvido por INT 21h/AH=63h (tabela DBCS) e usa
// essa tabela p/ classificar caracteres no parser. Se AH=63h falha, ele guarda
// lixo (ex.: 1000:0081, dentro do PSP) e o parser varre ~64K de memoria, o lote
// re-le a mesma linha para sempre. Aqui: o lote tem que continuar depois do EXEC.
{
  const fs = await import("node:fs");
  const m = new Machine();
  for (const f of fs.readdirSync(new URL("../../../Systems/MS-DOS%206.22/extracted/", import.meta.url)).map(String)) {
    m.mountFile(f, new Uint8Array(fs.readFileSync(new URL("../../../Systems/MS-DOS%206.22/extracted/" + f, import.meta.url))));
  }
  m.mountFile("AUTOEXEC.BAT", new Uint8Array(0)); // isola o boot
  m.mountFile("T2.BAT", new Uint8Array(Buffer.from("@echo off\r\nTREE.COM\r\necho FIM\r\n", "latin1")));
  m.loadCom(new Uint8Array(fs.readFileSync(new URL("../../../Systems/MS-DOS%206.22/extracted/COMMAND.COM", import.meta.url))));
  m.pushInputLine("T2.BAT");
  m.pushInputLine("EXIT");
  m.run(40000000);
  assert.ok(m.cpu.exited, "lote com EXEC interno deve terminar e sair via EXIT");
  assert.match(m.state.stdout, /Directory PATH listing/, "TREE.COM (EXEC dentro do .BAT) deve rodar");
  assert.match(m.state.stdout, /FIM/, "linha seguinte do .BAT deve ser executada");
  console.log("ok 14 - EXEC dentro de .BAT: lote continua (TREE + echo FIM)");
}

// 15. INT 21h/AH=63h devolve ponteiro utilizavel p/ a tabela de lead bytes DBCS
// (code page SBCS => tabela vazia: so o terminador 0x0000).
{
  const { Memory } = await import("../src/mem.js");
  const { CPU } = await import("../src/cpu.js");
  const { Video } = await import("../src/video.js");
  const { handleInterrupt } = await import("../src/dos.js");
  const mem = new Memory(), video = new Video();
  const state = { stdout: "", keys: [], inputLine: [], intLog: [], lastExit: 0, fs: new Map(), handles: new Map(), nextHandle: 5 };
  const cpu = new CPU(mem, { int: (n, c) => handleInterrupt(n, c, mem, video, state) });
  cpu.ah = 0x63; cpu.al = 0x00; cpu.ds = 0x1111; cpu.si = 0x2222;
  handleInterrupt(0x21, cpu, mem, video, state);
  assert.equal(cpu.flags & 1, 0, "AH=63h AL=00h deve ter sucesso (CF=0)");
  assert.notEqual(cpu.ds, 0x1111, "DS deve apontar p/ a tabela (nao preservar lixo)");
  assert.equal(mem.read8(cpu.ds, cpu.si), 0x00, "primeiro byte da tabela SBCS = 0");
  assert.equal(mem.read8(cpu.ds, (cpu.si + 1) & 0xffff), 0x00, "terminador 0x0000");
  console.log("ok 15 - INT 21h/AH=63h: tabela DBCS vazia em " + cpu.ds.toString(16) + ":" + cpu.si.toString(16));
}

// 16. DIR com nome/curinga passa a filtrar. O COMMAND.COM reconstroi o FCB de
// busca via INT 21h/AH=29h (AL=0x0E) logo antes de listar (a busca do volume
// tinha trocado o nome por ????????.???). Se AH=29h tratar os bits 2/3 de AL
// como "nunca gravar", o FCB fica "*.*" e o DIR lista a raiz inteira.
{
  const fs = await import("node:fs");
  const m = new Machine();
  for (const f of fs.readdirSync(new URL("../../../Systems/MS-DOS%206.22/extracted/", import.meta.url)).map(String)) {
    m.mountFile(f, new Uint8Array(fs.readFileSync(new URL("../../../Systems/MS-DOS%206.22/extracted/" + f, import.meta.url))));
  }
  m.mountFile("AUTOEXEC.BAT", new Uint8Array(0));
  m.loadCom(new Uint8Array(fs.readFileSync(new URL("../../../Systems/MS-DOS%206.22/extracted/COMMAND.COM", import.meta.url))));
  m.pushInputLine("DIR COMMAND.COM");
  m.pushInputLine("DIR *.BAT");
  m.pushInputLine("DIR NOPE.TXT");
  m.pushInputLine("EXIT");
  m.run(120000000);
  assert.ok(m.cpu.exited, "shell deve sair via EXIT");
  const out = m.state.stdout;
  assert.match(out, /COMMAND +COM +54,645/, "DIR COMMAND.COM deve listar o arquivo");
  assert.match(out, /1 file\(s\) +54,645 bytes/, "DIR COMMAND.COM deve dar o total de 1 arquivo");
  assert.match(out, /2 file\(s\) +34 bytes/, "DIR *.BAT deve listar os 2 .BAT (0+34 bytes)");
  assert.match(out, /File not found/, "DIR NOPE.TXT deve dizer File not found");
  assert.ok(!out.includes("XCOPY"), "DIR filtrado nao pode listar a raiz inteira");
  assert.ok(!out.includes("43 file(s)"), "nenhum DIR filtrado deve listar 43 arquivos");
  console.log("ok 16 - DIR filtra por nome/curinga (1 file(s) / 2 file(s) / File not found)");
}

// 17. INT 21h/AH=29h: bits 2/3 de AL = "nao altera nome/extensao A MENOS QUE o
// texto especifique um" (regra do DOS: "not changed unless specified"). O
// COMMAND.COM usa AL=0x0E com o texto do argumento para remontar o FCB.
{
  const { Memory } = await import("../src/mem.js");
  const { CPU } = await import("../src/cpu.js");
  const { Video } = await import("../src/video.js");
  const { handleInterrupt } = await import("../src/dos.js");
  const mem = new Memory(), video = new Video();
  const state = { stdout: "", keys: [], inputLine: [], intLog: [], lastExit: 0, fs: new Map(), handles: new Map(), nextHandle: 5 };
  const cpu = new CPU(mem, { int: (n, c) => handleInterrupt(n, c, mem, video, state) });
  const fcbFill = () => {
    for (let i = 0; i < 8; i++) mem.write8(0x1000, 0x301 + i, 0x3f);
    for (let i = 0; i < 3; i++) mem.write8(0x1000, 0x309 + i, 0x3f);
  };
  const parse = (text) => {
    for (let i = 0; i < text.length; i++) mem.write8(0x1000, 0x200 + i, text.charCodeAt(i));
    mem.write8(0x1000, 0x200 + text.length, 0);
    cpu.ds = 0x1000; cpu.si = 0x200; cpu.es = 0x1000; cpu.di = 0x300; cpu.ah = 0x29; cpu.al = 0x0e;
  };
  const field = (off, len) => { let s = ""; for (let i = 0; i < len; i++) s += String.fromCharCode(mem.read8(0x1000, off + i)); return s; };
  fcbFill(); parse("COMMAND.COM");
  handleInterrupt(0x21, cpu, mem, video, state);
  assert.equal(cpu.flags & 1, 0, "AH=29h deve ter sucesso");
  assert.equal(field(0x301, 8).replace(/ +$/, "") + "." + field(0x309, 3), "COMMAND.COM", "AL=0x0E grava nome+extensao presentes no texto");
  assert.equal(cpu.al, 0x00, "AL=00 = sem curingas");
  parse("*.EXE");
  handleInterrupt(0x21, cpu, mem, video, state);
  assert.equal(field(0x301, 8), "????????", "curinga vira '?' no FCB");
  assert.equal(cpu.al, 0x01, "AL=01 = com curingas");
  fcbFill(); parse("COMMAND"); // sem extensao no texto
  handleInterrupt(0x21, cpu, mem, video, state);
  assert.equal(field(0x301, 8), "COMMAND ", "nome do texto e gravado");
  assert.equal(field(0x309, 3), "???", "extensao ausente NAO e apagada (bit 3 de AL)");
  console.log("ok 17 - AH=29h: bits 2/3 = 'nao altera a menos que especificado'");
}

// 18. DIR de subdiretorio: o COMMAND.COM entra no diretorio (AH=3Bh) para
// listar e volta em seguida. O diretorio atual tem que voltar ao original (e o
// prompt tambem), como no DOS real.
{
  const fs = await import("node:fs");
  const m = new Machine();
  for (const f of fs.readdirSync(new URL("../../../Systems/MS-DOS%206.22/extracted/", import.meta.url)).map(String)) {
    m.mountFile(f, new Uint8Array(fs.readFileSync(new URL("../../../Systems/MS-DOS%206.22/extracted/" + f, import.meta.url))));
  }
  m.mountFile("AUTOEXEC.BAT", new Uint8Array(0));
  m.loadCom(new Uint8Array(fs.readFileSync(new URL("../../../Systems/MS-DOS%206.22/extracted/COMMAND.COM", import.meta.url))));
  m.pushInputLine("MD SUB");
  m.pushInputLine("DIR SUB");
  m.pushInputLine("EXIT");
  m.run(120000000);
  assert.ok(m.cpu.exited);
  assert.match(m.state.stdout, /Directory of C:\\SUB/);
  assert.equal(m.state.cwd, "", "DIR <dir> deve restaurar o diretorio atual");
  assert.ok(!/C:\\SUB>[^\n]*EXIT/.test(m.state.stdout), "prompt nao pode ficar em C:\\SUB");
  console.log("ok 18 - DIR <subdir> lista e restaura o diretorio atual");
}

// 19. INT 21h/AH=3Eh em handles reservados (0-4 = CON/AUX/PRN) deve dar certo:
// o COMMAND.COM fecha 1/2 ao redirecionar e um erro 6 quebra a linha.
{
  const { Memory } = await import("../src/mem.js");
  const { CPU } = await import("../src/cpu.js");
  const { Video } = await import("../src/video.js");
  const { handleInterrupt } = await import("../src/dos.js");
  const mem = new Memory(), video = new Video();
  const state = { stdout: "", keys: [], inputLine: [], intLog: [], lastExit: 0, fs: new Map(), handles: new Map(), nextHandle: 5 };
  const cpu = new CPU(mem, { int: (n, c) => handleInterrupt(n, c, mem, video, state) });
  cpu.ah = 0x3e; cpu.bx = 1;
  handleInterrupt(0x21, cpu, mem, video, state);
  assert.equal(cpu.flags & 1, 0, "fechar handle 1 (CON) deve ter sucesso");
  cpu.ah = 0x3e; cpu.bx = 4;
  handleInterrupt(0x21, cpu, mem, video, state);
  assert.equal(cpu.flags & 1, 0, "fechar handle 4 (PRN) deve ter sucesso");
  cpu.ah = 0x3e; cpu.bx = 7;
  handleInterrupt(0x21, cpu, mem, video, state);
  assert.equal(cpu.flags & 1, 1, "fechar handle inexistente deve falhar (erro 6)");
  assert.equal(cpu.ax & 0xff, 6);
  console.log("ok 19 - AH=3Eh: handles 0-4 fecham, handle invalido da erro 6");
}

// ---------------------------------------------------------------------------
// Sonda/montagem: maquina com TODOS os arquivos extraidos + disco virtual.
// O disco FAT16 sintetico so' existe depois de loadCom (buildDosData).
async function machineWithFiles() {
  const fs = await import("node:fs");
  const m = new Machine();
  for (const f of fs.readdirSync(new URL("../../../Systems/MS-DOS%206.22/extracted/", import.meta.url)).map(String)) {
    m.mountFile(f, new Uint8Array(fs.readFileSync(new URL("../../../Systems/MS-DOS%206.22/extracted/" + f, import.meta.url))));
  }
  m.mountFile("AUTOEXEC.BAT", new Uint8Array(0)); // isola o boot
  m.loadCom(new Uint8Array(fs.readFileSync(new URL("../../../Systems/MS-DOS%206.22/extracted/COMMAND.COM", import.meta.url))));
  return m;
}

// 20. INT 25h: leitura absoluta de setor (bloco de parametros do DOS 4+,
// CX=FFFFh). O CHKDSK/SCANDISK/FORMAT leem o setor de boot, a FAT e o
// diretorio raiz por aqui. Convencao da pilha: devolve CF e empilha 1 word
// (o chamador faz `pop dx` logo depois).
{
  const { handleInterrupt } = await import("../src/dos.js");
  const m = await machineWithFiles();
  const cpu = m.cpu, mem = m.mem, d = m.state.disk;
  const blk = (0x1000 << 4) + 0x200;
  const w = (o, v) => { mem.buf[blk + o] = v & 0xff; mem.buf[blk + o + 1] = (v >> 8) & 0xff; };
  const call = () => { cpu.ss = 0x1000; cpu.sp = 0x700; handleInterrupt(0x25, cpu, mem, m.video, m.state); };
  w(0, 0); w(2, 0); w(4, 1); w(6, 0x0500); w(8, 0x2000); // setor 0, 1 setor, 2000:0500
  cpu.ds = 0x1000; cpu.bx = 0x200; cpu.cx = 0xffff; cpu.al = 0x02;
  call();
  assert.equal(cpu.flags & 1, 0, "INT 25h deve ter sucesso");
  assert.equal(cpu.sp, 0x700 - 2, "INT 25h empilha os flags (o chamador faz pop)");
  const sec = d.readSector(0);
  let same = true;
  for (let i = 0; i < 512; i++) if (mem.read8(0x2000, 0x500 + i) !== sec[i]) { same = false; break; }
  assert.ok(same, "o buffer recebe o setor de boot identico ao do disco");
  assert.equal(mem.read8(0x2000, 0x500 + 0x1fe), 0x55);
  assert.equal(mem.read8(0x2000, 0x500 + 0x1ff), 0xaa);
  assert.equal(mem.read8(0x2000, 0x500 + 0x26), 0x29, "assinatura estendida do BPB (29h)");
  // a FAT inteira (126 setores) tambem vem por aqui
  w(0, 1); w(2, 0); w(4, 126); w(6, 0x0000); w(8, 0x3000);
  cpu.cx = 0xffff; cpu.al = 0x02;
  call();
  assert.equal(mem.read8(0x3000, 0), 0xf8, "1a entrada da FAT: media 0xFFF8");
  assert.equal(mem.read8(0x3000, 1), 0xff);
  cpu.al = 0x09; // unidade inexistente
  call();
  assert.equal(cpu.flags & 1, 1, "unidade invalida deve falhar (CF=1)");
  console.log("ok 20 - INT 25h le setor de boot + FAT pelo bloco de parametros");
}

// 21. O volume em disco, o DPB e o AH=36h tem de contar a MESMA historia
// (senao o DIR, o CHKDSK e o "Total" divergem).
{
  const { handleInterrupt } = await import("../src/dos.js");
  const m = await machineWithFiles();
  const cpu = m.cpu, mem = m.mem, d = m.state.disk;
  const dos = (ah) => { cpu.ah = ah; handleInterrupt(0x21, cpu, mem, m.video, m.state); };
  cpu.dl = 2; dos(0x36);
  assert.equal(cpu.ax, d.sectorsPerCluster, "AH=36h: AX = setores/cluster");
  assert.equal(cpu.cx, d.bytesPerSector, "AH=36h: CX = bytes/setor");
  assert.equal(cpu.dx, d.totalClusters, "AH=36h: DX = clusters totais");
  assert.equal(cpu.bx, d.freeClusters, "AH=36h: BX = clusters livres");
  cpu.dl = 2; dos(0x32); // GET DPB
  assert.equal(cpu.al, 0x00, "AH=32h: AL=0 (unidade valida)");
  const dpb = (cpu.ds << 4) + cpu.bx;
  const rw = (o) => mem.buf[dpb + o] | (mem.buf[dpb + o + 1] << 8);
  assert.equal(rw(0x02), 512, "DPB: bytes/setor");
  assert.equal(mem.buf[dpb + 0x04] + 1, d.sectorsPerCluster, "DPB: setores/cluster - 1");
  assert.equal(rw(0x1f), d.freeClusters, "DPB: clusters livres casa com o AH=36h");
  assert.equal(rw(0x0d), d.totalClusters + 2, "DPB: maior cluster + 1 = totais + 2");
  console.log("ok 21 - AH=36h / DPB / volume em disco coerentes (" + d.totalClusters + " clusters, " + d.freeClusters + " livres)");
}

// 22. AH=11h (FIND FIRST por FCB): o DTA recebe a UNIDADE + a ENTRADA DE
// DIRETORIO de 32 bytes (RBIL #01352). O CHKDSK le o cluster inicial em
// DTA+1Ah para validar a cadeia — sem isso ele acusa "First allocation unit
// is invalid, entry truncated" em todos os arquivos.
{
  const { handleInterrupt } = await import("../src/dos.js");
  const m = await machineWithFiles();
  const cpu = m.cpu, mem = m.mem, d = m.state.disk, state = m.state;
  mem.write8(0x1000, 0x300, 0x00); // FCB normal (sem FF): unidade padrao
  const nm = "CHKDSK     EXE";
  for (let i = 0; i < 11; i++) mem.write8(0x1000, 0x301 + i, nm.charCodeAt(i));
  state.dtaSeg = 0x1000; state.dtaOff = 0x400;
  cpu.ds = 0x1000; cpu.dx = 0x300; cpu.ah = 0x11;
  handleInterrupt(0x21, cpu, mem, m.video, state);
  assert.equal(cpu.al, 0x00, "FIND FIRST deve achar CHKDSK.EXE");
  const txt = (o, n) => { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(mem.read8(0x1000, 0x400 + o + i)); return s; };
  assert.equal(txt(1, 8), "CHKDSK  ", "nome em DTA+01h");
  assert.equal(txt(9, 3), "EXE", "extensao em DTA+09h");
  assert.equal(mem.read8(0x1000, 0x400 + 0x0c), 0x20, "atributo em DTA+0Ch");
  const cl = mem.read8(0x1000, 0x400 + 0x1b) | (mem.read8(0x1000, 0x400 + 0x1c) << 8);
  assert.equal(cl, d.clusterOf("CHKDSK.EXE"), "cluster inicial em DTA+1Bh");
  const sz = (mem.read8(0x1000, 0x400 + 0x1d) | (mem.read8(0x1000, 0x400 + 0x1e) << 8) |
              (mem.read8(0x1000, 0x400 + 0x1f) << 16) | (mem.read8(0x1000, 0x400 + 0x20) << 24)) >>> 0;
  assert.equal(sz, state.fs.get("CHKDSK.EXE").length, "tamanho (dword) em DTA+1Dh");
  console.log("ok 22 - AH=11h: DTA = unidade + entrada de diretorio (cluster em +1Ah)");
}

// 23. AH=69h AL=0 (numero de serie / rotulo): o COMMAND usa para o cabecalho
// do DIR ("Volume in drive C is ... / Volume Serial Number is ...").
{
  const { handleInterrupt } = await import("../src/dos.js");
  const m = await machineWithFiles();
  const cpu = m.cpu, mem = m.mem, d = m.state.disk;
  cpu.ah = 0x69; cpu.al = 0x00; cpu.bx = 0x0000; cpu.ds = 0x1000; cpu.dx = 0x600;
  handleInterrupt(0x21, cpu, mem, m.video, m.state);
  assert.equal(cpu.al, 0x00, "AH=69h AL=0 deve ter sucesso");
  const b = (0x1000 << 4) + 0x600;
  const txt = (o, n) => { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(mem.buf[b + o + i]); return s; };
  assert.equal(mem.buf[b] | (mem.buf[b + 1] << 8), 0, "nivel de informacao = 0");
  const ser = (mem.buf[b + 2] | (mem.buf[b + 3] << 8) | (mem.buf[b + 4] << 16) | (mem.buf[b + 5] << 24)) >>> 0;
  assert.equal(ser, d.serial >>> 0, "serie = a do setor de boot");
  assert.equal(txt(0x06, 11), "REDOS      ", "rotulo (11 bytes, preenchido com espacos)");
  assert.equal(txt(0x11, 8), "FAT16   ", "tipo do sistema de arquivos");
  console.log("ok 23 - AH=69h devolve serie/rotulo/FAT16 do volume");
}

// 24. AH=2Bh/2Dh: ajuste de data/hora + a sonda do DESQview que o CHKDSK faz
// no startup (AX=2B01h com CX='DE' e DX='SQ'; AL=FF = instalado).
{
  const { handleInterrupt } = await import("../src/dos.js");
  const m = await machineWithFiles();
  const cpu = m.cpu;
  const dos = (ah) => { cpu.ah = ah; handleInterrupt(0x21, cpu, m.mem, m.video, m.state); };
  cpu.al = 0x01; cpu.cx = 0x4445; cpu.dx = 0x5351; dos(0x2b);
  assert.notEqual(cpu.al, 0xff, "sonda DESQview = 'nao instalado'");
  cpu.al = 0x00; cpu.cx = 0x07ea; cpu.dx = 0x0a0e; dos(0x2b);
  assert.equal(cpu.al, 0x00, "AH=2Bh AL=0 aceita a data");
  cpu.al = 0x00; cpu.cx = 0x0c00; cpu.dx = 0x0000; dos(0x2d);
  assert.equal(cpu.al, 0x00, "AH=2Dh aceita a hora");
  console.log("ok 24 - AH=2Bh/2Dh: sonda DESQview + ajuste de data/hora");
}

// 25. AH=44h AL=8/9: removivel? e remoto? Sao o que o CHKDSK/FORMAT usam
// para decidir se ha midia na unidade (se C: dissesse "removivel", ele
// abortava com "Invalid media type").
{
  const { handleInterrupt } = await import("../src/dos.js");
  const m = await machineWithFiles();
  const cpu = m.cpu;
  const ioctl = (al, bl) => { cpu.ah = 0x44; cpu.al = al; cpu.bx = bl; handleInterrupt(0x21, cpu, m.mem, m.video, m.state); };
  ioctl(0x08, 0x01); assert.equal(cpu.ax, 0, "A: e' removivel (AX=0)");
  ioctl(0x08, 0x02); assert.equal(cpu.ax, 0, "B: e' removivel (AX=0)");
  ioctl(0x08, 0x03); assert.equal(cpu.ax, 1, "C: e' fixo (AX=1)");
  ioctl(0x09, 0x03);
  assert.equal(cpu.flags & 1, 0, "C: deve responder ao AL=9");
  assert.equal(cpu.dx & 0x1000, 0, "bit 12 = 0: drive local (nao remoto)");
  ioctl(0x09, 0x09);
  assert.equal(cpu.flags & 1, 1, "unidade inexistente no AL=9 deve falhar");
  console.log("ok 25 - AH=44h AL=8/9: C: fixo e local, A:/B: removiveis");
}

// 26. AH=68h COMMIT FILE (fflush): o CHKDSK chama antes de ler a FAT.
{
  const { handleInterrupt } = await import("../src/dos.js");
  const m = await machineWithFiles();
  const cpu = m.cpu;
  const commit = (bx) => { cpu.ah = 0x68; cpu.bx = bx; handleInterrupt(0x21, cpu, m.mem, m.video, m.state); };
  commit(0x0000); assert.equal(cpu.flags & 1, 0, "handle 0 (CON) descarrega sem erro");
  commit(0x0009); assert.equal(cpu.flags & 1, 1, "handle invalido deve falhar");
  assert.equal(cpu.ax & 0xff, 6, "erro 6 (handle invalido)");
  console.log("ok 26 - AH=68h commit file: handle valido ok, invalido = erro 6");
}

// 27. Interrupcoes de BIOS desconhecidas nao podem derrubar a maquina: o
// MOUSE.COM usa INT 16h/AH=6Fh, o SETVER/MSCDEX sondam INT 2Fh, etc.
{
  const { Memory } = await import("../src/mem.js");
  const { CPU } = await import("../src/cpu.js");
  const { Video } = await import("../src/video.js");
  const { handleInterrupt } = await import("../src/dos.js");
  const mem = new Memory(), video = new Video();
  const state = { stdout: "", keys: [], inputLine: [], intLog: [], lastExit: 0, fs: new Map(), handles: new Map(), nextHandle: 5 };
  const cpu = new CPU(mem, { int: (n, c) => handleInterrupt(n, c, mem, video, state) });
  cpu.ax = 0x9900; handleInterrupt(0x15, cpu, mem, video, state);
  assert.equal(cpu.flags & 1, 1, "INT 15h desconhecido -> CF=1");
  cpu.flags &= ~1; cpu.ax = 0x6f00; cpu.bx = 0;
  handleInterrupt(0x16, cpu, mem, video, state);
  assert.equal(cpu.zf, 1, "INT 16h desconhecido (6Fh do MOUSE) -> ZF=1 (sem tecla)");
  cpu.flags &= ~1; cpu.ah = 0x99;
  handleInterrupt(0x1a, cpu, mem, video, state);
  assert.equal(cpu.flags & 1, 1, "INT 1Ah desconhecido -> CF=1");
  cpu.flags &= ~1; cpu.ax = 0x1234;
  handleInterrupt(0x77, cpu, mem, video, state); // numero de INT desconhecido
  assert.equal(cpu.ax, 0x1234, "INT desconhecido volta sem alterar os registradores");
  console.log("ok 27 - BIOS/INTs desconhecidos degradam com elegancia (CF/ZF)");
}

// 28. AH=52h (lista de listas) + cadeia de MCBs: o MEM/CHKDSK leem a memoria
// por aqui. O primeiro MCB fica em DOS_SEG (0070h, como no DOS 6.22 real) e
// tem de comecar com 'M' e pertencer ao DOS (owner 8).
{
  const { handleInterrupt } = await import("../src/dos.js");
  const m = await machineWithFiles();
  const cpu = m.cpu, mem = m.mem, state = m.state;
  cpu.ah = 0x52;
  handleInterrupt(0x21, cpu, mem, m.video, state);
  assert.equal(cpu.es, state.dosSeg, "ES = segmento de dados do DOS");
  assert.equal(cpu.bx, state.lolOff, "BX = offset da lista de listas");
  const mcb = mem.read16(cpu.es, (cpu.bx - 2) & 0xffff);
  assert.equal(mcb, state.dosSeg, "LoL-2 = segmento do 1o MCB (= DOS_SEG)");
  assert.equal(mem.read8(mcb, 0x00), 0x4d, "o 1o MCB comeca com 'M'");
  assert.equal(mem.read16(mcb, 0x01), 0x0008, "MCB do proprio DOS (owner 8)");
  assert.ok(mem.read16(mcb, 0x03) > 0, "MCB com tamanho > 0");
  console.log("ok 28 - AH=52h/LoL/MCB: DOS_SEG=" + mcb.toString(16) + " com 'M' e owner 8");
}

// 29. Busca do ROTULO DE VOLUME (FCB estendido, atributo 08h): e' o que o DIR
// e o CHKDSK usam para imprimir "Volume in drive C is ...". Tem de devolver a
// entrada do rotulo em DTA+8 (cabecalho estendido + unidade + entrada) e
// depois dizer "acabou" para o FIND NEXT.
{
  const { handleInterrupt } = await import("../src/dos.js");
  const m = await machineWithFiles();
  const cpu = m.cpu, mem = m.mem, state = m.state;
  mem.write8(0x1000, 0x300, 0xff); // FCB estendido
  for (let i = 1; i <= 5; i++) mem.write8(0x1000, 0x300 + i, 0x00);
  mem.write8(0x1000, 0x306, 0x08); // atributo: volume
  mem.write8(0x1000, 0x307, 0x00); // unidade: padrao
  for (let i = 0; i < 11; i++) mem.write8(0x1000, 0x308 + i, 0x3f); // "????????.???"
  state.dtaSeg = 0x1000; state.dtaOff = 0x400;
  cpu.ds = 0x1000; cpu.dx = 0x300; cpu.ah = 0x11;
  handleInterrupt(0x21, cpu, mem, m.video, state);
  assert.equal(cpu.al, 0x00, "busca do rotulo deve achar");
  assert.equal(mem.read8(0x1000, 0x400 + 0x00), 0xff, "DTA: cabecalho estendido (FFh)");
  assert.equal(mem.read8(0x1000, 0x400 + 0x07), 0x00, "DTA+7: unidade");
  let lbl = "";
  for (let i = 0; i < 8; i++) lbl += String.fromCharCode(mem.read8(0x1000, 0x400 + 0x08 + i));
  assert.equal(lbl, "REDOS   ", "DTA+8: nome do rotulo");
  assert.equal(mem.read8(0x1000, 0x400 + 0x08 + 0x0b), 0x08, "DTA+13h: atributo de volume");
  cpu.ax = 0; cpu.ah = 0x12;
  handleInterrupt(0x21, cpu, mem, m.video, state);
  assert.equal(cpu.al, 0xff, "so' existe 1 rotulo: FIND NEXT = acabou");
  console.log("ok 29 - rotulo de volume pelo FCB estendido (attr 08h)");
}

// 30. CHKDSK.EXE real de ponta a ponta: le o volume por INT 25h, valida a FAT
// contra o diretorio raiz e imprime os totais. Sem erro nenhum.
{
  const m = await machineWithFiles();
  m.pushInputLine("CHKDSK");
  m.pushInputLine("EXIT");
  m.run(6000000);
  assert.ok(m.cpu.exited, "CHKDSK deve rodar e o shell sair via EXIT");
  const out = m.state.stdout;
  assert.match(out, /bytes total disk space/);
  assert.match(out, /43 user files/, "43 arquivos de usuario, nenhum corrompido");
  assert.match(out, /32,247 total allocation units on disk/);
  assert.ok(!/allocation unit is invalid|entry truncated/.test(out), "nenhum erro de alocacao");
  console.log("ok 30 - CHKDSK.EXE: volume consistente (43 arquivos, 32247 unidades)");
}

// 31. Entrada INTERATIVA: cada tecla nao pode fechar a linha. Antes, com a fila
// vazia o DOS "inventava" um Enter, e cada caractere digitado virava um comando
// proprio ("Bad command or file name" a cada tecla).
{
  const { INPUT_WAIT } = await import("../src/dos.js");
  const m = await machineWithFiles();
  m.state.interactive = true;
  const step = () => { try { m.run(4000000); return "fim"; } catch (e) { if (e === INPUT_WAIT) return "espera"; throw e; } };
  assert.equal(step(), "espera", "o boot termina esperando tecla no prompt");
  m.pushKeys("v"); assert.equal(step(), "espera", "1 caractere: ainda esperando");
  assert.match(m.state.stdout, /C:\\>v$/, "o 'v' ecoa na hora (nao espera o Enter)");
  m.pushKeys("e"); assert.equal(step(), "espera", "2 caracteres: ainda esperando");
  m.pushKeys("r"); assert.equal(step(), "espera", "3 caracteres: ainda esperando");
  assert.match(m.state.stdout, /C:\\>ver$/, "cada tecla ecoa na hora");
  m.pushKeys("\b"); assert.equal(step(), "espera", "backspace nao fecha a linha");
  assert.ok(m.state.stdout.endsWith("\b \b"), "backspace apaga o ultimo caractere");
  m.pushKeys("r"); assert.equal(step(), "espera", "segue digitando depois do backspace");
  assert.match(m.state.stdout, /C:\\>ver\x08 \x08r$/, "a linha continua montando certa");
  m.pushKeys("\r"); assert.equal(step(), "espera", "Enter fecha a linha e volta ao prompt");
  assert.match(m.state.stdout, /MS-DOS Version 6\.22/, "a linha roda no Enter");
  assert.ok(!/Bad command or file name/.test(m.state.stdout), "nenhum comando fantasma");
  console.log("ok 31 - entrada interativa: eco por tecla, backspace, e a linha so' fecha no Enter");
}

console.log("reDOS core: 31/31 testes passaram");

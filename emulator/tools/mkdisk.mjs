// Cria uma imagem de disco IDE "em branco" com UMA particao FAT16 bootavel.
//
// So a tabela de particao (dados, sem codigo) e escrita aqui; o resto quem faz
// e o DOS de verdade, rodando dentro do emulador:
//   A:\> format c: /s        (setor de boot, FATs, raiz, IO.SYS/MSDOS.SYS/COMMAND.COM)
//   A:\> xcopy a:\*.* c:\dos\ /s
//
// uso:  node tools/mkdisk.mjs [--mb 16] [--out ../Systems/MS-DOS 6.22/novo.img]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const emu = path.resolve(here, "..");

const argv = process.argv.slice(2);
const arg = (name, def) => (argv.indexOf(name) >= 0 && argv[argv.indexOf(name) + 1] ? argv[argv.indexOf(name) + 1] : def);

const mb = Number(arg("--mb", "16"));
const out = path.resolve(emu, arg("--out", "../Systems/MS-DOS 6.22/novo.img"));
fs.mkdirSync(path.dirname(out), { recursive: true });

// Geometria 16 cabecas x 63 setores (a "padrao" de HD pequeno). Detalhe que
// importa: o v86 DEDUZ a geometria da propria tabela de particao
// (heads = cabeca_final + 1, sectors = setor_final). Entao o disco tem que
// fechar em cilindro inteiro e a particao tem que terminar exatamente em
// cabeca 15 / setor 63 -- senao ele deduz uma geometria torta (11/8, por ex.)
// e o MBR do DOS le a particao no lugar errado.
const HEADS = 16, SPT = 63;
const porCilindro = HEADS * SPT;                   // 1008 setores
const queridos = Math.floor((mb * 1024 * 1024) / 512);
const total = Math.floor(queridos / porCilindro) * porCilindro;
const startLba = SPT;                              // 63 = cilindro 0, cabeca 1, setor 1
const size = total - startLba;                     // termina em (ultimo cilindro, 15, 63)

const buf = Buffer.alloc(total * 512);
const chs = (lba) => {
  const c = Math.floor(lba / (HEADS * SPT));
  const h = Math.floor((lba % (HEADS * SPT)) / SPT);
  const s = (lba % SPT) + 1;
  return [h & 0xff, ((c >> 2) & 0xc0) | (s & 0x3f), c & 0xff];
};

const p = 0x1be;                                   // entrada 1 da tabela de particao
buf[p + 0] = 0x80;                                 // ativa (bootavel)
buf.set(chs(startLba), p + 1);                     // CHS inicial
buf[p + 4] = 0x06;                                 // FAT16
buf.set(chs(startLba + size - 1), p + 5);          // CHS final
buf.writeUInt32LE(startLba, p + 8);                // LBA inicial
buf.writeUInt32LE(size, p + 12);                   // setores
buf[510] = 0x55;
buf[511] = 0xaa;

fs.writeFileSync(out, buf);
console.log(`${out}`);
console.log(`  ${(total * 512 / 1048576).toFixed(2)} MB · geometria ${total / porCilindro} cilindros x ${HEADS} cabecas x ${SPT} setores`);
console.log(`  particao FAT16 ativa: lba ${startLba}..${total - 1} (${size} setores)`);
console.log(`  agora abra /emulator/preparar-disco.html (o DOS formata e instala por cima)`);


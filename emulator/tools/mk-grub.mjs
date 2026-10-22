// mk-grub.mjs — monta o disco de boot do GRUB (grub-hd.img) a partir dos
// arquivos em Systems/GNU GRUB 2.06/grub/: boot.img (setor 0) + core.img
// (a partir do setor 1).
//
// O GRUB oficial para Windows nao instala em arquivo imagem sem elevacao, entao
// fazemos aqui o mesmo que o grub-bios-setup faria: gravamos o boot.img no setor
// 0, o core.img em setores contiguos e preenchemos a blocklist do diskboot.
//
// Rode: npm run grub
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SETOR = 512;

const here = path.dirname(fileURLToPath(import.meta.url));
const emu = path.resolve(here, "..");
const root = path.resolve(emu, "..");
const dir = path.join(root, "Systems", "GNU GRUB 2.06", "grub");
const dst = path.join(root, "Systems", "GNU GRUB 2.06", "grub-hd.img");
fs.mkdirSync(path.dirname(dst), { recursive: true });

// Se o pacote oficial do GRUB estiver presente no TEMP, regera o core.img
// com o grub.cfg atualizado e os módulos necessários.
const tempDir = process.env.TEMP || process.env.TMP;
const gDir = path.join(tempDir, "grub-win", "grub-2.06-for-windows");
const mkStandalone = path.join(gDir, "grub-mkstandalone.exe");
const i386pc = path.join(gDir, "i386-pc");
const cfg = path.join(dir, "grub.cfg");
const corePath = path.join(dir, "core.img");

if (fs.existsSync(mkStandalone) && fs.existsSync(i386pc)) {
  const modules = [
    "biosdisk", "part_msdos", "fat", "chain", "drivemap",
    "normal", "configfile", "echo", "test", "reboot", "iorw"
  ].join(" ");
  console.log("Regenerando core.img com grub-mkstandalone...");
  execFileSync(mkStandalone, [
    "-O", "i386-pc",
    "-o", corePath,
    "-d", i386pc,
    "--compress=no",
    "--locales=",
    "--fonts=",
    "--themes=",
    `--install-modules=${modules}`,
    `--modules=${modules}`,
    `boot/grub/grub.cfg=${cfg}`
  ]);
  console.log(`core.img regenerado com sucesso (${fs.statSync(corePath).size} bytes).`);
}

const HEADS = 16, SPT = 63;
const porCilindro = HEADS * SPT; // 1008 setores
const mbDesejados = 8;
const totalSetores = Math.floor((mbDesejados * 1024 * 1024 / 512) / porCilindro) * porCilindro;

const boot = Buffer.from(fs.readFileSync(path.join(dir, "boot.img")));
const core = Buffer.from(fs.readFileSync(corePath));

if (boot.length !== SETOR) throw new Error(`boot.img tem ${boot.length} bytes (esperado 512)`);
if (core.length < SETOR || core.length + SETOR > totalSetores * SETOR) {
  throw new Error(`core.img tem ${core.length} bytes (nao cabe no disco)`);
}

// boot.img: kernel_sector (64 bits em 0x5c) = 1 (o core comeca no setor 1) e
// boot_drive = 0xff (usa o DL que o BIOS passou; o hda sera 0x80).
boot.writeUInt32LE(1, 0x5c);
boot.writeUInt32LE(0, 0x60);
boot[0x64] = 0xff;

// diskboot (primeiro setor do core.img) carrega o resto do core por blocklist.
const setoresCore = Math.ceil((core.length - SETOR) / SETOR);
core.writeUInt32LE(2, 0x1f4);          // start (LBA 2)
core.writeUInt32LE(0, 0x1f8);          // start alto
core.writeUInt16LE(setoresCore, 0x1fc); // quantidade de setores
core.writeUInt16LE(0x820, 0x1fe);       // segmento de destino (0x800 + 0x20)
core.fill(0, 0x1e8, 0x1f4);             // terminador (len = 0)

const img = Buffer.alloc(totalSetores * SETOR);
boot.copy(img, 0);
core.copy(img, SETOR);
fs.writeFileSync(dst, img);

console.log(`Systems/GNU GRUB 2.06/grub-hd.img  <-  boot.img + core.img`);
console.log(`  ${(img.length / 1024 / 1024).toFixed(1)} MB (${totalSetores} setores), core ${core.length} bytes (${setoresCore} setores)`);

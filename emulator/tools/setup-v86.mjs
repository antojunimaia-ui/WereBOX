// Prepara o motor v86 para uso no navegador:
//   1. copia libv86.js + v86.wasm do pacote npm "v86"        (na pasta emulator/)
//   2. baixa seabios.bin + vgabios.bin (BIOS do PC emulado)  (na pasta emulator/)
//   3. extrai a imagem de boot El Torito da ISO do MS-DOS 6.22
//      -> Systems/MS-DOS 6.22/msdos622.img (disquete 1.44MB real)
//   4. copia a ISO inteira -> Systems/MS-DOS 6.22/dos622.iso (vai como CD-ROM no v86)
//   5. extrai o disquete MS-DOS 3.3 + Windows 1.01 da ISO
//      -> Systems/Windows 1.01/win101.img
//   6. monta o disco de boot do GNU GRUB 2.06
//      -> Systems/GNU GRUB 2.06/grub-hd.img, a partir de Systems/GNU GRUB 2.06/grub/
//
// Rode:  npm run v86   (ou: node tools/setup-v86.mjs)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const emu = path.resolve(here, "..");
const root = path.resolve(emu, "..");
const out = emu;
const sistemas = path.join(root, "Systems");
const pastaDos = path.join(sistemas, "MS-DOS 6.22");
const pastaWin = path.join(sistemas, "Windows 1.01");
const pastaGrub = path.join(sistemas, "GNU GRUB 2.06");
for (const dir of [out, pastaDos, pastaWin, pastaGrub]) fs.mkdirSync(dir, { recursive: true });

const log = (msg) => console.log(msg);
const kb = (n) => (n / 1024).toFixed(1) + " KB";
const primeiroExistente = (...candidatos) => candidatos.find((p) => fs.existsSync(p)) || candidatos[0];
if (!fs.existsSync(path.join(pastaDos, "c.img"))) {
  log("aviso: Systems/MS-DOS 6.22/c.img nao existe — o perfil C: nao vai bootar");
}

/* ------------------------------------------------------------------ 1+2 */
const fromPkg = [
  ["build/libv86.js", "libv86.js"],
  ["build/v86.wasm", "v86.wasm"],
];
for (const [src, dst] of fromPkg) {
  const p = path.join(emu, "node_modules", "v86", src);
  if (!fs.existsSync(p)) throw new Error(`faltou ${p} — rode "npm install" primeiro`);
  fs.copyFileSync(p, path.join(out, dst));
  log(`emulator/${dst}  <-  node_modules/v86/${src}  (${kb(fs.statSync(p).size)})`);
}

const bios = [
  ["seabios.bin", ["https://copy.sh/v86/bios/seabios.bin", "https://raw.githubusercontent.com/copy/v86/master/bios/seabios.bin"]],
  ["vgabios.bin", ["https://copy.sh/v86/bios/vgabios.bin", "https://raw.githubusercontent.com/copy/v86/master/bios/vgabios.bin"]],
];
for (const [name, urls] of bios) {
  const dst = path.join(out, name);
  if (fs.existsSync(dst) && fs.statSync(dst).size > 0) {
    log(`emulator/${name}  já existe (${kb(fs.statSync(dst).size)})`);
    continue;
  }
  let err;
  for (const url of urls) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      // nao servimos um HTML de erro disfarcado de resposta
      if (buf.length < 8192 || buf.subarray(0, 16).toString("latin1").trimStart().startsWith("<")) {
        throw new Error(`conteudo suspeito (${buf.length} bytes)`);
      }
      fs.writeFileSync(dst, buf);
      log(`emulator/${name}  <-  ${url}  (${kb(buf.length)})`);
      err = null;
      break;
    } catch (e) {
      err = e;
    }
  }
  if (err) throw new Error(`nao consegui baixar ${name}: ${err.message}`);
}

/* -------------------------------------------------------------------- 3 */
const isoPath = primeiroExistente(
  path.join(pastaDos, "MS-DOS 6.22.iso"),
  path.join(root, "MS-DOS 6.22.iso"),
);
const iso = fs.readFileSync(isoPath);
const SEC = 2048;

// volume descriptor de boot (type 0, "EL TORITO SPECIFICATION") -> LBA do catalogo
let catalogLba = null;
for (let s = 16; s < 48; s++) {
  const v = iso.subarray(s * SEC, s * SEC + 512);
  if (v.subarray(1, 6).toString("latin1") !== "CD001") break;
  if (v[0] === 0 && v.subarray(7, 7 + 10).toString("latin1") === "EL TORITO ") {
    catalogLba = v.readUInt32LE(0x47);
  }
  if (v[0] === 255) break;
}
if (catalogLba == null) throw new Error("ISO sem catalogo El Torito");

// entrada default do catalogo
const entry = iso.subarray(catalogLba * SEC + 0x20, catalogLba * SEC + 0x40);
const sectors = entry.readUInt16LE(0x06) || 2880; // setores de 512 a carregar (a ISO diz 1; o disquete todo tem 2880)
const lba = entry.readUInt32LE(0x08);

// o disquete inteiro = 1.44MB (2880 setores); o BPB manda mais que a entrada do catalogo
const boot = iso.subarray(lba * SEC, lba * SEC + 512);
const total = boot.readUInt16LE(19) || 2880; // setores totais do BPB
const img = iso.subarray(lba * SEC, lba * SEC + total * 512);
if (img.readUInt16LE(510) !== 0xaa55) throw new Error("imagem de boot sem 55AA");
const msdosDst = path.join(pastaDos, "msdos622.img");
fs.writeFileSync(msdosDst, img);
log(`Systems/MS-DOS 6.22/msdos622.img  <-  ${path.basename(isoPath)}  setor ${lba}, ${total} setores (${kb(img.length)})`);
log(`                 OEM="${boot.subarray(3, 11).toString("latin1")}" rotulo="${boot.subarray(43, 54).toString("latin1").trim()}" fstype="${boot.subarray(54, 62).toString("latin1").trim()}"`);

/* -------------------------------------------------------------------- 4 */
const isoDst = path.join(pastaDos, "dos622.iso");
if (!fs.existsSync(isoDst) || fs.statSync(isoDst).size !== iso.length) {
  fs.copyFileSync(isoPath, isoDst);
  log(`Systems/MS-DOS 6.22/dos622.iso  <-  ${path.basename(isoPath)}  (${kb(iso.length)})`);
} else {
  log(`Systems/MS-DOS 6.22/dos622.iso  já existe (${kb(iso.length)})`);
}

/* -------------------------------------------------------------------- 5 */
// O "Windows 1.01.iso" NAO e' um CD bootavel do Windows: o Windows 1.x roda em
// cima do DOS. Dentro da ISO existem duas imagens de disquete de 1.44 MB com
// MS-DOS 3.3 + Windows 1.01, guardadas fora da arvore ISO9660. A primeira (a
// que roda o WIN no AUTOEXEC.BAT) vira o A: do perfil "Windows 1.01".
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** le um arquivo de uma imagem FAT12 de 1.44 MB (offset do BPB dentro da ISO) */
function lerFAT12(iso, base, cluster, tamanho) {
  const bps = 512, spc = iso[base + 13], res = u16(iso, base + 14);
  const nf = iso[base + 16], spf = u16(iso, base + 22);
  const setoresRaiz = Math.ceil(u16(iso, base + 17) * 32 / bps);
  const inicioDados = base + (res + nf * spf + setoresRaiz) * bps;
  const inicioFAT = base + res * bps;
  const bpc = bps * spc;
  const fat12 = (n) => {
    const o = inicioFAT + n + (n >> 1), w = u16(iso, o);
    return (n & 1) ? (w >> 4) : (w & 0xfff);
  };
  const out = Buffer.alloc(tamanho);
  let escrito = 0, c = cluster;
  while (c >= 2 && escrito < tamanho) {
    const n = Math.min(bpc, tamanho - escrito);
    iso.copy(out, escrito, inicioDados + (c - 2) * bpc, inicioDados + (c - 2) * bpc + n);
    escrito += n;
    const prox = fat12(c);
    if (prox >= 0xff8 || prox === 0) break;
    c = prox;
  }
  return out.toString("latin1");
}

/** procura na ISO a imagem de 1.44 MB que tem WIN.COM e roda o WIN no AUTOEXEC */
function acharDisqueteWindows(iso) {
  const TAM = 1474560, SEC = 512;
  const candidatos = [];
  for (let off = 0; off + TAM <= iso.length; off += SEC) {
    if (iso[off + 510] !== 0x55 || iso[off + 511] !== 0xaa) continue;
    const bps = u16(iso, off + 11), nf = iso[off + 16], er = u16(iso, off + 17);
    const tot = u16(iso, off + 19), spf = u16(iso, off + 22);
    if (bps !== 512 || nf !== 2 || er !== 224 || tot !== 2880 || spf !== 9) continue;
    const raiz = off + (u16(iso, off + 14) + nf * spf) * bps;
    let temWin = false, autoexec = null;
    for (let i = 0; i < er; i++) {
      const o = raiz + i * 32;
      if (!iso[o]) break;
      if (iso[o] === 0xe5 || iso[o + 11] === 0x0f) continue;
      const nome = iso.toString("latin1", o, o + 8).replace(/[\s\0]+$/, "");
      const ext = iso.toString("latin1", o + 8, o + 11).replace(/[\s\0]+$/, "");
      const completo = ext ? `${nome}.${ext}` : nome;
      if (completo === "WIN.COM") temWin = true;
      if (completo === "AUTOEXEC.BAT") autoexec = { cluster: u16(iso, o + 26), tamanho: u32(iso, o + 28) };
    }
    if (!temWin) continue;
    let chamaWin = false;
    if (autoexec) {
      try { chamaWin = /^\s*WIN\b/im.test(lerFAT12(iso, off, autoexec.cluster, autoexec.tamanho)); } catch { /* fica falso */ }
    }
    candidatos.push({ off, chamaWin });
  }
  const escolhido = candidatos.find((c) => c.chamaWin) || candidatos[0];
  return escolhido ? iso.subarray(escolhido.off, escolhido.off + TAM) : null;
}

const winIsoPath = primeiroExistente(
  path.join(pastaWin, "Windows 1.01.iso"),
  path.join(root, "Windows 1.01.iso"),
);
const winDst = path.join(pastaWin, "win101.img");
if (!fs.existsSync(winIsoPath)) {
  log(`Systems/Windows 1.01/win101.img  --  ${path.basename(winIsoPath)} nao encontrada (perfil Windows 1.01 fica sem midia)`);
} else if (fs.existsSync(winDst) && fs.statSync(winDst).size === 1474560) {
  log(`Systems/Windows 1.01/win101.img  já existe (${kb(fs.statSync(winDst).size)})`);
} else {
  const winIso = fs.readFileSync(winIsoPath);
  const disquete = acharDisqueteWindows(winIso);
  if (!disquete) throw new Error("nao achei a imagem de disquete do Windows 1.01 dentro da ISO");
  fs.writeFileSync(winDst, disquete);
  log(`Systems/Windows 1.01/win101.img  <-  ${path.basename(winIsoPath)}  (disquete 1.44 MB: MS-DOS 3.3 + Windows 1.01)`);
}

/* -------------------------------------------------------------------- 6 */
// O GRUB real e' montado de Systems/GNU GRUB 2.06/grub/boot.img + core.img. O
// core ja' traz o menu (grub.cfg) e os modulos embutidos; o script so' grava os setores.
const grubDst = path.join(pastaGrub, "grub-hd.img");
const { spawnSync } = await import("node:child_process");
log("Systems/GNU GRUB 2.06/grub-hd.img  --  montando a partir de Systems/GNU GRUB 2.06/grub/ ...");
const r = spawnSync(process.execPath, [path.join(here, "mk-grub.mjs")], { stdio: "inherit" });
if (r.status !== 0) throw new Error("nao consegui montar grub-hd.img");
log(`Systems/GNU GRUB 2.06/grub-hd.img  (${kb(fs.statSync(grubDst).size)})`);

log("\npronto. sirva a raiz do repo (ex.: python -m http.server 8080) e abra /emulator/");

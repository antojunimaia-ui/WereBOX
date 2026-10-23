// mk-grub.mjs — monta o disco de boot do GRUB (grub-hd.img) a partir dos
// arquivos em Systems/GNU GRUB 2.06/grub/: boot.img (setor 0) + core.img
// (a partir do setor 1).
//
// O GRUB oficial para Windows nao instala em arquivo imagem sem elevacao, entao
// fazemos aqui o mesmo que o grub-bios-setup faria: gravamos o boot.img no setor
// 0, o core.img em setores contiguos e preenchemos a blocklist do diskboot.
//
// O core.img embute o grub.cfg. Quando as ferramentas do GRUB nao estao
// disponiveis, este script so' reutiliza um core.img existente se ele
// corresponder ao grub.cfg/boot.img atuais; caso contrario, aborta em vez de
// gerar um disco com a configuracao antiga.
//
// Rode na raiz do repositorio: node emulator/tools/mk-grub.mjs
// Para aceitar um core.img desatualizado de proposito: --reutilizar-core
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SETOR = 512;
const MODULOS = [
  "biosdisk", "part_msdos", "fat", "chain", "drivemap",
  "normal", "configfile", "echo", "test", "reboot", "iorw"
];
const LISTA_MODULOS = MODULOS.join(" ");
const reutilizarCore = process.argv.slice(2).includes("--reutilizar-core");

const here = path.dirname(fileURLToPath(import.meta.url));
const emu = path.resolve(here, "..");
const root = path.resolve(emu, "..");
const dir = path.join(root, "Systems", "GNU GRUB 2.06", "grub");
const dst = path.join(root, "Systems", "GNU GRUB 2.06", "grub-hd.img");
const cfg = path.join(dir, "grub.cfg");
const bootPath = path.join(dir, "boot.img");
const corePath = path.join(dir, "core.img");
const metaPath = path.join(dir, "core.img.meta.json");
fs.mkdirSync(path.dirname(dst), { recursive: true });

// Se o pacote oficial do GRUB estiver presente no TEMP, regera o core.img
// com o grub.cfg atualizado e os módulos necessários.
const tempDir = process.env.TEMP || process.env.TMP;
const gDir = path.join(tempDir, "grub-win", "grub-2.06-for-windows");
const mkStandalone = path.join(gDir, "grub-mkstandalone.exe");
const i386pc = path.join(gDir, "i386-pc");
const ferramentasGrub = fs.existsSync(mkStandalone) && fs.existsSync(i386pc);

function falhar(mensagem) {
  console.error(`\nerro: ${mensagem}`);
  process.exit(1);
}

function sha256(arquivo) {
  return createHash("sha256").update(fs.readFileSync(arquivo)).digest("hex");
}

function lerMetadados() {
  if (!fs.existsSync(metaPath)) return null;
  let dados;
  try {
    dados = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch {
    console.warn("aviso: core.img.meta.json ilegivel; a correspondencia sera' conferida apenas pela data dos arquivos.");
    return null;
  }
  if (
    typeof dados?.grubCfgSha256 !== "string" ||
    typeof dados?.bootImgSha256 !== "string" ||
    typeof dados?.coreImgSha256 !== "string" ||
    typeof dados?.modulos !== "string"
  ) {
    console.warn("aviso: core.img.meta.json incompleto; a correspondencia sera' conferida apenas pela data dos arquivos.");
    return null;
  }
  return dados;
}

function diferencaDoCore(meta, hashes) {
  if (meta.grubCfgSha256 !== hashes.cfg) return "o grub.cfg mudou depois que o core.img foi gerado";
  if (meta.bootImgSha256 !== hashes.boot) return "o boot.img mudou depois que o core.img foi gerado";
  if (meta.coreImgSha256 !== hashes.core) return "o proprio core.img foi alterado depois de gerado";
  if (meta.modulos !== LISTA_MODULOS) return "a lista de modulos do mk-grub.mjs mudou";
  return null;
}

function instrucoes({ permitirReutilizar = true } = {}) {
  const linhas = [
    "",
    "As ferramentas do GRUB nao foram encontradas em:",
    `  ${gDir}`,
    "",
    "Extraia o GRUB 2.06 for Windows nessa pasta (ou ajuste TEMP/TMP) e rode na raiz do repositorio:",
    "  node emulator/tools/mk-grub.mjs",
  ];
  if (permitirReutilizar) {
    linhas.push(
      "",
      "Para reutilizar o core.img antigo mesmo assim (o disco pode ficar",
      "inconsistente com o grub.cfg atual):",
      "  node emulator/tools/mk-grub.mjs --reutilizar-core"
    );
  }
  linhas.push("");
  return linhas.join("\n");
}

for (const [nome, arquivo] of [["grub.cfg", cfg], ["boot.img", bootPath]]) {
  if (!fs.existsSync(arquivo)) falhar(`${nome} nao encontrado em ${arquivo}.`);
}

if (ferramentasGrub) {
  console.log("Regenerando core.img com grub-mkstandalone...");
  // Gera em um temporario para nao deixar core.img truncado se a ferramenta falhar.
  const coreTmp = `${corePath}.tmp`;
  try {
    execFileSync(mkStandalone, [
      "-O", "i386-pc",
      "-o", coreTmp,
      "-d", i386pc,
      "--compress=no",
      "--locales=",
      "--fonts=",
      "--themes=",
      `--install-modules=${LISTA_MODULOS}`,
      `--modules=${LISTA_MODULOS}`,
      `boot/grub/grub.cfg=${cfg}`
    ]);
    if (!fs.existsSync(coreTmp) || fs.statSync(coreTmp).size <= SETOR) {
      throw new Error("grub-mkstandalone nao gerou um core.img valido");
    }
    fs.renameSync(coreTmp, corePath);
  } catch (erro) {
    try { fs.rmSync(coreTmp, { force: true }); } catch { /* ignora */ }
    const detalhe = String(erro.stderr || erro.message || erro).trim();
    falhar(`grub-mkstandalone falhou; core.img e grub-hd.img NAO foram alterados.\n${detalhe}`);
  }

  // Registra o que foi embutido no core.img para permitir a verificacao
  // quando as ferramentas do GRUB nao estiverem mais disponiveis.
  const meta = {
    geradoEm: new Date().toISOString(),
    geradoPor: "emulator/tools/mk-grub.mjs",
    grubCfgSha256: sha256(cfg),
    bootImgSha256: sha256(bootPath),
    coreImgSha256: sha256(corePath),
    modulos: LISTA_MODULOS
  };
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`core.img regenerado com sucesso (${fs.statSync(corePath).size} bytes).`);
} else {
  if (!fs.existsSync(corePath)) {
    falhar(`core.img nao encontrado em ${corePath}.${instrucoes({ permitirReutilizar: false })}`);
  }

  const hashes = { cfg: sha256(cfg), boot: sha256(bootPath), core: sha256(corePath) };
  const meta = lerMetadados();
  const conferidoPorHash = Boolean(meta);
  let diferenca = meta ? diferencaDoCore(meta, hashes) : null;

  if (!meta) {
    // Sem metadados (core.img gerado antes desta verificacao existir), usa a
    // data como ultimo recurso. Se o grub.cfg for mais novo, aborta.
    if (fs.statSync(cfg).mtimeMs > fs.statSync(corePath).mtimeMs) {
      diferenca = "o grub.cfg e' mais novo que o core.img (sem metadados para confirmar o conteudo)";
    } else {
      console.warn("aviso: sem core.img.meta.json, nao e' possivel confirmar que o core.img embute o grub.cfg atual.");
      console.warn("A correspondencia foi assumida pela data dos arquivos; o disco gerado pode estar desatualizado.");
      console.warn("Rode com as ferramentas do GRUB disponiveis para gerar os metadados de verificacao.");
    }
  }

  if (diferenca) {
    if (!reutilizarCore) {
      falhar(
        `core.img nao corresponde ao grub.cfg atual: ${diferenca}.\n\n` +
        "grub-hd.img NAO foi alterado." +
        instrucoes()
      );
    }
    console.warn(`\naviso: reutilizando core.img desatualizado porque --reutilizar-core foi passado (${diferenca}).`);
    console.warn("O grub-hd.img gerado pode nao refletir o grub.cfg atual.\n");
  } else if (conferidoPorHash) {
    console.log("core.img existente corresponde ao grub.cfg/boot.img atuais (hashes conferem).");
  } else {
    console.log("core.img existente sera' reutilizado sem verificacao por hash.");
  }
}

const HEADS = 16, SPT = 63;
const porCilindro = HEADS * SPT; // 1008 setores
const mbDesejados = 8;
const totalSetores = Math.floor((mbDesejados * 1024 * 1024 / 512) / porCilindro) * porCilindro;

const boot = Buffer.from(fs.readFileSync(bootPath));
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

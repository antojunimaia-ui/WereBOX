// tests/midias.test.mjs — prova que "salvar o disco" grava na imagem do perfil.
//
// O C: muda de arquivo conforme o perfil (c.img, msdos.img, win203.img,
// win311hd.img…). Se o mapeamento errar, salvar o disco pode sobrescrever a
// imagem errada.
//
//   node tests/midias.test.mjs
import { configurarMidias, caminhoDaUnidade, arquivoDaUnidade } from "../ui/midias.mjs";

let ok = 0, falhas = 0;
const check = (cond, msg) => {
  if (cond) { ok++; console.log(`   ok    ${msg}`); }
  else { falhas++; console.log(`   FALHA ${msg}`); }
};
const secao = (t) => console.log(`\n== ${t}`);

const c = (config) => {
  configurarMidias(config);
  return { caminho: caminhoDaUnidade("C"), arquivo: arquivoDaUnidade("C") };
};

secao("C: por perfil");
check(c({ hdb: { url: "../Systems/MS-DOS%206.22/c.img" } }).caminho === "Systems/MS-DOS 6.22/c.img", "GRUB (hdb) -> c.img");
check(c({ hda: { url: "../Systems/MS-DOS%206.22/msdos.img" } }).caminho === "Systems/MS-DOS 6.22/msdos.img", "MS-DOS 6.22 -> msdos.img");
check(c({ hda: { url: "../Systems/MS-DOS%206.22/novo.img" } }).caminho === "Systems/MS-DOS 6.22/novo.img", "bancada -> novo.img");
check(c({ hda: { url: "../Systems/Windows%202.03/win203.img" } }).caminho === "Systems/Windows 2.03/win203.img", "Windows 2.03 -> win203.img");
check(c({ hda: { url: "../Systems/Windows%203.11/win311hd.img" } }).caminho === "Systems/Windows 3.11/win311hd.img", "Windows 3.11 -> win311hd.img");
check(c({ hda: { url: "../Systems/Windows%2095/win95.img" } }).caminho === "Systems/Windows 95/win95.img", "Windows 95 -> win95.img");
check(c({}).caminho === "Systems/MS-DOS 6.22/c.img", "sem perfil cai no c.img (padrao)");

secao("nome do download acompanha o perfil");
check(c({ hda: { url: "../Systems/Windows%202.03/win203.img" } }).arquivo === "win203.img", "baixar a imagem usa win203.img");
check(c({ hda: { url: "../Systems/Windows%203.11/win311hd.img" } }).arquivo === "win311hd.img", "baixar a imagem usa win311hd.img");

secao("A: e B: por perfil");
configurarMidias({ fda: { url: "../Systems/Windows%201.01/win101.img" } });
check(caminhoDaUnidade("A") === "Systems/Windows 1.01/win101.img", "GRUB/Windows 1.01 -> win101.img");
configurarMidias({ fda: { url: "../Systems/Windows%203.11/win311-boot.img" } });
check(caminhoDaUnidade("A") === "Systems/Windows 3.11/win311-boot.img", "Windows 3.11 -> win311-boot.img");
configurarMidias({ fdb: { url: "../Systems/KolibriOS/kolibri.img" } });
check(caminhoDaUnidade("B") === "Systems/KolibriOS/kolibri.img", "Kolibri -> kolibri.img");

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);

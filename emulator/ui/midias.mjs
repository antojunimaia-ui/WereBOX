// midias.mjs — onde as imagens dos sistemas ficam no repositorio.
//
// As URLs que o v86 carrega estao no profiles.json (relativas a /emulator/).
// Aqui fica o caminho fisico usado pelo POST /emulator/__save quando a interface
// grava o disco de volta no projeto. Manter os dois em um lugar so' evita salvar
// o C: na pasta errada depois que os sistemas foram para Systems/.
const IMAGENS = {
  C: { arquivo: "c.img", projeto: "Systems/MS-DOS 6.22/c.img" },
  A: { arquivo: "win101.img", projeto: "Systems/Windows 1.01/win101.img" },
  B: { arquivo: "kolibri.img", projeto: "Systems/KolibriOS/kolibri.img" },
};

// O C: muda conforme o perfil: no GRUB/MS-DOS/Windows 3.11 ele e' o c.img; no
// Windows 95 e' o disco novo win95.img (o mesmo do instalador e do sistema ja'
// instalado, para o botao "salvar o disco" gravar no lugar certo).
const MIDIAS_C = [
  { chave: "c.img", arquivo: "c.img", projeto: "Systems/MS-DOS 6.22/c.img" },
  { chave: "msdos.img", arquivo: "msdos.img", projeto: "Systems/MS-DOS 6.22/msdos.img" },
  { chave: "novo.img", arquivo: "novo.img", projeto: "Systems/MS-DOS 6.22/novo.img" },
  { chave: "win203.img", arquivo: "win203.img", projeto: "Systems/Windows 2.03/win203.img" },
  { chave: "win311hd.img", arquivo: "win311hd.img", projeto: "Systems/Windows 3.11/win311hd.img" },
  { chave: "win95.img", arquivo: "win95.img", projeto: "Systems/Windows 95/win95.img" },
];

// O A: muda conforme o perfil: no GRUB ele e' o Windows 1.01; no perfil
// Windows 3.11 ele e' o disquete de boot que chama C:\WINDOWS\WIN /3.
const MIDIAS_A = [
  { chave: "win311-boot", arquivo: "win311-boot.img", projeto: "Systems/Windows 3.11/win311-boot.img" },
  { chave: "win95-boot", arquivo: "win95-boot.img", projeto: "Systems/Windows 95/win95-boot.img" },
  { chave: "win101", arquivo: "win101.img", projeto: "Systems/Windows 1.01/win101.img" },
  { chave: "msdos622", arquivo: "msdos622.img", projeto: "Systems/MS-DOS 6.22/msdos622.img" },
];

const MIDIAS_B = [
  { chave: "kolibri", arquivo: "kolibri.img", projeto: "Systems/KolibriOS/kolibri.img" },
];

let midiaA = IMAGENS.A;
let midiaB = IMAGENS.B;
let midiaC = MIDIAS_C[0];

function acharMidia(url, lista) {
  if (!url) return null;
  const limpa = decodeURIComponent(String(url)).replace(/\\/g, "/").toLowerCase().split(/[?#]/)[0];
  // Compara o nome do arquivo primeiro: "msdos.img" nao pode cair no c.img
  // so' porque o caminho nao contem "c.img".
  const base = limpa.split("/").pop();
  return lista.find((m) => base === m.chave) || lista.find((m) => limpa.includes(m.chave)) || null;
}

/** Ajusta o caminho de salvamento do A:/B:/C: ao perfil atual. */
export function configurarMidias(config = {}) {
  midiaA = acharMidia(config.fda?.url, MIDIAS_A) || IMAGENS.A;
  midiaB = acharMidia(config.fdb?.url, MIDIAS_B) || IMAGENS.B;
  // No GRUB o C: e' o hdb; nos perfis diretos e' o hda.
  midiaC = acharMidia(config.hdb?.url || config.hda?.url, MIDIAS_C) || MIDIAS_C[0];
}

export function dadosDaUnidade(unidade = "C") {
  const u = String(unidade).toUpperCase();
  if (u === "A") return midiaA;
  if (u === "B") return midiaB;
  return midiaC;
}

export function caminhoDaUnidade(unidade = "C") {
  return dadosDaUnidade(unidade).projeto;
}

export function arquivoDaUnidade(unidade = "C") {
  return dadosDaUnidade(unidade).arquivo;
}

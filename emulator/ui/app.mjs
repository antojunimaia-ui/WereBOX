// app.mjs — liga a maquina (v86) com a interface do reDOS:
//   barra de ferramentas em cima, tela do PC embaixo (canvas em tela cheia),
//   aba "Machine" com as opcoes: configuracao, snapshots, arquivos e logs.
import { el, $, pausa, fmtBytes } from "./util.mjs";
import { logs, log, logV86 } from "./logs.mjs";
import { ultimaLinhaTela, telaTexto, montarFS, dispositivoDe, baixarImagem, salvarNoProjeto } from "./discos.mjs";
import { configurarMidias } from "./midias.mjs";
import * as pConfig from "./paineis/config.mjs";
import * as pSnapNovo from "./paineis/snap-novo.mjs";
import * as pSnapLista from "./paineis/snap-lista.mjs";
import * as pArquivos from "./paineis/arquivos.mjs";
import * as pLogs from "./paineis/logs.mjs";
import * as pSeguranca from "./paineis/seguranca.mjs";
import { BootSelector } from "./boot-selector.mjs";
import { BootLoader } from "./boot-loader.mjs";
import { instalarGovernador, pararGovernador, lerAlvo, definirAlvo, alvoAtual, ativarGovernador, desativarGovernador } from "./velocidade.mjs";
import { baixarLinkParaDisco, lerPedidoDownload, paramsDaPagina, pausarMaquina, unidadeDeDownload } from "./transferencia.mjs";
import * as tecladoMobile from "./teclado-mobile.mjs";

/* ------------------------------------------------------------------- ajustes */
// O que pedimos ao v86. A aba "Machine > Configuração" mostra isso ao vivo.
// As midias e a ordem de boot vem do perfil escolhido. No perfil padrao o GRUB
// real ocupa o hda, o C: fica no hdb (com drivemap) e o Windows 1.01 no fda;
// os perfis "diretos" (menu HTML) usam hda=c.img ou fda=win101.img.
const AJUSTES = {
  wasm_path: "v86.wasm",
  memory_size: 32 * 1024 * 1024,
  vga_memory_size: 2 * 1024 * 1024,
  bios: { url: "seabios.bin" },
  vga_bios: { url: "vgabios.bin" },
  autostart: true,
  disable_speaker: false, // Sound Blaster 16 enabled (PC Speaker + DAC)
  screen: { use_graphical_text: true, encoding: "cp437", scaling: 1 },
};
const INFO = { proporcao: 4 / 3, msPorTecla: 12 };

// O Windows 1.01 roda em EGA 640×350 (proporção nativa 1,83); o NovaOS roda em
// 1280×720 (16:9). Os modos de texto (720×400) e o VGA continuam em 4:3.
function proporcaoDoModo(largura, altura) {
  if (largura === 640 && altura === 350) return 640 / 350;
  if (largura === 1280 && altura === 720) return 16 / 9;
  if (largura && altura && Math.abs(largura / altura - 16 / 9) < 0.05) return 16 / 9;
  return 4 / 3;
}
let sistemaAtual = null;
const MIDIAS = ["fda", "fdb", "hda", "hdb", "cdrom"];

const PAINEIS = {
  config: pConfig,
  "snap-novo": pSnapNovo,
  "snap-lista": pSnapLista,
  arquivos: pArquivos,
  logs: pLogs,
  seguranca: pSeguranca,
};

/* ---------------------------------------------------------------------- DOM */
const app = $("#app");
const telaArea = $("#tela-area");
const screenEl = $("#screen");
const statusEl = $("#status");
const avisoEl = $("#aviso");
const menuEl = $("#menu-machine");
const abaMachine = $("#aba-machine");
const gaveta = $("#gaveta");
const gavetaTitulo = $("#gaveta-titulo");
const gavetaCorpo = $("#gaveta-corpo");

let em = null;
let pronto = false;
let limparPainel = null;
let watchdogGrub = null;
let downloadPendente = null;

export const ctx = {
  get em() { return em; },
  get sistemaAtual() { return sistemaAtual; },
  // "msdos" | "win101" | "win311" | "win95" | null (null = ainda no menu do
  // GRUB / desconhecido). O gerenciador de arquivos usa isto para abrir no disco certo.
  osAtual: null,
  config: AJUSTES,
  info: INFO,
  abrirPainel,
  fecharPainel,
  reiniciar: reiniciarMaquina,
  status(texto, classe = "") { statusEl.textContent = texto; statusEl.className = classe; },
  aviso,             // mostra o recado flutuante (erro ou não)
};

/* ------------------------------------------------------------------- avisos */
function aviso(msg, erro = true) {
  avisoEl.textContent = msg;
  avisoEl.className = erro ? "erro" : "";
  avisoEl.hidden = !msg;
  if (msg) log(msg, erro ? "err" : "info");
}

/** baixa o arquivo pedido em ?download=... e reinicia a maquina quando terminar */
async function processarDownloadPendente() {
  if (!downloadPendente || !em) return;
  const pedido = downloadPendente;
  downloadPendente = null;
  const config = sistemaAtual?.config || AJUSTES;
  const unidade = pedido.unidade || unidadeDeDownload({ osAtual: ctx.osAtual, sistemaAtual, config });
  if (!unidade) {
    ctx.aviso("este sistema não tem disco gravável (C:/A:/B:) para receber o download");
    log("download automático cancelado: nenhum disco gravável", "err");
    return;
  }

  let pausou = false;
  try {
    ctx.status(`baixando ${pedido.url}…`);
    log(`baixando ${pedido.url} para ${unidade}:`);
    const r = await baixarLinkParaDisco(em, {
      url: pedido.url,
      unidade,
      nome: pedido.nome,
      antesDeGravar: async () => { pausou = await pausarMaquina(em); },
    });
    if (r.zip && r.extraido) {
      log(`ZIP ${r.nomeOriginal} extraído no ${unidade}: (${r.arquivos} arquivo(s), ${r.pastas} pasta(s), ${fmtBytes(r.bytes)})`, "ok");
      ctx.status("ZIP extraído — reiniciando a máquina", "ok");
    } else if (r.zip && !r.extraido) {
      const nota = r.renomeado ? ` — de "${r.nomeOriginal}"` : "";
      log(`ZIP ${r.nomeOriginal} não extraído (${r.zipFalhou}); gravado como ${r.nome} (${r.bytes} bytes)${nota}`, "err");
      ctx.status("ZIP gravado sem extrair — reiniciando a máquina", "ok");
      ctx.aviso(`ZIP não extraído: ${r.zipFalhou}. O arquivo foi gravado como ${r.nome}.`);
    } else {
      const nota = r.renomeado ? ` — de "${r.nomeOriginal}"` : "";
      log(`${r.nome} gravado no ${unidade}: (${fmtBytes(r.bytes)})${nota}`, "ok");
      ctx.status(`${r.nome} baixado — reiniciando a máquina`, "ok");
    }
    await pausa(800);
    ctx.reiniciar();
    // reiniciar nao religa sozinho uma maquina que estava pausada
    em?.run();
  } catch (e) {
    if (pausou) em?.run();
    ctx.aviso(`download automático falhou: ${e.message}`);
    log(`download automático falhou: ${e.message}`, "err");
  }
}

/* ------------------------------------------------------------------ máquina */
function boot() {
  pararWatchdogGrub();
  if (em) pararGovernador(em);
  if (typeof V86 !== "function") {
    aviso("libv86.js não carregou. Rode `npm run v86` e sirva o projeto por http (npm run serve).");
    return;
  }
  const midias = MIDIAS.filter((k) => AJUSTES[k]).map((k) => `${k}=${AJUSTES[k].url}`).join(", ");
  log(`subindo a máquina: v86 + SeaBIOS + ${midias || "nenhuma mídia"}`);
  ctx.status("carregando o PC…");
  ajustarTela();
  BootLoader.mostrar(screenEl, sistemaAtual?.name || "WereBOX");
  const novoEm = new V86({ ...AJUSTES, screen_container: screenEl, screen: { ...AJUSTES.screen } });
  em = novoEm;
  pronto = false;
  // O limitador é instalado já, mas fica desligado durante o boot: o
  // controlador de disquete e a inicialização do Windows 3.11 são sensíveis a
  // pausas no meio da leitura. `acompanhar*`/`esperarPrompt` ligam quando o
  // sistema chega ao prompt ou a tela gráfica estabiliza.
  const prepararGovernador = () => {
    if (!novoEm.v86) return;
    if (!novoEm.v86.__redosYieldOriginal) instalarGovernador(novoEm, lerAlvo(), false);
  };
  prepararGovernador();
  // Um snapshot restaura uma máquina já em execução: liga o limite junto.
  const restaurarOriginal = novoEm.restore_state.bind(novoEm);
  novoEm.restore_state = async (estado) => {
    const r = await restaurarOriginal(estado);
    if (em === novoEm) ativarGovernador(novoEm);
    return r;
  };
  const vivo = () => em === novoEm;

  const progresso = new Map();
  novoEm.add_listener("download-progress", (d) => {
    if (!vivo()) return;
    if (!d.total) return;
    const pct = Math.round((d.loaded / d.total) * 100);
    BootLoader.atualizar({
      arquivo: d.file_name,
      loaded: d.loaded,
      total: d.total,
      file_index: d.file_index,
      file_count: d.file_count,
    });
    // anota de 25 em 25% (senão o log vira uma parede de linhas)
    const ultimo = progresso.get(d.file_name) ?? -1;
    if (pct === 0 || pct >= ultimo + 25) {
      progresso.set(d.file_name, pct);
      logV86(`baixando ${d.file_name}: ${fmtBytes(d.loaded)} de ${fmtBytes(d.total)} (${pct}%)`, "dbg");
    }
  });
  novoEm.add_listener("emulator-loaded", () => {
    if (!vivo()) return;
    pronto = true;
    BootLoader.concluir();
    // O objeto interno do v86 só existe depois que as imagens são carregadas;
    // é aqui que o limitador de velocidade pode ser instalado de verdade.
    prepararGovernador();
    
    // Log do status do áudio
    if (novoEm.speaker_adapter) {
      logV86("🔊 Sound Blaster 16 inicializado", "ok");
      console.log("[WereBOX] Speaker adapter:", novoEm.speaker_adapter);
      console.log("[WereBOX] Audio context state:", novoEm.speaker_adapter.audio_context?.state);
    } else {
      logV86("⚠️ Speaker adapter não foi criado", "err");
      console.warn("[WereBOX] disable_speaker pode estar true ou navegador não suporta Web Audio");
    }
    
    // no v86 o "emulator-loaded" pode chegar depois do "emulator-started"; nao
    // deixe ele sobrescrever o estado do GRUB com "ligando o PC...".
    ctx.status(
      sistemaAtual?.bootloader === "grub"
        ? "GRUB 2.06 — escolha o sistema"
        : sistemaAtual?.id === "win95inst"
          ? "Windows 95 — instalador"
          : sistemaAtual?.id === "win95"
            ? "boot do Windows 95…"
            : sistemaAtual?.id === "win311"
              ? "boot do Windows 3.11…"
              : sistemaAtual?.id === "win203"
                ? "boot do Windows 2.03…"
                : sistemaAtual?.id === "menuet"
                  ? "boot do MenuetOS…"
                  : sistemaAtual?.id === "win101"
                  ? "boot do Windows 1.01…"
                  : "ligando o PC (SeaBIOS)…",
    );
    logV86("firmware carregado, ligando a CPU");
    // a maquina (e os discos) acabou de ficar pronta; deixa o gerenciador
    // de arquivos tentar montar de novo se ele foi aberto cedo demais.
    definirOS(ctx.osAtual);
    // Se a pagina foi aberta com ?download=..., o disco ja' esta' carregado:
    // busca o arquivo, grava no FAT e reinicia.
    processarDownloadPendente();
    // Instala o teclado virtual mobile
    tecladoMobile.instalar(app, novoEm);
  });
  novoEm.add_listener("emulator-started", () => {
    if (!vivo()) return;
    pronto = true;
    prepararGovernador();
    if (sistemaAtual?.bootloader === "grub") {
      // Quem escolhe o sistema agora e' o GRUB de verdade, dentro da tela do PC.
      definirOS(null);
      ctx.status("GRUB 2.06 — escolha o sistema");
      logV86("máquina no ar (SeaBIOS → GRUB 2.06 → menu)");
      acompanharGrub(vivo);
      return;
    }
    if (sistemaAtual?.id === "win101") {
      definirOS("win101");
      // o Windows 1.01 e' grafico: nao existe prompt "C:\\>" para esperar.
      ctx.status("boot do Windows 1.01…");
      logV86("máquina no ar (SeaBIOS → disquete MS-DOS 3.3 → WIN)");
      acompanharWin101(vivo);
      return;
    }
    if (sistemaAtual?.id === "win203") {
      definirOS("win203");
      ctx.status("boot do Windows 2.03…");
      logV86("máquina no ar (SeaBIOS → C: → Windows 2.03)");
      acompanharWin203(vivo);
      return;
    }
    if (sistemaAtual?.id === "win311") {
      // O Windows 3.11 tambem e' grafico, mas o disco C: ja' tem o DOS: o
      // disquete em A: so' carrega os drivers e chama C:\\WINDOWS\\WIN /3.
      definirOS(null);
      ctx.status("boot do Windows 3.11…");
      logV86("máquina no ar (SeaBIOS → disquete MS-DOS 6.22 → WIN /3 em C:)");
      acompanharWin311(vivo);
      return;
    }
    if (sistemaAtual?.id === "win95inst") {
      // O instalador roda do disquete extraido do CD e monta o ISO em X:; o
      // C: e' o win95.img novo. Nao limita a CPU aqui: a instalacao ja' e' longa.
      definirOS("win95");
      ctx.status("Windows 95 — instalador");
      logV86("máquina no ar (SeaBIOS → disquete de instalação → OEMSETUP no CD)");
      return;
    }
    if (sistemaAtual?.id === "win95") {
      definirOS("win95");
      ctx.status("boot do Windows 95…");
      logV86("máquina no ar (SeaBIOS → C: → Windows 95)");
      acompanharWin95(vivo);
      return;
    }
    if (sistemaAtual?.id === "novaos") {
      definirOS("novaos");
      ctx.status("boot do NovaOS…");
      logV86("máquina no ar (SeaBIOS → CD-ROM El Torito → GRUB → NovaOS)");
      acompanharNovaOS(vivo);
      return;
    }
    if (sistemaAtual?.id === "tinycore") {
      definirOS("tinycore");
      ctx.status("boot do Tiny Core Linux…");
      logV86("máquina no ar (SeaBIOS → CD-ROM El Torito → ISOLINUX → Tiny Core Linux)");
      acompanharTinyCore(vivo);
      return;
    }
    if (sistemaAtual?.id === "kolibri") {
      definirOS("kolibri");
      ctx.status("boot do KolibriOS…");
      logV86("máquina no ar (SeaBIOS → Disquete A: → KolibriOS)");
      acompanharKolibri(vivo);
      return;
    }
    if (sistemaAtual?.id === "menuet") {
      definirOS("menuet");
      ctx.status("boot do MenuetOS…");
      logV86("máquina no ar (SeaBIOS → Disquete A: → MenuetOS)");
      acompanharMenuet(vivo);
      return;
    }
    definirOS("msdos");
    ctx.status("boot do MS-DOS 6.22…");
    logV86("máquina no ar (SeaBIOS → MBR → IO.SYS)");
    esperarPrompt();
  });
  novoEm.add_listener("emulator-stopped", () => { if (vivo()) { ctx.status("máquina pausada", "warn"); logV86("máquina pausada"); } });
  novoEm.add_listener("screen-set-size", (d) => { 
    if (vivo()) {
      // o v86 manda um array [largura, altura, bits] neste evento
      const [largura, altura] = Array.isArray(d) ? d : [d?.width, d?.height];
      INFO.proporcao = proporcaoDoModo(largura, altura);
      logV86(`tamanho da tela: ${largura}×${altura} (proporção ${INFO.proporcao.toFixed(2)})`, "dbg");
      // Pequeno delay para garantir que o canvas foi atualizado
      setTimeout(() => ajustarTela(), 100);
    }
  });

  ajustarTela();
}

async function teardown() {
  pararWatchdogGrub();
  BootLoader.remover();
  const velho = em;
  em = null;
  pronto = false;
  if (velho) {
    pararGovernador(velho);
    try { await velho.destroy(); } catch { /* ignore */ }
  }
}

/** reinicia pelo mesmo caminho em qualquer painel/botão (e desliga o limite no boot) */
function reiniciarMaquina() {
  if (!em) return;
  log("reiniciando a máquina", "warn");
  desativarGovernador(em);
  // no GRUB o menu ainda vai decidir; nos perfis diretos a máquina continua a mesma
  definirOS(sistemaAtual?.id === "win101" ? "win101" : sistemaAtual?.id === "win203" ? "win203" : sistemaAtual?.id === "msdos622" ? "msdos" : null);
  pararWatchdogGrub();
  em.restart();
  pintarBotaoPausa();
  if (sistemaAtual?.bootloader === "grub") {
    ctx.status("GRUB 2.06 — escolha o sistema");
    acompanharGrub(() => true);
  } else if (sistemaAtual?.id === "win101") {
    ctx.status("boot do Windows 1.01…");
    acompanharWin101(() => true);
  } else if (sistemaAtual?.id === "win203") {
    ctx.status("boot do Windows 2.03…");
    acompanharWin203(() => true);
  } else if (sistemaAtual?.id === "win311") {
    ctx.status("boot do Windows 3.11…");
    acompanharWin311(() => true);
  } else if (sistemaAtual?.id === "win95inst") {
    ctx.status("Windows 95 — instalador");
  } else if (sistemaAtual?.id === "win95") {
    ctx.status("boot do Windows 95…");
    acompanharWin95(() => true);
  } else if (sistemaAtual?.id === "novaos") {
    ctx.status("boot do NovaOS…");
    acompanharNovaOS(() => true);
  } else if (sistemaAtual?.id === "tinycore") {
    ctx.status("boot do Tiny Core Linux…");
    acompanharTinyCore(() => true);
  } else if (sistemaAtual?.id === "kolibri") {
    ctx.status("boot do KolibriOS…");
    acompanharKolibri(() => true);
  } else if (sistemaAtual?.id === "menuet") {
    ctx.status("boot do MenuetOS…");
    acompanharMenuet(() => true);
  } else {
    ctx.status("boot do MS-DOS 6.22…");
    esperarPrompt();
  }
}

function pararWatchdogGrub() {
  if (watchdogGrub) { clearInterval(watchdogGrub); watchdogGrub = null; }
}

/** avisa os paineis (ex.: o gerenciador de arquivos) que o sistema bootado mudou */
function definirOS(os) {
  ctx.osAtual = os;
  // sempre avisa: além de trocar a unidade, o painel aproveita para tentar
  // remontar o disco quando a maquina termina de subir.
  window.dispatchEvent(new CustomEvent("redos-os", { detail: os }));
}

/** o Windows 3.11 sobe em 640×480 (VGA); o GRUB e o DOS ficam em 720×400 */
function ehTelaWindows311(cv) {
  return cv?.width === 640 && cv?.height === 480;
}

/** o VGA do v86 sabe se o modo atual é gráfico (e não texto 80×25/80×30) */
function modoGrafico(em) {
  return Boolean(em?.v86?.cpu?.devices?.vga?.graphical_mode);
}

/**
 * O canvas pode já estar no tamanho do Windows mas ainda totalmente preto
 * (BIOS/transição de modo). Conta uma amostra dos pixels para não anunciar
 * "no ar" antes de existir imagem. Em 640×350/480 o desktop passa fácil de 5%.
 */
function telaComConteudo(cv) {
  if (!cv?.width || !cv?.height) return false;
  try {
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    // Amostra pequena (5 janelas de 24×24), não o canvas inteiro: ler 640×350
    // a cada segundo bloqueia a thread principal e atrapalha o controlador de
    // disquete do v86 durante o boot.
    const w = Math.min(24, cv.width), h = Math.min(24, cv.height);
    const pontos = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.75], [0.25, 0.75], [0.75, 0.25]];
    let amostras = 0, acesos = 0;
    for (const [fx, fy] of pontos) {
      const x = Math.max(0, Math.min(cv.width - w, Math.floor(cv.width * fx - w / 2)));
      const y = Math.max(0, Math.min(cv.height - h, Math.floor(cv.height * fy - h / 2)));
      const { data } = ctx.getImageData(x, y, w, h);
      for (let i = 0; i < data.length; i += 4) {
        amostras++;
        if (data[i] || data[i + 1] || data[i + 2]) acesos++;
      }
    }
    return amostras > 0 && acesos / amostras > 0.05;
  } catch {
    return false;
  }
}

/** depois do GRUB, descobre o que bootou pela tela (prompt do DOS ou modo grafico) */
function acompanharGrub(vivo = () => true) {
  pararWatchdogGrub();
  const emLocal = em;
  const inicio = Date.now();
  let promptDesde = 0;
  let graficoDesde = 0;
  watchdogGrub = setInterval(() => {
    if (!vivo() || em !== emLocal || Date.now() - inicio > 240000) { pararWatchdogGrub(); return; }
    if (Date.now() - inicio < 3000) return; // deixa o GRUB redesenhar antes de olhar
    const cv = screenEl.querySelector("canvas");
    const win101 = cv?.width === 640 && cv?.height === 350 && modoGrafico(emLocal) && telaComConteudo(cv);
    // O Windows 3.11 é identificado só pela resolução 640×480: ler os pixels
    // do canvas durante a troca de modo pode atrasar a atualização da tela no
    // navegador. O 1.01 continua exigindo conteúdo para não confundir o splash.
    const win311 = ehTelaWindows311(cv);
    const kolibri = cv?.width === 1024 && cv?.height === 768 && telaComConteudo(cv);
    if (win101 || win311 || kolibri) {
      if (!graficoDesde) graficoDesde = Date.now();
      // O 1.01 espera o modo gráfico estabilizar; o 3.11 tem uma janela maior; o Kolibri sobe direto em VESA.
      if (Date.now() - graficoDesde < (win101 ? 5000 : kolibri ? 2000 : 15000)) return;
      if (kolibri) {
        definirOS("kolibri");
        ctx.status("KolibriOS no ar", "ok");
        logV86("KolibriOS no ar (1024×768)", "ok");
      } else if (win101) {
        definirOS("win101");
        ctx.status("Windows 1.01 no ar", "ok");
        logV86("Windows 1.01 no ar (640×350)", "ok");
      } else {
        definirOS("win311");
        ctx.status("Windows 3.11 no ar", "ok");
        logV86("Windows 3.11 no ar (640×480)", "ok");
      }
      ativarGovernador(emLocal);
      pararWatchdogGrub();
      return;
    }
    graficoDesde = 0;
    // So' o prompt C: e' o MS-DOS do disco. O Windows 1.01 boota pelo A: e
    // mostra um "A:\>" antes do WIN.COM; se a gente parasse nesse prompt, o
    // watchdog morreria antes do 640x350 e o gerenciador ficaria no C:.
    // O Windows 3.11 tambem passa por um prompt antes do WIN /3, entao espera
    // alguns segundos de prompt estavel antes de assumir que ficou no DOS.
    if (/^C:\\>$/.test(ultimaLinhaTela(emLocal))) {
      if (!promptDesde) promptDesde = Date.now();
      if (Date.now() - promptDesde < 3000) return;
      definirOS("msdos");
      ctx.status("MS-DOS 6.22 pronto — prompt C:\\", "ok");
      logV86("MS-DOS 6.22 no ar: prompt C:\\", "ok");
      ativarGovernador(emLocal);
      pararWatchdogGrub();
    } else {
      promptDesde = 0;
    }
  }, 1000);
}

/** perfil direto do Windows 1.01: espera o EGA 640×350 com imagem de verdade */
function acompanharWin101(vivo = () => true) {
  pararWatchdogGrub();
  const emLocal = em;
  const inicio = Date.now();
  let graficoDesde = 0;
  watchdogGrub = setInterval(() => {
    if (!vivo() || em !== emLocal || Date.now() - inicio > 240000) { pararWatchdogGrub(); return; }
    const cv = screenEl.querySelector("canvas");
    // O modo 640×350 aparece cedo, mas o canvas pode ficar preto enquanto o
    // disquete carrega; só avisa "no ar" quando houver pixels acesos por alguns
    // segundos (o splash inicial também acende pixels).
    if (cv?.width === 640 && cv?.height === 350 && modoGrafico(emLocal) && telaComConteudo(cv)) {
      if (!graficoDesde) graficoDesde = Date.now();
      if (Date.now() - graficoDesde < 5000) return;
      ctx.status("Windows 1.01 no ar", "ok");
      logV86("Windows 1.01 no ar (640×350)", "ok");
      ativarGovernador(emLocal);
      pararWatchdogGrub();
    } else {
      graficoDesde = 0;
    }
  }, 1000);
}

/** perfil direto do Windows 2.03: aguarda modo gráfico 640×350 / 640×480 */
function acompanharWin203(vivo = () => true) {
  pararWatchdogGrub();
  const emLocal = em;
  const inicio = Date.now();
  let graficoDesde = 0;
  watchdogGrub = setInterval(() => {
    if (!vivo() || em !== emLocal || Date.now() - inicio > 240000) { pararWatchdogGrub(); return; }
    const cv = screenEl.querySelector("canvas");
    if (cv?.width >= 640 && modoGrafico(emLocal) && telaComConteudo(cv)) {
      if (!graficoDesde) graficoDesde = Date.now();
      if (Date.now() - graficoDesde < 3000) return;
      definirOS("win203");
      ctx.status("Windows 2.03 no ar", "ok");
      logV86(`Windows 2.03 no ar (${cv.width}×${cv.height})`, "ok");
      ativarGovernador(emLocal);
      pararWatchdogGrub();
    } else {
      graficoDesde = 0;
    }
  }, 1000);
}

/** perfil direto do Windows 3.11: espera o VGA 640×480 do Program Manager */
function acompanharWin311(vivo = () => true) {
  pararWatchdogGrub();
  const emLocal = em;
  const inicio = Date.now();
  let viuGrafico = 0;
  watchdogGrub = setInterval(() => {
    if (!vivo() || em !== emLocal || Date.now() - inicio > 240000) { pararWatchdogGrub(); return; }
    const cv = screenEl.querySelector("canvas");
    // 640×480 é o começo do WIN /3. Espera a troca de modo e o carregamento
    // das fontes antes de ligar o limitador; ler pixels do canvas aqui atrasa
    // a atualização da tela no navegador.
    if (ehTelaWindows311(cv)) {
      if (!viuGrafico) viuGrafico = Date.now();
      if (Date.now() - viuGrafico < 15000) return;
      definirOS("win311");
      ctx.status("Windows 3.11 no ar", "ok");
      logV86("Windows 3.11 no ar (640×480)", "ok");
      ativarGovernador(emLocal);
      pararWatchdogGrub();
      return;
    }
    viuGrafico = 0;
    // se o WIN /3 falhar, o DOS volta e o gerenciador continua no C:
    if (/^C:\\>$/.test(ultimaLinhaTela(emLocal)) && Date.now() - inicio > 25000) {
      definirOS("msdos");
      ctx.status("Windows 3.11 não subiu — prompt C:\\", "warn");
      logV86("WIN 3.11 não subiu; máquina no prompt C:\\", "warn");
      ativarGovernador(emLocal);
      pararWatchdogGrub();
    }
  }, 1000);
}

/** perfil direto do Windows 95: espera o desktop VGA e liga o limite */
function acompanharWin95(vivo = () => true) {
  pararWatchdogGrub();
  const emLocal = em;
  const inicio = Date.now();
  let graficoDesde = 0;
  watchdogGrub = setInterval(() => {
    if (!vivo() || em !== emLocal || Date.now() - inicio > 300000) { pararWatchdogGrub(); return; }
    const cv = screenEl.querySelector("canvas");
    const grafico = cv?.width >= 640 && cv?.height >= 400 && modoGrafico(emLocal);
    if (!grafico) { graficoDesde = 0; return; }
    if (!graficoDesde) graficoDesde = Date.now();
    const conteudo = telaComConteudo(cv);
    // Canvas preto pode ser só a troca de modo ou uma aba em segundo plano:
    // nesse caso espera mais antes de considerar o desktop pronto.
    if (!conteudo && Date.now() - graficoDesde < 30000) return;
    if (conteudo && Date.now() - graficoDesde < 5000) return;
    definirOS("win95");
    ctx.status("Windows 95 no ar", "ok");
    logV86("Windows 95 no ar (VGA)", "ok");
    ativarGovernador(emLocal);
    pararWatchdogGrub();
  }, 1000);
}

/** perfil direto do NovaOS: aguarda o carregamento do kernel Multiboot e modo gráfico */
function acompanharNovaOS(vivo = () => true) {
  pararWatchdogGrub();
  const emLocal = em;
  const inicio = Date.now();
  let graficoDesde = 0;
  watchdogGrub = setInterval(() => {
    if (!vivo() || em !== emLocal || Date.now() - inicio > 300000) { pararWatchdogGrub(); return; }
    const cv = screenEl.querySelector("canvas");
    // NovaOS usa Multiboot framebuffer: detecta pelo tamanho do canvas, nao por modoGrafico()
    const grafico = cv?.width >= 800;
    if (!grafico) { graficoDesde = 0; return; }
    if (!graficoDesde) graficoDesde = Date.now();
    const conteudo = telaComConteudo(cv);
    if (!conteudo && Date.now() - graficoDesde < 20000) return;
    if (conteudo && Date.now() - graficoDesde < 3000) return;
    definirOS("novaos");
    ctx.status("NovaOS no ar", "ok");
    logV86(`NovaOS no ar (${cv?.width}×${cv?.height})`, "ok");
    ativarGovernador(emLocal);
    pararWatchdogGrub();
  }, 1000);
}

/** perfil direto do Tiny Core Linux: aguarda boot do kernel Linux e interface gráfica/shell */
function acompanharTinyCore(vivo = () => true) {
  pararWatchdogGrub();
  const emLocal = em;
  const inicio = Date.now();
  let graficoDesde = 0;
  watchdogGrub = setInterval(() => {
    if (!vivo() || em !== emLocal || Date.now() - inicio > 300000) { pararWatchdogGrub(); return; }
    const cv = screenEl.querySelector("canvas");
    const grafico = (cv?.width >= 640 || modoGrafico(emLocal)) && telaComConteudo(cv);
    if (grafico) {
      if (!graficoDesde) graficoDesde = Date.now();
      if (Date.now() - graficoDesde < 3000) return;
      definirOS("tinycore");
      ctx.status("Tiny Core Linux no ar", "ok");
      logV86(`Tiny Core Linux no ar (${cv?.width}×${cv?.height})`, "ok");
      ativarGovernador(emLocal);
      pararWatchdogGrub();
      return;
    }
    const ult = ultimaLinhaTela(emLocal);
    if (/tc@box:~\$|box login:/.test(ult)) {
      definirOS("tinycore");
      ctx.status("Tiny Core Linux pronto (terminal)", "ok");
      logV86("Tiny Core Linux pronto no terminal", "ok");
      ativarGovernador(emLocal);
      pararWatchdogGrub();
    }
  }, 1000);
}

/** perfil direto do KolibriOS: aguarda modo gráfico VESA/VBE e área de trabalho */
function acompanharKolibri(vivo = () => true) {
  pararWatchdogGrub();
  const emLocal = em;
  const inicio = Date.now();
  let graficoDesde = 0;
  watchdogGrub = setInterval(() => {
    if (!vivo() || em !== emLocal || Date.now() - inicio > 120000) { pararWatchdogGrub(); return; }
    const cv = screenEl.querySelector("canvas");
    const grafico = (cv?.width >= 640 || modoGrafico(emLocal)) && telaComConteudo(cv);
    if (grafico) {
      if (!graficoDesde) graficoDesde = Date.now();
      if (Date.now() - graficoDesde < 2000) return;
      definirOS("kolibri");
      ctx.status("KolibriOS no ar", "ok");
      logV86(`KolibriOS no ar (${cv?.width}×${cv?.height})`, "ok");
      ativarGovernador(emLocal);
      pararWatchdogGrub();
    }
  }, 1000);
}

/** perfil direto do MenuetOS: aguarda modo gráfico VESA/VBE e desktop */
function acompanharMenuet(vivo = () => true) {
  pararWatchdogGrub();
  const emLocal = em;
  const inicio = Date.now();
  let graficoDesde = 0;
  watchdogGrub = setInterval(() => {
    if (!vivo() || em !== emLocal || Date.now() - inicio > 120000) { pararWatchdogGrub(); return; }
    const cv = screenEl.querySelector("canvas");
    const grafico = (cv?.width >= 640 || modoGrafico(emLocal)) && telaComConteudo(cv);
    if (!grafico) { graficoDesde = 0; return; }
    if (!graficoDesde) {
      graficoDesde = Date.now();
      ctx.status("carregando o desktop do MenuetOS…");
    }
    // Aguarda o launcher descompactar todos os ícones e arquivos do disquete para a RAM
    if (Date.now() - graficoDesde < 12000) return;
    definirOS("menuet");
    ctx.status("MenuetOS no ar", "ok");
    logV86(`MenuetOS no ar (${cv?.width}×${cv?.height})`, "ok");
    pararWatchdogGrub();
  }, 1000);
}


/* ------------------------------------------------------- encaixe da tela (4:3) */
function ajustarTela() {
  const caixa = telaArea.getBoundingClientRect();
  if (!caixa.width || !caixa.height) return;
  let largura = caixa.width, altura = largura / INFO.proporcao;
  if (altura > caixa.height) { altura = caixa.height; largura = altura * INFO.proporcao; }
  screenEl.style.width = `${Math.floor(largura)}px`;
  screenEl.style.height = `${Math.floor(altura)}px`;
}

/* ------------------------------------------------- espera o DOS ficar no prompt */
// O BIOS → MBR → IO.SYS → CONFIG.SYS → AUTOEXEC.BAT leva alguns segundos. Em vez
// de adivinhar, olhamos a tela: quando a última linha com conteúdo for um prompt
// "C:\>", o MS-DOS 6.22 está pronto. Cuidado: num reinício a tela ainda mostra o
// prompt antigo por um instante — então só aceitamos depois de a tela mudar.
async function esperarPrompt(ms = 180000) {
  const emLocal = em;
  const inicio = Date.now();
  const telaInicial = telaTexto(emLocal);
  let viuBoot = false;
  while (em === emLocal && Date.now() - inicio < ms) {
    const texto = telaTexto(emLocal);
    if (!viuBoot && texto !== telaInicial) viuBoot = true;
    if (viuBoot && /^C:\\>$/.test(ultimaLinhaTela(emLocal))) {
      definirOS("msdos");
      ctx.status("MS-DOS 6.22 pronto — prompt C:\\", "ok");
      logV86("MS-DOS 6.22 no ar: prompt C:\\", "ok");
      ativarGovernador(emLocal);
      return true;
    }
    await pausa(400);
  }
  return false;
}

/* -------------------------------------------------------------------- barra */
abaMachine.addEventListener("click", (e) => {
  e.stopPropagation();
  const abrir = menuEl.hidden;
  if (abrir) {
    // abre colado embaixo da aba, seja qual for o tamanho do nome
    const caixa = abaMachine.getBoundingClientRect();
    menuEl.style.left = `${Math.round(caixa.left)}px`;
  }
  menuEl.hidden = !abrir;
  abaMachine.setAttribute("aria-expanded", String(abrir));
  if (abrir) log("menu Machine aberto", "dbg");
});

for (const item of menuEl.querySelectorAll("button[data-painel]")) {
  item.addEventListener("click", () => {
    menuEl.hidden = true;
    abaMachine.setAttribute("aria-expanded", "false");
    abrirPainel(item.dataset.painel);
  });
}

$("#btn-escolher-sistema")?.addEventListener("click", () => {
  menuEl.hidden = true;
  abaMachine.setAttribute("aria-expanded", "false");
  if (confirm("Trocar de sistema? A máquina atual será reiniciada e o que estiver só na memória (como um disco ainda não salvo) será perdido.")) {
    location.href = "?menu=html";
  }
});

document.addEventListener("click", () => {
  if (!menuEl.hidden) { menuEl.hidden = true; abaMachine.setAttribute("aria-expanded", "false"); }
});

for (const b of document.querySelectorAll("button[data-cmd]")) {
  b.addEventListener("click", () => {
    // controlando o DOS por codigo: no v86 o Enter e "\n" (nao "\r") e o ritmo de
    // ~12 ms por tecla evita estourar o buffer do controlador de teclado
    if (!em) return;
    log(`enviando comando para o DOS: ${b.dataset.cmd}`, "dbg");
    em.keyboard_send_text(`${b.dataset.cmd}\n`, INFO.msPorTecla);
  });
}

$("#btn-pausa").addEventListener("click", () => {
  if (!em) return;
  if (em.is_running()) { em.stop(); } else { em.run(); }
  pintarBotaoPausa();
});
pintarBotaoPausa();
function pintarBotaoPausa() {
  const rodando = em?.is_running?.() ?? false;
  const b = $("#btn-pausa");
  b.textContent = rodando ? "⏸" : "▶";
  b.title = rodando ? "pausar a máquina" : "retomar a máquina";
}

$("#btn-reset").addEventListener("click", () => ctx.reiniciar());

/* ---------------------------------------------------------------- fullscreen */
const emTelaCheia = () => !!document.fullscreenElement || app.classList.contains("pseudo");
function entrarTelaCheia() {
  const p = app.requestFullscreen?.({ navigationUI: "hide" });
  if (p?.catch) p.catch(() => {});
  setTimeout(() => { if (!document.fullscreenElement) app.classList.add("pseudo"); ajustarTela(); }, 400);
}
function sairTelaCheia() {
  if (document.fullscreenElement) document.exitFullscreen?.()?.catch?.(() => {});
  app.classList.remove("pseudo");
  ajustarTela();
}
$("#btn-full").addEventListener("click", () => (emTelaCheia() ? sairTelaCheia() : entrarTelaCheia()));
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) app.classList.remove("pseudo"); ajustarTela(); });
window.addEventListener("resize", ajustarTela);

/* --------------------------------------------------------------- gaveta/painel */
function abrirPainel(nome) {
  const painel = PAINEIS[nome];
  if (!painel) return;
  if (limparPainel) { try { limparPainel(); } catch { /* ignore */ } limparPainel = null; }
  gaveta.hidden = false;
  app.classList.add("com-gaveta");   // a tela do PC recua para o painel
  gavetaTitulo.textContent = painel.meta.titulo;
  gavetaCorpo.textContent = "";
  try {
    limparPainel = painel.montar(gavetaCorpo, ctx) || null;
  } catch (e) {
    aviso(`não consegui montar o painel: ${e.message}`);
    gavetaCorpo.append(el("p", { class: "vazio" }, e.message));
  }
  ajustarTela();
  log(`painel aberto: ${painel.meta.titulo}`, "dbg");
}

function fecharPainel() {
  if (limparPainel) { try { limparPainel(); } catch { /* ignore */ } limparPainel = null; }
  gaveta.hidden = true;
  app.classList.remove("com-gaveta");
  ajustarTela();
  log("painel fechado", "dbg");
}

$("#gaveta-fechar").addEventListener("click", fecharPainel);
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  
  // Libera o pointer lock primeiro (se estiver ativo)
  if (document.pointerLockElement) {
    document.exitPointerLock?.();
    e.preventDefault();
    return;
  }
  
  // Fecha teclado mobile se estiver aberto
  if (tecladoMobile.estaVisivel()) {
    tecladoMobile.esconder();
    e.preventDefault();
    return;
  }
  
  // Depois fecha menus e painéis
  if (!menuEl.hidden) { menuEl.hidden = true; abaMachine.setAttribute("aria-expanded", "false"); return; }
  if (!gaveta.hidden) { fecharPainel(); return; }
  if (app.classList.contains("pseudo")) sairTelaCheia();
}, true);

// Ctrl+K ou Cmd+K abre/fecha o teclado mobile
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "k") {
    e.preventDefault();
    tecladoMobile.toggle();
  }
});

// clicar na tela captura o mouse (pointer lock) para sincronização perfeita
telaArea.addEventListener("click", async () => {
  // Resume AudioContext (navegadores bloqueiam áudio até user gesture)
  if (em?.speaker_adapter?.audio_context?.state === "suspended") {
    try {
      await em.speaker_adapter.audio_context.resume();
      logV86("🔊 AudioContext resumed - som ativado", "ok");
    } catch (err) {
      console.warn("[WereBOX] Falha ao ativar áudio:", err);
    }
  }
  
  const canvas = screenEl.querySelector("canvas");
  if (!canvas) return;
  
  // Tenta capturar o ponteiro (o cursor do navegador some e o mouse fica preso)
  try {
    await canvas.requestPointerLock?.();
    log("mouse capturado (pointer lock ativado) — pressione ESC para liberar", "info");
  } catch (e) {
    log(`não consegui capturar o mouse: ${e.message}`, "warn");
  }
  
  canvas.focus?.();
});

// Detecta quando o pointer lock é liberado (ESC ou perda de foco)
document.addEventListener("pointerlockchange", () => {
  const travado = document.pointerLockElement === screenEl.querySelector("canvas");
  if (!travado) {
    log("mouse liberado (pointer lock desativado)", "dbg");
  }
});

// Avisa o usuário na primeira vez que clicar
let primeiroClique = true;
telaArea.addEventListener("click", () => {
  if (primeiroClique && !document.pointerLockElement) {
    primeiroClique = false;
    ctx.aviso("Clique na tela para capturar o mouse. Pressione ESC para liberar.", false);
    setTimeout(() => ctx.aviso(""), 4000);
  }
}, { once: true });

/* -------------------------------------------------------------------- start */
log("WereBOX — interface iniciada (motor v86)");

// restaura preferencia visual salva (sem-crt)
if (localStorage.getItem("werebox-sem-crt") === "1") app.classList.add("sem-crt");

function iniciarPerfil(selectedSystem) {
  log(`sistema selecionado: ${selectedSystem.name}`, "ok");
  sistemaAtual = selectedSystem;
  configurarMidias(selectedSystem.config);
  definirOS(
    selectedSystem.id === "win101"
      ? "win101"
      : selectedSystem.id === "win203"
        ? "win203"
        : selectedSystem.id === "msdos622"
        ? "msdos"
        : selectedSystem.id === "win95" || selectedSystem.id === "win95inst"
          ? "win95"
          : selectedSystem.id === "novaos"
            ? "novaos"
            : selectedSystem.id === "kolibri"
              ? "kolibri"
              : null,
  );

  // Cada perfil define as SUAS midias. Sem apagar as anteriores, o Windows 1.01
  // herdaria o c.img e o CD do MS-DOS (que ficaram em AJUSTES) e tentaria
  // bootar pelo disco errado.
  for (const k of MIDIAS) delete AJUSTES[k];
  Object.assign(AJUSTES, {
    memory_size: selectedSystem.memory * 1024 * 1024,
    vga_memory_size: selectedSystem.vga_memory * 1024 * 1024,
    ...selectedSystem.config
  });

  boot();
}

/** o perfil padrao e' o GRUB real: vai direto para ele, sem a tela HTML */
async function iniciar() {
  // Aceita ?system=msdos622&download=... e o formato compacto
  // ?system=msdos622=download'https://...' (ver transferencia.mjs).
  const params = paramsDaPagina(location.search);

  // iframe do modo duo: sem barra de ferramentas, a tela ocupa o quadro inteiro.
  if (params.get("embed") === "1") app.classList.add("embed");

  downloadPendente = lerPedidoDownload(params);
  if (downloadPendente) log(`download automático na fila: ${downloadPendente.url}`);

  const forcarMenu = params.get("menu") === "html";
  // ?system=win311 abre direto um perfil (util para testar/regerar uma midia)
  const forcado = params.get("system");
  if (!forcarMenu) {
    try {
      const r = await fetch("profiles.json", { cache: "no-store" });
      if (r.ok) {
        const perfis = await r.json();
        const padrao = forcado
          ? perfis.systems?.find((s) => s.id === forcado)
          : perfis.systems?.find((s) => s.id === perfis.default);
        if (padrao?.bootloader === "grub") {
          const url = padrao.config?.hda?.url || "../Systems/GNU%20GRUB%202.06/grub-hd.img";
          const existe = await fetch(url, { method: "HEAD", cache: "no-store" }).then((x) => x.ok).catch(() => false);
          if (existe) { iniciarPerfil(padrao); return; }
          log(`perfil GRUB sem ${url}; caindo no menu HTML`, "warn");
        } else if (padrao) {
          // o perfil padrao pode ser qualquer sistema; o GRUB so' precisa da
          // checagem extra acima porque o disco dele pode nao existir.
          iniciarPerfil(padrao);
          return;
        }
      }
    } catch (e) {
      log(`não consegui ler profiles.json: ${e.message} — usando o menu HTML`, "warn");
    }
  }
  BootSelector.mostrar(iniciarPerfil);
}

// ?duo=id1,id2 entra no mesmo #app: o duo.mjs esconde a barra/palco do PC unico
// e monta dois iframes (cada um com ?embed=1). Nao existe pagina separada.
const paramsEntrada = paramsDaPagina(location.search);
if (paramsEntrada.get("duo")) {
  import("./duo.mjs")
    .then(({ iniciarDuo }) => iniciarDuo())
    .catch((e) => aviso(`não consegui abrir o modo duo: ${e.message}`));
} else {
  iniciar();
}

window.addEventListener("beforeunload", teardown);
if (!paramsEntrada.get("duo")) setInterval(pintarBotaoPausa, 1500);

window.redos = {
  get emulator() { return em; },
  get pronto() { return pronto; },
  boot, teardown, abrirPainel, fecharPainel, logs, ctx,
  get ultimaLinha() { return em ? ultimaLinhaTela(em) : ""; },
  // API de automação (o painel de arquivos usa exatamente isto por baixo)
  disco: {
    montar: (unidade = "C") => montarFS(em, unidade),
    dispositivo: (unidade = "C") => dispositivoDe(em, unidade),
    baixar: (nome = null, unidade = "C") => baixarImagem(em, nome, unidade),
    salvar: (nome = null, unidade = "C") => salvarNoProjeto(em, nome, unidade),
  },
  velocidade: {
    get alvo() { return em ? alvoAtual(em) : lerAlvo(); },
    get extra() { return em?.v86?.__redosExtra ?? 0; },
    definir(mips) {
      definirAlvo(mips);
      if (em) instalarGovernador(em, Number(mips));
    },
  },
};

// teclado-mobile.mjs — teclado virtual otimizado para mobile
import { el } from "./util.mjs";

let teclado = null;
let visivel = false;
let emulador = null;
let modoAtual = "abc"; // "abc" | "num" | "fn"
let modificadores = { ctrl: false, alt: false, shift: false };

// Layouts de teclado
const LAYOUTS = {
  abc: [
    ["ESC", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "←"],
    ["TAB", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "ENTER"],
    ["CAPS", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'"],
    ["SHIFT", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", "↑"],
    ["CTRL", "ALT", "SPACE", "123", "F*", "←", "↓", "→"],
  ],
  num: [
    ["ESC", "!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "←"],
    ["TAB", "7", "8", "9", "/", "[", "]", "\\", "-", "=", "`", "ENTER"],
    ["CAPS", "4", "5", "6", "*", "{", "}", "|", "_", "+", "~", "'"],
    ["SHIFT", "1", "2", "3", "-", "<", ">", "?", ":", '"', "↑"],
    ["CTRL", "ALT", "0", ".", "ABC", "←", "↓", "→"],
  ],
  fn: [
    ["F1", "F2", "F3", "F4", "F5", "F6", "←"],
    ["F7", "F8", "F9", "F10", "F11", "F12", "ENTER"],
    ["INS", "HOME", "PGUP", "DEL", "END", "PGDN", "↑"],
    ["CTRL", "ALT", "SPACE", "ABC", "←", "↓", "→"],
  ],
};

// Comandos rápidos comuns do DOS
const ATALHOS = [
  { label: "dir", cmd: "dir\n" },
  { label: "cd..", cmd: "cd..\n" },
  { label: "cls", cmd: "cls\n" },
  { label: "ver", cmd: "ver\n" },
  { label: "mem", cmd: "mem\n" },
  { label: "exit", cmd: "exit\n" },
];

// Mapa de teclas especiais para o v86
const MAPA_TECLAS = {
  "ENTER": "\n",
  "TAB": "\t",
  "SPACE": " ",
  "ESC": "\x1b",
  "←": "\x08", // Backspace
  "↑": "\x1b[A",
  "↓": "\x1b[B",
  "→": "\x1b[C",
  "←": "\x1b[D",
  "HOME": "\x1b[H",
  "END": "\x1b[F",
  "PGUP": "\x1b[5~",
  "PGDN": "\x1b[6~",
  "DEL": "\x1b[3~",
  "INS": "\x1b[2~",
  "F1": "\x1bOP",
  "F2": "\x1bOQ",
  "F3": "\x1bOR",
  "F4": "\x1bOS",
  "F5": "\x1b[15~",
  "F6": "\x1b[17~",
  "F7": "\x1b[18~",
  "F8": "\x1b[19~",
  "F9": "\x1b[20~",
  "F10": "\x1b[21~",
  "F11": "\x1b[23~",
  "F12": "\x1b[24~",
};

function vibrar() {
  if (navigator.vibrate) {
    navigator.vibrate(10); // 10ms
  }
}

function enviarTecla(tecla) {
  if (!emulador) return;
  
  vibrar();
  
  // Teclas especiais
  if (MAPA_TECLAS[tecla]) {
    emulador.keyboard_send_text(MAPA_TECLAS[tecla]);
    return;
  }
  
  // Modificadores
  if (tecla === "CTRL") {
    modificadores.ctrl = !modificadores.ctrl;
    atualizarModificadores();
    return;
  }
  if (tecla === "ALT") {
    modificadores.alt = !modificadores.alt;
    atualizarModificadores();
    return;
  }
  if (tecla === "SHIFT") {
    modificadores.shift = !modificadores.shift;
    atualizarModificadores();
    return;
  }
  if (tecla === "CAPS") {
    // Toggle caps lock (não implementado no v86 facilmente)
    return;
  }
  
  // Trocar layout
  if (tecla === "123") {
    trocarModo("num");
    return;
  }
  if (tecla === "ABC") {
    trocarModo("abc");
    return;
  }
  if (tecla === "F*") {
    trocarModo("fn");
    return;
  }
  
  // Tecla normal
  let char = tecla;
  if (modificadores.shift || /^[A-Z]$/.test(tecla)) {
    char = tecla.toUpperCase();
  } else {
    char = tecla.toLowerCase();
  }
  
  emulador.keyboard_send_text(char);
  
  // Auto-desligar shift
  if (modificadores.shift) {
    modificadores.shift = false;
    atualizarModificadores();
  }
}

function enviarComando(cmd) {
  if (!emulador) return;
  vibrar();
  emulador.keyboard_send_text(cmd, 12); // 12ms entre teclas
}

function trocarModo(modo) {
  modoAtual = modo;
  renderizarTeclado();
}

function atualizarModificadores() {
  for (const mod of ["ctrl", "alt", "shift"]) {
    const btn = teclado?.querySelector(`[data-key="${mod.toUpperCase()}"]`);
    if (btn) {
      btn.classList.toggle("mod-ativo", modificadores[mod]);
    }
  }
}

function criarBotaoTecla(tecla) {
  const isModificador = ["CTRL", "ALT", "SHIFT", "CAPS"].includes(tecla);
  const isEspecial = ["ENTER", "TAB", "ESC", "SPACE"].includes(tecla);
  const isNavegacao = ["←", "↑", "↓", "→"].includes(tecla);
  const isTroca = ["123", "ABC", "F*"].includes(tecla);
  
  let classe = "tecla";
  if (isModificador) classe += " tecla-mod";
  if (isEspecial) classe += " tecla-especial";
  if (isNavegacao) classe += " tecla-nav";
  if (isTroca) classe += " tecla-troca";
  
  let label = tecla;
  if (tecla === "SPACE") label = "___";
  if (tecla === "←" && tecla.length === 1) label = "⌫"; // Backspace especial
  
  const btn = el("button", {
    class: classe,
    type: "button",
    "data-key": tecla,
  }, label);
  
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    enviarTecla(tecla);
  });
  
  return btn;
}

function renderizarTeclado() {
  if (!teclado) return;
  
  const corpo = teclado.querySelector(".teclado-corpo");
  if (!corpo) return;
  
  corpo.innerHTML = "";
  
  // Renderizar linhas do layout atual
  const layout = LAYOUTS[modoAtual];
  for (const linha of layout) {
    const linhaEl = el("div", { class: "teclado-linha" });
    for (const tecla of linha) {
      linhaEl.append(criarBotaoTecla(tecla));
    }
    corpo.append(linhaEl);
  }
  
  // Atualizar indicador de modo
  const indicador = teclado.querySelector(".modo-indicador");
  if (indicador) {
    indicador.textContent = {
      abc: "ABC",
      num: "123",
      fn: "F-Keys",
    }[modoAtual];
  }
  
  atualizarModificadores();
}

function criarTeclado() {
  teclado = el("div", { id: "teclado-mobile", class: "teclado-oculto" });
  
  // Cabeçalho com atalhos e fechar
  const cabecalho = el("div", { class: "teclado-cabecalho" },
    el("div", { class: "teclado-atalhos" },
      ...ATALHOS.map(({ label, cmd }) => 
        el("button", {
          class: "atalho-btn",
          type: "button",
          onclick: () => enviarComando(cmd),
        }, label)
      )
    ),
    el("div", { class: "teclado-info" },
      el("span", { class: "modo-indicador" }, "ABC"),
      el("button", {
        class: "btn-fechar-teclado",
        type: "button",
        title: "Fechar teclado",
        onclick: () => toggle(),
      }, "✕")
    )
  );
  
  // Corpo com as teclas
  const corpo = el("div", { class: "teclado-corpo" });
  
  teclado.append(cabecalho, corpo);
  
  return teclado;
}

export function instalar(containerEl, em) {
  emulador = em;
  
  if (!teclado) {
    teclado = criarTeclado();
    containerEl.append(teclado);
    renderizarTeclado();
  }
  
  // Detectar mobile e mostrar botão flutuante
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (isMobile) {
    mostrarBotaoFlutuante(containerEl);
  }
}

function mostrarBotaoFlutuante(containerEl) {
  const botaoExistente = containerEl.querySelector("#btn-teclado-flutuante");
  if (botaoExistente) return;
  
  const btn = el("button", {
    id: "btn-teclado-flutuante",
    class: "btn-flutuante",
    type: "button",
    title: "Abrir teclado virtual",
    onclick: () => toggle(),
  }, "⌨️");
  
  containerEl.append(btn);
}

export function toggle() {
  if (!teclado) return;
  
  visivel = !visivel;
  
  if (visivel) {
    teclado.classList.remove("teclado-oculto");
    teclado.classList.add("teclado-visivel");
  } else {
    teclado.classList.remove("teclado-visivel");
    teclado.classList.add("teclado-oculto");
  }
}

export function mostrar() {
  if (!teclado) return;
  visivel = true;
  teclado.classList.remove("teclado-oculto");
  teclado.classList.add("teclado-visivel");
}

export function esconder() {
  if (!teclado) return;
  visivel = false;
  teclado.classList.remove("teclado-visivel");
  teclado.classList.add("teclado-oculto");
}

export function estaVisivel() {
  return visivel;
}

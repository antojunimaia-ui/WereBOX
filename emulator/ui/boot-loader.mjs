// boot-loader.mjs — apenas o ASCII do WereBOX grande na tela, enchendo de amarelo
const ASCII_ART = [
  "███   ███ ████████ ███████▄  ████████ ██████▄   ▄██████▄  ███▄ ▄███",
  "███   ███ ███      ███   ███ ███      ███  ▐█▌ ███▀  ▀███  ▀█████▀ ",
  "███▄█▄███ ███▀▀▀   ████████  ███▀▀▀   ███▀▀▀█▄ ███    ███   ▄███▄  ",
  "████▀████ ███▄▄▄▄▄ ███   ███ ███▄▄▄▄▄ ███▄▄▄██ ▀███▄▄███▀ ▄███▀███▄",
  " ▀▀   ▀▀  ▀▀▀▀▀▀▀▀ ▀▀▀   ▀▀▀ ▀▀▀▀▀▀▀▀ ▀▀▀▀▀▀▀    ▀▀▀▀▀▀   ▀▀▀   ▀▀▀",
].join("\n");

class WereboxBootLoader {
  constructor() {
    this.el = null;
    this.asciiFg = null;
    this.arquivos = new Map();
    this.pctAtual = 0;
    this.finalizado = false;
  }

  mostrar(container) {
    this.remover();
    this.finalizado = false;
    this.pctAtual = 0;
    this.arquivos.clear();

    const tela = document.createElement("div");
    tela.id = "werebox-boot-screen";
    tela.innerHTML = `
      <div class="wb-ascii-wrap">
        <pre class="wb-ascii wb-ascii-fg">${ASCII_ART}</pre>
      </div>
    `;

    container.appendChild(tela);
    this.el = tela;
    this.asciiFg = tela.querySelector(".wb-ascii-fg");

    this.atualizarProgressoVisual(0);
  }

  atualizar({ arquivo = "", loaded = 0, total = 0, pct = null }) {
    if (!this.el || this.finalizado) return;

    if (arquivo && total > 0) {
      this.arquivos.set(arquivo, { loaded, total });
    }

    let pctFinal = pct;
    let somaLoaded = 0;
    let somaTotal = 0;

    for (const [, item] of this.arquivos) {
      somaLoaded += item.loaded;
      somaTotal += item.total;
    }

    if (pctFinal === null) {
      pctFinal = somaTotal > 0 ? Math.round((somaLoaded / somaTotal) * 100) : 0;
    }

    pctFinal = Math.max(this.pctAtual, Math.min(100, pctFinal));
    this.pctAtual = pctFinal;

    this.atualizarProgressoVisual(pctFinal);
  }

  atualizarProgressoVisual(pct) {
    if (!this.asciiFg) return;
    this.asciiFg.style.setProperty("--loader-pct", `${pct}%`);
  }

  concluir() {
    if (!this.el || this.finalizado) return;
    this.finalizado = true;
    this.atualizarProgressoVisual(100);

    setTimeout(() => {
      this.esconder();
    }, 350);
  }

  esconder() {
    if (!this.el) return;
    this.el.classList.add("wb-boot-oculto");
    setTimeout(() => {
      this.remover();
    }, 350);
  }

  remover() {
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
  }
}

export const BootLoader = new WereboxBootLoader();

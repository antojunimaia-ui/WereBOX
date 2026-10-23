// boot-loader.mjs — apenas o ASCII do WereBOX grande na tela, mudando de cor para amarelo em tempo real
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
    this.asciiEl = null;
    this.pctAtual = 0;
    this.finalizado = false;
  }

  mostrar(container) {
    this.remover();
    this.finalizado = false;
    this.pctAtual = 0;

    const tela = document.createElement("div");
    tela.id = "werebox-boot-screen";
    tela.innerHTML = `
      <div class="wb-ascii-wrap">
        <pre class="wb-ascii">${ASCII_ART}</pre>
      </div>
    `;

    container.appendChild(tela);
    this.el = tela;
    this.asciiEl = tela.querySelector(".wb-ascii");

    this.atualizarProgressoVisual(0);
  }

  atualizar({ arquivo = "", loaded = 0, total = 0, file_index = 0, file_count = 1 }) {
    if (!this.el || this.finalizado) return;

    let pct = 0;
    const totalArquivos = Math.max(1, Number(file_count) || 1);
    const indiceArquivo = Math.max(0, Number(file_index) || 0);

    if (total > 0) {
      const progressoAtual = Math.min(1, Math.max(0, loaded / total));
      pct = Math.round(((indiceArquivo + progressoAtual) / totalArquivos) * 100);
    } else {
      pct = Math.round((indiceArquivo / totalArquivos) * 100);
    }

    pct = Math.max(this.pctAtual, Math.min(100, pct));
    this.pctAtual = pct;

    this.atualizarProgressoVisual(pct);
  }

  atualizarProgressoVisual(pct) {
    if (!this.asciiEl) return;
    this.asciiEl.style.setProperty("--loader-pct", `${pct}%`);
  }

  concluir() {
    if (!this.el || this.finalizado) return;
    this.finalizado = true;
    this.atualizarProgressoVisual(100);

    setTimeout(() => {
      this.esconder();
    }, 280);
  }

  esconder() {
    if (!this.el) return;
    this.el.classList.add("wb-boot-oculto");
    setTimeout(() => {
      this.remover();
    }, 320);
  }

  remover() {
    if (this.el) {
      this.el.remove();
      this.el = null;
      this.asciiEl = null;
    }
  }
}

export const BootLoader = new WereboxBootLoader();

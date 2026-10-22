// boot-selector.mjs — tela de seleção estilo GNU GRUB
import { el, $ } from "./util.mjs";

export class BootSelector {
  constructor(profiles, onSelect) {
    this.profiles = profiles;
    this.onSelect = onSelect;
    this.selectedIndex = 0;
    this.countdown = 5;
    this.timer = null;
    
    // Sistema padrão: o último escolhido (se ainda existir no profiles.json),
    // senão o "default" do arquivo.
    const salvo = localStorage.getItem("redos-selected-os");
    const padrao = profiles.systems.some((s) => s.id === salvo) ? salvo : profiles.default;
    const defaultIdx = profiles.systems.findIndex(s => s.id === padrao);
    if (defaultIdx >= 0) this.selectedIndex = defaultIdx;
  }

  render() {
    const container = el("div", { id: "boot-selector", class: "grub-screen" },
      // Header GRUB-style
      el("div", { class: "grub-header" },
        el("div", { class: "grub-title" }, "GNU GRUB  version 2.06"),
        el("div", { class: "grub-line" })
      ),

      // Menu de sistemas
      el("div", { class: "grub-menu", id: "grub-menu" },
        ...this.profiles.systems.map((sys, idx) => this.criarItem(sys, idx))
      ),

      // Footer com instruções
      el("div", { class: "grub-footer" },
        el("div", { class: "grub-hint" }, 
          "Use as teclas ↑ e ↓ para selecionar qual entrada é destacada."
        ),
        el("div", { class: "grub-hint" }, 
          "Pressione Enter para iniciar o sistema selecionado, 'e' para editar os"
        ),
        el("div", { class: "grub-hint" }, 
          "comandos antes de iniciar ou 'c' para uma linha de comando."
        ),
        el("div", { class: "grub-countdown", id: "grub-countdown" },
          `   O sistema destacado será iniciado automaticamente em ${this.countdown} segundos.   `
        )
      )
    );

    this.container = container;
    this.attachEvents(container);

    return container;
  }

  criarItem(system, index) {
    const isSelected = index === this.selectedIndex;
    
    return el("div", {
      class: `grub-item ${isSelected ? 'grub-item-selected' : ''}`,
      "data-index": index
    },
      el("span", { class: "grub-item-marker" }, isSelected ? "*" : " "),
      el("span", { class: "grub-item-text" }, 
        `${system.name} (${system.year})`
      )
    );
  }

  attachEvents(container) {
    // Navegação por teclado. O handler fica guardado para ser removido quando o
    // sistema for iniciado — senão Enter/↑/↓ continuariam mexendo na máquina
    // depois do boot (e um Enter reabriria/rebootaria tudo por baixo).
    this.onKeyDown = (e) => {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        this.move(-1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        this.move(1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        this.start();
      } else if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        this.showCommandLine();
      } else if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        this.showEdit();
      } else {
        // Qualquer outra tecla cancela o countdown
        this.stopCountdown();
      }
    };
    document.addEventListener("keydown", this.onKeyDown);

    // Clique nos itens
    container.querySelectorAll(".grub-item").forEach(item => {
      item.addEventListener("click", () => {
        this.stopCountdown();
        this.selectedIndex = parseInt(item.dataset.index);
        this.updateSelection(container);
      });
      
      item.addEventListener("dblclick", () => {
        this.selectedIndex = parseInt(item.dataset.index);
        this.start();
      });
    });
  }

  move(delta) {
    this.stopCountdown();
    this.selectedIndex = (this.selectedIndex + delta + this.profiles.systems.length) % this.profiles.systems.length;
    this.updateSelection($("#boot-selector"));
  }

  updateSelection(container) {
    container.querySelectorAll(".grub-item").forEach((item, idx) => {
      const marker = item.querySelector(".grub-item-marker");
      if (idx === this.selectedIndex) {
        item.classList.add("grub-item-selected");
        marker.textContent = "*";
      } else {
        item.classList.remove("grub-item-selected");
        marker.textContent = " ";
      }
    });
  }

  startCountdown() {
    if (this.timer || this.iniciado) return;
    this.timer = setInterval(() => {
      this.countdown--;
      const countdownEl = $("#grub-countdown");
      if (countdownEl) {
        countdownEl.textContent = `   O sistema destacado será iniciado automaticamente em ${this.countdown} segundo${this.countdown !== 1 ? 's' : ''}.   `;
      }

      if (this.countdown <= 0) {
        this.start();
      }
    }, 1000);
  }

  stopCountdown() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      const countdownEl = $("#grub-countdown");
      if (countdownEl) {
        countdownEl.textContent = "";
      }
    }
  }

  showCommandLine() {
    alert("GRUB command line: Não implementado. Use Enter para iniciar.");
  }

  showEdit() {
    const system = this.profiles.systems[this.selectedIndex];
    alert(`Editar entrada: ${system.name}\n\nConfiguração:\n${JSON.stringify(system.config, null, 2)}`);
  }

  start() {
    if (this.iniciado) return;
    this.iniciado = true;
    this.stopCountdown();
    document.removeEventListener("keydown", this.onKeyDown);

    const system = this.profiles.systems[this.selectedIndex];

    // Salvar preferência
    localStorage.setItem('redos-selected-os', system.id);

    // Animação de "booting"
    const container = this.container || $("#boot-selector");
    if (container) {
      container.innerHTML = "";
      container.appendChild(el("div", { class: "grub-booting" },
        el("div", {}, `Booting '${system.name}'...`),
        el("div", { class: "grub-loading" })
      ));
    }

    setTimeout(() => {
      // A tela do GRUB e' uma sobreposicao de tela cheia (z-index 10000). Se ela
      // nao sair, o PC emulado fica rodando atras dela e a pagina parece travada
      // em "Booting..." para sempre.
      container?.remove();
      this.onSelect(system);
    }, 800);
  }

  static async mostrar(onSelect) {
    try {
      // Carregar perfis
      const response = await fetch("profiles.json");
      if (!response.ok) throw new Error("Não foi possível carregar profiles.json");
      
      const profiles = await response.json();

      // Se o disco do GRUB nao existir, nao adianta oferecer a entrada dele no
      // menu HTML: mostra so' os perfis diretos que ainda funcionam.
      const perfilGrub = profiles.systems?.find((s) => s.bootloader === "grub");
      const urlGrub = perfilGrub?.config?.hda?.url || "../Systems/GNU%20GRUB%202.06/grub-hd.img";
      const temGrub = await fetch(urlGrub, { method: "HEAD", cache: "no-store" })
        .then((r) => r.ok).catch(() => false);
      if (!temGrub) profiles.systems = profiles.systems.filter((s) => s.bootloader !== "grub");

      // Criar e mostrar seletor
      const selector = new BootSelector(profiles, onSelect);
      const container = selector.render();

      document.body.appendChild(container);

      // Iniciar countdown APÓS adicionar ao DOM
      selector.startCountdown();

      return selector;
    } catch (e) {
      console.error("Erro ao carregar boot selector:", e);
      // Fallback: iniciar com DOS padrão
      onSelect({
        id: "msdos622",
        name: "MS-DOS 6.22",
        memory: 32,
        vga_memory: 2,
        config: {
          hda: { url: "../Systems/MS-DOS%206.22/c.img" },
          cdrom: { url: "../Systems/MS-DOS%206.22/dos622.iso" },
          boot_order: 0x132
        }
      });
    }
  }
}

// boot-selector.mjs — launcher HTML para escolher o sistema (fallback do GRUB real).
//
// É a tela de `?menu=html` e do item "Escolher sistema". De propósito, não imita
// o GRUB: usa a mesma linguagem visual do resto da interface (lista, tipografia do
// app, destaque em âmbar). O boot "de verdade" continua sendo o GRUB 2.06 na tela
// do PC; isto aqui é só uma alternativa navegável quando o disco do GRUB não existe.
import { el } from "./util.mjs";

const CATEGORIAS = {
  boot: "Bootloader",
  dos: "DOS",
  windows: "Windows",
  os: "Sistema",
  linux: "Linux",
};

const SEGUNDOS = 10;

const lerPreferencia = () => {
  try { return localStorage.getItem("redos-selected-os"); } catch { return null; }
};
const salvarPreferencia = (id) => {
  try { localStorage.setItem("redos-selected-os", id); } catch { /* modo privado */ }
};

export class BootSelector {
  constructor(profiles, onSelect) {
    this.profiles = profiles;
    this.onSelect = onSelect;
    this.selectedIndex = 0;
    this.segundos = SEGUNDOS;
    this.restante = SEGUNDOS;
    this.timer = null;
    this.iniciado = false;
    this.container = null;

    // Começa no último sistema escolhido (se ainda existir). Sem preferência,
    // evita cair no próprio GRUB: o default do app é o GRUB real, mas aqui a
    // ideia é escolher um sistema direto (o GRUB continua na lista).
    const salvo = lerPreferencia();
    const salvoValido = profiles.systems.some((s) => s.id === salvo);
    const primeiroDireto = profiles.systems.find((s) => s.bootloader !== "grub");
    const padrao = salvoValido
      ? salvo
      : profiles.default === "grub" && primeiroDireto
        ? primeiroDireto.id
        : profiles.default;
    const padraoIdx = profiles.systems.findIndex((s) => s.id === padrao);
    if (padraoIdx >= 0) this.selectedIndex = padraoIdx;
  }

  render() {
    const container = el("div", {
      id: "boot-selector",
      class: "boot-launcher",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "Escolher sistema",
    },
      el("div", { class: "boot-painel" },
        el("header", { class: "boot-topo" },
          el("div", { class: "boot-titulo" },
            el("span", { class: "boot-logo", "aria-hidden": "true" }, "▮"),
            el("div", {},
              el("strong", {}, "Escolher sistema"),
              el("span", { class: "boot-sub" }, "WereBOX · máquinas virtuais retrô"))),
          el("div", { class: "boot-contagem" },
            el("span", { id: "boot-contagem-texto", class: "boot-contagem-texto" }, ""),
            el("div", { class: "boot-progresso", "aria-hidden": "true" },
              el("div", { id: "boot-progresso-barra", class: "boot-progresso-barra" })))),

        el("div", { class: "boot-lista", role: "listbox", "aria-label": "Sistemas disponíveis" },
          ...this.profiles.systems.map((s, i) => this.criarCartao(s, i))),

        el("footer", { class: "boot-rodape" },
          el("div", { class: "boot-dicas" },
            el("kbd", {}, "↑"), el("kbd", {}, "↓"), el("span", {}, "navegar"),
            el("span", { class: "boot-ponto" }, "·"),
            el("kbd", {}, "Enter"), el("span", {}, "iniciar"),
            el("span", { class: "boot-ponto" }, "·"),
            el("kbd", {}, "1–9"), el("span", {}, "atalho")),
          el("button", { id: "boot-iniciar", class: "boot-iniciar", type: "button" }, "Iniciar"))),
    );

    this.container = container;
    this.attachEvents(container);
    this.selecionar(this.selectedIndex);
    return container;
  }

  criarCartao(system, index) {
    const categoria = CATEGORIAS[system.category] || system.category || "sistema";
    const cartao = el("button", {
      type: "button",
      class: "boot-cartao",
      role: "option",
      "aria-selected": "false",
      "data-index": String(index),
    },
      el("span", { class: "boot-icone", "aria-hidden": "true" }, system.icon || "💻"),
      el("span", { class: "boot-info" },
        el("span", { class: "boot-linha" },
          el("strong", { class: "boot-nome" }, system.name),
          system.year ? el("span", { class: "boot-ano" }, system.year) : null),
        system.description ? el("span", { class: "boot-desc" }, system.description) : null),
      el("span", { class: "boot-meta" },
        el("span", {}, categoria),
        system.memory ? el("span", { class: "boot-sep" }, "·") : null,
        system.memory ? el("span", {}, `${system.memory} MB`) : null),
      el("span", { class: "boot-seta", "aria-hidden": "true" }, "↵"));

    cartao.addEventListener("click", () => {
      this.pararContagem();
      this.selecionar(index);
    });
    cartao.addEventListener("dblclick", () => {
      this.selecionar(index);
      this.start();
    });
    return cartao;
  }

  attachEvents(container) {
    this.onKeyDown = (e) => {
      const total = this.profiles.systems.length;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault(); this.mover(1);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault(); this.mover(-1);
      } else if (e.key === "Home") {
        e.preventDefault(); this.pararContagem(); this.selecionar(0);
      } else if (e.key === "End") {
        e.preventDefault(); this.pararContagem(); this.selecionar(total - 1);
      } else if (e.key === "Enter") {
        e.preventDefault(); this.start();
      } else if (/^[1-9]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        if (i < total) { this.pararContagem(); this.selecionar(i); }
      } else {
        // qualquer outra tecla cancela a contagem (o usuário assumiu o controle)
        this.pararContagem();
      }
    };
    document.addEventListener("keydown", this.onKeyDown);

    container.querySelector("#boot-iniciar")?.addEventListener("click", () => {
      this.pararContagem();
      this.start();
    });
  }

  mover(delta) {
    this.pararContagem();
    const total = this.profiles.systems.length;
    this.selecionar((this.selectedIndex + delta + total) % total);
  }

  selecionar(index) {
    const total = this.profiles.systems.length;
    if (!total) return;
    this.selectedIndex = ((index % total) + total) % total;

    const cartoes = this.container?.querySelectorAll(".boot-cartao") || [];
    cartoes.forEach((cartao, i) => {
      const ativo = i === this.selectedIndex;
      cartao.classList.toggle("selecionado", ativo);
      cartao.setAttribute("aria-selected", String(ativo));
    });
    cartoes[this.selectedIndex]?.scrollIntoView({ block: "nearest" });

    const system = this.profiles.systems[this.selectedIndex];
    const botao = this.container?.querySelector("#boot-iniciar");
    if (botao) botao.setAttribute("aria-label", `Iniciar ${system.name}`);
  }

  startCountdown() {
    if (this.timer || this.iniciado) return;
    this.restante = this.segundos;
    this.atualizarContagem();
    this.timer = setInterval(() => {
      this.restante--;
      this.atualizarContagem();
      if (this.restante <= 0) this.start();
    }, 1000);
  }

  atualizarContagem() {
    const text = this.container?.querySelector("#boot-contagem-texto");
    const barra = this.container?.querySelector("#boot-progresso-barra");
    if (text) text.textContent = this.restante > 0 ? `inicia em ${this.restante}s` : "iniciando…";
    if (barra) barra.style.width = `${Math.max(0, Math.min(100, ((this.segundos - this.restante) / this.segundos) * 100))}%`;
  }

  pararContagem() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const text = this.container?.querySelector("#boot-contagem-texto");
    const barra = this.container?.querySelector("#boot-progresso-barra");
    if (text) text.textContent = "aguardando escolha";
    if (barra) barra.style.width = "0%";
  }

  start() {
    const system = this.profiles.systems[this.selectedIndex];
    if (this.iniciado || !system) return;
    this.iniciado = true;
    this.pararContagem();
    document.removeEventListener("keydown", this.onKeyDown);

    salvarPreferencia(system.id);

    const container = this.container;
    if (container) {
      container.textContent = "";
      container.append(
        el("div", { class: "boot-iniciando" },
          el("div", { class: "boot-iniciando-marca" }, el("span", {}, "▮"), " WereBOX"),
          el("div", { class: "boot-iniciando-nome" }, system.name),
          el("div", { class: "boot-iniciando-barra" }, el("span", {})),
          el("div", { class: "boot-iniciando-dica" }, "preparando a máquina…")),
      );
    }

    setTimeout(() => {
      container?.remove();
      this.onSelect(system);
    }, 900);
  }

  static async mostrar(onSelect) {
    try {
      const response = await fetch("profiles.json", { cache: "no-store" });
      if (!response.ok) throw new Error("não consegui carregar profiles.json");

      const profiles = await response.json();
      if (!Array.isArray(profiles.systems) || !profiles.systems.length) {
        throw new Error("profiles.json não tem nenhum sistema");
      }

      // Se o disco do GRUB não existir, a entrada dele no menu HTML não serve:
      // mostra só os perfis diretos que ainda funcionam.
      const perfilGrub = profiles.systems.find((s) => s.bootloader === "grub");
      const urlGrub = perfilGrub?.config?.hda?.url || "../Systems/GNU%20GRUB%202.06/grub-hd.img";
      const temGrub = await fetch(urlGrub, { method: "HEAD", cache: "no-store" })
        .then((r) => r.ok).catch(() => false);
      if (!temGrub) profiles.systems = profiles.systems.filter((s) => s.bootloader !== "grub");
      if (!profiles.systems.length) throw new Error("nenhum sistema disponível para o menu HTML");

      const selector = new BootSelector(profiles, onSelect);
      const container = selector.render();
      document.body.appendChild(container);
      selector.startCountdown();
      return selector;
    } catch (e) {
      console.error("não consegui montar o seletor de sistemas:", e);
      // Fallback: boota o MS-DOS direto (o c.img é a imagem que sempre existe).
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

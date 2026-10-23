// paineis/config.mjs — "Machine > Configuração": a ficha da máquina, ao vivo.
import { el, fmtBytes, fmtMB, fmtDuracao, baixarDeUrl } from "../util.mjs";
import { log } from "../logs.mjs";
import { dispositivoC, montarFS, baixarImagem, salvarNoProjeto, tamanhoRemoto, ultimaLinhaTela } from "../discos.mjs";
import { estadoMouse } from "../mouse.mjs";
import { PRESETS, lerAlvo, definirAlvo, instalarGovernador, rotuloAlvo, estaAtivo } from "../velocidade.mjs";

export const meta = { titulo: "Configuração da máquina" };

export function montar(corpo, ctx) {
  const em = ctx.em;
  if (!em) { corpo.append(el("p", { class: "vazio" }, "A máquina não está no ar.")); return; }

  const hda = ctx.config.hda;
  const hdb = ctx.config.hdb;
  const cdrom = ctx.config.cdrom;
  const fda = ctx.config.fda;
  const fdb = ctx.config.fdb;
  // No perfil do GRUB o hda e' o disco de boot e o C: esta no hdb.
  const discoC = hdb || hda;
  const NOME_BOOT = { 1: "disquete", 2: "disco rígido", 3: "CD-ROM" };
  // no v86 a ordem e' lida do digito menos significativo para o mais: 0x132 = disco -> CD -> disquete
  const ordemBoot = (n) => (n >>> 0).toString(16).split("").reverse()
    .map((d) => NOME_BOOT[parseInt(d, 16)] || `desconhecido (${d})`).join(" → ");

  const bloco = (t) => { const s = el("section", { class: "bloco" }, el("h3", {}, t)); corpo.append(s); return s; };
  const campo = (onde, rotulo, valor, classe = "") => {
    const v = el("span", { class: `valor ${classe}` }, valor);
    onde.append(el("div", { class: "campo" }, el("span", { class: "rotulo" }, rotulo), v));
    return v;
  };
  const controle = (onde, rotulo, no) => {
    const v = el("span", { class: "valor" }, no);
    onde.append(el("div", { class: "campo" }, el("span", { class: "rotulo" }, rotulo), v));
    return no;
  };

  /* ------------------------------------------------------- o que está rolando */
  const bAgora = bloco("Agora");
  const vEstado = campo(bAgora, "Estado", "…");
  const vNoAr = campo(bAgora, "No ar há", "…");
  const vVel = campo(bAgora, "Velocidade", "…");
  const vTela = campo(bAgora, "Saída de vídeo", "…");
  const vMouse = campo(bAgora, "Mouse", "…");
  const vUltima = campo(bAgora, "Última linha da tela", "…", "mono");

  /* ----------------------------------------------------------- velocidade */
  const bVel = bloco("Velocidade da CPU");
  const seletorVel = el("select", {
    class: "entrada fino",
    title: "Limite de instruções por segundo (0 = sem limite)",
  }, ...PRESETS.map((p) => el("option", { value: String(p.mips) }, p.nome)));
  controle(bVel, "Limite", seletorVel);
  seletorVel.value = String(lerAlvo());
  seletorVel.addEventListener("change", () => {
    const alvo = Number(seletorVel.value);
    definirAlvo(alvo);
    // durante o boot o limitador fica desligado; a escolha entra quando o
    // sistema terminar de subir (o target já foi salvo em definirAlvo)
    instalarGovernador(em, alvo, estaAtivo(em));
    ctx.status(alvo > 0 ? `CPU limitada a ${rotuloAlvo(alvo)}` : "CPU sem limite de velocidade", "ok");
    log(`limite de velocidade da CPU: ${rotuloAlvo(alvo)}`, "info");
  });
  bVel.append(el("p", { class: "dica" },
    "O v86 roda o mais rápido que o host permitir. O limite insere pausas para simular um PC da época e entra quando o sistema termina de subir (o boot fica na velocidade máxima para não atrapalhar os discos); 5 MIPS equivale a um 386DX e 0 desliga o limite."));

  /* ---------------------------------------------------------------- visual */
  const bVisual = bloco("Visual");
  const app = document.getElementById("app");
  const semCrt = localStorage.getItem("werebox-sem-crt") === "1";
  if (semCrt) app.classList.add("sem-crt");
  const chkCrt = el("input", { type: "checkbox", id: "chk-crt", style: "cursor:pointer" });
  chkCrt.checked = !semCrt;
  chkCrt.addEventListener("change", () => {
    const desligar = !chkCrt.checked;
    app.classList.toggle("sem-crt", desligar);
    localStorage.setItem("werebox-sem-crt", desligar ? "1" : "0");
    log(`scanlines CRT: ${desligar ? "desligadas" : "ligadas"}`, "info");
  });
  const lblCrt = el("label", { for: "chk-crt", style: "cursor:pointer; display:flex; align-items:center; gap:6px" },
    chkCrt, "Scanlines CRT (efeito de linhas de monitor antigo)");
  bVisual.append(el("div", { class: "campo" }, el("span", { class: "rotulo" }, "Scanlines"), el("span", { class: "valor" }, lblCrt)));

  /* ---------------------------------------------------------------- ajustes */
  const bAjustes = bloco("Ajustes da máquina");
  campo(bAjustes, "Memória RAM", fmtMB(ctx.config.memory_size));
  campo(bAjustes, "Memória de vídeo", fmtMB(ctx.config.vga_memory_size));
  campo(bAjustes, "Ordem de boot", `0x${(ctx.config.boot_order >>> 0).toString(16).toUpperCase()} → ${ordemBoot(ctx.config.boot_order)}`);
  campo(bAjustes, "Modo de texto", "fonte VGA de verdade, página de código cp437");
  campo(bAjustes, "CPU", "x86 de 32 bits (é o PC que o v86 emula: 386/486 com FPU)");

  /* ------------------------------------------------------------ mídia: C: */
  let vTamanho = null, vGeo = null, vPart = null, vFS = null, vClusters = null, vArvore = null;
  if (discoC) {
    const bDisco = bloco("Disco rígido (C:)");
    campo(bDisco, "Imagem", discoC.url);
    campo(bDisco, "Dispositivo", hdb ? "hdb (o hda é o disco de boot do GRUB)" : "hda");
    vTamanho = campo(bDisco, "Tamanho", "…");
    vGeo = campo(bDisco, "Geometria", "…");
    vPart = campo(bDisco, "Partição", "…");
    vFS = campo(bDisco, "Sistema de arquivos", "…");
    vClusters = campo(bDisco, "Espaço", "…");
    vArvore = campo(bDisco, "Conteúdo", "…");
  }

  /* ------------------------------------------------------- mídia: CD/disquete */
  const bMidia = bloco("Outras mídias");
  const vHda = hdb ? campo(bMidia, "Disco de boot (hda)", `${hda?.url || "—"} — GRUB 2.06`) : null;
  const vFda = campo(bMidia, "Disquete (A:)", fda ? `${fda.url} — …` : "nenhum");
  const vFdb = fdb ? campo(bMidia, "Disquete de boot (B:)", `${fdb.url} — …`) : null;
  const vCD = campo(bMidia, "CD-ROM (R:)", cdrom ? `${cdrom.url} — …` : "nenhum");

  /* --------------------------------------------------------------- o motor */
  const bMotor = bloco("O motor");
  const vVersao = campo(bMotor, "Versão do v86", "…");
  const vWasm = campo(bMotor, "v86.wasm", "…");
  const vLib = campo(bMotor, "libv86.js", "…");
  const vBios = campo(bMotor, "BIOS", "…");

  /* ---------------------------------------------------------------- ações */
  const bAcoes = bloco("Ações");
  const botao = (rotulo, fn, classe = "") => {
    const b = el("button", { class: classe }, rotulo);
    b.addEventListener("click", async () => {
      b.disabled = true;
      try { await fn(b); } catch (e) { ctx.aviso(`falhou: ${e.message}`); log(`ação "${rotulo}" falhou: ${e.message}`, "err"); }
      finally { b.disabled = false; }
    });
    return b;
  };
  const acoes = [];
  if (discoC) {
    acoes.push(botao("⬇ baixar a imagem do C:", () => {
      const n = baixarImagem(em, "c.img");
      ctx.status(`imagem do C: baixada (${fmtBytes(n)})`);
    }));
    acoes.push(botao("💾 salvar o C: no projeto", async () => {
      const resposta = await salvarNoProjeto(em, null, "C");
      ctx.aviso(resposta, false);
    }, "principal"));
  }
  if (cdrom) acoes.push(botao("⬇ baixar a ISO do CD", () => baixarDeUrl(cdrom.url)));
  acoes.push(botao("⏸ pausar / retomar", () => { em.is_running() ? em.stop() : em.run(); }));
  acoes.push(botao("⟳ reiniciar a máquina", () => {
    if (!confirm("Reiniciar a máquina? O que estiver na RAM se perde (o disco C: não).")) return;
    ctx.reiniciar();
  }));
  bAcoes.append(el("div", { class: "acoes" }, ...acoes));

  /* -------------------------------------------------------------- preencher */
  const t0 = Date.now();
  let contadorAnterior = em.get_instruction_counter?.() ?? 0;
  let tAnterior = Date.now();

  const atualizar = () => {
    const agora = Date.now();
    const contador = em.get_instruction_counter?.() ?? 0;
    const segundos = Math.max(0.001, (agora - tAnterior) / 1000);
    const mips = (contador - contadorAnterior) / segundos / 1e6;
    contadorAnterior = contador; tAnterior = agora;

    vEstado.textContent = em.is_running() ? "rodando" : "pausada";
    vNoAr.textContent = fmtDuracao(agora - t0);
    const alvo = lerAlvo();
    const limite = alvo > 0 ? `${alvo.toLocaleString("pt-BR")} MIPS` : "desligado";
    vVel.textContent = `${mips.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} M instruções/s · limite ${limite} · ${(contador / 1e9).toFixed(2)} G no total`;
    const cv = document.querySelector("#screen canvas");
    vTela.textContent = cv?.width ? `canvas ${cv.width}×${cv.height} px · 80×25 caracteres` : "—";
    const m = estadoMouse(em);
    vMouse.textContent = !m.lido
      ? m.motivo
      : m.pronto
        ? "driver de pé (INT 33h) — o ponteiro do navegador está ligado na máquina"
        : m.assumido
          ? "driver carregado, esperando o fluxo de dados"
          : "sem driver — o C: tem MOUSE.COM e o AUTOEXEC.BAT o carrega no boot";
    vUltima.textContent = ultimaLinhaTela(em) || "(tela vazia)";
  };
  atualizar();
  const timer = setInterval(atualizar, 1000);

  (async () => {
    if (discoC) {
      try {
        const dev = dispositivoC(em);
        vTamanho.textContent = `${fmtBytes(dev.byteLength)} (${dev.byteLength.toLocaleString("pt-BR")} bytes)`;

        const g = dev.geometria();
        vGeo.textContent = g
          ? `${g.cylinders} cilindros × ${g.heads} cabeças × ${g.sectors} setores (tradução ${["nenhuma", "lba", "large"][g.translation] ?? g.translation})`
          : "—";

        const fs = montarFS(em);
        const i = fs.info();
        vPart.textContent = i.particao
          ? `1${i.particao.ativa ? " ativa" : ""}, tipo 0x${i.particao.tipo.toString(16).toUpperCase().padStart(2, "0")}, começa no LBA ${i.particao.lba} (${i.particao.setores.toLocaleString("pt-BR")} setores)`
          : "sem tabela de partição";
        vFS.textContent = `${i.fsTipo} · rótulo "${i.rotulo}" · OEM ${i.oem} · serial ${i.serial.toString(16).toUpperCase().padStart(8, "0")}`;
        vClusters.textContent = `${(i.bytesPorCluster / 1024).toFixed(0)} KB por cluster · ${i.clustersLivres.toLocaleString("pt-BR")} de ${i.clusters.toLocaleString("pt-BR")} clusters livres — ${fmtMB(i.bytesLivres)} livres de ${fmtMB(i.bytesTotal)}`;

        // anda a arvore: quantos arquivos/pastas o disco tem agora
        let arquivos = 0, pastas = 0, bytes = 0;
        const visitar = (cluster) => {
          for (const e of fs.listar(cluster)) {
            if (e.atual || e.pai) continue;
            if (e.diretorio) { pastas++; visitar(e.cluster); }
            else { arquivos++; bytes += e.tamanho; }
          }
        };
        visitar(0);
        vArvore.textContent = `${arquivos} arquivos em ${pastas} diretório(s) — ${fmtMB(bytes)}`;

        log(`ficha do C: lida (${i.fsTipo}, ${i.clustersLivres} clusters livres)`, "ok");
      } catch (e) {
        vFS.textContent = `não consegui ler o disco: ${e.message}`;
        log(`ficha do disco falhou: ${e.message}`, "err");
      }
    }

    try {
      const [wasm, lib, bio, vga] = await Promise.all([
        tamanhoRemoto(ctx.config.wasm_path), tamanhoRemoto("libv86.js"),
        tamanhoRemoto(ctx.config.bios.url), tamanhoRemoto(ctx.config.vga_bios.url),
      ]);
      const pacote = await fetch("node_modules/v86/package.json").then((r) => r.json()).catch(() => null);
      vVersao.textContent = pacote ? `v86 ${pacote.version} (pacote npm "${pacote.name}")` : "v86 (versão não informada pelo pacote)";
      vWasm.textContent = fmtBytes(wasm);
      vLib.textContent = fmtBytes(lib);
      vBios.textContent = `${ctx.config.bios.url} ${fmtBytes(bio)} · ${ctx.config.vga_bios.url} ${fmtBytes(vga)}`;
      if (hdb && hda && vHda) {
        const t = await tamanhoRemoto(hda.url);
        vHda.textContent = `${hda.url} — ${fmtBytes(t)} (disco de boot do GRUB; o C: é o hdb)`;
      }
      if (fda) {
        const t = await tamanhoRemoto(fda.url);
        const uso = fda.url.includes("win101")
          ? "disquete de boot do Windows 1.01"
          : fda.url.includes("win311-boot")
            ? "disquete que inicia o Windows 3.11 em C:"
            : fda.url.includes("win95-boot")
              ? "disquete de instalação do Windows 95 (OEMSETUP no CD)"
              : "disquete";
        vFda.textContent = `${fda.url} — ${fmtBytes(t)} (${uso})`;
      }
      if (fdb) {
        const t = await tamanhoRemoto(fdb.url);
        const uso = fdb.url.includes("win311-boot")
          ? "disquete que inicia o Windows 3.11 em C:"
          : "disquete";
        vFdb.textContent = `${fdb.url} — ${fmtBytes(t)} (${uso})`;
      }
      if (cdrom) {
        const cd = await tamanhoRemoto(cdrom.url);
        const descCD = cdrom.url.includes("NovaOS")
          ? "Live CD do NovaOS, boot via El Torito / GRUB"
          : cdrom.url.includes("Win95")
            ? "CD de instalação do Windows 95 OSR2"
            : "ISO 9660 da Microsoft, montada pelo MSCDEX em R:";
        vCD.textContent = `${cdrom.url} — ${fmtBytes(cd)} (${descCD})`;
      }
    } catch (e) {
      log(`ficha do motor falhou: ${e.message}`, "warn");
    }
  })();

  return () => clearInterval(timer);
}

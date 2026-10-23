// paineis/arquivos.mjs — "Machine > Gerenciador de arquivos": os arquivos da
// propria maquina (C: no disco rígido, A: no disquete), lidos/gravados no FAT.
import { el, fmtBytes, fmtDataHora, baixar, escolherArquivo, pausa } from "../util.mjs";
import { log } from "../logs.mjs";
import { montarFS, salvarNoProjeto, baixarImagem } from "../discos.mjs";
import { arquivoDaUnidade } from "../midias.mjs";
import { dataDOS } from "../fat.mjs";
import { nome83Seguro } from "../nomes.mjs";
import { baixarLinkParaDisco, pausarMaquina } from "../transferencia.mjs";

export const meta = { titulo: "Gerenciador de arquivos" };

const atributos = (e) => [e.diretorio && "D", e.somenteLeitura && "R", e.oculto && "H", e.sistema && "S"].filter(Boolean).join("") || "A";

export function montar(corpo, ctx) {
  const em = ctx.em;
  if (!em) { corpo.append(el("p", { class: "vazio" }, "A máquina não está no ar.")); return; }

  const recado = el("p", { class: "dica mono" }, "");
  const caminhoEl = el("div", { class: "caminho" });
  const listaEl = el("div", { class: "arquivos" });
  let fs = null;                  // sistema de arquivos montado da unidade atual
  let pilha = [];                 // navegação: [{ cluster, nome }]

  // O que esta máquina tem: C: (disco rígido), A: (disquete A) e/ou B: (disquete B).
  const temC = !!(ctx.config.hda || ctx.config.hdb);
  const temA = !!ctx.config.fda;
  const temB = !!ctx.config.fdb;

  if (!temC && !temA && !temB) {
    corpo.append(el("p", { class: "vazio" }, "Este sistema roda direto do CD-ROM (Live CD). Não há discos rígidos ou disquetes FAT anexados para gerenciar."));
    return;
  }

  /** unidade inicial: KolibriOS -> B:; Windows 1.01 -> A:; MS-DOS/GRUB -> C:; senão a que existir */
  function preferida() {
    if ((ctx.osAtual === "kolibri" || ctx.sistemaAtual?.id === "kolibri") && (temB || temA)) return temB ? "B" : "A";
    if (ctx.osAtual === "win101" && temA) return "A";
    if (ctx.osAtual === "msdos" && temC) return "C";
    if (ctx.sistemaAtual?.id === "win101" && temA) return "A";
    return temC ? "C" : temA ? "A" : "B";
  }

  let unidade = preferida();
  let escolhaManual = false;
  const atual = () => (pilha.length ? pilha[pilha.length - 1] : { cluster: 0, nome: `${unidade}:\\` });
  const nomeImagem = () => arquivoDaUnidade(unidade);

  corpo.append(el("p", { class: "alerta" },
    "O que você mexer aqui é gravado direto na imagem do disco, em memória. ",
    "O DOS/Windows em execução guarda setores em cache e pode escrever por cima: ",
    "pause a máquina antes de editar e reinicie depois. O download por link já pausa e reinicia sozinho."));

  const seletor = el("div", { class: "acoes" }, el("span", { class: "dica" }, "disco: "));
  const bC = temC ? el("button", {}, "C:") : null;
  const bA = temA ? el("button", {}, "A:") : null;
  const bB = temB ? el("button", {}, "B:") : null;
  if (bC) seletor.append(bC);
  if (bA) seletor.append(bA);
  if (bB) seletor.append(bB);
  const notaUnidade = el("p", { class: "dica mono" }, "");

  const acoes = el("div", { class: "acoes" });
  const bEnviar = el("button", { class: "principal" }, "⬆ enviar arquivo(s)");
  const bPasta = el("button", {}, "＋ nova pasta");
  const bAtualizar = el("button", {}, "🔄 atualizar");
  const bSalvar = el("button", {}, "💾 salvar o disco no projeto");
  const bBaixar = el("button", {}, "⬇ baixar o disco");
  const bReiniciar = el("button", {}, "⟳ reiniciar a máquina");
  acoes.append(bEnviar, bPasta, bAtualizar, bSalvar, bBaixar, bReiniciar);

  const campoLink = el("input", {
    type: "url",
    class: "entrada",
    placeholder: "https://.../arquivo.exe",
    spellcheck: "false",
    autocomplete: "off",
    "aria-label": "link direto para baixar um arquivo",
  });
  const bLink = el("button", { class: "principal" }, "⬇ baixar link");
  const linhaLink = el("div", { class: "acoes" }, campoLink, bLink);
  campoLink.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); bLink.click(); }
  });

  corpo.append(seletor, acoes, linhaLink, el("p", { class: "dica" },
    "Cole o link direto do arquivo (o que já dispara o download, não a página de anúncio). ",
    "Ele é gravado no diretório atual e a máquina reinicia para o sistema reler o disco."),
  el("p", { class: "dica" },
    "O CD (R:) é só leitura e é montado pelo MSCDEX — para vê-lo, use `dir r:` no próprio DOS."),
  notaUnidade, recado, caminhoEl, listaEl);

  function remontar() {
    fs = montarFS(em, unidade);
    return fs;
  }

  function pintarUnidades() {
    if (bC) bC.className = unidade === "C" ? "unidade-ativa" : "";
    if (bA) bA.className = unidade === "A" ? "unidade-ativa" : "";
    if (bB) bB.className = unidade === "B" ? "unidade-ativa" : "";
    const url = unidade === "B"
      ? ctx.config.fdb?.url
      : unidade === "A"
      ? ctx.config.fda?.url
      : (ctx.config.hdb?.url || ctx.config.hda?.url);
    const caminho = url ? decodeURIComponent(url).replace(/^\.\.\//, "") : "—";
    notaUnidade.textContent = unidade === "B"
      ? `B: é o disquete do KolibriOS (${caminho}).`
      : unidade === "A"
      ? `A: é o disquete anexado (${caminho}). Não apague IO.SYS/MSDOS.SYS/COMMAND.COM se ele for de boot.`
      : `C: é o disco rígido (${caminho})${ctx.sistemaAtual?.id === "win311" || ctx.osAtual === "win311" ? " — o mesmo C: do MS-DOS 6.22, com o Windows 3.11 em C:\\WINDOWS" : ""}.`;
  }

  function trocarUnidade(nova, manual = false) {
    if (manual) escolhaManual = true;
    if (nova !== "C" && nova !== "A" && nova !== "B") return;
    if (nova === "A" && !temA) return;
    if (nova === "B" && !temB) return;
    if (nova === "C" && !temC) return;
    if (nova === unidade) { pintarUnidades(); return; }
    unidade = nova;
    pilha = [];
    fs = null;
    pintar();
  }

  function pintarCaminho() {
    caminhoEl.textContent = "";
    const trilha = [{ cluster: 0, nome: `${unidade}:\\` }, ...pilha];
    trilha.forEach((p, i) => {
      const b = el("button", { class: "trilha" }, p.nome);
      b.addEventListener("click", () => { pilha = pilha.slice(0, i); pintar(); });
      caminhoEl.append(b);
      if (i < trilha.length - 1) caminhoEl.append(el("span", { class: "dica" }, " › "));
    });
  }

  function pintar() {
    pintarCaminho();
    pintarUnidades();
    listaEl.textContent = "";
    if (!fs) {
      try { remontar(); } catch (e) {
        listaEl.append(el("p", { class: "vazio" }, `não consegui montar o ${unidade}: ${e.message}`));
        return;
      }
    }
    let entradas;
    try {
      entradas = fs.listar(atual().cluster);
    } catch (e) {
      listaEl.append(el("p", { class: "vazio" }, `não consegui ler este diretório: ${e.message}`));
      return;
    }
    const i = fs.info();
    // o disquete do Windows 1.01 tem um "rótulo" com bytes de controle; limpa
    const rotulo = String(i.rotulo || "").replace(/[^\x20-\x7E]/g, "").trim() || "(sem rótulo)";
    recado.textContent = `${i.fsTipo} · rótulo "${rotulo}" · ${i.clustersLivres} de ${i.clusters} clusters livres (${fmtBytes(i.bytesLivres)} livres) · ${entradas.filter((e) => !e.atual && !e.pai).length} entrada(s)`;

    const tabela = el("table", { class: "tabela" });
    tabela.append(el("thead", {}, el("tr", {},
      el("th", {}, "nome"), el("th", {}, "tamanho"), el("th", {}, "data"), el("th", {}, "atrib."), el("th", {}, "ações"))));
    const tbody = el("tbody");

    if (pilha.length) {
      const b = el("button", { class: "link" }, "[..]");
      b.addEventListener("click", () => { pilha.pop(); pintar(); });
      tbody.append(el("tr", { class: "linha pasta" }, el("td", {}, b), el("td", {}, "—"), el("td", {}, "—"), el("td", {}, "D"), el("td", {})));
    }

    for (const e of entradas) {
      if (e.atual) continue;
      const nomeCel = el("td");
      if (e.diretorio) {
        const b = el("button", { class: "link" }, `${e.nomeCompleto}\\`);
        b.addEventListener("click", () => { pilha.push({ cluster: e.cluster, nome: e.nomeCompleto }); pintar(); });
        nomeCel.append(b);
      } else {
        nomeCel.append(e.nomeCompleto);
      }

      const td = el("td", {});
      if (!e.diretorio) {
        const bBaixarArquivo = el("button", { class: "mini" }, "⬇ baixar");
        bBaixarArquivo.addEventListener("click", () => {
          try {
            const dados = fs.ler(e);
            baixar(e.nomeCompleto, dados);
            recado.textContent = `${e.nomeCompleto} baixado (${fmtBytes(dados.length)})`;
          } catch (err) { ctx.aviso(`não consegui ler ${e.nomeCompleto}: ${err.message}`); }
        });
        td.append(bBaixarArquivo);
      }
      const bApagar = el("button", { class: "mini perigo" }, "🗑 apagar");
      bApagar.addEventListener("click", () => {
        if (!confirm(`Apagar ${e.diretorio ? "a pasta" : "o arquivo"} ${e.nomeCompleto}?`)) return;
        try {
          fs.apagar(atual().cluster, e);
          log(`${e.nomeCompleto} apagado do disco ${unidade}:`);
          recado.textContent = `${e.nomeCompleto} apagado`;
          remontar();
          pintar();
        } catch (err) { ctx.aviso(`não consegui apagar: ${err.message}`); }
      });
      td.append(bApagar);

      tbody.append(el("tr", { class: e.diretorio ? "linha pasta" : "linha" },
        nomeCel,
        el("td", {}, e.diretorio ? "<DIR>" : fmtBytes(e.tamanho, 2)),
        el("td", {}, dataDOS(e.data, e.hora) || "—"),
        el("td", {}, atributos(e)),
        td,
      ));
    }
    tabela.append(tbody);
    listaEl.append(tabela);
  }

  if (bC) bC.addEventListener("click", () => trocarUnidade("C", true));
  if (bA) bA.addEventListener("click", () => trocarUnidade("A", true));
  if (bB) bB.addEventListener("click", () => trocarUnidade("B", true));

  // Se o usuário não escolheu a unidade na mão, acompanha o sistema que bootou:
  // Windows 1.01 -> A:, MS-DOS -> C:. O evento vem do app.mjs (definirOS).
  function aoMudarOS() {
    if (escolhaManual) return;
    const p = preferida();
    if (p !== unidade) { trocarUnidade(p); return; }
    // mesma unidade, mas o disco pode ter aparecido agora (painel aberto cedo)
    if (!fs) pintar();
  }
  window.addEventListener("redos-os", aoMudarOS);

  bAtualizar.addEventListener("click", () => { remontar(); pintar(); recado.textContent = `relido do ${unidade}:`; });

  bEnviar.addEventListener("click", async () => {
    const arquivos = await escolherArquivo({ multiplo: true });
    if (!arquivos.length) return;
    try {
      remontar();
      const existentes = new Set(fs.listar(atual().cluster).filter((e) => !e.atual && !e.pai).map((e) => e.nomeCompleto));
      const relatos = [];
      for (const f of arquivos) {
        const { nome, mudou } = nome83Seguro(f.name, existentes);
        const bytes = new Uint8Array(await f.arrayBuffer());
        fs.gravar(atual().cluster, nome, bytes);
        existentes.add(nome);
        relatos.push(`${nome} (${fmtBytes(bytes.length)})${mudou ? ` — de "${f.name}"` : ""}`);
        log(`${f.name} enviado para o disco ${unidade}: como ${nome} (${bytes.length} bytes)`);
      }
      recado.textContent = `gravado: ${relatos.join(", ")} — reinicie a máquina para o sistema enxergar`;
      remontar();
      pintar();
    } catch (e) {
      ctx.aviso(`não consegui gravar: ${e.message}`);
    }
  });

  bLink.addEventListener("click", async () => {
    const url = campoLink.value.trim();
    if (!url) { campoLink.focus(); return; }
    bLink.disabled = true;
    campoLink.disabled = true;
    let pausou = false;
    try {
      recado.textContent = `baixando ${url}…`;
      ctx.status(`baixando ${url}…`);
      const r = await baixarLinkParaDisco(em, {
        url,
        unidade,
        cluster: atual().cluster,
        antesDeGravar: async () => { pausou = await pausarMaquina(em); },
      });
      let mensagem;
      if (r.zip && r.extraido) {
        log(`ZIP ${r.nomeOriginal} extraído no ${unidade}: (${r.arquivos} arquivo(s), ${r.pastas} pasta(s), ${fmtBytes(r.bytes)})`, "ok");
        mensagem = `ZIP extraído no ${unidade}: — ${r.arquivos} arquivo(s), ${r.pastas} pasta(s), ${fmtBytes(r.bytes)} — reiniciando a máquina…`;
        ctx.status(`ZIP extraído (${r.arquivos} arquivo(s)); reiniciando`, "ok");
      } else if (r.zip && !r.extraido) {
        const nota = r.renomeado ? ` — de "${r.nomeOriginal}"` : "";
        log(`ZIP ${r.nomeOriginal} não extraído (${r.zipFalhou}); gravado como ${r.nome} (${r.bytes} bytes)${nota}`, "err");
        mensagem = `ZIP não extraído (${r.zipFalhou}); gravado como ${r.nome} (${fmtBytes(r.bytes)})${nota} — reiniciando a máquina…`;
        ctx.status("ZIP gravado sem extrair; reiniciando", "ok");
        ctx.aviso(`ZIP não extraído: ${r.zipFalhou}. O arquivo foi gravado como ${r.nome}.`);
      } else {
        const nota = r.renomeado ? ` — de "${r.nomeOriginal}"` : "";
        log(`${r.nome} baixado de ${url} para ${unidade}: (${r.bytes} bytes)${nota}`, "ok");
        mensagem = `${r.nome} gravado no ${unidade}: (${fmtBytes(r.bytes)})${nota} — reiniciando a máquina…`;
        ctx.status(`${r.nome} baixado; reiniciando`, "ok");
      }
      campoLink.value = "";
      remontar();
      pintar();
      recado.textContent = mensagem;
      await pausa(700);
      ctx.reiniciar();
      // reiniciar nao religa sozinho uma maquina que estava pausada
      em?.run();
    } catch (e) {
      if (pausou) em?.run();
      recado.textContent = "";
      ctx.aviso(`não consegui baixar: ${e.message}`);
    } finally {
      bLink.disabled = false;
      campoLink.disabled = false;
    }
  });

  bPasta.addEventListener("click", () => {
    const nome = prompt("Nome da pasta (8.3, até 8 caracteres + 3 de extensão):", "NOVADIR");
    if (!nome) return;
    try {
      remontar();
      fs.criarPasta(atual().cluster, nome);
      log(`pasta ${nome.toUpperCase()} criada no disco ${unidade}:`);
      remontar();
      pintar();
    } catch (e) { ctx.aviso(`não consegui criar a pasta: ${e.message}`); }
  });

  bSalvar.addEventListener("click", async () => {
    try {
      recado.textContent = `mandando a imagem do ${unidade}: para o projeto…`;
      const resposta = await salvarNoProjeto(em, null, unidade);
      recado.textContent = resposta;
      ctx.status(`imagem do ${unidade}: salva no projeto`, "ok");
    } catch (e) { ctx.aviso(`não consegui salvar: ${e.message}`); }
  });

  bBaixar.addEventListener("click", () => {
    const n = baixarImagem(em, nomeImagem(), unidade);
    recado.textContent = `imagem do ${unidade}: baixada (${fmtBytes(n)})`;
  });

  bReiniciar.addEventListener("click", () => {
    if (!confirm("Reiniciar a máquina para o sistema reler o disco?")) return;
    ctx.reiniciar();
  });

  pintar();
  return () => window.removeEventListener("redos-os", aoMudarOS);
}

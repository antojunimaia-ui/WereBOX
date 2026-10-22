// paineis/logs.mjs — "Machine > Mostrar logs": o diário da sessão ao vivo.
import { el, baixar, fmtBytes } from "../util.mjs";
import { logs } from "../logs.mjs";

export const meta = { titulo: "Logs da sessão" };

const NIVEIS = ["info", "ok", "warn", "err", "dbg"];
const ROTULO_NIVEL = { info: "info", ok: "ok", warn: "aviso", err: "erro", dbg: "detalhe" };

export function montar(corpo, ctx) {
  const visiveis = new Set(NIVEIS);
  let busca = "";
  let seguindo = true;
  let renderizados = 0;

  corpo.append(el("p", { class: "dica" },
    "Tudo em tempo real: ",
    el("b", {}, "reDOS"), " (o que a interface faz), ",
    el("b", {}, "v86"), " (eventos do motor: download das imagens, boot, tela), ",
    el("b", {}, "console"), " (o console do navegador) e ",
    el("b", {}, "erro"), " (falhas de JavaScript)."));

  const campoServidor = el("div", { class: "log-controles" });
  for (const n of NIVEIS) {
    const caixa = el("input", { type: "checkbox", checked: true, id: `nivel-${n}` });
    caixa.addEventListener("change", () => { caixa.checked ? visiveis.add(n) : visiveis.delete(n); pintarTudo(); });
    campoServidor.append(el("label", { class: `marca nivel-${n}` }, caixa, ROTULO_NIVEL[n]));
  }
  const campoBusca = el("input", { class: "entrada fino", type: "search", placeholder: "filtrar por texto…" });
  campoBusca.addEventListener("input", () => { busca = campoBusca.value.toLowerCase(); pintarTudo(); });
  const caixaConsole = el("input", { type: "checkbox" });
  caixaConsole.addEventListener("change", () => {
    logs.capturarConsole(caixaConsole.checked);
    logs.add("reDOS", caixaConsole.checked ? "captura do console do navegador ligada" : "captura do console desligada", "warn");
  });

  const bPausar = el("button", {}, "⏸ pausar a rolagem");
  const bLimpar = el("button", {}, "🧹 limpar");
  const bCopiar = el("button", {}, "📋 copiar");
  const bBaixar = el("button", {}, "⬇ baixar .txt");

  campoServidor.append(el("span", { class: "rotulo-filtro" }, "mostrar:"), campoBusca, el("label", { class: "marca" }, caixaConsole, "capturar o console do navegador"));
  corpo.append(campoServidor);
  corpo.append(el("div", { class: "acoes" }, bPausar, bLimpar, bCopiar, bBaixar));

  const contador = el("p", { class: "dica mono" }, "");
  const painel = el("div", { class: "log" });
  corpo.append(contador, painel);

  const passa = (e) => visiveis.has(e.nivel) && (!busca || e.texto.toLowerCase().includes(busca) || e.fonte.toLowerCase().includes(busca));

  function linha(e) {
    return el("div", { class: `log-linha nivel-${e.nivel}` },
      el("span", { class: "log-hora" }, new Date(e.t).toLocaleTimeString("pt-BR")),
      el("span", { class: "log-fonte" }, e.fonte),
      el("span", { class: "log-texto" }, e.texto));
  }

  function pintarTudo() {
    painel.textContent = "";
    const todas = logs.lista().filter(passa);
    const ultimas = todas.slice(-900);
    for (const e of ultimas) painel.append(linha(e));
    renderizados = ultimas.length;
    contador.textContent = `${todas.length} linha(s) no filtro · ${logs.lista().length} no total${todas.length > ultimas.length ? ` · mostrando as últimas ${ultimas.length}` : ""}`;
    if (seguindo) painel.scrollTop = painel.scrollHeight;
  }

  const desassinar = logs.assinar((e) => {
    if (e === null) { pintarTudo(); return; }
    if (!passa(e)) return;
    painel.append(linha(e));
    renderizados++;
    if (renderizados > 1200) { painel.firstElementChild?.remove(); renderizados--; }
    if (seguindo) painel.scrollTop = painel.scrollHeight;
    contador.textContent = `${logs.lista().length} linha(s) na sessão`;
  });

  bPausar.addEventListener("click", () => {
    seguindo = !seguindo;
    bPausar.textContent = seguindo ? "⏸ pausar a rolagem" : "▶ voltar a seguir";
    if (seguindo) painel.scrollTop = painel.scrollHeight;
  });
  bLimpar.addEventListener("click", () => { logs.limpar(); logs.add("reDOS", "log limpo", "warn"); });
  bCopiar.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(logs.texto());
      contador.textContent = `copiado (${fmtBytes(logs.texto().length)})`;
    } catch (err) { ctx.aviso(`não consegui copiar: ${err.message}`); }
  });
  bBaixar.addEventListener("click", () => baixar(`redos-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`, logs.texto(), "text/plain"));

  pintarTudo();
  logs.add("reDOS", "painel de logs aberto", "dbg");

  return () => desassinar();
}

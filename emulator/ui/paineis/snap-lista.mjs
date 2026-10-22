// paineis/snap-lista.mjs — "Machine > Selecionar snapshot": restaurar, baixar, apagar.
import { el, fmtBytes, fmtDataHora, baixar, escolherArquivo } from "../util.mjs";
import { listar, guardar, apagar } from "../snapshots.mjs";
import { log } from "../logs.mjs";

export const meta = { titulo: "Selecionar snapshot" };

export function montar(corpo, ctx) {
  const em = ctx.em;
  const lista = el("div", { class: "lista-snaps" });
  const recado = el("p", { class: "dica mono" }, "");

  corpo.append(el("p", { class: "dica" },
    "Voltar no tempo: restaurar troca a máquina inteira (RAM, dispositivos e disco C:) pelo estado guardado. ",
    "A imagem do disco volta junto — inclusive os arquivos que você tiver mexido pelo gerenciador."));

  const acoes = el("div", { class: "acoes" });
  const botaoImportar = el("button", {}, "⬆ importar arquivo .v86state");
  const botaoAtualizar = el("button", {}, "🔄 atualizar a lista");
  acoes.append(botaoImportar, botaoAtualizar);
  corpo.append(acoes, recado, lista);

  const nomeArquivoSeguro = (nome) => `${nome.replace(/[^\w áéíóúâêôãõç.:-]+/gi, "_").trim() || "snapshot"}.v86state`;

  async function pintar() {
    lista.textContent = "";
    let snaps = [];
    try { snaps = await listar(); } catch (e) { recado.textContent = `não consegui ler o banco: ${e.message}`; return; }
    if (!snaps.length) {
      lista.append(el("p", { class: "vazio" }, "nenhum snapshot guardado — use Machine → Criar snapshot"));
      return;
    }
    recado.textContent = `${snaps.length} snapshot(s) guardado(s)`;
    for (const s of snaps) {
      const miniatura = s.tela
        ? el("img", { class: "miniatura", src: s.tela, alt: `tela de ${s.nome}` })
        : el("div", { class: "miniatura vazia" }, "sem imagem");
      const detalhe = [
        fmtDataHora(s.criado),
        fmtBytes(s.estado?.byteLength || 0),
        s.resumo?.prompt ? `tela: "${s.resumo.prompt}"` : null,
        s.resumo?.disco ? `${s.resumo.disco.fsTipo} "${s.resumo.disco.rotulo}" · ${s.resumo.disco.livres} clusters livres` : null,
      ].filter(Boolean).join(" · ");

      const bRestaurar = el("button", { class: "principal" }, "↩ restaurar");
      bRestaurar.addEventListener("click", async () => {
        if (!em) { ctx.aviso("a máquina não está no ar"); return; }
        if (!confirm(`Restaurar "${s.nome}"? A máquina inteira volta para esse momento.`)) return;
        bRestaurar.disabled = true;
        recado.textContent = "restaurando…";
        try {
          await em.restore_state(s.estado);
          recado.textContent = `restaurado: "${s.nome}"`;
          ctx.status(`snapshot "${s.nome}" restaurado`, "ok");
          log(`snapshot restaurado: ${s.nome}`, "ok");
        } catch (e) {
          recado.textContent = `falhou: ${e.message}`;
          ctx.aviso(`não consegui restaurar: ${e.message}`);
        } finally { bRestaurar.disabled = false; }
      });

      const bBaixar = el("button", {}, "⬇ baixar");
      bBaixar.addEventListener("click", () => baixar(nomeArquivoSeguro(s.nome), s.estado));

      const bApagar = el("button", { class: "perigo" }, "🗑 apagar");
      bApagar.addEventListener("click", async () => {
        if (!confirm(`Apagar o snapshot "${s.nome}"?`)) return;
        await apagar(s.id);
        pintar();
      });

      lista.append(el("article", { class: "snap" },
        miniatura,
        el("div", { class: "snap-info" },
          el("strong", {}, s.nome),
          el("span", { class: "dica" }, detalhe)),
        el("div", { class: "acoes" }, bRestaurar, bBaixar, bApagar),
      ));
    }
  }

  botaoAtualizar.addEventListener("click", pintar);
  botaoImportar.addEventListener("click", async () => {
    const [arquivo] = await escolherArquivo({ aceita: ".v86state" });
    if (!arquivo) return;
    try {
      recado.textContent = `lendo ${arquivo.name}…`;
      const bytes = new Uint8Array(await arquivo.arrayBuffer());
      const snap = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        nome: arquivo.name.replace(/\.v86state$/i, ""),
        criado: Date.now(),
        estado: bytes,
        tela: null,
        resumo: { prompt: "(importado de arquivo)", disco: null, bytes: bytes.byteLength },
      };
      await guardar(snap);
      recado.textContent = `importado: "${snap.nome}" — clique em restaurar`;
      log(`snapshot importado de arquivo: ${arquivo.name}`, "ok");
      pintar();
    } catch (e) {
      recado.textContent = `falhou: ${e.message}`;
      ctx.aviso(`não consegui importar: ${e.message}`);
    }
  });

  pintar();
}

// paineis/snap-novo.mjs — "Machine > Criar snapshot".
import { el, fmtBytes, fmtDataHora } from "../util.mjs";
import { listar, espaco } from "../snapshots.mjs";
import { criarSnapshot, nomeSugerido } from "./snapshot-comum.mjs";

export const meta = { titulo: "Criar snapshot" };

export function montar(corpo, ctx) {
  const em = ctx.em;
  if (!em) { corpo.append(el("p", { class: "vazio" }, "A máquina não está no ar.")); return; }

  corpo.append(el("p", { class: "dica" },
    "Um snapshot é o retrato da máquina inteira: a RAM (32 MB), os dispositivos e o próprio disco C:. ",
    "Dá uns 22 MB por snapshot (o v86 comprime o estado) e fica guardado no navegador, sobrevivendo ao F5. ",
    "A máquina continua rodando enquanto o snapshot é tirado."));

  const nome = el("input", { class: "entrada", type: "text", value: nomeSugerido(), maxlength: 70, spellcheck: "false" });
  const botao = el("button", { class: "principal" }, "📷 criar snapshot agora");
  const andamento = el("p", { class: "dica mono" }, "pronto para criar");
  corpo.append(el("div", { class: "form" },
    el("label", { class: "campo-form" }, el("span", {}, "Nome"), nome),
    el("div", { class: "acoes" }, botao),
    andamento,
  ));

  const existentes = el("div", { class: "bloco" }, el("h3", {}, "Snapshots já guardados"));
  corpo.append(existentes);

  async function pintarExistentes() {
    existentes.textContent = "";
    existentes.append(el("h3", {}, "Snapshots já guardados"));
    let lista = [];
    try { lista = await listar(); } catch (e) { existentes.append(el("p", { class: "vazio" }, `não consegui ler o banco: ${e.message}`)); return; }
    if (!lista.length) { existentes.append(el("p", { class: "vazio" }, "nenhum ainda")); }
    else {
      const total = lista.reduce((s, x) => s + (x.estado?.byteLength || 0), 0);
      existentes.append(el("p", { class: "dica" }, `${lista.length} snapshot(s) · ${fmtBytes(total)} · o mais recente é de ${fmtDataHora(lista[0].criado)}`));
      existentes.append(el("p", { class: "dica" }, "para restaurar ou apagar, use Machine → Selecionar snapshot"));
    }
    const e = await espaco();
    if (e?.uso) existentes.append(el("p", { class: "dica" }, `o navegador está usando ${fmtBytes(e.uso)} (cota de ${fmtBytes(e.cota)})`));
  }
  pintarExistentes();

  botao.addEventListener("click", async () => {
    botao.disabled = true;
    andamento.className = "dica mono";
    try {
      const s = await criarSnapshot(em, nome.value, (t) => { andamento.textContent = t; });
      andamento.textContent = `pronto: "${s.nome}" — ${fmtBytes(s.estado.byteLength)} guardados`;
      ctx.status(`snapshot "${s.nome}" criado`, "ok");
      nome.value = nomeSugerido();
    } catch (e) {
      andamento.textContent = `falhou: ${e.message}`;
      ctx.aviso(`não consegui criar o snapshot: ${e.message}`);
    } finally {
      botao.disabled = false;
      pintarExistentes();
    }
  });
}

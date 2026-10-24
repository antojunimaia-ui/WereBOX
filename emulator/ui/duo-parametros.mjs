// duo-parametros.mjs — le e valida o ?duo=id1,id2.
//
// Fica separado do duo.mjs (que mexe no DOM) para poder ser testado no Node.

/** Le ?duo=win101,win203. Devolve os dois ids ou uma mensagem de erro. */
export function lerDuo(search = "") {
  const params = new URLSearchParams(search);
  const bruto = params.get("duo");
  if (bruto === null || !bruto.trim()) {
    return { ids: [], erro: "faltou o parametro ?duo=id1,id2" };
  }

  const partes = bruto.split(",").map((s) => s.trim().toLowerCase());
  if (partes.length !== 2 || partes.some((p) => !p)) {
    return {
      ids: partes,
      erro: "?duo= espera exatamente dois sistemas separados por virgula",
    };
  }

  return { ids: partes, erro: null };
}

/** Confere os ids contra a lista de profiles.json. */
export function validarDuo(ids, systems = []) {
  const porId = new Map((systems || []).map((s) => [s.id, s]));
  const faltando = ids.filter((id) => !porId.has(id));
  if (faltando.length) {
    return {
      sistemas: [],
      erro: `sistema(s) desconhecido(s): ${faltando.join(", ")}`,
    };
  }
  return { sistemas: ids.map((id) => porId.get(id)), erro: null };
}

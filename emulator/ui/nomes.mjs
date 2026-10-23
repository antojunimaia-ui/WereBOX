// nomes.mjs — nomes de arquivo que o FAT 8.3 do DOS aceita.
//
// Fica separado do transferencia.mjs para o extrator de ZIP poder usar a mesma
// regra sem criar dependencia circular (transferencia -> zip -> transferencia).

// Nomes de dispositivo do DOS: valem mesmo com extensao (CON.EXE e' o console).
export const RESERVADOS = new Set([
  "CON", "PRN", "AUX", "NUL", "CLOCK$",
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

/** nome de arquivo que caiba em 8.3, sem colidir com o que ja existe */
export function nome83Seguro(original, existentes) {
  const limpo = String(original).trim().toUpperCase().replace(/[^A-Z0-9._$-]/g, "_");
  const ponto = limpo.lastIndexOf(".");
  // O DOS so' tem um ponto: se o nome original tiver varios (foo.bar.exe), o
  // ponto do meio vira "_" para nao gravar uma entrada 8.3 invalida.
  let baseOriginal = (ponto > 0 ? limpo.slice(0, ponto) : limpo).replace(/\./g, "_").slice(0, 8) || "ARQUIVO";
  if (RESERVADOS.has(baseOriginal)) baseOriginal = `_${baseOriginal}`.slice(0, 8);
  const ext = (ponto > 0 ? limpo.slice(ponto + 1) : "").replace(/[^A-Z0-9]/g, "").slice(0, 3);
  const juntar = (b) => (ext ? `${b}.${ext}` : b);
  if (!existentes.has(juntar(baseOriginal))) return { nome: juntar(baseOriginal), mudou: juntar(baseOriginal) !== limpo };
  for (let i = 1; i < 100; i++) {
    const s = String(i);
    const cand = juntar(baseOriginal.slice(0, 8 - s.length) + s);
    if (!existentes.has(cand)) return { nome: cand, mudou: true };
  }
  throw new Error("não achei um nome livre");
}

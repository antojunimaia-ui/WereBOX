// paineis/snapshot-comum.mjs — o que "Criar snapshot" e "Selecionar snapshot" usam juntos.
import { capturarTela } from "../util.mjs";
import { guardar } from "../snapshots.mjs";
import { ultimaLinhaTela, montarFS } from "../discos.mjs";
import { log } from "../logs.mjs";

export function nomeSugerido() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `estado ${p(d.getDate())}/${p(d.getMonth() + 1)} às ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Tira o retrato da máquina: miniatura da tela + save_state() do v86 (RAM,
 * dispositivos e o próprio disco) e guarda no IndexedDB.
 */
export async function criarSnapshot(em, nome, aoProgredir = () => {}) {
  if (!em) throw new Error("a máquina não está no ar");

  aoProgredir("tirando a foto da tela…");
  const tela = capturarTela(400);

  aoProgredir("lendo o disco (sistema de arquivos)…");
  let disco = null;
  try {
    const i = montarFS(em).info();
    disco = { fsTipo: i.fsTipo, rotulo: i.rotulo, livres: i.clustersLivres, clusters: i.clusters };
  } catch (e) { log(`não consegui ler o disco para o resumo: ${e.message}`, "warn"); }

  aoProgredir("salvando o estado da máquina (RAM + dispositivos + disco)…");
  const estado = await em.save_state();
  const bytes = estado instanceof Uint8Array ? estado : new Uint8Array(estado);

  const snap = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    nome: (nome || "").trim() || nomeSugerido(),
    criado: Date.now(),
    estado: bytes,
    tela,
    resumo: { prompt: ultimaLinhaTela(em), disco, bytes: bytes.byteLength },
  };

  aoProgredir("guardando no navegador…");
  await guardar(snap);
  return snap;
}

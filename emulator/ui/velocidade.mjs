// velocidade.mjs — limitador de velocidade da CPU.
//
// O v86 não tem um relógio de CPU fixo: ele executa o `main_loop` o mais rápido
// que o host permitir. Para um PC da época, isso pode ficar rápido demais
// (principalmente o boot). Este módulo mede as instruções por segundo pelo
// contador do próprio v86 e insere uma pausa no `yield` da máquina até chegar
// ao alvo escolhido. O `yield` é o mesmo ponto que o v86 usa para devolver o
// controle ao navegador; a pausa extra só deixa o relógio do PC mais lento.
const CHAVE = "redos.velocidade.mips";
const PADRAO = 5;

export const PRESETS = [
  { id: "286", nome: "286 (≈1,5 MIPS)", mips: 1.5 },
  { id: "386sx", nome: "386SX (≈2,5 MIPS)", mips: 2.5 },
  { id: "386dx", nome: "386DX (≈5 MIPS)", mips: 5 },
  { id: "486", nome: "486 (≈10 MIPS)", mips: 10 },
  { id: "max", nome: "máxima (sem limite)", mips: 0 },
];

/** alvo em MIPS; 0 = sem limite */
export function lerAlvo() {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (bruto === null) return PADRAO;
    const n = Number(bruto);
    return Number.isFinite(n) && n >= 0 ? n : PADRAO;
  } catch {
    return PADRAO;
  }
}

export function definirAlvo(mips) {
  const n = Number(mips);
  if (!Number.isFinite(n) || n < 0) return;
  try { localStorage.setItem(CHAVE, String(n)); } catch { /* modo privado */ }
}

export function alvoAtual(em) {
  return em?.v86?.__redosAlvo ?? lerAlvo();
}

export function rotuloAlvo(mips) {
  const p = PRESETS.find((x) => x.mips === mips);
  if (p) return p.nome;
  return mips > 0 ? `${mips.toLocaleString("pt-BR")} MIPS` : "máxima (sem limite)";
}

const INTERVALO_MS = 500;
const MAX_ATRASO_MS = 80;
// Abaixo disso consideramos que a CPU está parada/halt e não mexemos no limite.
const MIPS_MINIMO = 0.2;

/**
 * Instala (ou reajusta) o limitador numa máquina v86.
 * Pode ser chamado de novo para trocar o alvo sem reiniciar a máquina.
 *
 * `ativo = false` deixa o limitador desligado (usado durante o boot: o
 * controlador de disquete do v86 é sensível a pausas longas). Quando o
 * sistema termina de subir, `ativarGovernador` liga o alvo escolhido.
 */
export function instalarGovernador(em, alvo = lerAlvo(), ativo = true) {
  const m = em?.v86;
  if (!m || typeof m.yield !== "function") return false;
  const alvoNum = Number(alvo);
  if (!Number.isFinite(alvoNum) || alvoNum < 0) return false;

  // Envolve o yield uma única vez por máquina. O yield original do v86 usa um
  // Worker com setTimeout; o atraso extra entra no mesmo postMessage.
  if (!m.__redosYieldOriginal) {
    m.__redosYieldOriginal = m.yield.bind(m);
    m.__redosExtra = 0;
    m.yield = function (atraso, tick) {
      this.__redosYieldOriginal(atraso + (this.__redosExtra || 0), tick);
    };
  }

  if (m.__redosTimer) {
    clearInterval(m.__redosTimer);
    m.__redosTimer = null;
  }
  m.__redosAlvo = alvoNum;
  m.__redosAtivo = Boolean(ativo);

  if (!ativo || alvoNum === 0) {
    m.__redosExtra = 0;
    return true;
  }

  let ultimoContador = em.get_instruction_counter?.() ?? 0;
  let ultimoTempo = performance.now();

  m.__redosTimer = setInterval(() => {
    const agora = performance.now();
    const contador = em.get_instruction_counter?.() ?? 0;

    // Pausada: reinicia a amostra para não contar o tempo parado ao retomar.
    if (typeof em.is_running === "function" && !em.is_running()) {
      ultimoContador = contador;
      ultimoTempo = agora;
      return;
    }

    const segundos = (agora - ultimoTempo) / 1000;
    if (segundos < 0.05) return;

    const delta = (contador - ultimoContador) >>> 0;
    ultimoContador = contador;
    ultimoTempo = agora;

    // O contador tem 32 bits. Um salto gigante é reinício (restart), não wrap:
    // nesse caso só recomeça a amostra.
    if (delta > 0x80000000) return;

    const mips = delta / segundos / 1e6;
    if (!Number.isFinite(mips) || mips < MIPS_MINIMO) return;

    const razao = mips / alvoNum;
    if (razao > 1.08) {
      // Rápido demais: aumenta a pausa proporcionalmente ao excedente.
      m.__redosExtra = Math.min(MAX_ATRASO_MS, m.__redosExtra + Math.max(1, Math.ceil((razao - 1) * 4)));
    } else if (razao < 0.92) {
      // Ficou abaixo do alvo: devolve um pouco da pausa.
      m.__redosExtra = Math.max(0, m.__redosExtra - Math.max(1, Math.ceil((1 - razao) * 4)));
    }
  }, INTERVALO_MS);

  return true;
}

/** Liga o limite com o alvo atual (chamado quando o sistema terminou de subir). */
export function ativarGovernador(em, alvo = lerAlvo()) {
  return instalarGovernador(em, alvo, true);
}

/** Desliga o limite (boot/restart): o alvo fica guardado para depois. */
export function desativarGovernador(em) {
  return instalarGovernador(em, alvoAtual(em), false);
}

export function estaAtivo(em) {
  return Boolean(em?.v86?.__redosAtivo);
}

/** Para o limitador antes de destruir/trocar a máquina. */
export function pararGovernador(em) {
  const m = em?.v86;
  if (!m) return;
  if (m.__redosTimer) {
    clearInterval(m.__redosTimer);
    m.__redosTimer = null;
  }
  m.__redosAtivo = false;
  m.__redosExtra = 0;
}

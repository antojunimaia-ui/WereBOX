// discos.mjs — acesso as midias da maquina: o disco C: e o disquete A: vivos,
// o CD-ROM e as imagens em disco. É a ponte entre o v86 e o fat.mjs / arquivos.
import { abrirFS } from "./fat.mjs";
import { baixar } from "./util.mjs";
import { arquivoDaUnidade, caminhoDaUnidade } from "./midias.mjs";

/**
 * O C: e' o hdb quando o GRUB de verdade ocupa o hda (perfil padrao); nos
 * perfis diretos (menu HTML) o C: e' o hda. Se existir um segundo disco,
 * ele e' o C: — o hda fica reservado para o disco de boot do GRUB.
 */
export function bufferC(em) {
  const ide = em?.v86?.cpu?.devices?.ide;
  const dev = ide?.primary?.slave?.buffer ? ide.primary.slave : ide?.primary?.master;
  if (!dev || !dev.buffer) throw new Error("disco rígido (C:) não encontrado na máquina");
  return { dev, buf: dev.buffer };
}

/** embrulha um SyncBuffer do v86 no dispositivo de blocos que o fat.mjs entende */
function dispositivoDeBuffer(dev, buf) {
  // OBS: SyncBuffer.get(start, len, fn) exige callback; get_from_cache(start, len)
  // devolve a vista na hora — é o que usamos para ler.
  const ler = (off, len) => (buf.get_from_cache ? buf.get_from_cache(off, len) : new Uint8Array(buf.buffer, off, len));
  return {
    byteLength: buf.byteLength,
    get: ler,
    // SyncBuffer.set(inicio, bytes, fn): grava direto na imagem que o DOS enxerga
    set: (off, bytes) => buf.set(off, bytes, () => {}),
    copia: () => ler(0, buf.byteLength).slice(),
    geometria: () => { try { return dev.get_disk_geometry?.() || null; } catch { return null; } },
  };
}

/** dispositivo de blocos do disco C: (hdb no GRUB, hda nos perfis diretos) */
export function dispositivoC(em) {
  const { dev, buf } = bufferC(em);
  return dispositivoDeBuffer(dev, buf);
}

/** dispositivo de blocos do disquete A: (fda) — o Windows 1.01 mora aqui */
export function dispositivoA(em) {
  const dev = em?.v86?.cpu?.devices?.fdc?.drives?.[0];
  if (!dev?.buffer) throw new Error("disquete (A:) não encontrado na máquina");
  return dispositivoDeBuffer(dev, dev.buffer);
}

/** dispositivo de blocos do disquete B: (fdb) — o KolibriOS mora aqui */
export function dispositivoB(em) {
  const dev = em?.v86?.cpu?.devices?.fdc?.drives?.[1];
  if (!dev?.buffer) throw new Error("disquete (B:) não encontrado na máquina");
  return dispositivoDeBuffer(dev, dev.buffer);
}

/** escolhe o dispositivo pela letra: "C" (disco rígido), "A" (disquete A) ou "B" (disquete B) */
export function dispositivoDe(em, unidade = "C") {
  const u = String(unidade).toUpperCase();
  if (u === "A") return dispositivoA(em);
  if (u === "B") return dispositivoB(em);
  return dispositivoC(em);
}

/** monta o sistema de arquivos do disco pedido (FAT12/FAT16) — sempre do zero */
export function montarFS(em, unidade = "C") {
  return abrirFS(dispositivoDe(em, unidade));
}

/** baixa a imagem atual do disco (com tudo o que o DOS e nós escrevemos nela) */
export function baixarImagem(em, nome = null, unidade = "C") {
  const dados = dispositivoDe(em, unidade).copia();
  baixar(nome || arquivoDaUnidade(unidade), dados, "application/octet-stream");
  return dados.byteLength;
}

/** manda a imagem atual para o projeto (POST /emulator/__save) — grava no repositório */
export async function salvarNoProjeto(em, nome = null, unidade = "C") {
  const dados = dispositivoDe(em, unidade).copia();
  const alvo = nome || caminhoDaUnidade(unidade);
  const r = await fetch(`__save?name=${encodeURIComponent(alvo)}`, { method: "POST", body: dados });
  if (!r.ok) throw new Error(`o servidor recusou (${r.status}): ${await r.text()}`);
  return r.text();
}

/** tamanho de um arquivo servido pelo dev server (para a ficha da máquina) */
export async function tamanhoRemoto(url) {
  try {
    const r = await fetch(url, { method: "HEAD" });
    return Number(r.headers.get("content-length")) || 0;
  } catch { return 0; }
}

/** ultima linha com conteudo na tela do DOS */
export function ultimaLinhaTela(em) {
  const linhas = em?.screen_adapter?.get_text_screen?.() || [];
  return [...linhas].reverse().find((l) => l.trim() !== "")?.trim() || "";
}

/** texto completo da tela (25 linhas) */
export const telaTexto = (em) => (em?.screen_adapter?.get_text_screen?.() || []).join("\n");

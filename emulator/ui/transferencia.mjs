// transferencia.mjs — baixa um arquivo por link e grava direto no FAT da maquina.
//
// O download passa pelo servidor (/emulator/__download) porque a maioria dos
// links nao manda cabecalho CORS; o servidor busca o arquivo e devolve os bytes
// para a interface, que grava no disco vivo do v86 com o fat.mjs.
import { montarFS } from "./discos.mjs";
import { pausa } from "./util.mjs";
import { nome83Seguro } from "./nomes.mjs";
import { ehZip, extrairZipParaDisco } from "./zip.mjs";

// Reexportado para quem ja' importava daqui (o gerenciador de arquivos usa o
// nomes.mjs diretamente, mas os testes e outros modulos antigos continuam valendo).
export { nome83Seguro } from "./nomes.mjs";

const UNIDADES = new Set(["A", "B", "C"]);

/**
 * Le a query da pagina, aceitando tambem o formato compacto
 *   ?system=msdos622=download'https://exemplo.com/arquivo.exe'
 * (e a variante com aspas duplas). O link e' lido da query crua para poder
 * conter &, ? e # sem que o URLSearchParams corte o resto.
 */
export function paramsDaPagina(search = "") {
  // O trecho do system=...=download'...' sai da query antes do URLSearchParams:
  // assim um & dentro do link nao vira um parametro da pagina.
  const compacto = /(?:^|[?&])system=([^&=]+)=download(['"])([\s\S]*?)\2(?=&|$)/.exec(search);
  if (compacto) {
    const antes = search.slice(0, compacto.index);
    const depois = search.slice(compacto.index + compacto[0].length);
    const params = new URLSearchParams(antes + depois);
    let link = compacto[3];
    try { link = decodeURIComponent(link); } catch { /* mantem como veio */ }
    params.set("system", compacto[1]);
    params.set("download", link);
    return params;
  }
  const params = new URLSearchParams(search);
  // formato sem aspas (aceito por compatibilidade): ?system=msdos622=download...
  const sistemaBruto = params.get("system");
  if (sistemaBruto?.includes("=download")) {
    const [id, ...resto] = sistemaBruto.split("=download");
    params.set("system", id);
    params.set("download", resto.join("=download"));
  }
  return params;
}

/** le ?download=... (ou ?baixar=...) da URL; devolve null se nao houver pedido */
export function lerPedidoDownload(params) {
  const bruto = params.get("download") || params.get("baixar");
  if (!bruto) return null;
  const unidade = String(params.get("unidade") || params.get("drive") || "").trim().toUpperCase();
  return {
    url: bruto,
    nome: params.get("nome") || params.get("name") || null,
    unidade: UNIDADES.has(unidade) ? unidade : null,
  };
}

/** escolhe a unidade gravavel do sistema atual (C:, A: ou B:) */
export function unidadeDeDownload({ osAtual = null, sistemaAtual = null, config = {} } = {}) {
  const id = osAtual || sistemaAtual?.id || "";
  if (id === "win101" || id === "menuet") {
    if (config.fda) return "A";
  } else if (id === "kolibri") {
    if (config.fdb) return "B";
    if (config.fda) return "A";
  } else if (config.hdb || config.hda) {
    return "C";
  }
  if (config.hda || config.hdb) return "C";
  if (config.fda) return "A";
  if (config.fdb) return "B";
  return null;
}

/**
 * Para a CPU e espera o loop do v86 parar, para gravar no disco sem o sistema
 * escrever por cima. Devolve true se a maquina estava rodando.
 */
export async function pausarMaquina(em) {
  if (!em?.is_running?.()) return false;
  em.stop();
  for (let i = 0; i < 20 && em.is_running?.(); i++) await pausa(50);
  return true;
}

/** tira aspas em volta do link (o formato compacto aceita 'https://...') */
function limparUrl(url) {
  return String(url || "").trim().replace(/^['"]+|['"]+$/g, "");
}

/** filename= ou filename*= do Content-Disposition */
function nomeDoCabecalho(cabecalho) {
  if (!cabecalho) return "";
  const estrela = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(cabecalho);
  if (estrela) {
    let nome = estrela[1].trim().replace(/^"|"$/g, "");
    try { nome = decodeURIComponent(nome); } catch { /* mantem como veio */ }
    if (nome) return nome;
  }
  const simples = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/i.exec(cabecalho);
  return ((simples?.[1] ?? simples?.[2]) || "").trim();
}

/** ultimo segmento do caminho da URL (a query string nao entra) */
function nomeDaUrl(url) {
  try {
    const pedaco = new URL(url).pathname.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(pedaco);
  } catch {
    return "";
  }
}

function escolherNome(headers, url) {
  return nomeDoCabecalho(headers.get("content-disposition")) ||
    nomeDaUrl(headers.get("x-final-url") || url) ||
    "DOWNLOAD.BIN";
}

/** nome de arquivo terminando em .ZIP, para o fallback quando a extracao falha */
function nomeParaZip(nomeOriginal) {
  const s = String(nomeOriginal || "").trim();
  if (/\.zip$/i.test(s)) return s;
  const semExt = s.replace(/\.[^./\\]*$/, "");
  return `${semExt || "ARQUIVO"}.ZIP`;
}

function nomesExistentes(fs, cluster) {
  return new Set(
    fs.listar(cluster)
      .filter((e) => !e.atual && !e.pai)
      .map((e) => e.nomeCompleto),
  );
}

/**
 * Baixa um link pelo servidor e grava no FAT da unidade. Se o arquivo for um
 * ZIP, extrai o conteudo no proprio emulador e nao grava o ZIP; se a extracao
 * nao for possivel, grava o ZIP inteiro como fallback.
 *
 * @param {object} em            instancia do V86
 * @param {object} opcoes
 * @param {string} opcoes.url    link http(s) direto para o arquivo
 * @param {string} [opcoes.unidade="C"]  A:, B: ou C:
 * @param {number} [opcoes.cluster=0]    diretorio de destino (0 = raiz)
 * @param {string} [opcoes.nome]         forca o nome (senao usa Content-Disposition/URL)
 * @param {string} [opcoes.endpoint="__download"]  endpoint do proxy
 * @param {Function} [opcoes.antesDeGravar]  chamado depois do download e antes de gravar
 * @returns {Promise<{nome:string,nomeOriginal:string,renomeado:boolean,bytes:number,unidade:string,urlFinal:string,zip:boolean,extraido:boolean,bytesZip:number,arquivos:number,pastas:number}>}
 */
export async function baixarLinkParaDisco(em, {
  url,
  unidade = "C",
  cluster = 0,
  nome = null,
  endpoint = "__download",
  antesDeGravar = null,
} = {}) {
  if (!em) throw new Error("a máquina não está no ar");
  const alvo = limparUrl(url);
  let parsed;
  try { parsed = new URL(alvo); } catch { throw new Error("link inválido"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("o link precisa começar com http:// ou https://");
  }

  // Primeira montagem so' para saber quanto cabe no disco. Depois do download a
  // gente remonta: o sistema pode ter escrito no FAT enquanto baixava.
  const infoInicial = montarFS(em, unidade).info();
  const livreInicial = Math.max(0, infoInicial.bytesLivres - infoInicial.bytesPorCluster);
  if (livreInicial < 512) throw new Error(`o disco ${unidade}: não tem espaço livre`);

  const separador = endpoint.includes("?") ? "&" : "?";
  const resposta = await fetch(
    `${endpoint}${separador}url=${encodeURIComponent(parsed.href)}&max=${livreInicial}`,
    { cache: "no-store" },
  );
  if (!resposta.ok) {
    const detalhe = (await resposta.text()).trim();
    throw new Error(`o servidor não conseguiu baixar (${resposta.status})${detalhe ? `: ${detalhe}` : ""}`);
  }

  const bytes = new Uint8Array(await resposta.arrayBuffer());
  if (!bytes.length) throw new Error("o link devolveu um arquivo vazio");

  if (antesDeGravar) await antesDeGravar();

  // Remonta depois da pausa para enxergar o FAT como ele esta' agora.
  const fsDisco = montarFS(em, unidade);
  const info = fsDisco.info();
  const livre = Math.max(0, info.bytesLivres - info.bytesPorCluster);
  if (bytes.length > livre) {
    throw new Error(`o arquivo tem ${bytes.length} bytes e o disco ${unidade}: só tem ${livre} livres`);
  }

  const nomeOriginal = nome || escolherNome(resposta.headers, resposta.headers.get("x-final-url") || parsed.href);
  const urlFinal = resposta.headers.get("x-final-url") || parsed.href;

  // ZIP: extrai no proprio emulador e apaga o original. Se o formato nao for
  // suportado (senha, metodo exotico, corrompido) ou nao couber, grava o ZIP
  // como fallback para o sistema convidado tentar depois.
  const pareceZip = ehZip(bytes) || /\.zip$/i.test(nomeOriginal);
  if (pareceZip) {
    try {
      const extraido = await extrairZipParaDisco(bytes, fsDisco, cluster, { limiteBytes: livre });
      return {
        zip: true,
        extraido: true,
        nome: nomeOriginal,
        nomeOriginal,
        nomeZip: nomeOriginal,
        renomeado: false,
        bytes: extraido.bytes,
        bytesZip: bytes.length,
        arquivos: extraido.arquivos,
        pastas: extraido.pastas,
        unidade,
        urlFinal,
      };
    } catch (e) {
      const motivo = e?.message || String(e);
      if (bytes.length > livre) {
        throw new Error(`o ZIP não pôde ser extraído (${motivo}) e não cabe no disco ${unidade}: (${bytes.length} bytes para ${livre} livres)`);
      }
      const nomeZip = nomeParaZip(nomeOriginal);
      const escolhido = nome83Seguro(nomeZip, nomesExistentes(fsDisco, cluster));
      fsDisco.gravar(cluster, escolhido.nome, bytes);
      return {
        zip: true,
        extraido: false,
        zipFalhou: motivo,
        nome: escolhido.nome,
        nomeOriginal,
        nomeZip,
        renomeado: escolhido.mudou,
        bytes: bytes.length,
        bytesZip: bytes.length,
        arquivos: 0,
        pastas: 0,
        unidade,
        urlFinal,
      };
    }
  }

  const escolhido = nome83Seguro(nomeOriginal, nomesExistentes(fsDisco, cluster));
  fsDisco.gravar(cluster, escolhido.nome, bytes);

  return {
    zip: false,
    extraido: false,
    nome: escolhido.nome,
    nomeOriginal,
    nomeZip: null,
    renomeado: escolhido.mudou,
    bytes: bytes.length,
    bytesZip: 0,
    arquivos: 0,
    pastas: 0,
    unidade,
    urlFinal,
  };
}

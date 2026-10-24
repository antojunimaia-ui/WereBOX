// duo.mjs — ?duo=id1,id2 mostra dois PCs lado a lado.
//
// CADA iframe tem sua PRÓPRIA barra completa (não usa ?embed=1).
// A página duo só monta o layout lado a lado.
import { el } from "./util.mjs";
import { lerDuo, validarDuo } from "./duo-parametros.mjs";

let app = null;

function mostrarErro(mensagem) {
  const aviso = document.getElementById("aviso");
  if (!aviso) return;
  aviso.hidden = false;
  aviso.style.display = "";
  aviso.className = "erro";
  aviso.textContent = mensagem;
  document.title = "WereBOX — link duo inválido";
}

function montarPalco(sistemas) {
  const palco = el("div", {
    id: "duo-palco",
    style: "display:flex;width:100%;height:100%;background:#000;overflow:hidden",
  });

  for (const sistema of sistemas) {
    const iframe = el("iframe", {
      src: `./?system=${encodeURIComponent(sistema.id)}`,
      title: sistema.name,
      allow: "fullscreen",
      style: "flex:1 1 50%;width:50%;height:100%;border:0;display:block;background:#000",
    });
    palco.append(iframe);
  }

  app.append(palco);
}

function montar(sistemas) {
  app = document.getElementById("app");
  if (!app) return;

  app.classList.add("duo");

  // Esconde TUDO da página principal - só ficam os iframes
  const barra = document.getElementById("barra");
  const palco = document.getElementById("palco");
  const gaveta = document.getElementById("gaveta");
  const aviso = document.getElementById("aviso");
  
  if (barra) barra.style.display = "none";
  if (palco) palco.style.display = "none";
  if (gaveta) gaveta.style.display = "none";
  if (aviso) aviso.style.display = "none";

  montarPalco(sistemas);
}

export async function iniciarDuo() {
  const { ids, erro } = lerDuo(location.search);
  if (erro) {
    mostrarErro(erro);
    return;
  }

  let dados = null;
  try {
    const r = await fetch("profiles.json", { cache: "no-store" });
    if (r.ok) dados = await r.json();
  } catch {
    // Sem profiles.json, os iframes ainda abrem e mostram o menu deles.
  }

  let sistemas;
  if (dados?.systems) {
    const valido = validarDuo(ids, dados.systems);
    if (valido.erro) {
      const disponiveis = dados.systems.map((s) => s.id).join(", ");
      mostrarErro(`${valido.erro} Disponíveis: ${disponiveis}.`);
      return;
    }
    sistemas = valido.sistemas;
  } else {
    sistemas = ids.map((id) => ({ id, name: id }));
  }

  montar(sistemas);
}

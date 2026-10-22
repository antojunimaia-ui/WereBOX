// paineis/seguranca.mjs — "Machine > Análise de Segurança": syscalls, MBR watchdog, timeline
import { el, fmtBytes, fmtHora } from "../util.mjs";
import { log } from "../logs.mjs";

export const meta = { titulo: "Avançado" };

// Estado global do monitor
const syscalls = [];
const timeline = [];
let mbrHash = null;
let mbrWatchdogAtivo = false;
let hookHandlers = [];

export function montar(corpo, ctx) {
  const em = ctx.em;
  if (!em) { 
    corpo.append(el("p", { class: "vazio" }, "A máquina não está no ar.")); 
    return; 
  }

  // Estrutura com abas recolhíveis
  corpo.append(
    el("div", { class: "dica" }, 
      "🔬 Monitoramento em tempo real de operações suspeitas e análise forense"
    )
  );

  // Container para as seções
  const secoes = el("div", { class: "seguranca-secoes" });
  corpo.append(secoes);

  // Cada seção é um accordeon
  montarSyscallMonitor(secoes, em, ctx);
  montarMBRWatchdog(secoes, em, ctx);
  montarTimeline(secoes, em, ctx);

  // Iniciar monitoramento
  iniciarMonitoramento(em, ctx);

  return () => {
    // Cleanup ao fechar o painel
    pararMonitoramento();
  };
}

/* ========================================================================== */
/*                            SYSCALL MONITOR                                 */
/* ========================================================================== */

function montarSyscallMonitor(container, em, ctx) {
  const secao = criarSecaoRecolhivel(
    "Syscall Monitor",
    "📞 Interceptação de INT 21h (DOS) e INT 13h (disco) em tempo real",
    true // aberta por padrão
  );
  container.append(secao.elemento);

  // Controles
  const controles = el("div", { class: "syscall-controles" },
    el("label", { class: "marca" },
      el("input", { type: "checkbox", checked: true, id: "syscall-int21" }),
      " INT 21h (DOS)"
    ),
    el("label", { class: "marca" },
      el("input", { type: "checkbox", checked: true, id: "syscall-int13" }),
      " INT 13h (Disco)"
    ),
    el("label", { class: "marca" },
      el("input", { type: "checkbox", id: "syscall-suspeito" }),
      " Apenas suspeitos"
    ),
    el("button", { class: "mini", id: "syscall-limpar" }, "Limpar"),
    el("button", { class: "mini", id: "syscall-exportar" }, "Exportar JSON")
  );
  secao.corpo.append(controles);

  // Estatísticas
  const stats = el("div", { class: "syscall-stats" },
    el("span", { class: "stat" }, "Total: ", el("strong", { id: "stat-total" }, "0")),
    el("span", { class: "stat" }, "INT 21h: ", el("strong", { id: "stat-21h" }, "0")),
    el("span", { class: "stat" }, "INT 13h: ", el("strong", { id: "stat-13h" }, "0")),
    el("span", { class: "stat stat-suspeito" }, "⚠ Suspeitos: ", el("strong", { id: "stat-suspeito" }, "0"))
  );
  secao.corpo.append(stats);

  // Lista de syscalls
  const lista = el("div", { class: "syscall-lista", id: "syscall-lista" });
  secao.corpo.append(lista);

  // Event listeners
  document.getElementById("syscall-limpar")?.addEventListener("click", () => {
    syscalls.length = 0;
    atualizarListaSyscalls(lista, []);
  });

  document.getElementById("syscall-exportar")?.addEventListener("click", () => {
    const json = JSON.stringify(syscalls, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `syscalls-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    ctx.aviso("Syscalls exportados com sucesso", false);
  });

  // Atualizar a cada 500ms
  const timer = setInterval(() => {
    const filtros = {
      int21: document.getElementById("syscall-int21")?.checked ?? true,
      int13: document.getElementById("syscall-int13")?.checked ?? true,
      suspeito: document.getElementById("syscall-suspeito")?.checked ?? false,
    };
    
    let filtrados = syscalls;
    if (!filtros.int21) filtrados = filtrados.filter(s => s.int !== "21h");
    if (!filtros.int13) filtrados = filtrados.filter(s => s.int !== "13h");
    if (filtros.suspeito) filtrados = filtrados.filter(s => s.suspeito);

    atualizarListaSyscalls(lista, filtrados.slice(-100)); // últimos 100

    // Stats
    document.getElementById("stat-total").textContent = syscalls.length;
    document.getElementById("stat-21h").textContent = syscalls.filter(s => s.int === "21h").length;
    document.getElementById("stat-13h").textContent = syscalls.filter(s => s.int === "13h").length;
    document.getElementById("stat-suspeito").textContent = syscalls.filter(s => s.suspeito).length;
  }, 500);

  secao.onDestroy = () => clearInterval(timer);
}

function atualizarListaSyscalls(lista, calls) {
  lista.innerHTML = "";
  if (calls.length === 0) {
    lista.append(el("div", { class: "vazio" }, "Nenhuma syscall registrada ainda"));
    return;
  }

  calls.forEach(call => {
    const linha = el("div", { class: `syscall-item ${call.suspeito ? "suspeito" : ""}` },
      el("span", { class: "syscall-time" }, call.time),
      el("span", { class: "syscall-int" }, `INT ${call.int}`),
      el("span", { class: "syscall-func" }, call.funcao),
      el("span", { class: "syscall-desc" }, call.descricao),
      call.suspeito ? el("span", { class: "syscall-alert" }, "⚠") : null
    );
    lista.append(linha);
  });

  // Auto-scroll para o final
  lista.scrollTop = lista.scrollHeight;
}

/* ========================================================================== */
/*                            MBR WATCHDOG                                    */
/* ========================================================================== */

function montarMBRWatchdog(container, em, ctx) {
  const secao = criarSecaoRecolhivel(
    "MBR Watchdog",
    "🛡️ Proteção do Master Boot Record e setores críticos",
    false
  );
  container.append(secao.elemento);

  // Status
  const status = el("div", { class: "mbr-status", id: "mbr-status" },
    el("div", { class: "campo" },
      el("span", { class: "rotulo" }, "Status"),
      el("span", { class: "valor", id: "mbr-status-text" }, "Inicializando...")
    ),
    el("div", { class: "campo" },
      el("span", { class: "rotulo" }, "Hash do MBR"),
      el("span", { class: "valor mono", id: "mbr-hash" }, "—")
    ),
    el("div", { class: "campo" },
      el("span", { class: "rotulo" }, "Última verificação"),
      el("span", { class: "valor", id: "mbr-last-check" }, "—")
    )
  );
  secao.corpo.append(status);

  // Controles
  const controles = el("div", { class: "acoes" },
    el("label", { class: "marca" },
      el("input", { type: "checkbox", id: "mbr-watchdog-ativo", checked: true }),
      " Ativar monitoramento"
    ),
    el("button", { class: "mini", id: "mbr-verificar" }, "Verificar agora"),
    el("button", { class: "mini", id: "mbr-resetar" }, "Resetar hash de referência")
  );
  secao.corpo.append(controles);

  // Histórico de alertas
  const historico = el("div", { class: "mbr-historico" },
    el("h4", {}, "Histórico de Alertas"),
    el("div", { id: "mbr-alertas" })
  );
  secao.corpo.append(historico);

  // Event listeners
  document.getElementById("mbr-verificar")?.addEventListener("click", () => {
    verificarMBR(em, ctx);
  });

  document.getElementById("mbr-resetar")?.addEventListener("click", () => {
    if (!confirm("Resetar hash de referência? O MBR atual será considerado legítimo.")) return;
    mbrHash = null;
    verificarMBR(em, ctx);
    ctx.aviso("Hash de referência do MBR resetado", false);
  });

  // Verificar a cada 2 segundos
  const timer = setInterval(() => {
    const ativo = document.getElementById("mbr-watchdog-ativo")?.checked ?? true;
    if (ativo && mbrWatchdogAtivo) {
      verificarMBR(em, ctx);
    }
  }, 2000);

  secao.onDestroy = () => clearInterval(timer);

  // Verificação inicial
  setTimeout(() => verificarMBR(em, ctx), 500);
}

async function verificarMBR(em, ctx) {
  try {
    // Usar o mesmo método que discos.mjs (sabemos que funciona!)
    const dev = em?.v86?.cpu?.devices?.ide?.primary?.master;
    if (!dev || !dev.buffer) {
      document.getElementById("mbr-status-text").textContent = "❌ Disco não disponível";
      return;
    }

    const buf = dev.buffer;
    
    // Ler 512 bytes do setor 0 (MBR)
    const buffer = buf.get_from_cache 
      ? buf.get_from_cache(0, 512) 
      : new Uint8Array(buf.buffer, 0, 512);

    // Calcular hash simples
    const hash = calcularHash(buffer);
    
    if (mbrHash === null) {
      // Primeira verificação
      mbrHash = hash;
      document.getElementById("mbr-status-text").textContent = "✓ MBR íntegro (baseline estabelecido)";
      document.getElementById("mbr-hash").textContent = hash;
    } else if (mbrHash !== hash) {
      // MBR MODIFICADO!
      document.getElementById("mbr-status-text").textContent = "⚠️ MBR MODIFICADO!";
      adicionarAlertaMBR(hash);
      ctx.aviso("⚠️ ALERTA: MBR foi modificado!", true);
      log("MBR MODIFICADO DETECTADO!", "err");
      
      // Adicionar à timeline
      timeline.push({
        time: fmtHora(new Date()),
        timestamp: Date.now(),
        tipo: "mbr-alert",
        icone: "⚠️",
        descricao: "MBR modificado detectado!",
        detalhes: `Hash anterior: ${mbrHash}, novo: ${hash}`
      });
      
      mbrHash = hash; // Atualizar para o novo
    } else {
      document.getElementById("mbr-status-text").textContent = "✓ MBR íntegro";
    }

    document.getElementById("mbr-hash").textContent = hash;
    document.getElementById("mbr-last-check").textContent = fmtHora(new Date());

  } catch (e) {
    document.getElementById("mbr-status-text").textContent = `❌ Erro: ${e.message}`;
    log(`erro ao verificar MBR: ${e.message}`, "err");
  }
}

function calcularHash(buffer) {
  let hash = 0;
  for (let i = 0; i < buffer.length; i++) {
    hash = ((hash << 5) - hash) + buffer[i];
    hash = hash & hash; // Convert to 32bit integer
  }
  return (hash >>> 0).toString(16).padStart(8, '0').toUpperCase();
}

function adicionarAlertaMBR(novoHash) {
  const container = document.getElementById("mbr-alertas");
  if (!container) return;

  const alerta = el("div", { class: "mbr-alerta" },
    el("span", { class: "mbr-alerta-time" }, fmtHora(new Date())),
    el("span", { class: "mbr-alerta-text" }, `MBR modificado! Novo hash: ${novoHash}`)
  );
  container.prepend(alerta);

  // Manter apenas os últimos 10
  while (container.children.length > 10) {
    container.removeChild(container.lastChild);
  }
}

/* ========================================================================== */
/*                            TIMELINE                                        */
/* ========================================================================== */

function montarTimeline(container, em, ctx) {
  const secao = criarSecaoRecolhivel(
    "Timeline",
    "📊 Histórico completo de eventos da sessão",
    false
  );
  container.append(secao.elemento);

  // Filtros
  const filtros = el("div", { class: "timeline-filtros" },
    el("label", { class: "marca" },
      el("input", { type: "checkbox", checked: true, class: "timeline-filtro", "data-tipo": "sistema" }),
      " Sistema"
    ),
    el("label", { class: "marca" },
      el("input", { type: "checkbox", checked: true, class: "timeline-filtro", "data-tipo": "syscall" }),
      " Syscalls"
    ),
    el("label", { class: "marca" },
      el("input", { type: "checkbox", checked: true, class: "timeline-filtro", "data-tipo": "snapshot" }),
      " Snapshots"
    ),
    el("label", { class: "marca" },
      el("input", { type: "checkbox", checked: true, class: "timeline-filtro", "data-tipo": "mbr-alert" }),
      " Alertas MBR"
    ),
    el("button", { class: "mini", id: "timeline-exportar" }, "Exportar")
  );
  secao.corpo.append(filtros);

  // Lista da timeline
  const lista = el("div", { class: "timeline-lista", id: "timeline-lista" });
  secao.corpo.append(lista);

  // Event listeners
  document.getElementById("timeline-exportar")?.addEventListener("click", () => {
    const json = JSON.stringify(timeline, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timeline-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    ctx.aviso("Timeline exportada com sucesso", false);
  });

  // Atualizar a cada segundo
  const timer = setInterval(() => {
    const filtrosAtivos = {};
    document.querySelectorAll(".timeline-filtro").forEach(cb => {
      filtrosAtivos[cb.dataset.tipo] = cb.checked;
    });

    const filtrados = timeline.filter(ev => filtrosAtivos[ev.tipo]);
    atualizarTimeline(lista, filtrados.slice(-50)); // últimos 50
  }, 1000);

  secao.onDestroy = () => clearInterval(timer);
}

function atualizarTimeline(lista, eventos) {
  lista.innerHTML = "";
  
  if (eventos.length === 0) {
    lista.append(el("div", { class: "vazio" }, "Nenhum evento registrado ainda"));
    return;
  }

  eventos.forEach(ev => {
    const item = el("div", { class: `timeline-item timeline-${ev.tipo}` },
      el("span", { class: "timeline-time" }, ev.time),
      el("span", { class: "timeline-icone" }, ev.icone),
      el("span", { class: "timeline-desc" }, ev.descricao),
      ev.detalhes ? el("span", { class: "timeline-detalhes" }, ev.detalhes) : null
    );
    lista.append(item);
  });
}

/* ========================================================================== */
/*                            MONITORAMENTO                                   */
/* ========================================================================== */

let monitoramentoAtivo = false;
let monitorTimer = null;
let ultimoIP = 0;
let ultimoAH = 0;

function iniciarMonitoramento(em, ctx) {
  if (monitoramentoAtivo) return;
  monitoramentoAtivo = true;
  mbrWatchdogAtivo = true;

  log("monitoramento de segurança iniciado", "ok");

  // Evento inicial na timeline
  timeline.push({
    time: fmtHora(new Date()),
    timestamp: Date.now(),
    tipo: "sistema",
    icone: "🔬",
    descricao: "Análise de segurança iniciada"
  });

  // Monitorar registradores da CPU a cada 50ms
  monitorTimer = setInterval(() => {
    if (!monitoramentoAtivo || !em) return;
    
    try {
      const cpu = em.v86?.cpu;
      if (!cpu) return;

      // Ler registradores via v86
      const regs = cpu.reg32 || [];
      const ah = (regs[0] >>> 8) & 0xFF;  // AH (parte alta de EAX)
      const al = regs[0] & 0xFF;          // AL (parte baixa de EAX)
      const bx = regs[3] & 0xFFFF;        // BX
      const cx = regs[1] & 0xFFFF;        // CX
      const dx = regs[2] & 0xFFFF;        // DX
      
      // Detectar mudanças significativas (heurística simples)
      if (ah !== ultimoAH && ah !== 0) {
        detectarSyscall(em, ctx, ah, al, bx, cx, dx);
        ultimoAH = ah;
      }

    } catch (e) {
      // Silencioso - a CPU pode não estar acessível em alguns momentos
    }
  }, 50);

  // Adicionar também eventos de disco
  if (em.bus) {
    em.bus.register("ide-write-end", function(...args) {
      if (!monitoramentoAtivo) return;
      
      // args pode ser [channel, bytes, sectors] ou [[channel, bytes, sectors]]
      const data = Array.isArray(args[0]) ? args[0] : args;
      const channel = data[0] || 0;
      const bytes = data[1] || 0;
      const sectors = data[2] || 0;
      
      const call = {
        time: fmtHora(new Date()),
        timestamp: Date.now(),
        int: "13h",
        ah: "03h",
        funcao: "WRITE",
        descricao: `canal ${channel}, ${sectors} setor(es), ${fmtBytes(bytes)}`,
        suspeito: false // escritas de disco são normais, MBR Watchdog cuida da proteção
      };
      
      syscalls.push(call);
      
      // Limitar syscalls
      if (syscalls.length > 1000) {
        syscalls.shift();
      }
    }, ctx);

    em.bus.register("ide-read-end", function(...args) {
      if (!monitoramentoAtivo) return;
      
      // args pode ser [channel, bytes, sectors] ou [[channel, bytes, sectors]]
      const data = Array.isArray(args[0]) ? args[0] : args;
      const channel = data[0] || 0;
      const bytes = data[1] || 0;
      const sectors = data[2] || 0;
      
      const call = {
        time: fmtHora(new Date()),
        timestamp: Date.now(),
        int: "13h",
        ah: "02h",
        funcao: "READ",
        descricao: `canal ${channel}, ${sectors} setor(es), ${fmtBytes(bytes)}`,
        suspeito: false
      };
      
      syscalls.push(call);
      
      // Limitar syscalls
      if (syscalls.length > 1000) {
        syscalls.shift();
      }
    }, ctx);
  }
}

function detectarSyscall(em, ctx, ah, al, bx, cx, dx) {
  // Tabela de funções INT 21h mais comuns
  const funcoes21h = {
    0x01: { nome: "READ_CHAR", desc: "Ler caractere do teclado", suspeito: false },
    0x02: { nome: "WRITE_CHAR", desc: "Escrever caractere na tela", suspeito: false },
    0x06: { nome: "DIRECT_IO", desc: "I/O direto do console", suspeito: false },
    0x09: { nome: "WRITE_STR", desc: "Escrever string na tela", suspeito: false },
    0x0A: { nome: "READ_STR", desc: "Ler string do teclado", suspeito: false },
    0x25: { nome: "SET_VECTOR", desc: `Definir vetor INT ${al.toString(16)}h`, suspeito: true },
    0x2A: { nome: "GET_DATE", desc: "Obter data do sistema", suspeito: false },
    0x2C: { nome: "GET_TIME", desc: "Obter hora do sistema", suspeito: false },
    0x30: { nome: "GET_VERSION", desc: "Obter versão do DOS", suspeito: false },
    0x35: { nome: "GET_VECTOR", desc: `Obter vetor INT ${al.toString(16)}h`, suspeito: false },
    0x39: { nome: "MKDIR", desc: "Criar diretório", suspeito: false },
    0x3A: { nome: "RMDIR", desc: "Remover diretório", suspeito: false },
    0x3B: { nome: "CHDIR", desc: "Mudar diretório", suspeito: false },
    0x3C: { nome: "CREATE", desc: "Criar arquivo", suspeito: false },
    0x3D: { nome: "OPEN", desc: `Abrir arquivo (modo ${al})`, suspeito: false },
    0x3E: { nome: "CLOSE", desc: `Fechar handle ${bx}`, suspeito: false },
    0x3F: { nome: "READ", desc: `Ler ${cx} bytes (handle ${bx})`, suspeito: false },
    0x40: { nome: "WRITE", desc: `Escrever ${cx} bytes (handle ${bx})`, suspeito: false },
    0x41: { nome: "DELETE", desc: "Apagar arquivo", suspeito: false },
    0x42: { nome: "SEEK", desc: `Seek handle ${bx}`, suspeito: false },
    0x43: { nome: "GET_ATTR", desc: "Obter atributos de arquivo", suspeito: false },
    0x47: { nome: "GET_DIR", desc: "Obter diretório atual", suspeito: false },
    0x48: { nome: "ALLOC", desc: `Alocar ${bx} parágrafos de memória`, suspeito: false },
    0x49: { nome: "FREE", desc: "Liberar memória", suspeito: false },
    0x4A: { nome: "RESIZE", desc: `Redimensionar memória para ${bx} parágrafos`, suspeito: false },
    0x4B: { nome: "EXEC", desc: "Executar programa", suspeito: true },
    0x4C: { nome: "EXIT", desc: `Sair com código ${al}`, suspeito: false },
    0x4E: { nome: "FIND_FIRST", desc: "Buscar primeiro arquivo", suspeito: false },
    0x4F: { nome: "FIND_NEXT", desc: "Buscar próximo arquivo", suspeito: false },
  };

  const info = funcoes21h[ah];
  if (!info) return; // Função desconhecida

  const call = {
    time: fmtHora(new Date()),
    timestamp: Date.now(),
    int: "21h",
    ah: `${ah.toString(16).toUpperCase().padStart(2, '0')}h`,
    funcao: info.nome,
    descricao: info.desc,
    suspeito: info.suspeito
  };

  syscalls.push(call);

  // Limitar a 1000 entradas para não estourar memória
  if (syscalls.length > 1000) {
    syscalls.shift();
  }

  // Adicionar à timeline se for relevante
  if (info.suspeito || ah === 0x3C || ah === 0x41 || ah === 0x4B) {
    timeline.push({
      time: call.time,
      timestamp: call.timestamp,
      tipo: "syscall",
      icone: info.suspeito ? "⚠️" : "📞",
      descricao: `INT 21h ${call.ah} (${call.funcao})`,
      detalhes: call.descricao
    });

    // Limitar timeline
    if (timeline.length > 500) {
      timeline.shift();
    }
  }
}

function pararMonitoramento() {
  monitoramentoAtivo = false;
  mbrWatchdogAtivo = false;
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
  log("monitoramento de segurança pausado", "dbg");
}

/* ========================================================================== */
/*                            HELPERS                                         */
/* ========================================================================== */

function criarSecaoRecolhivel(titulo, subtitulo, aberta = false) {
  const header = el("div", { class: "secao-header" },
    el("div", { class: "secao-titulo-group" },
      el("h3", { class: "secao-titulo" }, titulo),
      el("p", { class: "secao-subtitulo" }, subtitulo)
    ),
    el("span", { class: "secao-toggle" }, aberta ? "▼" : "▶")
  );

  const corpo = el("div", { class: "secao-corpo", style: aberta ? "" : "display: none;" });

  const elemento = el("div", { class: "secao-recolhivel" }, header, corpo);

  // Toggle ao clicar no header
  header.addEventListener("click", () => {
    const toggle = header.querySelector(".secao-toggle");
    const estaAberta = corpo.style.display !== "none";
    
    if (estaAberta) {
      corpo.style.display = "none";
      toggle.textContent = "▶";
    } else {
      corpo.style.display = "";
      toggle.textContent = "▼";
    }
  });

  return { 
    elemento, 
    corpo, 
    header,
    onDestroy: null  // função de cleanup se necessário
  };
}

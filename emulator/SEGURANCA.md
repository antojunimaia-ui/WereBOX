# Sistema de Análise de Segurança do WereBOX

Painel profissional para análise de malware e testes de segurança em ambiente DOS.

## ⚠️ Segurança do Servidor em Produção

### Endpoints Protegidos

Os seguintes endpoints são **automaticamente desabilitados em produção** (`NODE_ENV=production`):

- **`POST /emulator/__save`** - Salvamento de imagens de disco
- **`GET /emulator/__download`** - Proxy de download de arquivos externos

**Por que são desabilitados?**

1. **`/__download`**: Sem autenticação, poderia ser abusado como proxy anônimo para:
   - Ocultar origem de ataques
   - Baixar conteúdo ilegal usando o IP do servidor
   - DDoS através do seu servidor
   - Violação das políticas de hospedagem (Render, Vercel, etc.)

2. **`/__save`**: Aceita uploads de até 96 MB, podendo:
   - Lotar o disco do servidor
   - Causar abuso de bandwidth
   - Em produção, o sistema de arquivos geralmente é read-only

### Funcionalidades Disponíveis em Produção

✅ **Funcionam normalmente:**
- Todos os sistemas operacionais (MS-DOS, Windows, KolibriOS, etc.)
- Interface completa com barra de ferramentas
- Snapshots (salvos no IndexedDB do navegador)
- Gerenciador de arquivos com **upload manual** de arquivos
- Tela cheia, pausar, reiniciar
- Controle de velocidade da CPU
- Logs da sessão

❌ **Desabilitados por segurança:**
- Download de arquivos por URL (campo "baixar link")
- Salvamento de disco no projeto (botão "salvar no projeto")

### Uso Local (Desenvolvimento)

Para usar **todos** os recursos localmente:

```bash
npm start  # NODE_ENV não definido = modo desenvolvimento
```

### Testar Modo Produção

Para testar como se comportará em produção:

```bash
NODE_ENV=production npm start
```

Os endpoints protegidos retornarão `403 Forbidden` com mensagem explicativa.

---

## Acesso

**Machine > Análise de Segurança**

## Funcionalidades

### 1. Syscall Monitor 📞
- Intercepta INT 21h (DOS) e INT 13h (disco)
- Detecção automática de operações suspeitas
- Filtros por tipo e criticidade
- Export para JSON

### 2. Auto-Snapshot 📷
- Snapshot automático antes de EXEC
- Lista de todos os pontos de restauração
- Restore em 1 clique

### 3. MBR Watchdog 🛡️
- Monitoramento contínuo do Master Boot Record
- Alertas imediatos de modificação
- Histórico de eventos

### 4. Timeline 📊
- Registro completo da sessão
- Filtros por categoria
- Export forense

## Uso Típico

```
1. Ativar monitoramento
2. Executar binário suspeito
3. Observar syscalls em tempo real
4. Verificar alertas de MBR
5. Restaurar snapshot se necessário
6. Export logs para análise
```

## Estado Atual

**Interface:** 100% funcional  
**Backend:** Simulação para demonstração  
**Próximo:** Integração real com hooks do v86

## Arquivos

- `ui/paineis/seguranca.mjs` — lógica do painel
- `ui/estilo.css` — estilos visuais
- Registrado em `app.mjs` e `index.html`

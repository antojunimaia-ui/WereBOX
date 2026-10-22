# Sistema de Análise de Segurança do reDOS

Painel profissional para análise de malware e testes de segurança em ambiente DOS.

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

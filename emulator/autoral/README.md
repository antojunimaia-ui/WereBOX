# reDOS — emulador próprio (núcleo 0.1)

> **APOSENTADO.** A partir de agora o reDOS usa o motor [v86](../README.md) (x86 → WASM) e este
> emulador 8086 + DOS, escrito por nós, fica como laboratório/arquivo: continua rodando
> (`npm run autoral VER DIR`, `npm test`) mas não é mais o caminho do produto.
> Ele foi aposentado depois de a gente provar, testando, que o que ele ainda não fazia
> (x87, CD-ROM/MSCDEX, FIND/FORMAT, FDISK, UNDELETE) o motor pronto já faz.
> Os caminhos abaixo valem a partir desta pasta (`emulator/autoral/`).

Sem js-dos, sem DOSBox. Interpretador 8086 em JS puro (WASM entra quando o
perfil de CPU justificar — hoje o gargalo é cobertura de instruções/INTs,
não velocidade).

## Rodar

### Shell interativo (jeito principal)

```sh
cd emulator
npm start                      # monta C:\ com Systems/MS-DOS 6.22/extracted e sobe o COMMAND.COM real
```

Abre um `C:\>` de verdade: digite `DIR`, `VER`, `CHKDSK`, `MEM`, `XCOPY ...`, etc.
`EXIT` encerra, `Ctrl+C` derruba o processo.

Modo lote (roda os comandos e sai — bom p/ script/teste):

```sh
node redos.mjs VER DIR                # roda VER, DIR e EXIT
node redos.mjs --clean CHKDSK         # --clean = ignora o AUTOEXEC.BAT real
node redos.mjs --dir "../Systems/MS-DOS 6.22/extracted" VER # outra pasta de binarios
```

(O `AUTOEXEC.BAT` real roda `MSCDEX /D:banana`; como ainda não emulamos o
driver de CD, ele imprime `Device driver not found: 'BANANA'`. Use `--clean`
para pular isso.)

### No navegador (o MS-DOS 6.22 rodando de verdade na página)

```sh
cd emulator
npm run manifest                           # gera web/files.json (lista dos 43 arquivos)
cd ..                                      # na raiz do reDOS
python -m http.server 8080
# abra:  http://localhost:8080/emulator/web/
```

A página monta o `C:` buscando os binários de `Systems/MS-DOS 6.22/extracted/`, sobe o `COMMAND.COM`
real, desenha o texto 80x25 (com cores, lendo a VRAM em `B800:0000`) e captura o
teclado. Clique na tela e digite: `DIR`, `VER`, `CHKDSK`, `MEM`… `EXIT` encerra.
O botão *reiniciar* refaz o boot; a caixa `AUTOEXEC.BAT` controla se o
AUTOEXEC real roda no boot.

Digitação tecla a tecla com eco imediato e `Backspace` que edita (o núcleo
pausa a CPU enquanto o programa espera teclado: `INPUT_WAIT` em `dos.js`).

**Tela cheia**: botão `⛶ tela cheia`, duplo clique na tela, ou `window.redos.fullscreen()`.
`ESC` sai. O canvas é redesenhado no tamanho final (colunas múltiplas de 80,
linhas de 25), então o texto fica nítido em qualquer resolução — sem interpolação.
Se a Fullscreen API não responder, cai automaticamente num modo CSS equivalente.

### Testes

```sh
npm test                                   # regressões do núcleo (31 casos)
```

## O que roda hoje

* `.COM` via `Machine.loadCom()` em `0x1000:0x0100` com PSP mínimo, `DS=ES=SS=CS`, `SP=FFFE`.
* CPU M2: ModR/M, `MOV/ADD/ADC/SUB/SBB/AND/OR/XOR/CMP/TEST` (incl. `80/81/83`, `F6/F7`),
  `INC/DEC`, shifts, `JMP/Jcc/CALL/RET/RETF/LOOP`, string ops + `REP`,
  `PUSH/POP/PUSHA`, `LEA/LDS/LES`, `IN/OUT` (stub), `AAM/AAD/DAA/DAS/AAA/AAS`.
* DOS: `INT 20h`, `INT 21h AH=01/02/06/07/08/09/0A/0B/0C/0E/19/1A/25/26/2A/2C/30/33/35/`
  `36/38/39/3A/3B/3C/3D/3E/3F/40/41/42/44/47/48/49/4A/4C/4D/4E/4F/50/51/52/62/63/65`,
  loader MZ + relocs, cadeia MCB real + `AH=48` que caminha nela,
  `INT 10h` teletype/cursor/modo, `INT 16h` fila + BDA `40:1A/1C`,
  tick do BIOS `40:6C`, `INT 13h` reset, `INT 2Fh` (ausente), `INT 33h` (sem mouse).
* **Binários MS reais de ponta a ponta:** `FIND.EXE` (MZ + exit 2),
  `TREE.COM` (exit 1) — regressões ok 7/ok 8.
* **COMMAND.COM real (54.645 bytes): 500 passos sem falha de CPU** —
  `JMP` inicial, `INT 21h AH=50h/30h`, auto-relocação p/ `CS=126E`
  (`MOV CS:[219B]` + `CALL FAR [2199]`), parsing de linha de comando.
  Trava de progresso em `tests/run.js` (ok 5).
* **COMMAND.COM real interativo (trava ok 13):** banner, prompt `C:\>`,
  `VER` → "MS-DOS Version 6.22", `DIR` → 43 arquivos com nomes 8.3,
  tamanhos, datas e totais corretos, `ECHO`, `EXIT` com saída limpa.
* DTA FCB-find (observado): nome[8]@+8, ext[3]@+10H, attr@+13H,
  hora@+1EH, data@+20H, tamanho-lo@+22H/+24H, tamanho-hi@+26H.
  Datas/horas/serial/vol-label: constantes plausíveis (cosmético).
* Limite atual: comandos externos via EXEC funcionam (ok 9), mas
  ainda sem `TYPE`/`DEL`/`COPY` internos testados nem `AUTOEXEC.BAT`
  no boot; `GOTO`/`IF`/`FOR` em batch não cobertos.

## Mapa de INTs (scan estático da ISO — superestima)

Contagem de bytes `CD xx` no binário (inclui dados, não só código).
Prioridade real de implementação:

| Vetor | Ocorrências | Status | Próximo marco |
|---|---|---|---|
| 21h DOS | 1364 | AH=09,4C ok | 02,0A,3C-42 (console/arquivo), 25/35 (vetores), 4E/4F (find), 30/33/44 (info) |
| 20h exit | 303 | ok | — |
| 2Fh multiplex | 234 | todo | AX=16xx (win), 11xx (MSCDEX), 12xx (DRVSPACE) |
| 10h vídeo | 146 | todo | 00 (modo), 02 (cursor), 06 (scroll), 09/0A (char), 0E (teletype), 0F (get modo) |
| 33h mouse | 61 | todo | 00 (reset), 01/02 (cursor), 03 (posição) |
| 16h teclado | 46 | todo | 00 (get key), 01 (status), 02 (shift) |
| 13h disco | 43 | todo | 02/03 (setores), 08 (params), 15 (tipo) |
| 15h / 1Ah / 67h | 64/30/18 | todo | wait/cassete, relógio, EMS |
| restante (00-FF) | ruído alto | ignorar | re-medir via trace dinâmico, não scan |

## Roteiro p/ binários MS

1. **M1 (atual):** núcleo + HELLO.COM + testes. ✅
2. **M2:** ModR/M + `MOV/ADD/SUB/CMP` + `JMP/Jcc/CALL/RET` + `PUSH/POP` + prefixos de segmento → roda `TREE.COM`/`FIND.EXE` simples.
3. **M3:** loader MZ (`MZ` + header + relocs) + PSP + INT 21h arquivo/console (abrir/ler/escrever, `3D/3F/40/42`, `01/02/07/0A`) → roda utilitários pequenos.
4. **M4:** `INT 10h/16h/13h` texto + FAT12/16 em memória + `COMMAND.COM` interativo.
5. **M5:** EMS/XMS (`INT 67h`, `HIMEM/EMM386` ficam de fora — prover XMS/EMS virtual), `MSCDEX` virtual p/ `R:`.
6. **M6:** WASM (compilar CPU em AssemblyScript/Rust) + testes de conformidade por binário da ISO.

## Limites honestos

* `COMMAND.COM`/`IO.SYS`/`MSDOS.SYS` exigem centenas de serviços; M2–M4 são semanas de trabalho, não horas.
* MS-DOS 6.22 é proprietário: distribuir a ISO pode infringir licença — o núcleo reDOS é limpo, os binários MS continuam sendo da Microsoft.
* A demo js-dos (DOSBox) que existia na raiz do repositório foi removida — este emulador e o v86 tomaram o lugar dela.

# WereBOX

**Sistemas operacionais clássicos e experimentais de verdade no navegador.** MS-DOS 6.22, Windows 
1.01/2.03/3.11, KolibriOS, MenuetOS, NovaOS e mais. A interface é nossa (tema CRT, cores CGA, 
tela cheia, barra de ferramentas); o motor é o [v86](https://github.com/copy/v86) (x86 → WASM).

```
WereBOX/
  Systems/              as mídias dos sistemas (ver Systems/README.md)
    MS-DOS 6.22/        c.img · msdos.img · dos622.iso · novo.img · extracted/
    Windows 1.01/       win101.img · Windows 1.01.iso
    Windows 2.03/       win203.img
    Windows 3.11/       win311hd.img · win311-boot.img · disk01-07.img
    KolibriOS/          kolibri.img (1.44 MB, 100% Assembly x86)
    MenuetOS/           menuet.img (1.44 MB, 100% Assembly x86)
    NovaOS/             NovaOS.iso (kernel Multiboot, VBE 1280×720)
    TinyCore/           tinycore.iso (Linux ultraleve)
    GNU GRUB 2.06/      grub-hd.img · grub/ (boot.img, core.img, grub.cfg, licença)
  emulator/
    index.html          a interface: barra de ferramentas + tela do PC (motor v86)
    ui/                 o código da interface (ver "A interface" abaixo)
      app.mjs           sobe a máquina, monta a barra, abre os painéis
      boot-selector.mjs menu HTML de fallback (o boot padrão é o GRUB real)
      estilo.css        o visual (tema, cores, scanlines — tudo em variáveis)
      fat.mjs           leitor/gravador de FAT12/FAT16 (os arquivos da máquina)
      discos.mjs        os discos C:/A:/B: vivos do v86 (ler/gravar/baixar/salvar no projeto)
      midias.mjs        onde cada imagem é salva em Systems/
      mouse.mjs         o estado do mouse (o driver assumiu o PS/2?)
      snapshots.mjs     snapshots no IndexedDB do navegador
      logs.mjs          o diário da sessão
      teclado-mobile.mjs teclado virtual para mobile
      duo.mjs           modo comparação lado a lado
      paineis/          config · snap-novo · snap-lista · arquivos · logs · seguranca
    tests/              testes em Node (fat.test.mjs — roda sem navegador)
    preparar-disco.html bancada: monta o disco C: usando o próprio DOS
    autoral/            o emulador 8086 + DOS que escrevemos — APOSENTADO (ver autoral/README.md)
    profiles.json       os 9 sistemas do menu de boot (mídias, RAM, ordem de boot)
    tools/              setup-v86.mjs · mk-grub.mjs · mkdisk.mjs · instalar-mouse.mjs · serve.mjs
    libv86.js v86.wasm  motor v86 (do pacote npm)
    seabios.bin vgabios.bin   BIOS do PC emulado
    capturas/           prints do PC emulado (GRUB real, Windows 3.11, Windows 1.01, DOS)
```

## Como rodar

```bash
cd emulator
npm install
npm start          # roda tools/setup-v86.mjs e sobe o servidor em http://localhost:8123/emulator/
```

(`npm run serve` sobe só o servidor; ele precisa existir porque o v86 carrega `.wasm` e as
imagens por HTTP — abrir por `file://` não funciona.)

O `npm start` também extrai `Systems/Windows 1.01/win101.img` de
`Systems/Windows 1.01/Windows 1.01.iso` e monta
`Systems/GNU GRUB 2.06/grub-hd.img` a partir de `Systems/GNU GRUB 2.06/grub/` (ver
abaixo). Sem a ISO o perfil do Windows 1.01 fica sem mídia; o MS-DOS e o Windows
3.11 continuam funcionando. O Windows 3.11 já está instalado no `c.img`; o
`win311-boot.img` é um disquete de boot que só existe para o perfil direto.

## Escolha do sistema (GNU GRUB de verdade)

Ao abrir, o PC boota direto no **GNU GRUB 2.06** rodando dentro do v86 — não é uma
tela HTML. **↑/↓** escolhem, **Enter** inicia e o destaque começa sozinho depois de
12 segundos. O menu tem **MS-DOS 6.22 (C:)**, **Windows 2.03 (C:)**, **Windows 3.11 (C:)**, 
**Windows 1.01 (A:)** e **KolibriOS (B:)**; o teclado do navegador chega ao GRUB como em 
qualquer sistema emulado.

O GRUB fica no `hda` (`Systems/GNU GRUB 2.06/grub-hd.img`); o disco do MS-DOS e do
Windows 3.11 vai no `hdb` (`Systems/MS-DOS 6.22/c.img`) e o `drivemap` o apresenta
ao DOS/Windows como disco 0/`C:`; o Windows 1.01 fica no `fda`
(`Systems/Windows 1.01/win101.img`), como `A:`; a ISO original continua no `cdrom`
(`Systems/MS-DOS 6.22/dos622.iso`), em `R:`.

| Perfil (`profiles.json`) | Como boota | Mídias |
| --- | --- | --- |
| **GNU GRUB 2.06** (padrão) | `hda = grub-hd.img` → menu real | `hdb = c.img`, `fda = win101.img`, `fdb = kolibri.img`, ordem `0x312` |
| **MS-DOS 6.22** | `C:` direto (MBR → IO.SYS) | `hda = msdos.img`, `cdrom = dos622.iso`, ordem `0x132` |
| **Windows 1.01** | `A:` direto (MS-DOS 3.3 → `WIN`) | `fda = win101.img`, ordem `0x321` |
| **Windows 2.03** | `C:` direto | `hda = win203.img`, ordem `0x132` |
| **Windows 3.11** | `A:` de boot → `C:\WINDOWS\WIN /3` | `hda = win311hd.img`, `fda = win311-boot.img`, ordem `0x321` |
| **NovaOS** | Live CD (GRUB → kernel Multiboot) | `cdrom = NovaOS.iso`, ordem `0x123` |
| **Tiny Core Linux** | Live CD (ISOLINUX) | `cdrom = tinycore.iso`, ordem `0x123` |
| **KolibriOS** | Disquete `A:` | `fda = kolibri.img`, ordem `0x321` |
| **MenuetOS** | Disquete `A:` | `fda = menuet.img`, ordem `0x321` |

Os nomes da tabela são os arquivos dentro de `Systems/`; os caminhos completos estão
em `Systems/README.md`.

O menu HTML antigo (`ui/boot-selector.mjs`) continua como **fallback**: aparece se
`Systems/GNU GRUB 2.06/grub-hd.img` não existir e pode ser forçado com `?menu=html`. Nesse caso os perfis
diretos acima bootam sem passar pelo GRUB. A tela de "Booting..." do fallback sai
sozinha quando o PC começa a rodar.

### O Windows 1.01

O Windows 1.x **não é um sistema que boota sozinho**: ele roda em cima do MS-DOS. E o arquivo
`Systems/Windows 1.01/Windows 1.01.iso` não é um CD do Windows — é uma ISO do *UtilityCDDOS*
(isolinux) que guarda, **fora** da árvore ISO9660, duas imagens de disquete de 1.44 MB com
MS-DOS 3.3 + Windows 1.01. O `tools/setup-v86.mjs` varre a ISO, acha a imagem que tem `WIN.COM` e
roda o `WIN` no `AUTOEXEC.BAT`, e grava o disquete em `Systems/Windows 1.01/win101.img`.

No perfil direto do Windows 1.01, o `profiles.json` sobe só esse disquete como `A:` e manda o
v86 bootar por ele. No perfil padrão, a entrada **Windows 1.01 (A:)** do GRUB faz o mesmo
chainload, mas mantém o `C:` e o CD disponíveis para a outra entrada do menu. O Windows 1.01
entra em 640×350 (EGA) e o MS-DOS Executive aparece já com `A:` — o Windows em si não monta o
CD-ROM como `R:`. A tela do Windows é exibida na proporção nativa do 640×350 (1,83:1), por isso
fica mais larga que o modo texto do DOS (720×400), que continua em 4:3 como num monitor CRT.

> Se o menu real não aparecer, veja se `Systems/GNU GRUB 2.06/grub-hd.img` existe (rode
> `npm run grub`). Se o fallback HTML ficar em "Booting 'Windows 1.01'..." para sempre, veja se
> `Systems/Windows 1.01/win101.img` existe (rode `npm run v86`) e se o perfil tem
> `fda: ../Systems/Windows%201.01/win101.img`, `boot_order: 0x321` e **nenhum** `hda`/`cdrom`
> herdado do MS-DOS.

### O Windows 3.11

O Windows 3.11 para Workgroups foi instalado pelo próprio `SETUP.EXE` do Windows, rodando
dentro do v86, a partir dos sete disquetes originais em `Systems/Windows 3.11/`
(`disk01.img` … `disk07.img`). Ele **divide o mesmo `C:` do MS-DOS 6.22**: o
`Systems/MS-DOS 6.22/c.img` tem o `C:\WINDOWS` completo, e o `CONFIG.SYS`/`AUTOEXEC.BAT`
do DOS carregam o `HIMEM.SYS`, o CD-ROM, o `SMARTDRV` e o mouse antes de qualquer coisa.
No perfil direto, o `C:` é uma cópia desse disco em `Systems/Windows 3.11/win311hd.img`.

No GRUB, as entradas **MS-DOS 6.22 (C:)** e **Windows 3.11 (C:)** chainloadam o mesmo
`c.img`. A diferença é uma flag no CMOS (registro `0x0E`): a entrada do Windows grava
`0x5A` com `outb` e o `C:\BOOTWIN.COM` (chamado pelo `AUTOEXEC.BAT`) lê a flag, limpa e
sai com `ERRORLEVEL 1`, fazendo o `AUTOEXEC.BAT` rodar `C:\WINDOWS\WIN /3`. A entrada do
MS-DOS grava `0x00` e cai no prompt `C:\>`. É assim que o mesmo disco tem dois "sistemas"
sem duplicar a instalação.

No perfil direto do Windows 3.11, o `profiles.json` usa `hda = win311hd.img` e
`fda = win311-boot.img` (ordem `0x321`): o disquete é uma cópia do `msdos622.img` cujo
`CONFIG.SYS`/`AUTOEXEC.BAT` carregam os drivers do `C:` e chamam `WIN /3`. O Windows
3.11 sobe em 640×480 (VGA); o watchdog da interface reconhece esse modo e troca o
gerenciador de arquivos para o `C:`.

## A interface

A tela do PC ocupa a janela inteira (a barra de ferramentas fica em cima), encaixada na proporção
do modo atual (4:3 no texto/VGA; 640:350 no EGA do Windows 1.01) e
com pixels quadrados de propósito: o v86 desenha 720×400 com a fonte VGA real, e o `estilo.css`
estica isso para 4:3, que é como um VGA de verdade se comportava. As scanlines do CRT são uma
variável CSS (`--scan-forca`); zerar desliga.

Na barra: a aba **Machine**, os comandos rápidos (`ver`, `dir`, `mem` — digitados com o ritmo de
12 ms por tecla), o estado da máquina e os botões de pausar, reiniciar e tela cheia.

### A aba Machine

| Opção | O que faz |
| --- | --- |
| **Configuração** | a ficha da máquina ao vivo: estado, velocidade (M instruções/s do contador do v86), **limite de velocidade** (286/386SX/386DX/486/máxima), RAM/vídeo, **mouse** (há driver de pé?), ordem de boot, disco de boot do GRUB (`hda`), geometria/partição/FAT do `C:` (que no perfil padrão é o `hdb`), o que tem dentro do `C:`, versão do v86 e tamanho de cada arquivo (wasm, BIOS, ISO). Com botões para baixar a imagem do C:, **salvar o C: no projeto** (grava na imagem do perfil: `c.img`, `msdos.img`, `win203.img`, `win311hd.img`… — ⚠️ apenas local), pausar e reiniciar. |
| **Criar snapshot** | `em.save_state()` (RAM + dispositivos + **o disco**) num nome que você escolhe, com miniatura da tela. Dá uns 22 MB comprimidos e vai para o IndexedDB — sobrevive ao F5. |
| **Selecionar snapshot** | a lista com miniatura, data, tamanho e o prompt que estava na tela: **restaurar**, baixar (`.v86state`) ou apagar. Também importa arquivo `.v86state`. |
| **Gerenciador de arquivos** | os arquivos da própria máquina, no `C:` (`c.img` no GRUB, `msdos.img` no perfil direto do MS-DOS, `win311hd.img` no do Windows 3.11) e no `A:` (a imagem anexada como `fda`: `win101.img` no GRUB/Windows 1.01 ou `win311-boot.img` no perfil direto do Windows 3.11): navegar, baixar, **enviar arquivo**, **baixar um arquivo por link**, criar pasta e apagar — mexendo no FAT de verdade. Ele abre sozinho no disco do sistema que está rodando (C: no MS-DOS e no Windows 3.11; A: no Windows 1.01 — no GRUB, conforme a entrada escolhida) e tem botões **C:/A:** para trocar na mão (ver abaixo). |
| **Mostrar logs** | o diário ao vivo: `WereBOX` (o que a interface faz), `v86` (download das imagens, boot, tela), `console` (o console do navegador, com captura opcional) e `erro`. Com filtros por nível, busca, pausa da rolagem, copiar e baixar `.txt`. |

### Velocidade da CPU

O v86 não tem um relógio de CPU fixo: ele roda o mais rápido que o host conseguir, e num
computador moderno isso fica bem acima de um PC da época (o boot, principalmente). O
`ui/velocidade.mjs` mede o contador de instruções do v86 a cada 500 ms e insere uma pausa no
`yield` da máquina para chegar ao alvo escolhido. O padrão é **5 MIPS** (≈386DX); no painel
**Configuração** dá para trocar para 286, 386SX, 486 ou **máxima** (sem limite). A escolha fica
no `localStorage` e vale para todos os perfis; o limite não muda a RAM, o disco nem o relógio do
sistema, só a velocidade da CPU. O limite só é ligado quando o sistema termina de subir: durante
o boot o v86 roda na velocidade máxima, porque pausas no meio da leitura dos discos e da troca
para o modo gráfico podem atrapalhar o Windows 3.11 e o controlador de disquete.

### Os arquivos da máquina (FAT de verdade)

`ui/fat.mjs` é um leitor/gravador de **FAT12 e FAT16** que fala com um "dispositivo de blocos"
(`get(offset, tamanho)` / `set(offset, bytes)`). O mesmo código serve para duas coisas:

- as **imagens vivas** do v86: `ui/discos.mjs` pega o `SyncBuffer` do `C:` (`hdb` no perfil GRUB,
  `hda` nos perfis diretos) e do `A:` (`fdc.drives[0]`, o disquete anexado como `fda`) — o que
  você faz no gerenciador é o disco que o sistema está usando;
- um arquivo `.img` no Node, que é como os testes rodam.

O gerenciador acompanha o boot: quando o Windows 1.01 entra em 640×350 ele troca para o `A:`;
quando o MS-DOS chega ao prompt ele fica no `C:`; no Windows 3.11 ele fica no `C:` (o `A:` é o
disquete de boot). Se você clicar em `C:` ou `A:`, a escolha manual manda (só volte a automática
reabrindo o painel). No `A:` dá para ver os programas do Windows (`WIN.COM`, `CALC.EXE`, fontes, …)
e também enviar/apagar arquivos. O botão de salvar grava a imagem certa de volta no projeto:
`Systems/Windows 1.01/win101.img` ou `Systems/Windows 3.11/win311-boot.img`, conforme o perfil
(o caminho vem de `ui/midias.mjs`).

Ele lê a tabela de partição, o BPB, monta as cadeias de clusters, interpreta entradas 8.3 (nome,
atributos, data/hora do DOS, tamanho) e sabe **gravar**: acha clusters livres, escreve a FAT (nas
duas cópias), os dados e a entrada de diretório; criar pasta escreve as entradas `.` e `..`;
apagar libera a cadeia (e apaga pasta recursivamente).

> **Cuidado com o cache do DOS/Windows:** o MS-DOS guarda setores de diretório/FAT em `BUFFERS` e o
> Windows 3.11 usa `SMARTDRV`; o Windows 1.01 está rodando do próprio disquete `A:`. Se você mexer
> nos arquivos com a máquina rodando, o sistema pode escrever por cima do que você fez. O painel
> avisa: pause antes de editar e reinicie depois para o sistema reler o disco.

Para conferir se ficou certo de verdade, o teste em Node monta o **nosso `c.img`**, lê o
`FORMAT.COM` do disco e compara **byte a byte** com o binário extraído da ISO; depois grava, relê,
apaga e audita a alocação (nenhum cluster perdido ou duplicado). E o teste final é sempre no DOS
real: os arquivos escritos pelo gerenciador aparecem no `dir c:` e saem certos no `type`.

```bash
npm run test:fat       # 57 conferências contra Systems/MS-DOS 6.22/c.img, sem navegador
npm run test:zip       # 67: extração de ZIP store/deflate/ZIP64, nomes 8.3, limites e rollback
npm run test:download  # 71: nomes 8.3, parsing do link, gravação no C:/A: e extração de ZIP
npm run test:midias    # 12: qual .img cada perfil salva (c.img, msdos.img, win203.img…)
npm run test:duo       # 17: parsing e validação do ?duo=id1,id2
npm run test:serve     # 21: o proxy /emulator/__download e a rota do duo contra um servidor de verdade
npm run test:tudo      # tudo acima + os 31 testes do emulador aposentado
```

### Baixar um arquivo por link (⚠️ Apenas Local)

**Nota:** Esta funcionalidade **só funciona localmente** (`NODE_ENV != production`). Em produção (Render, etc.), os endpoints de download são desabilitados por segurança.

Dá para mandar um arquivo para dentro da máquina sem baixá-lo no host: no
**Gerenciador de arquivos**, cole o **link direto** (o que já dispara o download, não a
página de anúncio) no campo do rodapé e clique em **⬇ baixar link** (ou tecle Enter). A
interface pede ao próprio servidor que busque o arquivo (para contornar CORS), grava os
bytes no FAT da unidade aberta e **reinicia a máquina** para o sistema reler o disco. O
arquivo **não é executado no host** — ele só entra na imagem do PC emulado.

O mesmo fluxo funciona por URL compartilhável, com o sistema já escolhido **(apenas local)**:

```
/?system=msdos622&download=https%3A%2F%2Fexemplo.com%2Farquivo.exe
/?baixar=https%3A%2F%2Fexemplo.com%2Farquivo.exe
/?system=win101=download'https%3A%2F%2Fexemplo.com%2Farquivo.zip'
```

No formato compacto `?system=id=download'link'`, o link pode ter `&` e `?` desde que
esteja entre aspas (simples ou duplas). Um `#` precisa ir codificado (`%23`), porque o
navegador trata tudo depois dele como fragmento da página. Para evitar qualquer
ambiguidade, prefira o formato normal com o link codificado por `encodeURIComponent`.

Parâmetros opcionais:

| Parâmetro | Efeito |
| --- | --- |
| `unidade=A`, `unidade=B` ou `unidade=C` | força o disco de destino. Sem ele, a interface usa o disco gravável do sistema que está rodando: `C:` no MS-DOS/Windows 3.11, `A:` no Windows 1.01/MenuetOS, `B:` no KolibriOS (ou `A:` no perfil direto). |
| `nome=ARQUIVO.EXE` | força o nome. Sem ele, usa o `Content-Disposition` da resposta e, por último, o nome da URL final. |

O arquivo é gravado **no diretório atual** do gerenciador (pela URL, na raiz da
unidade). Nomes que não cabem em 8.3 são ajustados (`relatorio.final.docx` →
`RELATORI.DOC`); se já existir um arquivo com o mesmo nome, ele ganha um sufixo
(`PAYLOAD1.EXE`) em vez de sobrescrever. Nomes de dispositivo do DOS (`CON`, `COM1`,
`LPT1`, …) ganham um `_` na frente.

#### ZIPs

Se o link (ou o `Content-Disposition`) for um `.zip`, a interface **extrai o ZIP no
próprio emulador** e grava os arquivos/pastas no diretório atual; o `.zip` original
**não fica no disco**. Assim o sistema convidado não precisa ter um descompactador
(o MS-DOS 6.22 e o Windows 3.11 só têm o `EXPAND.EXE`, que é do formato LZ da
Microsoft, não de ZIP).

- **Formatos**: `store` (sem compressão) e `deflate`; ZIP64 básico; nomes UTF-8
  (bit 11) ou CP437; pastas explícitas e implícitas.
- **Nomes**: cada componente vira 8.3 (`relatorio.final.docx` → `RELATORI.DOC`),
  colisões ganham sufixo (`ARQ1.TXT`) e nomes reservados ganham `_`.
- **Segurança**: caminhos absolutos e com `..` são recusados; o CRC32 de cada
  arquivo é conferido; no máximo **4096 entradas** e **16 níveis** de pasta.
- **Espaço**: a extração é feita primeiro na memória e só grava depois de conferir
  o espaço e a capacidade das pastas. Se algo falhar no meio, os arquivos já
  gravados são apagados (rollback).
- **Fallback**: se o ZIP estiver **criptografado** (senha/AES), usar um método que
  não seja `store`/`deflate` (bzip2, LZMA, …), estiver corrompido ou não couber no
  disco, ele é gravado inteiro como `NOME.ZIP` e um aviso explica o motivo. O ZIP
  só é apagado quando a extração termina bem.

O limite de **64 MB** do proxy vale para o ZIP compactado; o conteúdo extraído é
limitado pelo espaço livre do disco (e pelo teto de segurança de 256 MB do
extrator).

No perfil padrão (GRUB), o download por URL acontece assim que as imagens carregam,
**antes** de você escolher a entrada no menu — ele usa o `C:` do perfil. Para mandar
o arquivo para o `A:`/`B:` por URL, informe `unidade=A`/`unidade=B` ou use o perfil
direto (`?system=win101`, `?system=kolibri`, …).

O download mexe na **imagem viva em memória** do perfil (no GRUB, o `hdb`/`c.img`; no
perfil direto do MS-DOS, o `msdos.img`; no Windows 3.11, o `win311hd.img`). Ele **não
altera o `.img` do projeto**: para guardar, use **salvar o disco no projeto** depois
que a máquina reiniciar. O `ui/transferencia.mjs` pausa a CPU antes de gravar, remonta
o FAT (o sistema pode ter escrito enquanto o download corria) e o `ui/app.mjs` chama
`em.restart()` no fim.

> **Segurança do proxy:** O endpoint `GET /emulator/__download?url=...&max=...` aceita só 
> `http://` e `https://`, recusa links com usuário/senha, limita o arquivo a **64 MB** e a 
> busca a **60 s**. Por motivos de segurança, este endpoint é **automaticamente desabilitado 
> quando `NODE_ENV=production`**, tornando seguro hospedar o WereBOX em serviços públicos 
> (Render, Vercel, etc.). Use apenas localmente para desenvolvimento e testes.

### Dois PCs lado a lado (`?duo=`)

Para comparar dois sistemas, abra exatamente dois ids de `profiles.json` separados por
vírgula:

```
/?duo=win101,win203
/?duo=msdos622,win311
/?duo=grub,win101
```

Cada lado é uma máquina **independente**: o `C:`/`A:`, o estado da CPU, os downloads e os
snapshots de um não interferem no outro. Cada iframe mostra sua **própria interface completa** 
com barra de ferramentas, controles e painéis. O mesmo sistema pode aparecer dos dois lados 
(`?duo=win101,win101`).

### Teclado Virtual Mobile

O WereBOX inclui um **teclado virtual otimizado para dispositivos móveis** (smartphones e tablets).

**Como abrir:**
- **No mobile**: um botão flutuante (⌨️) aparece automaticamente no canto inferior direito
- **No desktop**: pressione `Ctrl+K` (Windows/Linux) ou `Cmd+K` (Mac)
- **Fechar**: clique no `✕`, pressione `ESC` ou `Ctrl+K` novamente

**Layouts disponíveis:**
- **ABC** - Layout alfabético padrão com letras, números e teclas especiais (ESC, TAB, ENTER, setas)
- **123** - Layout numérico com símbolos (!@#$%^&*), parênteses, chaves e operadores
- **F-Keys** - Teclas de função (F1-F12), INS, DEL, HOME, END, PGUP, PGDN

**Modificadores:**
- **CTRL/ALT** - Mantém pressionado até clicar novamente (toggle)
- **SHIFT** - Auto-desliga após digitar uma letra
- **CAPS** - Caps Lock (visual)

**Atalhos rápidos do DOS:**
Botões na barra superior para comandos comuns: `dir`, `cd..`, `cls`, `ver`, `mem`, `exit`

**Características:**
- Feedback haptic (vibração ao tocar, se o dispositivo suportar)
- Cores temáticas (modificadores em âmbar, especiais em verde, navegação em azul)
- Envio correto de sequências ANSI para setas e F-keys
- Layout responsivo (ajusta para paisagem/retrato)

**Nota**: O teclado virtual envia teclas com o mesmo timing do v86 (12ms entre caracteres para
comandos), garantindo compatibilidade total com programas DOS e Windows.

## O disco C:
monta o layout é o próprio `app.mjs` (via `ui/duo.mjs`) na mesma `index.html`, sem página
separada e sem redirecionamento.

> São **duas instâncias do v86** no mesmo navegador: espere cerca do dobro de memória e
> CPU. Para controlar um lado, clique dentro dele. Para abrir um lado sozinho, use
> `?system=<id>`; para voltar ao menu, `?menu=html`.

## O disco C:

O PC emulado tem **disco rígido e CD-ROM de verdade**. No perfil padrão, o GRUB ocupa o `hda`
e o `C:` é o `hdb`; o `drivemap` do menu troca os dois no BIOS antes de bootar o DOS, então
para o DOS nada muda: ele continua vendo o seu disco como `C:` e o CD como `R:`.

- o `C:` **boota sozinho** (ou pelo GRUB): MBR → setor de boot da partição → `IO.SYS`/`MSDOS.SYS`/`COMMAND.COM`;
- `C:\DOS` tem os 40 binários da ISO, com `PATH C:\DOS` e `DOSKEY` no `AUTOEXEC.BAT`;
- `C:\CONFIG.SYS` carrega `HIMEM.SYS` (memória estendida) e `CD1.SYS /D:banana`;
- o `AUTOEXEC.BAT` roda `MSCDEX.EXE /D:banana /L:R` → **`R:` = a ISO** (`dir r:` lista os 43 arquivos);
- o mesmo `AUTOEXEC.BAT` carrega `MOUSE.COM` → **mouse do navegador dentro dos programas DOS**
  (o driver já estava em `C:\DOS`, copiado da ISO pelo `XCOPY`; ver "O mouse" abaixo).

Nada disso foi montado por código: quem formatou e instalou foi o **MS-DOS 6.22 real**, rodando
dentro do v86.

### Como o `c.img` foi feito (e como refazer)

1. `npm run mkdisk` → gera `Systems/MS-DOS 6.22/novo.img`: disco em branco com **uma
   partição FAT16 ativa** (só a tabela de partição é escrita à mão — dados, sem código).
2. `npm run serve` → abrir `/emulator/preparar-disco.html` → botão **preparar o disco C:**.

A bancada sobe o DOS pelo disquete (A:) com o disco em branco no `hda` e roda, de verdade:

```
fdisk /mbr                     (MBR padrão do DOS, o que encadeia a partição ativa)
format c: /s                   (setor de boot, FATs, raiz, IO.SYS/MSDOS.SYS/COMMAND.COM)
md c:\dos
xcopy a:\*.* c:\dos\ /s        (40 arquivos)
echo ... >  c:\config.sys      (HIMEM, CD1.SYS, FILES, BUFFERS, LASTDRIVE)
echo ... >> c:\autoexec.bat    (PROMPT, PATH, MSCDEX, DOSKEY, MOUSE.COM)
dir / type                     (conferência dentro do próprio DOS)
```

e no fim manda a imagem pronta (16 MB) de volta pelo
`POST /emulator/__save?name=Systems/MS-DOS%206.22/c.img`.

(O driver de mouse, por exemplo, não é copiado à parte: ele já vem no `XCOPY` do `A:\` para
o `C:\DOS`, e o que a bancada escreve é só a linha que o carrega. Num `c.img` que já existe,
`npm run mouse` faz essa mesma linha, conferindo o disco antes de gravar — e sem gravar nada
se qualquer conferência falhar.)

> **Detalhe que deu trabalho:** o v86 **deduz a geometria do disco a partir da tabela de
> partição** (`heads = cabeça_final + 1`, `sectors = setor_final`). Se o disco não fechar em
> cilindro inteiro, ele deduz uma geometria torta (11 cabeças × 8 setores, por exemplo) e aí o
> MBR do DOS lê a partição no LBA errado — o sintoma é `Missing operating system`. Por isso o
> `mkdisk.mjs` fecha tudo em **32 cilindros × 16 cabeças × 63 setores**.

## O mouse

O mouse não precisou de nada de novo: o driver **já estava na ISO**. O `XCOPY` do `A:\` para
o `C:\DOS` trouxe o `MOUSE.COM` (versão 8.20, a do MS-DOS 6.22) junto com o resto, e o
`AUTOEXEC.BAT` só precisou chamá-lo:

```
MOUSE.COM
```

O caminho todo, do clique na tela até o programa DOS:

```
mouse do navegador (dentro do #screen)
  → controlador PS/2 8042 do v86   (o v86 emula o mouse PS/2 de verdade)
  → MOUSE.COM no boot              (detecta o PS/2 sozinho, nenhuma opção)
  → vetor INT 33h                  (é o que QBASIC, EDIT e os jogos consultam)
```

Detalhes que valem saber:

- o v86 só manda evento para dentro da máquina quando **o ponteiro está sobre a tela do PC**
  (`#screen`) — fora dela o mouse do navegador é do navegador, não do DOS;
- em modo texto o driver trabalha em **caracteres**, não em pixels: 8 px andados = 1 coluna da
  tela 80×25 (é o que faz o ponteiro "casar" com o que está escrito);
- o movimento é **relativo** (como um mouse de verdade), então o tamanho da janela não muda
  para onde o ponteiro vai;
- o driver fica residente (~15 KB de memória convencional) e é assim que o 6.22 faz;
- o painel **Configuração → Agora → Mouse** mostra se há driver de pé: ele olha o controlador
  PS/2 do v86, que só marca "relatando" quando alguém assume o `INT 33h` (ver `ui/mouse.mjs`).

Para conferir à mão: `EDIT` (o editor do próprio DOS) tem menu clicável — clique em **File** na
linha de cima. Se o menu abrir, o `INT 33h` está no ar.

## O que já roda (testado)

**Sistemas operacionais:**
- **GNU GRUB 2.06 de verdade**: menu ↑/↓/Enter desenhado pelo GRUB dentro do v86
- **MS-DOS 6.22**: prompt C:\>, todos os utilitários, CD-ROM em R:
- **Windows 1.01**: MS-DOS Executive em 640×350 (EGA), programas clássicos
- **Windows 2.03**: primeiro Windows com janelas sobrepostas e ícones no desktop
- **Windows 3.11**: instalado dos disquetes originais, roda em 640×480 (VGA)
- **NovaOS**: SO x86 de 32 bits com interface gráfica VBE 1280×720
- **Tiny Core Linux**: distribuição ultraleve com FLWM
- **KolibriOS**: SO escrito 100% em Assembly x86, interface gráfica completa
- **MenuetOS**: SO multitarefa preemptivo em Assembly x86

**Funcionalidades:**
- **gerenciador de arquivos no `C:`, `A:` e `B:`**: lista, baixa, envia, **baixa por link**,
  cria pasta e apaga; extração automática de ZIPs
- **o mouse dentro de programas DOS**: o `EDIT` abre menu por clique (driver `MOUSE.COM` 8.20)
- **programas que travavam no emulador próprio**: QBASIC (x87), SCANDISK (x87), EDIT, FDISK
- **teclado virtual mobile**: layouts ABC/123/F-keys, atalhos DOS, feedback haptic
- **modo duo**: dois PCs lado a lado para comparação
- **snapshots**: salvar/restaurar estado completo da máquina (RAM + disco)
- tela 80×25 com a fonte VGA real e cores CGA; tela cheia; até 256 MB de RAM

## Como a interface é customizada

O v86 só é motor: você dá um `screen_container` e ele desenha dentro. A interface do WereBOX é
só isso em volta — todo o resto (`ui/`) é nosso e é onde se mexe: o visual em `ui/estilo.css`
(tema, cores, fonte, scanlines: tudo variável CSS), e os painéis em `ui/paineis/`.

```html
<div id="screen">
  <div></div>      <!-- modo texto HTML -->
  <canvas></canvas><!-- modo texto bitmap VGA / gráfico -->
</div>
```

```js
const em = new V86({
  wasm_path: "v86.wasm",
  bios: { url: "seabios.bin" }, vga_bios: { url: "vgabios.bin" },
  hda: { url: "../Systems/GNU%20GRUB%202.06/grub-hd.img" },  // GRUB no hda
  hdb: { url: "../Systems/MS-DOS%206.22/c.img" },            // C: no hdb
  fda: { url: "../Systems/Windows%201.01/win101.img" },
  cdrom: { url: "../Systems/MS-DOS%206.22/dos622.iso" },
  boot_order: 0x312,                                       // HD -> disquete -> CD
  screen_container: screenEl,
  screen: { use_graphical_text: true, encoding: "cp437" },  // fonte VGA de verdade
});
```

Ganchos que já usamos (dá para montar qualquer UI em cima):

- **eventos**: `emulator-loaded`, `emulator-started`, `emulator-stopped`, `download-progress`,
  `screen-put-char`, `screen-set-size`, …;
- **tela como texto**: `em.screen_adapter.get_text_screen()` → 25 linhas × 80 colunas
  (foi assim que a bancada confere os comandos sem screenshot);
- **teclado por código**: `em.keyboard_send_text("dir c:\\dos\n", 12)` — no v86 o Enter é `\n`
  (não `\r`) e é preciso ritmar (~12 ms por tecla), senão o buffer do controlador perde o resto;
- **estado**: `em.save_state()` / `restore_state()`, `em.restart()`;
- **tela**: `em.screen_set_scale()`, `screen_make_screenshot()`;
- **discos a quente**: `set_fda`/`set_cdrom`/`eject_cdrom`.

Detalhe que custou uma sessão de depuração: o `SyncBuffer.get()` do v86 **exige callback**
(`get(start, len, fn)`); para ler na hora é `get_from_cache(start, len)`. E gravar é
`set(start, bytes, fn)` — com o deslocamento **primeiro**, fora do padrão.

A interface expõe o que ela mesma usa, para automatizar/testar do console do navegador:

```js
werebox.emulator            // a instância do v86
werebox.logs.lista()        // as linhas do log
werebox.abrirPainel("arquivos")
werebox.disco.montar()      // o FAT do C: montado agora
werebox.disco.montar().gravar(0, "OI.TXT", new TextEncoder().encode("oi"))
werebox.disco.salvar()      // grava a imagem do perfil (POST /emulator/__save)
```

## Licenças e etiqueta

- **v86**: BSD-2-Clause (o aviso está em `node_modules/v86/LICENSE`).
- **GNU GRUB 2.06**: GPLv3+ — binário em `Systems/GNU GRUB 2.06/grub/` +
  `Systems/GNU GRUB 2.06/grub-hd.img`, licença em
  `Systems/GNU GRUB 2.06/grub/COPYING`, fonte e build em
  `Systems/GNU GRUB 2.06/grub/README.md`.
- **SeaBIOS / VGABIOS**: LGPL.
- **Binários do MS-DOS 6.22, do Windows 3.11 e do Windows 1.01**: © Microsoft — vindos das
  suas próprias mídias (ISO e os sete disquetes do Windows 3.11).
- O projeto v86 **não aceita PR/issue escrito por IA** (usar como biblioteca é tranquilo;
  contribuir para ele, não).
- O emulador próprio está aposentado em `autoral/` — ainda roda (`npm run autoral VER DIR`) e
  seus 31 testes passam (`npm test`).

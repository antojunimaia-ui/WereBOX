# WereBOX

**Máquinas virtuais e sistemas operacionais clássicos e experimentais de verdade no navegador**, com interface própria, menu GNU GRUB 2.06 real e motor x86 em WebAssembly ([v86](https://github.com/copy/v86)).

### Sistemas disponíveis:
* **MS-DOS 6.22 (C:)** — Sistema DOS completo com mouse PS/2 e utilitários.
* **Windows 3.11 (C:)** — Instalado sobre o mesmo disco C:, iniciado com flag CMOS pelo GRUB.
* **Windows 1.01 (A:)** — Boot direto por disquete EGA histórico.
* **KolibriOS (B:)** — Sistema operacional multitarefa com interface gráfica 1024×768 escrito 100% em Assembly x86.
* **NovaOS (Live CD)** — Sistema operacional moderno com kernel Multiboot e VBE linear em 1280×720.

- **Interface + motor:** `emulator/` — motor v86 em WebAssembly.
- **Menu de boot GNU GRUB 2.06 real**, rodando dentro da BIOS do emulador (não é HTML fake).
- **A interface** é a tela do PC em tela cheia com uma barra em cima, e a aba **Machine** com:
  configuração da máquina (incluindo o **limite de velocidade da CPU**: 286/386/486/máxima),
  snapshots (criar/selecionar, com miniatura da tela), gerenciador dos
  arquivos do `C:` e do disquete `A:` (Windows 1.01 ou o disquete de boot do Windows 3.11,
  conforme o perfil) — enviar, baixar, criar pasta, apagar, no FAT de verdade, trocando sozinho
  para o disco do sistema que está rodando — e os logs da sessão ao vivo.
- **O disco `C:`** (`Systems/MS-DOS 6.22/c.img`) é um disco rígido MS-DOS 6.22 de verdade: quem
  formatou e instalou foi o próprio DOS, rodando dentro do emulador — a bancada reproduz isso.
  Ele também tem o **Windows 3.11** instalado em `C:\WINDOWS`, a partir dos sete disquetes
  originais em `Systems/Windows 3.11/`.
- **Mouse dentro dos programas DOS:** o `AUTOEXEC.BAT` do `C:` carrega o `MOUSE.COM` que veio na
  ISO, então o ponteiro do navegador chega nos programas via `INT 33h` (é o v86 que emula o
  mouse PS/2). No DOS, `EDIT` é um bom teste: o menu responde a clique.
- **Emulador próprio** (interpretador 8086 + camada DOS em JS que escrevemos): aposentado em
  `emulator/autoral/`.
- **`Systems/`**: as mídias dos sistemas organizadas por SO (`MS-DOS 6.22/`,
  `Windows 1.01/`, `Windows 3.11/`, `GNU GRUB 2.06/`), incluindo o `extracted/`, as ISOs
  originais e os sete disquetes do Windows 3.11 que servem de matéria-prima para o disco, os
  disquetes de boot e o CD. Veja `Systems/README.md`.

## Começar

```bash
cd emulator
npm install
npm start        # http://localhost:8123/emulator/
```

## Testes

```bash
cd emulator
npm run test:fat    # o FAT de Systems/MS-DOS 6.22/c.img: lê, grava, apaga e audita — sem navegador
npm run test:tudo   # + os 31 testes do emulador aposentado
```


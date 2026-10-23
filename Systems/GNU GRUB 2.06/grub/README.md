# GNU GRUB 2.06 — disco de boot do reDOS

O menu de boot do reDOS é o **GNU GRUB de verdade**, rodando dentro do v86 (BIOS).
Ele não é uma tela HTML: é o `grub-hd.img` (nesta pasta, um nível acima de `grub/`)
anexado como `hda`, com o menu desenhado pelo próprio GRUB em modo texto VGA.

## O que tem aqui

| Arquivo | O que é |
| --- | --- |
| `boot.img` | setor de boot do GRUB para BIOS (512 bytes, do pacote oficial) |
| `core.img` | núcleo do GRUB com os módulos e o menu `grub.cfg` embutidos (memdisk) |
| `grub.cfg` | fonte do menu (fica embutido no `core.img`; editar aqui exige regerar o core) |
| `core.img.meta.json` | hashes de `grub.cfg`, `boot.img` e `core.img` gravados por `mk-grub.mjs` (gerado automaticamente) |
| `COPYING` | licença GNU GPL v3 |

O `Systems/GNU GRUB 2.06/grub-hd.img` (8 MB) é gerado por `npm run grub`
(`emulator/tools/mk-grub.mjs`), que grava `boot.img` no setor 0, `core.img` a partir
do setor 1 e preenche a blocklist do `diskboot`. O `grub-bios-setup.exe` oficial
exige elevação no Windows, por isso a montagem é feita em Node.

O `core.img` embute o `grub.cfg`. Quando o pacote do GRUB não está no `TEMP`, o
script só reutiliza um `core.img` existente se os hashes registrados em
`core.img.meta.json` baterem com os arquivos atuais; caso contrário, aborta sem
alterar o `grub-hd.img`. Use `--reutilizar-core` apenas para aceitar um core
desatualizado de propósito.

## Como o core foi gerado

Pacote oficial: <https://ftp.gnu.org/gnu/grub/grub-2.06-for-windows.zip>
SHA-256 do zip usado: `980F492B2BB9EAF6ACB30E68E07B804D558A3389363B7D7273022B7200170991`

```powershell
# da raiz do repo, com o zip oficial extraido em $g
$g = "$env:TEMP\grub-win\grub-2.06-for-windows"
$grub = "Systems\GNU GRUB 2.06\grub"
& "$g\grub-mkstandalone.exe" -O i386-pc -o "$grub\core.img" `
  -d "$g\i386-pc" --compress=no --locales="" --fonts="" --themes="" `
  --install-modules="biosdisk part_msdos fat iso9660 chain drivemap normal configfile echo test reboot iorw multiboot all_video vbe video video_fb" `
  --modules="biosdisk part_msdos fat iso9660 chain drivemap normal configfile echo test reboot iorw multiboot all_video vbe video video_fb" `
  "boot/grub/grub.cfg=$grub\grub.cfg"
```

O `--compress=no` é necessário porque o build oficial para Windows não traz
compressão; o core fica em ~278 KB e cabe com folga nos ~444 KB que o `diskboot` carrega.
O módulo `iorw` fornece o comando `outb`, usado para gravar a flag no CMOS, e `multiboot`/`iso9660`
permitem carregar o kernel de sistemas operacionais modernos direto do CD-ROM.

## O menu

```
MS-DOS 6.22 (C:)   -> hdb (Systems/MS-DOS 6.22/c.img) com drivemap, enxergado como disco 0/C:
Windows 3.11 (C:)  -> o MESMO hdb, com a flag 0x5A no CMOS (registro 0x0E)
Windows 1.01 (A:)  -> fd0 (Systems/Windows 1.01/win101.img)
KolibriOS (B:)     -> fd1 (Systems/KolibriOS/kolibri.img) com drivemap
```

O `drivemap` troca `hd0`/`hd1` antes de chainloadar o `c.img`, então o DOS/Windows
continua vendo o seu disco como `C:` e o CD original continua em `R:`. O Windows
1.01 boota do disquete em `A:`, como se o GRUB não existisse.

### A flag do Windows 3.11

O MS-DOS e o Windows 3.11 usam o mesmo `c.img` e o mesmo `CONFIG.SYS`. Para o
GRUB escolher qual `AUTOEXEC.BAT` roda, ele grava um byte no CMOS antes de
chainloadar:

```
MS-DOS:        outb 0x70 0x0E ; outb 0x71 0x00
Windows 3.11:  outb 0x70 0x0E ; outb 0x71 0x5A
```

O `AUTOEXEC.BAT` do `C:` chama `C:\BOOTWIN.COM`; ele lê o registro `0x0E`, limpa
a flag e sai com `ERRORLEVEL 1` quando o valor é `0x5A`. Nesse caso o
`AUTOEXEC.BAT` roda `C:\WINDOWS\WIN /3`. O registro `0x0E` foi escolhido porque o
v86 implementa a escrita/leitura dele no CMOS (o `0x3F` é ignorado).

## Para mudar o menu

1. edite `Systems/GNU GRUB 2.06/grub/grub.cfg`;
2. regenere `core.img` com o comando acima;
3. rode `npm run grub` (em `emulator/`) para remontar `Systems/GNU GRUB 2.06/grub-hd.img`.

## Licença

GRUB é software livre sob **GNU GPL v3 ou superior** (veja `COPYING`). O código-fonte
oficial está em <https://ftp.gnu.org/gnu/grub/> (tarball `grub-2.06.tar.xz`). O
`grub-hd.img` distribuído aqui é um binário não modificado do GRUB 2.06 (apenas
instalado em um disco imagem), com o menu acima.

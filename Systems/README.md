# Systems — as mídias dos sistemas

Esta pasta guarda as imagens que o v86 anexa à máquina. A interface continua em
`emulator/`; o `profiles.json` aponta para cá com caminhos relativos
(`../Systems/...`), e o servidor estático serve a raiz do repositório.

```
Systems/
  MS-DOS 6.22/
    MS-DOS 6.22.iso     ISO original do MS-DOS 6.22 (matéria-prima)
    dos622.iso          cópia da ISO usada como CD-ROM (R:)
    c.img               disco rígido C: formatado, bootável e com o Windows 3.11
    msdos622.img        disquete de boot extraído da ISO (A: de resgate)
    novo.img            disco em branco com partição FAT16 (bancada)
    extracted/          binários do 6.22 extraídos da ISO (referência/testes)
  Windows 1.01/
    Windows 1.01.iso    ISO de origem (contém o disquete MS-DOS 3.3 + Windows)
    win101.img          disquete de 1.44 MB que boota o Windows 1.01 (A:)
  Windows 3.11/
    disk01.img … disk07.img   os sete disquetes originais do Windows 3.11
    win311-boot.img           disquete DOS 6.22 que carrega C:\WINDOWS e roda WIN /3
  GNU GRUB 2.06/
    grub-hd.img         disco de boot do GRUB (hda no perfil padrão)
    grub/
      boot.img          setor 0 do GRUB
      core.img          núcleo com o menu embutido
      grub.cfg          fonte do menu (embutido no core.img)
      COPYING           licença GPLv3+
      README.md         como o GRUB foi gerado e como mudar o menu
```

## O que é usado por quê

| Perfil | hda | hdb | fda | cdrom |
| --- | --- | --- | --- | --- |
| GNU GRUB 2.06 (padrão) | `GNU GRUB 2.06/grub-hd.img` | `MS-DOS 6.22/c.img` | `Windows 1.01/win101.img` | `MS-DOS 6.22/dos622.iso` |
| MS-DOS 6.22 | `MS-DOS 6.22/c.img` | — | — | `MS-DOS 6.22/dos622.iso` |
| Windows 1.01 | — | — | `Windows 1.01/win101.img` | — |
| Windows 3.11 | `MS-DOS 6.22/c.img` | — | `Windows 3.11/win311-boot.img` | — |

O GRUB não é um sistema operacional: ele é o bootloader real que aparece no
`hda` e chainloada o MS-DOS/Windows 3.11 (o mesmo `c.img`, com `drivemap`) ou o
disquete do Windows 1.01.

A instalação usou os discos 01–05; os discos 06–07 (readmes e drivers de impressoras)
ficam guardados como mídia original, mas não são necessários para o `C:\WINDOWS`.

O MS-DOS 6.22 e o Windows 3.11 **compartilham o mesmo `C:`**. A diferença entre
as duas entradas do GRUB é uma flag no CMOS (registro `0x0E`): a entrada do
Windows 3.11 grava `0x5A`, e o `C:\BOOTWIN.COM` (chamado pelo `AUTOEXEC.BAT`)
lê a flag, limpa e sai com `ERRORLEVEL 1`; o `AUTOEXEC.BAT` então roda
`C:\WINDOWS\WIN /3`. A entrada do MS-DOS grava `0x00` e cai no prompt normal.
O `win311-boot.img` é usado no perfil direto do Windows 3.11, fora do GRUB.

## Regerar as mídias

A partir de `emulator/`:

```bash
npm run v86      # reextrai msdos622.img/win101.img e remonta grub-hd.img
npm run grub     # só remonta Systems/GNU GRUB 2.06/grub-hd.img
npm run mkdisk   # gera Systems/MS-DOS 6.22/novo.img para a bancada
```

O `c.img` não é gerado por esses comandos: ele é feito pelo próprio DOS na
bancada `/emulator/preparar-disco.html` (ou já veio pronto com o projeto). O
`win311-boot.img` é uma cópia do `msdos622.img` com `CONFIG.SYS`/`AUTOEXEC.BAT`
apontando para `C:\WINDOWS` e chamando `WIN /3`.

Ao usar **salvar o disco no projeto** no gerenciador de arquivos, o `C:` é
gravado em `Systems/MS-DOS 6.22/c.img`. O `A:` é gravado na imagem que estiver
anexada como `fda` no perfil atual: `Systems/Windows 1.01/win101.img` no GRUB e
no Windows 1.01, ou `Systems/Windows 3.11/win311-boot.img` no perfil direto do
Windows 3.11.

<div align="center">

# 🖥️ WereBOX

**Máquinas virtuais x86 completas no navegador**

Sistemas operacionais clássicos e experimentais rodando de verdade, com interface própria, menu GNU GRUB 2.06 real e motor x86 em WebAssembly.

[![v86](https://img.shields.io/badge/powered%20by-v86-blue)](https://github.com/copy/v86)
[![License](https://img.shields.io/badge/license-BSD--3--Clause-green)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)

[🚀 Demo ao Vivo](https://werebox.onrender.com/) • [📖 Documentação](emulator/README.md) • [🐛 Reportar Bug](https://github.com/antojunimaia-ui/WereBOX/issues)

</div>

---

## 📋 Índice

- [Visão Geral](#-visão-geral)
- [Sistemas Disponíveis](#-sistemas-disponíveis)
- [Recursos](#-recursos)
- [Começar](#-começar)
- [Segurança em Produção](#️-segurança-em-produção)
- [Estrutura do Projeto](#-estrutura-do-projeto)
- [Testes](#-testes)
- [Como Funciona](#-como-funciona)
- [Licenças](#-licenças)

---

## 🎯 Visão Geral

WereBOX é uma plataforma web que emula **máquinas x86 completas** no navegador, permitindo executar sistemas operacionais reais - não simulações. Baseado no [v86](https://github.com/copy/v86) (x86 em WebAssembly), com interface customizada e funcionalidades avançadas.

### ✨ Destaques

- **🎮 Boot Real com GRUB 2.06** — Menu GNU GRUB rodando dentro do emulador (não é HTML)
- **💾 Disco Rígido Autêntico** — Formatado e instalado pelo MS-DOS real
- **🖱️ Mouse PS/2 Funcional** — Funciona dentro dos programas DOS (EDIT, QBASIC, etc.)
- **📁 Gerenciador FAT Real** — Lê/escreve FAT12 e FAT16 diretamente nas imagens
- **📸 Snapshots Completos** — Salva estado total (RAM + disco + dispositivos)
- **⚡ Controle de Velocidade** — Limite de CPU ajustável (286/386/486/máxima)
- **📱 Teclado Virtual Mobile** — Interface otimizada para smartphones e tablets

---

## 💿 Sistemas Disponíveis

| Sistema | Ano | Tipo | Memória | Detalhes |
|---------|-----|------|---------|----------|
| **MS-DOS 6.22** | 1994 | DOS | 32 MB | Sistema completo com mouse PS/2 e utilitários |
| **Windows 1.01** | 1985 | Windows | 8 MB | Boot por disquete, EGA 640×350 |
| **Windows 2.03** | 1987 | Windows | 16 MB | Primeiro com janelas sobrepostas |
| **Windows 3.11** | 1993 | Windows | 16 MB | Instalado dos 7 disquetes originais |
| **KolibriOS** | 2026 | OS | 128 MB | 100% Assembly x86, interface gráfica completa |
| **MenuetOS** | 2015 | OS | 128 MB | Sistema multitarefa em Assembly, 1.44 MB |
| **NovaOS** | 2024 | OS | 128 MB | Kernel Multiboot, VBE 1280×720 |
| **Tiny Core Linux** | 2024 | Linux | 256 MB | Distribuição ultraleve com FLWM |
| **GNU GRUB 2.06** | 2021 | Bootloader | 128 MB | Menu de boot para todos os sistemas |

---

## 🚀 Recursos

### Interface Completa

- **Barra de Ferramentas** — Controles de pausar, reiniciar, tela cheia
- **Comandos Rápidos** — Atalhos para `ver`, `dir`, `mem`
- **Tela CRT Autêntica** — Scanlines, cores CGA, proporção 4:3
- **Modo Dual Screen** — Compare dois sistemas lado a lado (`?duo=win101,win311`)

### Gerenciamento Avançado

- **📂 Gerenciador de Arquivos**
  - Upload/download de arquivos
  - Download direto por URL *(apenas local)*
  - Extração automática de ZIP (store/deflate/ZIP64)
  - Criação/exclusão de pastas
  - Manipulação FAT12/16 em tempo real

- **📸 Sistema de Snapshots**
  - Salva estado completo (~22 MB comprimidos)
  - Miniaturas da tela
  - Armazenamento no IndexedDB do navegador
  - Import/export de arquivos `.v86state`

- **⚙️ Configuração da Máquina**
  - Limite de velocidade da CPU
  - Informações de RAM/vídeo
  - Status do mouse (driver ativo?)
  - Geometria de disco e partições
  - Salvar disco no projeto *(apenas local)*

- **📜 Logs Detalhados**
  - Categorias: WereBOX, v86, console, erro
  - Filtros por nível
  - Busca em tempo real
  - Export para TXT

---

## 🚀 Começar

### Instalação e Execução

```bash
# Clone o repositório
git clone https://github.com/antojunimaia-ui/WereBOX.git
cd WereBOX

# Entre na pasta do emulador
cd emulator

# Instale as dependências
npm install

# Inicie o servidor local
npm start
```

Abra seu navegador em: **http://localhost:8123/emulator/**

> **💡 Experimente online:** [https://werebox.onrender.com/](https://werebox.onrender.com/)  
> *(Nota: Em produção, os recursos de download por URL e salvamento de disco estão desabilitados por segurança)*

### Primeiro Uso

1. O sistema iniciará com o **menu GNU GRUB 2.06**
2. Use **↑/↓** para navegar entre os sistemas
3. Pressione **Enter** para iniciar (ou aguarde 12s para boot automático)
4. Clique na aba **Machine** para acessar configurações, snapshots e arquivos

---

## ⚠️ Segurança em Produção

> **🌐 Acesse a versão pública:** [https://werebox.onrender.com/](https://werebox.onrender.com/)  
> Esta instância está configurada com `NODE_ENV=production` e os endpoints protegidos estão desabilitados.

### Endpoints Protegidos

Os seguintes endpoints são **automaticamente desabilitados** quando `NODE_ENV=production`:

| Endpoint | Função | Status |
|----------|--------|--------|
| `/emulator/__download` | Proxy de download de URLs externas | 🔒 Apenas local |
| `/emulator/__save` | Salvamento de imagens de disco | 🔒 Apenas local |

### Por Que São Desabilitados?

**Segurança:** Sem autenticação, esses endpoints poderiam ser abusados em produção para:
- ❌ Usar seu servidor como proxy anônimo
- ❌ Ocultar origem de ataques DDoS
- ❌ Baixar conteúdo ilegal usando o IP do servidor
- ❌ Lotar disco com uploads de 96 MB
- ❌ Violar políticas de hospedagem (Render, Vercel, etc.)

### O Que Funciona em Produção?

| Recurso | Local | Produção |
|---------|-------|----------|
| Interface completa | ✅ | ✅ |
| Todos os sistemas operacionais | ✅ | ✅ |
| Snapshots (IndexedDB) | ✅ | ✅ |
| Upload manual de arquivos | ✅ | ✅ |
| Tela cheia, pausar, reiniciar | ✅ | ✅ |
| Controle de velocidade da CPU | ✅ | ✅ |
| **Download por URL** | ✅ | ❌ |
| **Salvar disco no projeto** | ✅ | ❌ |

### Comandos

```bash
# Desenvolvimento (todos os recursos)
npm start

# Teste o modo produção localmente
NODE_ENV=production npm start

# Em produção (Render, etc.)
# O Render define NODE_ENV=production automaticamente
```

### 🌐 Instância Pública

O WereBOX está hospedado no Render e pode ser acessado em:

**https://werebox.onrender.com/**

Esta instância funciona com todas as funcionalidades principais, exceto:
- ❌ Download de arquivos por URL (endpoint `/__download` desabilitado)
- ❌ Salvamento de disco no projeto (endpoint `/__save` desabilitado)

Para usar esses recursos, execute o WereBOX localmente.

---

## 📁 Estrutura do Projeto

```
WereBOX/
├── emulator/                   # Interface e motor v86
│   ├── index.html             # Página principal
│   ├── profiles.json          # Configuração dos 10 sistemas
│   ├── ui/                    # Interface customizada
│   │   ├── app.mjs           # Controlador principal
│   │   ├── boot-loader.mjs   # Carregador de sistemas
│   │   ├── boot-selector.mjs # Menu HTML fallback
│   │   ├── fat.mjs           # Leitor/gravador FAT12/16
│   │   ├── discos.mjs        # Gerenciador de discos vivos
│   │   ├── snapshots.mjs     # Sistema de snapshots
│   │   ├── mouse.mjs         # Estado do mouse PS/2
│   │   ├── teclado-mobile.mjs# Teclado virtual mobile
│   │   ├── zip.mjs           # Extrator ZIP
│   │   ├── duo.mjs           # Modo comparação dual screen
│   │   ├── estilo.css        # Visual CRT e tema
│   │   └── paineis/          # Painéis da interface
│   │       ├── arquivos.mjs  # Gerenciador de arquivos
│   │       ├── config.mjs    # Configuração da máquina
│   │       ├── snap-novo.mjs # Criar snapshot
│   │       ├── snap-lista.mjs# Listar snapshots
│   │       ├── logs.mjs      # Logs da sessão
│   │       └── seguranca.mjs # Análise de segurança
│   ├── tools/                 # Ferramentas de build
│   │   ├── serve.mjs         # Servidor HTTP
│   │   ├── setup-v86.mjs     # Extrator v86
│   │   ├── mk-grub.mjs       # Montador GRUB
│   │   ├── mkdisk.mjs        # Criador de disco
│   │   └── instalar-mouse.mjs# Instalador de mouse
│   ├── tests/                 # Testes automatizados
│   │   ├── fat.test.mjs      # Testes FAT (57 casos)
│   │   ├── zip.test.mjs      # Testes ZIP (67 casos)
│   │   ├── download.test.mjs # Testes download (71 casos)
│   │   └── ...               # Mais testes
│   ├── autoral/               # Emulador próprio aposentado
│   ├── libv86.js, v86.wasm   # Motor v86
│   ├── seabios.bin           # BIOS do PC
│   └── vgabios.bin           # BIOS VGA
├── Systems/                   # Imagens de disco dos sistemas
│   ├── MS-DOS 6.22/
│   │   ├── c.img             # Disco C: com DOS + Windows 3.11
│   │   ├── msdos.img         # Imagem standalone do DOS
│   │   └── dos622.iso        # CD-ROM original
│   ├── Windows 1.01/
│   │   └── win101.img        # Disquete 1.44 MB bootável
│   ├── Windows 2.03/
│   │   └── win203.img        # Disco rígido com Windows 2.03
│   ├── Windows 3.11/
│   │   ├── win311hd.img      # Disco C: com Windows 3.11
│   │   ├── win311-boot.img   # Disquete de boot
│   │   └── disk01-07.img     # 7 disquetes originais
│   ├── GNU GRUB 2.06/
│   │   └── grub-hd.img       # Disco com GRUB instalado
│   ├── KolibriOS/
│   ├── MenuetOS/
│   ├── NovaOS/
│   └── TinyCore/
└── README.md                  # Este arquivo
```

---

## 🧪 Testes

WereBOX possui **mais de 270 testes automatizados** cobrindo FAT, ZIP, download, mídias e lógica do emulador.

```bash
cd emulator

# Testes específicos
npm run test:fat        # FAT12/16: lê, grava, apaga, audita (57 testes)
npm run test:zip        # Extração ZIP store/deflate/ZIP64 (67 testes)
npm run test:download   # Download por URL e gravação FAT (71 testes)
npm run test:midias     # Mapeamento de imagens por perfil (12 testes)
npm run test:duo        # Parsing de URLs dual screen (17 testes)
npm run test:serve      # Proxy e servidor HTTP (21 testes)

# Todos os testes
npm run test:tudo       # 270+ testes (emulador + FAT + ZIP + download)
```

### Cobertura de Testes

- ✅ Leitura/gravação FAT12 e FAT16
- ✅ Tabela de partição MBR e BPB
- ✅ Extração de ZIP (store, deflate, ZIP64)
- ✅ Conversão de nomes para 8.3
- ✅ Download com proxy HTTP
- ✅ Sanitização de caminhos e segurança
- ✅ Emulador 8086 aposentado (31 testes)

---

## 🔧 Como Funciona

### Emulação x86 Completa

O WereBOX usa o **v86** como motor de emulação, que converte instruções x86 para WebAssembly:

```
┌─────────────────────────────────────────┐
│  Interface WereBOX (HTML/CSS/JS)       │
├─────────────────────────────────────────┤
│  Motor v86 (x86 → WebAssembly)         │
│  • CPU 8086/286/386/486                │
│  • FPU x87 (QBASIC, SCANDISK)          │
│  • Controlador PS/2 (mouse/teclado)    │
│  • Controlador de disco (IDE/FDC)      │
│  • VGA/EGA (modos texto e gráfico)     │
│  • Relógio em tempo real (RTC)         │
├─────────────────────────────────────────┤
│  BIOS (SeaBIOS + VGABIOS)              │
├─────────────────────────────────────────┤
│  Sistema Operacional (DOS/Windows/etc) │
└─────────────────────────────────────────┘
```

### Boot Real com GRUB

O menu não é HTML — é o **GNU GRUB 2.06 real** rodando dentro da BIOS emulada:

1. BIOS lê o MBR do `hda` (grub-hd.img)
2. MBR carrega o `core.img` do GRUB
3. GRUB lê `grub.cfg` e desenha o menu
4. Usuário escolhe entrada com ↑/↓/Enter
5. GRUB executa `drivemap` e `chainloader` para bootar o sistema

### Mouse PS/2 Funcional

```
Clique no navegador
    ↓
Captura de evento JS (x, y, botões)
    ↓
Controlador PS/2 8042 do v86
    ↓
Driver MOUSE.COM no DOS (INT 33h)
    ↓
Programas DOS (EDIT, QBASIC, jogos)
```

### Gerenciador FAT Real

O `ui/fat.mjs` lê/escreve **FAT12 e FAT16** diretamente nos `SyncBuffer` do v86:

- Interpreta BPB (BIOS Parameter Block)
- Lê tabela de partição MBR
- Monta cadeias de clusters
- Interpreta entradas 8.3 (nome, atributos, data/hora)
- Grava arquivos, cria pastas, apaga recursivamente
- Auditoria de alocação (detecta clusters perdidos)

**Compatibilidade testada:** O mesmo código roda no navegador (disco vivo) e no Node.js (testes).

---

## 📜 Licenças

### Componentes de Terceiros

| Componente | Licença | Uso |
|------------|---------|-----|
| [v86](https://github.com/copy/v86) | BSD-2-Clause | Motor de emulação x86 |
| [GNU GRUB 2.06](https://www.gnu.org/software/grub/) | GPLv3+ | Bootloader (binário + fonte) |
| [SeaBIOS](https://www.seabios.org/) | LGPL | BIOS do PC emulado |
| VGABIOS | LGPL | BIOS VGA |

### Sistemas Operacionais

| Sistema | Copyright | Licença |
|---------|-----------|---------|
| MS-DOS 6.22 | © Microsoft | Uso das mídias originais |
| Windows 1.01/2.03/3.11 | © Microsoft | Uso das mídias originais |
| KolibriOS | GPL-2.0 | Open source |
| MenuetOS | Proprietary | Distribuição livre para uso |
| NovaOS | Custom | Open source |
| Tiny Core Linux | GPL-2.0 | Open source |

### Este Projeto

**WereBOX Interface e Ferramentas**

- **Licença:** BSD 3-Clause License
- **Copyright:** © 2026 antojunimaia-ui
- **Código fonte:** Disponível em `emulator/ui/`, `emulator/tools/` e `emulator/tests/`
- **Arquivo de licença:** [LICENSE](LICENSE)

---

## 🤝 Contribuindo

Contribuições são bem-vindas! Por favor:

1. Fork o projeto: [https://github.com/antojunimaia-ui/WereBOX/fork](https://github.com/antojunimaia-ui/WereBOX/fork)
2. Crie uma branch para sua feature (`git checkout -b feature/MinhaFeature`)
3. Commit suas mudanças (`git commit -m 'Adiciona MinhaFeature'`)
4. Push para a branch (`git push origin feature/MinhaFeature`)
5. Abra um Pull Request: [https://github.com/antojunimaia-ui/WereBOX/pulls](https://github.com/antojunimaia-ui/WereBOX/pulls)

### Diretrizes

- ✅ Adicione testes para novas funcionalidades
- ✅ Mantenha o código documentado
- ✅ Siga o estilo existente do projeto
- ❌ Não submeta código gerado por IA para o projeto v86 upstream

### 📢 Reportar Problemas

Encontrou um bug ou tem uma sugestão? [Abra uma issue](https://github.com/antojunimaia-ui/WereBOX/issues/new).

---

## 📚 Documentação Adicional

- **[emulator/README.md](emulator/README.md)** — Documentação técnica completa
- **[emulator/MOUSE.md](emulator/MOUSE.md)** — Como o mouse PS/2 funciona
- **[emulator/SEGURANCA.md](emulator/SEGURANCA.md)** — Segurança e análise de malware
- **[Systems/README.md](Systems/README.md)** — Organização das mídias dos sistemas

---

## 🙏 Agradecimentos

- **[copy/v86](https://github.com/copy/v86)** — Motor de emulação x86 em WebAssembly
- **Comunidade GNU GRUB** — Bootloader open source
- **Desenvolvedores de sistemas alternativos** — KolibriOS, MenuetOS, NovaOS

---

<div align="center">

Built by <strong>antojunimaia-ui</strong>.

</div>


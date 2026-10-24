# Menuet32-Plus

Fork moderno do MenuetOS 32-bit com bugfixes e novos recursos, mantendo compatibilidade com apps originais.

## GitHub

**Repositório:** https://github.com/ry755/menuet32-plus

### Instruções

#### Opção 1: Build Manual

1. Clone o repositório:
   ```bash
   git clone https://github.com/ry755/menuet32-plus.git
   cd menuet32-plus
   ```

2. Instale dependências (FASM, NASM, Smaller C)

3. Compile:
   ```bash
   make
   ```

4. Copie `m32-plus.img` para `Systems/Menuet32-Plus/menuet32-plus.img`

#### Opção 2: Download Manual

Se houver releases pré-compilados no GitHub:
1. Acesse https://github.com/ry755/menuet32-plus/releases
2. Baixe a imagem de disquete
3. Renomeie para `menuet32-plus.img`
4. Coloque nesta pasta

## Perfil

Adicione em `emulator/profiles.json`:

```json
{
  "id": "menuet32plus",
  "name": "Menuet32-Plus",
  "description": "Fork moderno do MenuetOS 32-bit com bugfixes e melhorias",
  "icon": "💎",
  "category": "os",
  "year": "2022",
  "memory": 128,
  "vga_memory": 8,
  "config": {
    "fda": { "url": "../Systems/Menuet32-Plus/menuet32-plus.img" },
    "boot_order": 801
  }
}
```

## Arquivo Esperado

```
Systems/Menuet32-Plus/
  ├── menuet32-plus.img     (1.44 MB - você compila ou baixa)
  └── README.md             (este arquivo)
```

## Recursos Adicionais

- Bugfixes da versão original
- Novos recursos e melhorias
- Compatível com aplicações MenuetOS 32-bit

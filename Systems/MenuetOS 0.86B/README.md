# MenuetOS 0.86B (2009)

Versão clássica do MenuetOS 32-bit de 2009.

## Download

**SourceForge:** https://sourceforge.net/projects/menuet/files/086/B/M32-086B.ZIP/download

### Instruções

1. Baixe `M32-086B.ZIP` (~750 KB)
2. Extraia o arquivo `M32-086.IMG`
3. Renomeie para `menuet086.img`
4. Coloque nesta pasta: `Systems/MenuetOS 0.86B/menuet086.img`

## Perfil

Adicione em `emulator/profiles.json`:

```json
{
  "id": "menuet086",
  "name": "MenuetOS 0.86B",
  "description": "Versão clássica do MenuetOS 32-bit de 2009",
  "icon": "💎",
  "category": "os",
  "year": "2009",
  "memory": 128,
  "vga_memory": 8,
  "config": {
    "fda": { "url": "../Systems/MenuetOS%200.86B/menuet086.img" },
    "boot_order": 801
  }
}
```

## Arquivo Esperado

```
Systems/MenuetOS 0.86B/
  ├── menuet086.img     (1.44 MB - você baixa)
  └── README.md         (este arquivo)
```

# MenuetOS - Versões Alternativas

O MenuetOS atual no WereBOX é a versão **0.99.86** (2015), a última versão 32-bit oficial.

Você pode adicionar versões mais antigas ou o fork moderno **Menuet32-Plus**!

---

## 📦 Versões Disponíveis

### 1. MenuetOS 0.99.86 (Atual)
- **Ano:** 2015
- **Arquivo:** `menuet.img` (na pasta pai)
- **Status:** ✅ Já instalado

### 2. MenuetOS 0.86B (Clássico)
- **Ano:** 2009
- **Download:** https://sourceforge.net/projects/menuet/files/086/B/M32-086B.ZIP/download
- **Instruções:**
  1. Baixe `M32-086B.ZIP` (≈750 KB)
  2. Extraia `M32-086.IMG`
  3. Renomeie para `menuet-086.img`
  4. Coloque nesta pasta (`Systems/MenuetOS/versions/`)
  5. Adicione perfil em `emulator/profiles.json`

### 3. Menuet32-Plus (Fork Moderno)
- **Ano:** 2022+
- **GitHub:** https://github.com/ry755/menuet32-plus
- **Recursos:** Bugfixes, novos recursos, compatível com apps originais
- **Instruções:**
  1. Clone o repo: `git clone https://github.com/ry755/menuet32-plus.git`
  2. Compile com `make` (requer FASM, NASM, Smaller C)
  3. Ou baixe release pré-compilado (se disponível)
  4. Renomeie para `menuet32-plus.img`
  5. Coloque nesta pasta
  6. Adicione perfil em `emulator/profiles.json`

---

## ⚙️ Adicionar Perfil

Depois de baixar uma versão, adicione em `emulator/profiles.json`:

```json
{
  "id": "menuet086",
  "name": "MenuetOS 0.86B (2009)",
  "description": "Versão clássica do MenuetOS 32-bit de 2009",
  "icon": "💎",
  "category": "os",
  "year": "2009",
  "memory": 128,
  "vga_memory": 8,
  "config": {
    "fda": { "url": "../Systems/MenuetOS/versions/menuet-086.img" },
    "boot_order": 801
  }
}
```

---

## 🔍 Diferenças Entre Versões

| Versão | Ano | Tamanho | Recursos Principais |
|--------|-----|---------|---------------------|
| **0.99.86** | 2015 | 1.44 MB | GUI moderna, TCP/IP, USB, jogos |
| **0.86B** | 2009 | 1.44 MB | GUI clássica, networking básico |
| **32-Plus** | 2022+ | 1.44 MB | Fork com bugfixes e melhorias |

---

## 📝 Notas

- MenuetOS 64-bit **NÃO funciona** no v86 (apenas 32-bit)
- Todas as versões cabem em disquete (1.44 MB)
- A versão atual (0.99.86) já funciona perfeitamente no WereBOX

**Quer adicionar uma versão diferente?** Siga as instruções acima! 🚀

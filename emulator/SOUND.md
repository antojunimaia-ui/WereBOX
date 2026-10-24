# Sound Blaster 16 no WereBOX 🔊

## ✅ Status: ATIVADO

O v86 já vem com **Sound Blaster 16 completo** implementado! Agora está ativado no WereBOX.

---

## 🎵 O Que Funciona

- ✅ **PC Speaker** (beeps básicos do BIOS/DOS)
- ✅ **Sound Blaster 16 DAC** (áudio digital 8-bit e 16-bit)
- ✅ **OPL3 FM Synthesis** (Yamaha YMF262 - música MIDI/AdLib)
- ✅ **Mixer** (controle de volume)
- ✅ **DMA** (transferência direta de memória para áudio)
- ✅ **IRQ** (interrupções de áudio)

**Configuração padrão:**
- **Base I/O:** 0x220
- **IRQ:** 5
- **DMA:** 1 (8-bit), 5 (16-bit)
- **OPL3:** 0x388

---

## 🧪 Como Testar

### 1. Beeps Simples (PC Speaker)
```batch
REM No MS-DOS:
ECHO ^G
REM Ou qualquer programa que use BEEP
```

### 2. Programas DOS com Áudio

Baixe e teste no WereBOX:
- **DIGPLAY.EXE** - player de arquivos .WAV/.VOC
- **MP.EXE** - MOD player (música tracker)
- **MPXPLAY.EXE** - player multi-formato (MP3, WAV, MOD)

### 3. Jogos DOS com Sound Blaster

Configure os jogos com:
- **Sound Card:** Sound Blaster 16
- **Port:** 220
- **IRQ:** 5
- **DMA:** 1 ou 5

**Jogos testáveis:**
- DOOM
- Duke Nukem 3D
- Jazz Jackrabbit
- Wolfenstein 3D

### 4. Windows 3.11 com Drivers SB16

Instale o driver Sound Blaster 16 no Windows 3.11 e teste com:
- Media Player
- Sound Recorder
- Qualquer jogo Win16 com áudio

---

## 🎮 Configurar no Setup de Jogos

Quando um jogo perguntar sobre áudio:

```
Sound Card Type: Sound Blaster 16
Base I/O Port:   220 (hex)
IRQ:             5
DMA:             1  (8-bit) ou 5 (16-bit)
MIDI/FM:         AdLib/OPL3 (port 388)
```

---

## 🔧 Controles de Volume (API)

```javascript
// Silenciar áudio
em.speaker_adapter.mixer.set_volume(0, undefined);

// Restaurar volume
em.speaker_adapter.mixer.set_volume(1, undefined);
```

---

## 📝 Implementação Técnica

O v86 emula:

### 1. DSP (Digital Signal Processor)
- Comandos DSP completos (0x10, 0x14, 0x40, 0xD0, etc)
- DMA transfer (8-bit e 16-bit)
- Auto-init mode
- High-speed mode

### 2. Mixer
- Master volume
- DAC volume
- PC Speaker volume
- Line In, Mic, CD (dummy)

### 3. OPL3 (FM Synthesis)
- Yamaha YMF262 completo
- 18 canais de síntese FM
- Stereo

### 4. Web Audio API Integration
- AudioContext para saída
- AudioWorklet (ou BufferSource fallback)
- Baixa latência (~20ms)

---

## 🐛 Problemas Conhecidos

### Áudio não toca?

1. **Navegador bloqueou** - clique na tela primeiro (Web Audio precisa de user gesture)
2. **Mute ativado** - verifique console: `em.speaker_adapter?.audio_context?.state`
3. **Driver errado** - certifique-se que o jogo está configurado para SB16

### Performance

- Áudio pode ter glitches se a CPU estiver muito lenta
- Use velocidade "máxima" no painel de configuração

---

## 📚 Referências

- [Sound Blaster 16 Programming Guide](https://pdos.csail.mit.edu/6.828/2011/readings/hardware/SoundBlaster.pdf)
- [v86 sb16.js Source](https://github.com/copy/v86/blob/master/src/sb16.js)
- [v86 speaker.js Source](https://github.com/copy/v86/blob/master/src/browser/speaker.js)

---

**Aproveite o áudio nostálgico! 🎵🎮**

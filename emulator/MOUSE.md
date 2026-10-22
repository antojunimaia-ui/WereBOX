# Mouse no reDOS

O reDOS usa **Pointer Lock** para sincronização perfeita do mouse com o DOS.

## Como usar

1. **Clique na tela do emulador** para capturar o mouse
2. O cursor do navegador desaparece
3. Seu mouse agora controla o cursor do DOS diretamente
4. **Pressione ESC** para liberar o mouse

## Por que Pointer Lock?

O mouse PS/2 que o MS-DOS usa funciona em **modo relativo** (movimentos, não posição absoluta). 
Pointer Lock é a forma nativa do navegador de capturar movimentos relativos, resultando em 
sincronização perfeita sem necessidade de ajustes ou calibração.

## Testado em

- EDIT (menus clicáveis)
- QBASIC (interface e menus)
- Qualquer programa que use INT 33h

## Comportamento

- **Dentro do pointer lock**: o cursor some e o movimento é passado diretamente ao DOS
- **Fora do pointer lock**: cursor normal, pode usar a interface do reDOS
- **ESC**: libera o pointer lock automaticamente
- **Funciona em tela cheia**: sim, sem problemas

## Implementação

Ver `ui/app.mjs`:
- `canvas.requestPointerLock()` ao clicar
- Listener em `pointerlockchange` para detectar quando libera
- ESC libera o lock antes de qualquer outra ação

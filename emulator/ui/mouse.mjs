// mouse.mjs — o mouse visto do lado do PC.
//
// Não há nada a configurar aqui: o v86 emula o mouse PS/2 (controlador 8042) e o
// driver do próprio DOS (MOUSE.COM, em C:\DOS) assume o INT 33h no boot — a
// interface só precisa de deixar os eventos chegarem na tela do PC (o v86 faz
// isso: eventos dentro do #screen viram pacote PS/2).
//
// O que dá para fazer deste lado é LER o estado. Quando um driver assume o mouse,
// ele manda o comando PS/2 0xF4 ("enable data reporting"); é esse comando que o
// controlador do v86 marca em `enable_mouse_stream`. Ou seja: se está marcado, há
// driver de pé e o ponteiro do navegador está ligado na máquina.
//
// (Mesma família de acesso por dentro do v86 que o ui/discos.mjs já usa para o
// buffer do C: (hdb no perfil GRUB, hda nos perfis diretos): se o v86 mudar
// essas entranhas, quebra nos dois.)
export function estadoMouse(em) {
  const ps2 = em?.v86?.cpu?.devices?.ps2;
  if (!ps2) return { lido: false, motivo: "controlador PS/2 não encontrado na máquina" };
  return {
    lido: true,
    // "pronto" = o controlador tem mouse, alguém assumiu (use_mouse) e o driver
    // pediu o fluxo de dados (enable_mouse_stream)
    pronto: !!(ps2.have_mouse && ps2.use_mouse && ps2.enable_mouse_stream),
    temMouse: !!ps2.have_mouse,
    assumido: !!ps2.use_mouse,
  };
}

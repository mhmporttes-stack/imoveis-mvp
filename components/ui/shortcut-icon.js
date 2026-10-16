// Padrão único dos ícones de atalho do cabeçalho (dono, 2026-10-16: "mesmo tamanho, mesma cor, mesmo estilo de notificação
// do Chat e da Agenda nos 4"). Vale para Chat, Agenda, "Clientes que esfriaram" e Notificações: ícone de 20px na cor do
// texto secundário, sem fundo nem borda colorida; contador = CountBadge verde (components/ui/Badge.jsx) no canto superior
// direito. A urgência vem do número, não da cor do botão.
//
// "shortcut": linha de atalhos da tela de Clientes (computador) — caixa de 44px.
// "compact": dentro do card "Melhor do Dia" (celular e demais telas) — caixa de 28px (32px no computador) com área de toque
// estendida a 44px+ pelo ::before; o ícone e o contador são os mesmos do "shortcut".
const BASE = "relative inline-flex items-center justify-center rounded-control text-ink-2 transition-colors hover:bg-navy/[0.06] hover:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

export const SHORTCUT_ICON_BUTTON = `${BASE} h-touch w-touch`;
export const SHORTCUT_ICON_BUTTON_COMPACT = `${BASE} h-7 w-7 before:absolute before:-inset-2 before:content-[''] lg:h-8 lg:w-8`;
export const SHORTCUT_ICON = "h-5 w-5";
export const SHORTCUT_BADGE = "absolute -right-1 -top-1 ring-2 ring-mist";
export const SHORTCUT_BADGE_COMPACT = "absolute -right-1.5 -top-1.5 ring-2 ring-white";

export function shortcutIconClasses(variant = "compact") {
  return variant === "shortcut"
    ? { button: SHORTCUT_ICON_BUTTON, icon: SHORTCUT_ICON, badge: SHORTCUT_BADGE }
    : { button: SHORTCUT_ICON_BUTTON_COMPACT, icon: SHORTCUT_ICON, badge: SHORTCUT_BADGE_COMPACT };
}

"use client";

import Link from "next/link";
import { CountBadge } from "@/components/ui/Badge";
import { SHORTCUT_BADGE, SHORTCUT_ICON, SHORTCUT_ICON_BUTTON } from "@/components/ui/shortcut-icon";
import { useMarketplaceUnreadCount } from "./MarketplaceNavBadge";

// Atalho do "Chat Marketplace" no cabeçalho da tela de Clientes (computador), à direita do Chat (dono, 2026-10-21).
// Todos os perfis (o escopo das conversas é do servidor). Contador = o mesmo do menu "Chat Marketplace".
export default function MarketplaceChatShortcut() {
  const count = useMarketplaceUnreadCount();
  return (
    <Link href="/admin/chat/marketplace" aria-label={`Chat Marketplace${count ? ` (${count} não lidas)` : ""}`} title="Chat Marketplace" className={SHORTCUT_ICON_BUTTON}>
      <MarketplaceChatIcon className={SHORTCUT_ICON} />
      <CountBadge count={count} className={SHORTCUT_BADGE} label={`${count} mensagens não lidas no Marketplace`} />
    </Link>
  );
}

// Desenho próprio no traço dos ícones lucide (24px, stroke 2, pontas arredondadas, cor do texto): balão arredondado com
// um raio em zigue-zague dentro. Lembra o Messenger sem copiar o logotipo da Meta (sem cores nem gradiente da marca).
// Exportado para a barra inferior do celular (AdminBottomNav), que passa o strokeWidth como faz com os ícones lucide.
export function MarketplaceChatIcon({ className = "", strokeWidth = 2 }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" focusable="false">
      {/* Mesmo contorno do balão do Chat (lucide MessageCircle) para ter exatamente o mesmo tamanho (dono, 2026-10-21:
          "o tamanho está menor, ficou feio"); só o raio dentro diferencia. */}
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
      <path d="m7.5 13.5 3-3.5 2.5 2.5 3.5-3.5" />
    </svg>
  );
}

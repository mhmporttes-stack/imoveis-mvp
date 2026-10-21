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
function MarketplaceChatIcon({ className = "" }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" focusable="false">
      <path d="M12 3c-5 0-9 3.7-9 8.3 0 2.5 1.2 4.7 3 6.2V21l3.1-1.7c.9.2 1.9.4 2.9.4 5 0 9-3.7 9-8.4S17 3 12 3z" />
      <path d="m7.5 13.5 3-3.2 2.5 2.2 3.5-3.5" />
    </svg>
  );
}

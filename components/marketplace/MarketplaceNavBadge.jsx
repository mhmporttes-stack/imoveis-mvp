"use client";

import { useEffect, useState } from "react";
import { CountBadge } from "@/components/ui/Badge";

// Não lidas do Chat do Marketplace (MKT-2), pelo escopo do servidor (/api/admin/marketplace-chat/unread →
// countMarketplaceUnread). Consulta a cada 60 s com a aba visível. Fonte única do contador: menu e atalho do cabeçalho.
export function useMarketplaceUnreadCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/admin/marketplace-chat/unread", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => alive && data && setCount(Number(data.unread) || 0))
        .catch(() => {}); // contador é só indicativo; a próxima volta tenta de novo
    };
    load();
    const timer = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return count;
}

// Contador de não lidas do Chat do Marketplace no menu (MKT-2).
export default function MarketplaceNavBadge({ className = "" }) {
  const count = useMarketplaceUnreadCount();
  return <CountBadge count={count} className={className} label={`${count} mensagens não lidas no Marketplace`} />;
}

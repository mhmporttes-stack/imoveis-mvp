"use client";

import { useEffect, useState } from "react";
import { CountBadge } from "@/components/ui/Badge";

// Contador de não lidas do Chat do Marketplace no menu (MKT-2). Consulta a cada 60 s com a aba visível.
export default function MarketplaceNavBadge({ className = "" }) {
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
  return <CountBadge count={count} className={className} label={`${count} mensagens não lidas no Marketplace`} />;
}

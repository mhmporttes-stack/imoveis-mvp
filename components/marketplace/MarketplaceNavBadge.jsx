"use client";

import { useEffect, useState } from "react";
import { CountBadge } from "@/components/ui/Badge";

// Não lidas do Chat do Marketplace (MKT-2), pelo escopo do servidor (/api/admin/marketplace-chat/unread →
// countMarketplaceUnread). Fonte única do contador: menu, barra inferior e atalho do cabeçalho.
// Atualiza rápido (dono, 2026-10-30, MKT-3): UMA consulta compartilhada por todos os selos da tela, a cada 20 s com a aba
// visível e na hora em que o app volta para a frente (ex.: depois de tocar no push).
const REFRESH_MS = 20000;
const listeners = new Set();
let current = 0;
let timer = null;
let inFlight = false;

function publish(value) {
  current = value;
  for (const listener of listeners) listener(value);
}

function load() {
  if (typeof document === "undefined" || document.visibilityState !== "visible" || inFlight) return;
  inFlight = true;
  fetch("/api/admin/marketplace-chat/unread", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => { if (data) publish(Number(data.unread) || 0); })
    .catch(() => {}) // contador é só indicativo; a próxima volta tenta de novo
    .finally(() => { inFlight = false; });
}

function onVisible() {
  if (document.visibilityState === "visible") load();
}

function start() {
  load();
  timer = setInterval(load, REFRESH_MS);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", load);
}

function stop() {
  clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", onVisible);
  window.removeEventListener("focus", load);
}

export function useMarketplaceUnreadCount() {
  const [count, setCount] = useState(current);
  useEffect(() => {
    listeners.add(setCount);
    if (listeners.size === 1) start();
    else setCount(current);
    return () => {
      listeners.delete(setCount);
      if (!listeners.size) stop();
    };
  }, []);
  return count;
}

// Contador de não lidas do Chat do Marketplace no menu (MKT-2).
export default function MarketplaceNavBadge({ className = "" }) {
  const count = useMarketplaceUnreadCount();
  return <CountBadge count={count} className={className} label={`${count} mensagens não lidas no Marketplace`} />;
}

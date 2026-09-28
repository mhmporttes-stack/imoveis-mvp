"use client";

import { useEffect, useState } from "react";
import { useWhatsappChatSummary } from "@/components/useWhatsappChatSummary";

let counts = { clients: 0, agenda: 0 };
let inFlight = null;
const listeners = new Set();

function refresh() {
  if (!inFlight) inFlight = fetch("/api/admin/crm-badge-counts", { cache: "no-store" })
    .then((response) => response.ok ? response.json() : null)
    .then((next) => {
      if (next) {
        counts = next;
        for (const listener of listeners) listener(counts);
      }
    })
    .catch(() => {})
    .finally(() => { inFlight = null; });
  return inFlight;
}

export function useCrmBadgeCounts() {
  const { summary } = useWhatsappChatSummary(refresh);
  const [current, setCurrent] = useState(counts);
  useEffect(() => {
    listeners.add(setCurrent);
    refresh();
    return () => listeners.delete(setCurrent);
  }, []);
  return { ...current, total: current.clients + current.agenda + (summary.unreadMessages || 0) };
}

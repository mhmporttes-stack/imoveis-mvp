"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquareReply } from "lucide-react";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Sheet from "@/components/ui/Sheet";
import { SkeletonList } from "@/components/ui/Skeleton";
import { formatBrazilianPhone } from "@/lib/phone-utils";
import { formatAgo, formatFullDateTime } from "./client-format";

// "Respostas da prospecção" (pedido do dono, 2026-10-02): clientes que
// responderam à prospecção pelo WhatsApp e aguardam o corretor atualizar o
// status — e clientes em "Não contactar" que voltaram a mandar mensagem.
// O status nunca muda sozinho por aqui: só pelos botões (mesma regra da
// ficha do cliente, ver lib/prospecting-reply.js).
export default function ProspectingRepliesPanel({ open, onClose, onChanged, notify, onOpenClient }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/prospecting-replies", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar.");
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const act = async (item, action, successMessage) => {
    setBusyId(item.id);
    try {
      const response = await fetch(`/api/admin/prospecting-replies/${item.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível atualizar.");
      setItems((current) => current.filter((row) => row.id !== item.id));
      notify?.(successMessage);
      onChanged?.();
    } catch (actionError) {
      notify?.(actionError.message, "danger");
    } finally {
      setBusyId("");
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Respostas da prospecção" description="Clientes que responderam e aguardam você atualizar o status.">
      {loading && !items.length ? <SkeletonList rows={3} /> : null}
      {error ? <p className="rounded-card border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
      {!loading && !error && !items.length ? (
        <EmptyState icon={MessageSquareReply} title="Nenhuma resposta aguardando" description="Quando um cliente da prospecção responder pelo WhatsApp, ele aparece aqui." />
      ) : null}
      <ul className="space-y-3">
        {items.map((item) => {
          const reactivation = item.kind === "reactivation";
          const busy = busyId === item.id;
          return (
            <li key={item.id} className="rounded-card border border-line bg-white p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <button type="button" onClick={() => onOpenClient?.(item.clientId)} className="truncate text-left text-[15px] font-semibold text-navy hover:underline">
                    {item.clientName}
                  </button>
                  <p className="text-xs text-muted tabular-nums">
                    {formatBrazilianPhone(item.phone) || item.phone}
                    {item.brokerName ? ` · ${item.brokerName}` : ""}
                  </p>
                </div>
                <span className={reactivation ? "shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning" : "shrink-0 rounded-full bg-info-soft px-2 py-0.5 text-[11px] font-semibold text-info"}>
                  {reactivation ? "Em Não contactar" : "Respondeu"}
                </span>
              </div>
              <p className="mt-2 rounded-control bg-mist px-3 py-2 text-sm text-ink-2">
                “{item.preview || "Mensagem"}”
              </p>
              <p className="mt-1 text-xs text-muted" title={formatFullDateTime(item.lastMessageAt)}>
                {item.messageCount > 1 ? `${item.messageCount} mensagens · ` : ""}última {formatAgo(item.lastMessageAt)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {reactivation ? (
                  <>
                    <Button size="sm" loading={busy} disabled={Boolean(busyId)} onClick={() => act(item, "reactivate", "Cliente reativado para Em atendimento.")}>Reativar para Atendimento</Button>
                    <Button size="sm" variant="secondary" disabled={Boolean(busyId)} onClick={() => act(item, "keep_do_not_contact", "Cliente mantido em Não contactar.")}>Manter Não contactar</Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" loading={busy} disabled={Boolean(busyId)} onClick={() => act(item, "start_service", "Cliente movido para Em atendimento.")}>Iniciar atendimento</Button>
                    <Button size="sm" variant="danger-ghost" disabled={Boolean(busyId)} onClick={() => act(item, "do_not_contact", "Cliente movido para Não contactar.")}>Não tem interesse</Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

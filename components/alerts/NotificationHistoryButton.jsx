"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { CountBadge } from "@/components/ui/Badge";
import { cx } from "@/components/ui/cx";
import { shortcutIconClasses } from "@/components/ui/shortcut-icon";
import { useKeepInViewport } from "@/components/ui/useKeepInViewport";

// Botão pequeno de sino no cabeçalho (pedido do dono, 2026-10-14): só o ícone; ao tocar abre o HISTÓRICO das notificações
// (Central de Alertas) do próprio usuário dos últimos 30 dias. Contador com o número das que ainda estão sem "Entendi" (antes era só uma bolinha).
// Lista TODAS as notificações do usuário (alertas da Central + cliente novo/atividade agendada/transferência, 2026-10-16). Só abrir uma
// notificação do sino antigo a marca como lida; os alertas da Central continuam só com "Entendi". Dados: GET /api/admin/alerts/history.

const POLL_MS = 120000;
const KIND_LABEL = { important: "Importante", informative: "Informativo" };

function timeAgo(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "ontem" : `há ${days} dias`;
}

function fullTime(value) {
  try {
    return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)).replace(",", " às");
  } catch {
    return "";
  }
}

export default function NotificationHistoryButton({ align = "end", variant = "compact" }) {
  const ui = shortcutIconClasses(variant);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  useKeepInViewport(panelRef, open);
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/alerts/history", { cache: "no-store" });
      if (!response.ok) throw new Error("falha");
      const data = await response.json();
      setItems(Array.isArray(data.items) ? data.items : []);
      setPending(Number(data.pending) || 0);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    load();
    const onPointer = (event) => { if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, load]);

  const openItem = (item) => {
    // Notificação do sino antigo (cliente novo, atividade agendada…): abrir marca como lida (mesma rota da lista de notificações).
    if (item.source === "notification" && !item.acknowledged && item.notificationId) {
      setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, acknowledged: true } : entry)));
      setPending((value) => Math.max(0, value - 1));
      fetch(`/api/crm-notifications/${item.notificationId}`, { method: "PATCH" }).catch(() => {});
    }
    if (!item.link) return;
    setOpen(false);
    router.push(item.link);
  };

  return (
    <span ref={rootRef} className="relative inline-flex" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Notificações"
        aria-label={pending ? `Notificações (${pending} pendentes)` : "Notificações"}
        aria-expanded={open}
        className={ui.button}
      >
        {/* Mesmo padrão do Chat/Agenda (dono, 2026-10-16): ícone neutro + NÚMERO de não lidas no contador verde. */}
        <Bell className={ui.icon} aria-hidden="true" />
        <CountBadge count={pending} className={ui.badge} label={`${pending} notificações pendentes`} />
      </button>
      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Histórico de notificações"
          className={cx(
            "absolute top-full z-40 mt-1.5 w-[min(92vw,22rem)] overflow-hidden rounded-2xl border border-line bg-white text-left shadow-float",
            align === "end" ? "right-0" : "left-0"
          )}
        >
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-sm font-extrabold text-navy">Notificações</span>
            <span className="text-[11px] font-semibold text-muted">Últimos 30 dias</span>
          </div>
          <div className="max-h-[min(70vh,26rem)] overflow-y-auto">
            {loading && !items.length ? <p className="px-3 py-4 text-sm text-muted">Carregando…</p> : null}
            {failed && !items.length ? <p className="px-3 py-4 text-sm text-muted">Não foi possível carregar agora.</p> : null}
            {!loading && !failed && !items.length ? <p className="px-3 py-4 text-sm text-muted">Nenhuma notificação nos últimos 30 dias.</p> : null}
            <ul className="divide-y divide-line">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => openItem(item)}
                    disabled={!item.link}
                    className={cx("flex w-full gap-2 px-3 py-2.5 text-left", item.link ? "hover:bg-neutral-soft" : "cursor-default")}
                  >
                    <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", item.acknowledged ? "bg-transparent" : "bg-red-500")} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cx("truncate text-[13px] text-navy", item.acknowledged ? "font-semibold" : "font-extrabold")}>{item.title}</span>
                        <span className="shrink-0 text-[11px] text-muted" title={fullTime(item.createdAt)}>{timeAgo(item.createdAt)}</span>
                      </span>
                      <span className="mt-0.5 line-clamp-3 block text-xs leading-snug text-slate-600">{item.body}</span>
                      <span className="mt-1 block text-[10px] font-bold uppercase tracking-wide text-muted">{item.label || KIND_LABEL[item.kind] || ""}{item.acknowledged ? "" : item.source === "notification" ? " · não lida" : " · não confirmada"}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </span>
  );
}

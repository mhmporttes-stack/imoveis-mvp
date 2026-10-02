"use client";

import { useCallback, useEffect, useState } from "react";
import { Ban, Check, CircleHelp, Clock, Unplug } from "lucide-react";
import { resolveWhatsappBadge } from "@/lib/whatsapp-restriction-core.mjs";

// Estados operacionais do WhatsApp no card do gestor/admin: Conectado ·
// Desconectado · Restrição informada (aguardando validação) · Restrição validada.
// Ícone + texto (nunca só cor). Só status operacional — não libera Prospecção.

const ICONS = { check: Check, unplug: Unplug, clock: Clock, help: CircleHelp, ban: Ban };
const TONES = {
  emerald: "bg-emerald-50 text-emerald-700",
  red: "bg-red-50 text-red-700",
  amber: "bg-amber-50 text-amber-700",
  sky: "bg-sky-50 text-sky-800 ring-1 ring-sky-300",
  navy: "bg-navy/10 text-navy ring-1 ring-navy/30"
};

// Restrições abertas do escopo (admin: todas; gestora: equipe) + permissão de validar.
export function useTeamRestrictions() {
  const [byUser, setByUser] = useState({});
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/whatsapp-individual/restriction/team", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.restrictions) setByUser(data.restrictions);
    } catch { /* silencioso: o card segue com o estado da sessão */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  return [byUser, load];
}

export function WhatsappStateChip({ sessionStatus, restriction, small = false }) {
  const open = restriction ? { validation_status: restriction.validationStatus } : null;
  const badge = resolveWhatsappBadge({ sessionStatus, openRestriction: open });
  const Icon = ICONS[badge.icon] || Clock;
  const size = small ? "text-[9px]" : "text-[10px]";
  return (
    <span title={badge.label} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-black ${size} ${TONES[badge.tone] || TONES.amber}`}>
      <Icon aria-hidden="true" className={small ? "h-2.5 w-2.5" : "h-3 w-3"} />{badge.short}
    </span>
  );
}

const EVENT_LABELS = { informed: "Informada", validated: "Validada", rejected: "Não validada", resolved: "Encerrada", auto_ended: "Encerrada (WhatsApp reconectou)" };
const ORIGIN_LABELS = { corretor: "corretor", admin: "administrador", gestora: "gestora", sistema: "sistema", evidencia_tecnica: "evidência técnica" };

// Ações da gestão sobre a restrição aberta do corretor (só admin geral / gestora da equipe):
// informada → "Validar restrição" / "Não validar"; validada → "Encerrar restrição" (o corretor não encerra
// sozinha uma validada); "Ver histórico" (leitura da rota .../restriction/history, só do próprio escopo).
export function RestrictionValidationActions({ brokerId, sessionStatus, restriction, onChanged }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState(null);
  if (!restriction || !restriction.canValidate) return null;
  const informed = restriction.validationStatus === "informed" && sessionStatus !== "connected";
  const validated = restriction.validationStatus === "validated" && restriction.canClose;

  const send = async (event, action) => {
    event.stopPropagation();
    setBusy(action);
    setError("");
    try {
      const isClose = action === "close";
      const response = await fetch(`/api/admin/whatsapp-individual/restriction/${isClose ? "close" : "validate"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isClose ? { userId: brokerId } : { userId: brokerId, action })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
      await onChanged?.();
    } catch (err) {
      setError(err.message || "Não foi possível salvar.");
    } finally {
      setBusy("");
    }
  };

  const toggleHistory = async (event) => {
    event.stopPropagation();
    if (history) { setHistory(null); return; }
    setBusy("history");
    setError("");
    try {
      const response = await fetch(`/api/admin/whatsapp-individual/restriction/history?userId=${encodeURIComponent(brokerId)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível ler o histórico.");
      setHistory(Array.isArray(data.history) ? data.history.slice(0, 8) : []);
    } catch (err) {
      setError(err.message || "Não foi possível ler o histórico.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="mt-1.5" onClick={(event) => event.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-1.5">
        {informed ? (
          <>
            <button type="button" disabled={Boolean(busy)} onClick={(event) => send(event, "validate")} className="rounded-full bg-navy px-2.5 py-1 text-[10px] font-extrabold text-white hover:bg-navy/90 disabled:opacity-50">
              {busy === "validate" ? "Validando…" : "Validar restrição"}
            </button>
            <button type="button" disabled={Boolean(busy)} onClick={(event) => send(event, "reject")} className="rounded-full border border-navy/20 bg-white px-2.5 py-1 text-[10px] font-extrabold text-navy hover:border-brand disabled:opacity-50">
              {busy === "reject" ? "Salvando…" : "Não validar"}
            </button>
          </>
        ) : null}
        {validated ? (
          <button type="button" disabled={Boolean(busy)} onClick={(event) => send(event, "close")} className="rounded-full border border-navy/20 bg-white px-2.5 py-1 text-[10px] font-extrabold text-navy hover:border-brand disabled:opacity-50">
            {busy === "close" ? "Encerrando…" : "Encerrar restrição"}
          </button>
        ) : null}
        <button type="button" disabled={busy === "history"} onClick={toggleHistory} className="text-[10px] font-bold text-brand underline-offset-2 hover:underline disabled:opacity-50">
          {history ? "Ocultar histórico" : "Ver histórico"}
        </button>
      </div>
      {history ? (
        <ul className="mt-1 space-y-0.5 rounded-lg bg-mist/60 p-1.5 text-[10px] text-navy/80">
          {history.length === 0 ? <li>Sem registros.</li> : history.map((item) => (
            <li key={item.id}>
              <span className="font-bold">{EVENT_LABELS[item.event_type] || item.event_type}</span>
              {" · "}{ORIGIN_LABELS[item.origin] || item.origin || "—"}
              {" · "}{item.created_at ? new Date(item.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="mt-1 text-[10px] font-bold text-red-700">{error}</p> : null}
    </div>
  );
}

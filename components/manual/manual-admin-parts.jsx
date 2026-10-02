"use client";

import { useCallback } from "react";
import Badge from "@/components/ui/Badge";
import { apiErrorMessage, AUDIENCE_OPTIONS, statusLabel } from "@/lib/manual-ui-core.mjs";

// Chamada à API administrativa do Manual. Erro 422 vira a mensagem padrão
// (sem revelar termos); os demais usam a mensagem do servidor.
export function useManualApi() {
  return useCallback(async (method, url, body) => {
    const response = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(apiErrorMessage(response.status, data.error));
    return data;
  }, []);
}

const TONES = { draft: "neutral", pending: "warning", published: "success", discarded: "danger" };

export function StatusPill({ status }) {
  return <Badge tone={TONES[status] || "neutral"} dot>{statusLabel(status)}</Badge>;
}

// Checkboxes de audiência: "Todos" é exclusivo; vazio volta para "Todos".
export function AudienceChecks({ value = ["all"], onChange, name }) {
  const set = new Set(value);
  function toggle(option) {
    let next;
    if (option === "all") next = ["all"];
    else {
      set.delete("all");
      if (set.has(option)) set.delete(option); else set.add(option);
      next = [...set];
      if (!next.length) next = ["all"];
    }
    onChange(next);
  }
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium text-ink">Quem vê</legend>
      <div className="flex flex-wrap gap-2">
        {AUDIENCE_OPTIONS.map((option) => (
          <label key={option.value} className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-control border border-line bg-white px-3 text-sm text-ink has-[:checked]:border-info-line has-[:checked]:bg-info-soft">
            <input type="checkbox" name={name} checked={set.has(option.value)} onChange={() => toggle(option.value)} className="h-4 w-4 accent-[#1769D1]" />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function audienceText(audiences) {
  const list = Array.isArray(audiences) && audiences.length ? audiences : ["all"];
  return list.map((value) => AUDIENCE_OPTIONS.find((option) => option.value === value)?.label || value).join(", ");
}

export function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(date);
}

export function BeforeAfter({ before, after }) {
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      <div><p className="text-2xs font-semibold uppercase tracking-wide text-muted">Antes</p><p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-control bg-white p-2 text-[13px] text-ink-2">{before || "—"}</p></div>
      <div><p className="text-2xs font-semibold uppercase tracking-wide text-brand">Depois</p><p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-control bg-white p-2 text-[13px] text-ink">{after || "—"}</p></div>
    </div>
  );
}


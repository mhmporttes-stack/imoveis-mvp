"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ThumbsDown, ThumbsUp } from "lucide-react";
import Button from "@/components/ui/Button";
import { inputClasses } from "@/components/ui/Field";

// Conferência por tipo da simulação automática (REGRA OFICIAL — dono, 2026-10-19): 👍 (bateu com a Caixa) e 👎 (corrigir)
// pequenos, logo abaixo do imóvel NOVO e do USADO. 👎 abre a correção SÓ daquele tipo (renda usada + valores da Caixa).
// O link só libera quando todos os tipos marcados estão conferidos (regras e gravação no servidor:
// /api/simulations/[id]/conferencia, lib/simulation-auto-review-types*.{mjs,js}).

/** Estado da conferência da simulação ({ automatic, types, typeReviews, pending }); `enabled` false = não busca. */
export function useAutoReviewState(simulationId, enabled = true) {
  const [state, setState] = useState(null);
  const refresh = useCallback(async () => {
    if (!simulationId || !enabled) return;
    const response = await fetch(`/api/simulations/${simulationId}/conferencia`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (response.ok) setState(data);
  }, [simulationId, enabled]);
  useEffect(() => { refresh(); }, [refresh]);
  return [state, refresh, setState];
}

const FIELDS = [
  ["caixaIncome", "Renda usada"],
  ["financingValue", "Financiado"],
  ["subsidyValue", "Subsídio"],
  ["firstInstallment", "1ª parcela"],
  ["lastInstallment", "Última"],
  ["termMonths", "Prazo (meses)"]
];

export default function AutoReviewTypeVote({ simulationId, type, label = "", review = null, values = {}, onDone }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => ({
    caixaIncome: "",
    financingValue: values.financingValue || "",
    subsidyValue: values.subsidyValue || "",
    firstInstallment: values.firstInstallment || "",
    lastInstallment: values.lastInstallment || "",
    termMonths: values.termMonths || ""
  }));

  if (review?.status) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-success" data-auto-review-done={type}>
        <Check className="h-3.5 w-3.5" aria-hidden="true" /> {review.status === "ok" ? "Conferido na Caixa" : "Corrigido com a Caixa"}
      </p>
    );
  }

  async function send(action) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/simulations/${simulationId}/conferencia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, type, correction: action === "corrigir" ? form : undefined })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível registrar a conferência.");
      setOpen(false);
      if (onDone) await onDone(data);
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setBusy(false);
    }
  }

  const iconButton = "grid h-11 w-11 place-items-center rounded-full border border-line bg-white text-muted transition disabled:cursor-default";
  return (
    <div className="mt-2" data-auto-review-type={type}>
      <div className="flex items-center gap-2">
        <span className="mr-auto text-xs font-bold text-muted">{label ? `${label}: bateu com a Caixa?` : "Bateu com a Caixa?"}</span>
        <button type="button" className={`${iconButton} hover:text-success`} aria-label={`Bateu com a Caixa${label ? ` (${label})` : ""}`} title="Bateu com a Caixa" disabled={busy} onClick={() => send("ok")}>
          <ThumbsUp className="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" className={`${iconButton} hover:text-danger ${open ? "border-danger text-danger" : ""}`} aria-label={`Corrigir${label ? ` (${label})` : ""}`} aria-expanded={open} title="Corrigir com os valores da Caixa" disabled={busy} onClick={() => setOpen((value) => !value)}>
          <ThumbsDown className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      {open ? (
        <div className="mt-2 rounded-2xl border border-line bg-white p-3">
          <p className="text-xs font-medium text-muted">Valores da Caixa (Price) {label ? `do ${label.toLowerCase()}` : ""}. Não lance a entrada mostrada pela Caixa.</p>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
            {FIELDS.map(([key, text]) => (
              <label key={key} className="grid min-w-0 gap-1 text-xs font-bold text-ink">
                <span className="truncate">{text}</span>
                <input
                  className={inputClasses}
                  inputMode={key === "termMonths" ? "numeric" : "decimal"}
                  autoComplete="off"
                  placeholder={key === "termMonths" ? "420" : "0,00"}
                  value={form[key]}
                  disabled={busy}
                  onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                />
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => send("corrigir")} loading={busy}>Salvar correção</Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
          </div>
        </div>
      ) : null}
      {error ? <p className="mt-1 text-xs font-medium text-danger" role="alert">{error}</p> : null}
    </div>
  );
}

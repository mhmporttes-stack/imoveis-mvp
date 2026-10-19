"use client";

import { useState } from "react";
import { Check, Pencil } from "lucide-react";
import Button from "@/components/ui/Button";
import { inputClasses } from "@/components/ui/Field";
import { AUTO_PRESENTATION_LOCKED_MESSAGE } from "@/lib/simulation-status-lock-core.mjs";
import { useSimulationTab } from "@/components/simulation-tab-context";

// Conferência OBRIGATÓRIA da simulação automática do site (SIM-AUTO, dono 2026-10-19), na ficha do cliente e na aba da
// simulação (Gerador): depois de refazer no simulador da Caixa, "Simulação OK" ou "Corrigir simulação". O link da
// apresentação só é liberado depois disso. Botões temporários: AUTO_SIMULATION_REVIEW_ENABLED.
// `onDone` (opcional) roda depois do OK; sem ele a página recarrega. `inEditor`: já está na edição (Gerador) — o
// "Corrigir" só registra a renda e orienta a lançar os valores ali mesmo.
export default function AutoSimulationReview({ simulationId, onDone = null, inEditor = false, prominent = false }) {
  const [mode, setMode] = useState("");
  const [income, setIncome] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [correcting, setCorrecting] = useState(false);
  // Dentro da aba da simulação (redesenho 2026-10-19): a faixa traz a renda para a Caixa e o "Refazer" junto do OK/Corrigir.
  const tab = useSimulationTab();
  const extras = prominent ? tab?.reviewExtras || null : null;

  async function send(action) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/simulations/${simulationId}/conferencia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, caixaIncome: income })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível registrar a conferência.");
      if (data.editUrl) {
        if (inEditor) setCorrecting(true);
        else window.location.assign(data.editUrl);
      } else if (onDone) await onDone();
      else window.location.reload();
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setBusy(false);
    }
  }

  const entryNote = "Não lance a entrada mostrada pela Caixa (a simulação usa imóvel de R$ 235 mil; poder de compra = financiado + subsídio).";

  return (
    <div className={prominent ? "rounded-card border border-warning-line bg-warning-soft p-4 sm:p-5" : "mt-3"}>
      {prominent ? <p className="text-base font-bold text-navy">Simulação automática do site: confira na Caixa</p> : null}
      <p className={prominent ? "mt-1 text-sm font-semibold text-warning" : "rounded-control bg-warning-soft px-3 py-2 text-[13px] font-medium text-warning"}>{AUTO_PRESENTATION_LOCKED_MESSAGE}</p>
      {extras?.before ? <div className="mt-3">{extras.before}</div> : null}
      {correcting ? (
        <p className="mt-3 text-sm font-semibold text-ink">Renda registrada. Lance abaixo os valores da Caixa (financiado, subsídio, parcelas, prazo e taxa de novo e/ou usado) e salve — o link é liberado ao salvar. {entryNote}</p>
      ) : mode === "corrigir" ? (
        <div className="mt-3 space-y-2">
          <label className="block text-xs font-medium text-muted" htmlFor={`caixa-income-${simulationId}`}>Renda usada no simulador da Caixa</label>
          <input id={`caixa-income-${simulationId}`} className={inputClasses} inputMode="decimal" placeholder="Ex.: 2.550,00" value={income} onChange={(event) => setIncome(event.target.value)} disabled={busy} />
          <p className="text-xs text-muted">Depois, na edição, lance financiado, subsídio, parcelas, prazo e taxa da Caixa. {entryNote}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => send("corrigir")} loading={busy}>{inEditor ? "Registrar renda" : "Abrir edição"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("")} disabled={busy}>Voltar</Button>
          </div>
        </div>
      ) : (
        <div className={extras ? "mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" : "mt-3 flex flex-wrap gap-2"}>
          <Button size={prominent ? "md" : "sm"} onClick={() => send("ok")} loading={busy}><Check className="h-4 w-4" aria-hidden="true" /> Simulação OK</Button>
          <Button size={prominent ? "md" : "sm"} variant="secondary" onClick={() => setMode("corrigir")} disabled={busy}><Pencil className="h-4 w-4" aria-hidden="true" /> {extras ? <><span className="sm:hidden">Corrigir</span><span className="hidden sm:inline">Corrigir simulação</span></> : "Corrigir simulação"}</Button>
          {extras?.actions ? <div className="col-span-2">{extras.actions}</div> : null}
        </div>
      )}
      {error ? <p className="mt-2 text-xs font-medium text-danger">{error}</p> : null}
    </div>
  );
}

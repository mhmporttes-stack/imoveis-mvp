"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import Button from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";

const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// "Refazer simulação automática" (REGRA OFICIAL — dono, 2026-10-19): recalcula com os dados ATUAIS do cadastro (renda do
// cadastro; informal com teto de R$ 2.550 por pessoa e a renda do melhor cenário como sugestão). Volta a exigir a
// conferência. Simulação salva pelo corretor só é substituída depois de "Isso substitui a simulação atual. Continuar?".
// `onDone` (opcional) roda no fim; sem ele a página recarrega.
// `variant="link"` (dono, 2026-10-19): botão pequeno e discreto (texto com ícone), sem o peso do botão secundário.
export default function RedoAutoSimulationButton({ registrationId, onDone = null, size = "sm", variant = "button" }) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState({ tone: "", text: "" });
  const [confirmAction, confirmElement] = useConfirm();

  async function post(confirmReplace) {
    const response = await fetch(`/api/admin/clients/${registrationId}/simulacao-automatica`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmReplace })
    });
    return { response, data: await response.json().catch(() => ({})) };
  }

  async function redo() {
    setBusy(true);
    setFeedback({ tone: "", text: "" });
    try {
      let { response, data } = await post(false);
      if (response.status === 409 && data.needsConfirmation) {
        const ok = await confirmAction({ title: "Refazer simulação automática?", description: data.message, confirmLabel: "Substituir", tone: "danger" });
        if (!ok) return;
        ({ response, data } = await post(true));
      }
      if (!response.ok) throw new Error(data.error || "Não foi possível refazer a simulação.");
      const notes = [
        `Refeita com renda de ${money(data.income)}${data.usedIncome && Math.abs(data.usedIncome - data.income) > 0.005 ? ` (usado: ${money(data.usedIncome)})` : ""}.`,
        data.informalCapped ? "Renda informal acima de R$ 2.550 por pessoa: aplicado o teto." : "",
        data.suggestion ? `Renda sugerida para informal — novo: ${money(data.suggestion.novo)} / usado: ${money(data.suggestion.usado)}.` : ""
      ].filter(Boolean).join(" ");
      setFeedback({ tone: "ok", text: notes });
      if (onDone) await onDone();
      else window.setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      setFeedback({ tone: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {variant === "link" ? (
        <button type="button" className="inline-flex min-h-11 items-center gap-1.5 text-xs font-bold text-muted underline-offset-2 hover:text-brand hover:underline disabled:opacity-60" onClick={redo} disabled={busy}>
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden="true" /> Refazer simulação automática
        </button>
      ) : (
        <Button size={size} variant="secondary" onClick={redo} loading={busy}><RefreshCw className="h-4 w-4" aria-hidden="true" /> Refazer simulação automática</Button>
      )}
      {feedback.text ? <p className={feedback.tone === "error" ? "mt-2 text-xs font-medium text-danger" : "mt-2 text-xs font-medium text-ink-2"}>{feedback.text}</p> : null}
      {confirmElement}
    </div>
  );
}

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
export default function RedoAutoSimulationButton({ registrationId, onDone = null, size = "sm" }) {
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
        `Refeita com renda de ${money(data.income)}.`,
        data.informalCapped ? "Renda informal acima de R$ 2.550 por pessoa: aplicado o teto." : "",
        data.suggestion && Math.abs(data.suggestion - data.income) > 0.005 ? `Renda sugerida para informal: ${money(data.suggestion)}.` : ""
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
      <Button size={size} variant="secondary" onClick={redo} loading={busy}><RefreshCw className="h-4 w-4" aria-hidden="true" /> Refazer simulação automática</Button>
      {feedback.text ? <p className={feedback.tone === "error" ? "mt-2 text-xs font-medium text-danger" : "mt-2 text-xs font-medium text-ink-2"}>{feedback.text}</p> : null}
      {confirmElement}
    </div>
  );
}

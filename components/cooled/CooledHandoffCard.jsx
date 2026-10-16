"use client";

import { useEffect, useState } from "react";
import { Copy, Sparkles } from "lucide-react";
import Button from "@/components/ui/Button";

// Ficha do cliente TRANSFERIDO pelo fluxo de clientes que esfriaram (dono, 2026-10-16): resumo do atendimento
// anterior + sugestão de primeira mensagem para o novo corretor, com botão Copiar. Nunca envia nada. Gerado uma vez
// por transferência no servidor (GET /api/admin/cooled-clients/handoff); sem transferência não mostra nada.

export default function CooledHandoffCard({ clientId }) {
  const [state, setState] = useState({ loading: true, handoff: null, error: "" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!clientId) return undefined;
    let alive = true;
    setState({ loading: true, handoff: null, error: "" });
    fetch(`/api/admin/cooled-clients/handoff?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!alive) return;
        if (!response.ok) setState({ loading: false, handoff: null, error: data.error || "" });
        else setState({ loading: false, handoff: data.handoff || null, error: "" });
      })
      .catch(() => { if (alive) setState({ loading: false, handoff: null, error: "" }); });
    return () => { alive = false; };
  }, [clientId]);

  if (state.loading || (!state.handoff && !state.error)) return null;
  if (!state.handoff) return <p className="rounded-card border border-line bg-mist p-3 text-xs text-muted">{state.error}</p>;

  const { handoff } = state;
  async function copy() {
    try {
      await navigator.clipboard.writeText(handoff.message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-card border border-line bg-info-soft/40 p-3" data-cooled-handoff="true">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-info">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Cliente recebido{handoff.previousBrokerName ? ` de ${handoff.previousBrokerName}` : ""}
      </p>
      <p className="mt-2 whitespace-pre-line text-[13px] leading-5 text-ink-2">{handoff.summary}</p>
      <p className="mt-3 text-xs font-semibold text-navy">Sugestão de primeira mensagem</p>
      <p className="mt-1 whitespace-pre-line rounded-control border border-line bg-white p-2.5 text-[13px] leading-5 text-ink">{handoff.message}</p>
      <Button size="sm" variant="secondary" className="mt-2" onClick={copy}>
        <Copy className="h-4 w-4" aria-hidden="true" /> {copied ? "Copiado" : "Copiar"}
      </Button>
    </div>
  );
}

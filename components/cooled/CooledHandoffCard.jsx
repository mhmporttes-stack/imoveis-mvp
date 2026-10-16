"use client";

import { useEffect, useState } from "react";
import { Copy, Sparkles } from "lucide-react";
import Button from "@/components/ui/Button";
import { inputClasses } from "@/components/ui/Field";
import { cx } from "@/components/ui/cx";
import CooledClientPhone from "@/components/cooled/CooledClientPhone";

// Ficha do cliente TRANSFERIDO pelo fluxo de clientes que esfriaram (dono, 2026-10-16): RASCUNHO de primeira mensagem
// para o novo corretor. Gerado uma vez por transferência no servidor (GET /api/admin/cooled-clients/handoff); sem
// transferência não mostra nada. Sem resumo por IA desde 2026-10-16 ("Pode tirar o resumo, acho que essa ideia de
// transferir o histórico da conversa já ajuda bastante." — dono): a conversa anterior fica em CooledChatHistory.
// REGRA OFICIAL (dono, 2026-10-16, FUN-15b): mensagem sugerida na transferência NUNCA é enviada sozinha. O
// corretor edita o rascunho, confirma que revisou e só então copia para enviar ele mesmo. Este card não envia
// nada e não pode ganhar envio automático (trava: tests/cooled-handoff-no-autosend.test.mjs).

export default function CooledHandoffCard({ clientId }) {
  const [state, setState] = useState({ loading: true, handoff: null, error: "" });
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState("");
  const [reviewed, setReviewed] = useState(false);

  useEffect(() => {
    if (!clientId) return undefined;
    let alive = true;
    setState({ loading: true, handoff: null, error: "" });
    fetch(`/api/admin/cooled-clients/handoff?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!alive) return;
        if (!response.ok) setState({ loading: false, handoff: null, error: data.error || "" });
        else {
          setState({ loading: false, handoff: data.handoff || null, error: "" });
          setDraft(data.handoff?.message || "");
          setReviewed(false);
        }
      })
      .catch(() => { if (alive) setState({ loading: false, handoff: null, error: "" }); });
    return () => { alive = false; };
  }, [clientId]);

  if (state.loading || (!state.handoff && !state.error)) return null;
  if (!state.handoff) return <p className="rounded-card border border-line bg-mist p-3 text-xs text-muted">{state.error}</p>;

  const { handoff } = state;
  const canCopy = reviewed && draft.trim().length > 0;
  async function copy() {
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(draft.trim());
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
      {handoff.clientName || handoff.clientPhone ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[13px]">
          {handoff.clientName ? <span className="font-semibold text-navy">{handoff.clientName}</span> : null}
          {handoff.clientPhone ? <CooledClientPhone phone={handoff.clientPhone} /> : null}
        </p>
      ) : null}
      <label className="mt-3 block text-xs font-semibold text-navy" htmlFor={`handoff-draft-${clientId}`}>
        Rascunho da primeira mensagem (ainda não enviado)
      </label>
      <p className="mt-0.5 text-xs text-muted">Leia a conversa, ajuste o texto ao contexto do cliente e só então envie você mesmo.</p>
      <textarea
        id={`handoff-draft-${clientId}`}
        className={cx(inputClasses, "mt-1 py-2 text-[13px] leading-5")}
        rows={5}
        value={draft}
        onChange={(event) => { setDraft(event.target.value); setCopied(false); }}
      />
      <label className="mt-2 flex items-start gap-2 text-xs text-ink-2">
        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-brand" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
        <span>Revisei a mensagem e ela faz sentido para este cliente.</span>
      </label>
      <Button size="sm" variant="secondary" className="mt-2" onClick={copy} disabled={!canCopy}>
        <Copy className="h-4 w-4" aria-hidden="true" /> {copied ? "Copiado" : "Copiar mensagem revisada"}
      </Button>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Eye, Link2, Presentation } from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { displayLink } from "@/lib/short-links.mjs";
import { formatBRL } from "@/lib/simulation-presentation-format.mjs";
import { STRATEGY_NAME, describeChoices, formatDuration } from "@/lib/payment-strategy-core.mjs";

// "Apresentação da simulação" no CRM (tela da simulação, onde também se gera o PDF). OPÇÃO ADICIONAL: o PDF não muda.
// Lê o estado pela API admin (mesmo escopo da simulação). O link mostra sempre os valores ATUAIS da simulação salva.

function formatMoment(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date).replace(",", " às");
}

// Última "Estratégia de pagamento" montada pelo cliente no link (PRES-24): o que ele ligou e o resultado (prazo e juros).
function PaymentStrategySummary({ strategy }) {
  if (!strategy?.escolhas) return null;
  const lines = describeChoices(strategy.escolhas, formatBRL);
  const summary = strategy.resumo;
  return (
    <div className="rounded-control border border-line bg-mist px-3 py-2 text-sm text-navy">
      <p className="font-semibold">{STRATEGY_NAME} do cliente{strategy.salvoEm ? ` · ${formatMoment(strategy.salvoEm)}` : ""}</p>
      <p className="text-muted">{lines.length ? lines.join(" · ") : "Nenhum valor extra ligado."}</p>
      {summary && summary.economiaJuros > 0 ? (
        <p className="text-muted">
          Quita em {formatDuration(summary.mesesCom)} em vez de {formatDuration(summary.mesesSem)}, com {formatBRL(summary.economiaJuros)} a menos de juros.
        </p>
      ) : null}
    </div>
  );
}

export default function SimulationPresentationPanel({ simulationId }) {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notify, toastElement] = useToast();
  const endpoint = `/api/admin/simulacoes/${encodeURIComponent(simulationId)}/apresentacao`;
  const previewHref = `/admin/simulacoes/${encodeURIComponent(simulationId)}/apresentacao`;

  const load = useCallback(async () => {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível consultar a apresentação.");
      setState(data);
      setLoadError("");
    } catch (error) {
      setLoadError(error.message || "Não foi possível consultar a apresentação.");
    }
  }, [endpoint]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action) {
    setBusy(true);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível gerar a apresentação.");
      setState(data);
      notify(action === "regenerate" ? "Novo link gerado. O link anterior deixou de funcionar." : "Apresentação pronta.");
    } catch (error) {
      notify(error.message || "Não foi possível gerar a apresentação.", "danger");
    } finally {
      setBusy(false);
    }
  }


  async function copyLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      notify("Link copiado.");
    } catch {
      notify("Não foi possível copiar automaticamente. Selecione o link e copie.", "danger");
    }
  }


  const presentation = state?.presentation || null;
  const canGenerate = state?.schemaReady && state?.ready;

  // Painel enxuto (dono, 2026-10-19): só o título, o link, "Copiar link" e "Visualizar" (não conta como abertura).
  // Saíram daqui: "Abrir o link", "Gerar novo link", a chave "Apresentação de aprovação" (passa a ligar sozinha quando o
  // cliente vai para "Aprovado" — lógica no servidor), a linha de aberturas e a nota de rodapé.
  return (
    <section className="container-page mb-6" aria-labelledby="presentation-title">
      <Card padding="lg">
        <h2 id="presentation-title" className="flex items-center gap-2 text-lg font-bold text-navy">
          <Presentation className="h-5 w-5 text-brand" aria-hidden="true" />
          Apresentação da simulação
        </h2>

        {!state && !loadError ? <p className="mt-3 text-sm text-muted" role="status">Carregando…</p> : null}
        {loadError ? <p className="mt-3 text-sm font-semibold text-danger" role="alert">{loadError}</p> : null}

        {state && !state.schemaReady ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button disabled>Apresentação da simulação</Button>
            <p className="text-sm font-semibold text-muted" role="status">{state.message || "Recurso ainda não ativado no banco."}</p>
          </div>
        ) : null}

        {state?.schemaReady && !state.ready ? (
          <p className="mt-3 text-sm font-semibold text-muted">Preencha e salve os valores da simulação (financiamento, subsídio ou parcelas) para liberar a apresentação.</p>
        ) : null}

        {/* Sem link ainda: "Enviar simulação" também cria o link; aqui dá para criar sem enviar. */}
        {canGenerate && !presentation ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => run("generate")} loading={busy}>
              <Link2 className="h-4 w-4" aria-hidden="true" />
              Gerar link
            </Button>
            <Button variant="secondary" href={previewHref} target="_blank" rel="noopener">
              <Eye className="h-4 w-4" aria-hidden="true" />
              Visualizar
            </Button>
          </div>
        ) : null}

        {canGenerate && presentation ? (
          <div className="mt-3 grid gap-3">
            <div className="flex min-w-0 items-center gap-2 rounded-control border border-line bg-mist px-3 py-2">
              <Link2 className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
              <input readOnly aria-label="Link da apresentação" value={displayLink(presentation.url)} onFocus={(event) => event.target.select()} className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-navy outline-none" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => copyLink(presentation.url)}>
                <Copy className="h-4 w-4" aria-hidden="true" />
                Copiar link
              </Button>
              <Button variant="secondary" href={previewHref} target="_blank" rel="noopener">
                <Eye className="h-4 w-4" aria-hidden="true" />
                Visualizar
              </Button>
            </div>
            {/* Mantido: único lugar do CRM que mostra a estratégia montada pelo cliente no link (só aparece se ele salvou). */}
            <PaymentStrategySummary strategy={state.paymentStrategy} />
          </div>
        ) : null}
      </Card>
      {toastElement}
    </section>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, ExternalLink, Eye, Link2, Presentation, RefreshCw } from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { formatDateBR } from "@/lib/simulation-presentation-format.mjs";
import { displayLink } from "@/lib/short-links.mjs";

// "Apresentação da simulação" no CRM (tela da simulação, onde também se gera o PDF). OPÇÃO ADICIONAL: o PDF não muda.
// Lê o estado pela API admin (mesmo escopo da simulação). O link mostra sempre os valores ATUAIS da simulação salva.

function formatMoment(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date).replace(",", " às");
}

function Metrics({ presentation, sceneCount }) {
  const opened = presentation.viewCount > 0 || presentation.firstOpenedAt;
  if (!opened) return <p className="text-sm text-muted">Ainda não foi aberta pelo cliente.</p>;
  const parts = [
    `${presentation.viewCount} ${presentation.viewCount === 1 ? "abertura" : "aberturas"}`,
    presentation.firstOpenedAt ? `primeira em ${formatMoment(presentation.firstOpenedAt)}` : "",
    presentation.lastOpenedAt ? `última em ${formatMoment(presentation.lastOpenedAt)}` : "",
    presentation.completedAt ? "viu até o fim" : presentation.lastScene ? `parou na cena ${presentation.lastScene}${sceneCount ? ` de ${sceneCount}` : ""}` : ""
  ].filter(Boolean);
  return <p className="text-sm text-muted">{parts.join(" · ")}</p>;
}

export default function SimulationPresentationPanel({ simulationId }) {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notify, toastElement] = useToast();
  const [confirmAction, confirmElement] = useConfirm();
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

  async function regenerate() {
    const ok = await confirmAction({
      title: "Gerar um novo link?",
      description: "O link atual deixa de funcionar. Quem já recebeu o link antigo verá uma página não encontrada.",
      confirmLabel: "Gerar novo link",
      tone: "danger"
    });
    if (ok) run("regenerate");
  }

  const presentation = state?.presentation || null;
  const canGenerate = state?.schemaReady && state?.ready;

  return (
    <section className="container-page mb-6" aria-labelledby="presentation-title">
      <Card padding="lg">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="presentation-title" className="flex items-center gap-2 text-lg font-bold text-navy">
              <Presentation className="h-5 w-5 text-brand" aria-hidden="true" />
              Apresentação da simulação
            </h2>
            {state?.schemaReady ? (
              <p className="mt-1 text-sm text-muted">
                {state.clientName || "Cliente"}
                {state.simulationDate ? ` · simulação de ${formatDateBR(state.simulationDate)}` : ""}
              </p>
            ) : null}
          </div>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
          Mostra a simulação ao cliente em cenas, pelo celular, por um link individual. É uma opção a mais: o PDF continua igual.
          O link sempre exibe os valores atuais da simulação salva.
        </p>

        {!state && !loadError ? <p className="mt-4 text-sm text-muted" role="status">Carregando…</p> : null}
        {loadError ? <p className="mt-4 text-sm font-semibold text-danger" role="alert">{loadError}</p> : null}

        {state && !state.schemaReady ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button disabled>Apresentação da simulação</Button>
            <p className="text-sm font-semibold text-muted" role="status">{state.message || "Recurso ainda não ativado no banco."}</p>
          </div>
        ) : null}

        {state?.schemaReady && !state.ready ? (
          <p className="mt-4 text-sm font-semibold text-muted">Preencha e salve os valores da simulação (financiamento, subsídio ou parcelas) para liberar a apresentação.</p>
        ) : null}

        {canGenerate && !presentation ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => run("generate")} loading={busy}>
              <Link2 className="h-4 w-4" aria-hidden="true" />
              Gerar apresentação
            </Button>
            <Button variant="secondary" href={previewHref} target="_blank" rel="noopener">
              <Eye className="h-4 w-4" aria-hidden="true" />
              Visualizar antes
            </Button>
          </div>
        ) : null}

        {canGenerate && presentation ? (
          <div className="mt-4 grid gap-3">
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
                Visualizar antes de enviar
              </Button>
              <Button variant="secondary" href={presentation.url} target="_blank" rel="noopener">
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Abrir o link
              </Button>
              <Button variant="ghost" onClick={regenerate} loading={busy}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Gerar novo link
              </Button>
            </div>
            <Metrics presentation={presentation} sceneCount={state.sceneCount} />
            <p className="text-xs text-faint">"Visualizar antes de enviar" não conta como abertura. "Abrir o link" conta, como se fosse o cliente.</p>
          </div>
        ) : null}
      </Card>
      {toastElement}
      {confirmElement}
    </section>
  );
}

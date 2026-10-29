"use client";

import { useState } from "react";
import { CirclePause, CirclePlay, Download, RefreshCw } from "lucide-react";
import Button, { buttonClasses } from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import Field, { inputClasses } from "@/components/ui/Field";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

// Extensões do Chrome do dono (EXT-1, dono, 2026-10-29). Só mostra e chama /api/admin/extensoes/**; faixas, limpeza de
// dado de terceiros e versões ficam no servidor (lib/browser-extensions-core.mjs).

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const formatDate = (value) => (value ? dateTime.format(new Date(value)) : "—");
const TODAY_LABELS = { follow: "Seguir", unfollow: "Deixar de seguir", welcome: "Boas-vindas", publish: "Publicações", chatSends: "Respostas do chat" };

async function callApi(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir a ação.");
  return data;
}

function signalTone(health) {
  if (health.minutesSinceSignal === null) return "neutral";
  if (health.lastRound && !health.lastRound.ok) return "warning";
  return health.minutesSinceSignal <= 30 ? "success" : "warning";
}

function HealthPanel({ health }) {
  const today = Object.entries(health.today || {});
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-1.5">
        {health.versionUnknown ? <Badge tone="neutral">Versão no PC: ainda sem sinal</Badge> : <Badge tone={health.outdated ? "danger" : "success"} dot>No PC: {health.runningVersion}</Badge>}
        <Badge tone="info">Mais nova: {health.latestVersion}</Badge>
        <Badge tone={signalTone(health)} dot>{health.minutesSinceSignal === null ? "Sem sinal ainda" : `Último sinal há ${health.minutesSinceSignal} min`}</Badge>
        {health.pausedUntil ? <Badge tone="warning">Pausa até {formatDate(health.pausedUntil)}</Badge> : null}
        {health.manualPause ? <Badge tone="neutral">Pausada no popup</Badge> : null}
      </div>
      {health.outdated ? <p className="rounded-control bg-danger-soft px-3 py-2 text-danger">O PC está numa versão antiga. Baixe a nova abaixo e recarregue a extensão no Chrome.</p> : null}
      {health.pauseReason ? <p className="rounded-control bg-warning-soft px-3 py-2 text-warning">{health.pauseReason}</p> : null}
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        <dt className="text-muted">Última rodada ok</dt>
        <dd className="text-ink">{formatDate(health.lastOkAt)}</dd>
        <dt className="text-muted">Última rodada</dt>
        <dd className="text-ink">{health.lastRound ? `${health.lastRound.ok ? "ok" : "falhou"}${health.lastRound.error ? ` — ${health.lastRound.error}` : ""}` : "—"}</dd>
        {today.map(([key, item]) => (
          <div key={key} className="contents">
            <dt className="text-muted">{TODAY_LABELS[key] || key} hoje</dt>
            <dd className="tabular-nums text-ink">{item.done}{item.limit !== null && item.limit !== undefined ? ` de ${item.limit}` : ""}</dd>
          </div>
        ))}
      </dl>
      <details className="rounded-control border border-line px-3 py-2">
        <summary className="cursor-pointer font-medium text-navy">Erros nas últimas 24 h ({health.errors24h.length})</summary>
        {health.errors24h.length ? (
          <ul className="mt-2 space-y-1">
            {health.errors24h.map((item) => <li key={`${item.at}-${item.text}`} className="text-ink-2"><span className="tabular-nums text-muted">{formatDate(item.at)}</span> · {item.text}</li>)}
          </ul>
        ) : <p className="mt-2 text-muted">Nenhum.</p>}
      </details>
      <details className="rounded-control border border-line px-3 py-2">
        <summary className="cursor-pointer font-medium text-navy">Partes da tela que não foram achadas ({health.selectorFailures24h.length})</summary>
        {health.selectorFailures24h.length ? (
          <ul className="mt-2 space-y-1">
            {health.selectorFailures24h.map((item) => <li key={`${item.at}-${item.name}`} className="text-ink-2"><span className="tabular-nums text-muted">{formatDate(item.at)}</span> · {item.name}{item.detail ? ` — ${item.detail}` : ""}</li>)}
          </ul>
        ) : <p className="mt-2 text-muted">Nenhuma.</p>}
      </details>
      {health.swallowed24h.length ? (
        <details className="rounded-control border border-line px-3 py-2">
          <summary className="cursor-pointer font-medium text-navy">Falhas internas registradas ({health.swallowed24h.length})</summary>
          <ul className="mt-2 space-y-1">
            {health.swallowed24h.map((item) => <li key={item.context} className="text-ink-2">{item.context}: {item.count}× (última {formatDate(item.lastAt)}{item.lastError ? ` — ${item.lastError}` : ""})</li>)}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function ConfigForm({ extension, onSaved, notify }) {
  const [values, setValues] = useState(extension.config);
  const [saving, setSaving] = useState(false);
  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const data = await callApi("/api/admin/extensoes", { method: "PUT", body: JSON.stringify({ ext: extension.key, config: values }) });
      setValues(data.config);
      onSaved(extension.key, data.config);
      notify("Configuração salva. A extensão usa na próxima rodada.");
    } catch (error) {
      notify(error.message, "danger");
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {extension.fields.map((field) => (
          <Field key={field.key} label={`${field.label} (${field.unit})`} hint={`De ${field.min} a ${field.max}. Padrão ${field.default}.`}>
            <input
              type="number"
              inputMode="numeric"
              min={field.min}
              max={field.max}
              value={values[field.key] ?? ""}
              onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value === "" ? "" : Number(event.target.value) }))}
              className={inputClasses}
            />
          </Field>
        ))}
      </div>
      <Button type="submit" loading={saving}>Salvar</Button>
    </form>
  );
}

export default function ExtensionsAdmin({ initialOverview }) {
  const [overview, setOverview] = useState(initialOverview);
  const [busy, setBusy] = useState("");
  const [token, setToken] = useState("");
  const [confirmAction, confirmElement] = useConfirm();
  const [notify, toastElement] = useToast();
  const stopped = overview.control.stopped;

  const reload = async () => {
    setBusy("reload");
    try {
      setOverview(await callApi("/api/admin/extensoes"));
    } catch (error) {
      notify(error.message, "danger");
    } finally {
      setBusy("");
    }
  };

  const toggleStop = async () => {
    if (!stopped && !(await confirmAction({ title: "Parar as duas extensões?", description: "O Seguidor do Instagram e o Publicador do Marketplace param antes da próxima ação (seguir, deixar de seguir, mensagem, publicação e chat) até você tocar em Retomar.", confirmLabel: "Parar tudo", tone: "danger" }))) return;
    setBusy("stop");
    try {
      const data = await callApi("/api/admin/extensoes", { method: "POST", body: JSON.stringify({ action: stopped ? "resume" : "stop" }) });
      setOverview((current) => ({ ...current, control: data.control }));
      notify(data.control.stopped ? "Extensões paradas." : "Extensões retomadas.");
    } catch (error) {
      notify(error.message, "danger");
    } finally {
      setBusy("");
    }
  };

  const generateToken = async () => {
    if (overview.instagramToken.configured && !(await confirmAction({ title: "Gerar chave nova?", description: "A chave atual do Seguidor do Instagram deixa de funcionar. Cole a nova nas Opções da extensão.", confirmLabel: "Gerar chave nova" }))) return;
    setBusy("token");
    try {
      const data = await callApi("/api/admin/extensoes/chave", { method: "POST", body: "{}" });
      setToken(data.token);
      setOverview((current) => ({ ...current, instagramToken: { configured: true, createdAt: new Date().toISOString() } }));
    } catch (error) {
      notify(error.message, "danger");
    } finally {
      setBusy("");
    }
  };

  const onSaved = (key, config) => setOverview((current) => ({ ...current, extensions: current.extensions.map((item) => (item.key === key ? { ...item, config } : item)) }));

  return (
    <section className="container-page space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-navy">Extensões</h1>
          <p className="text-sm text-muted">Seguidor do Instagram e Publicador do Marketplace, no Chrome do seu computador.</p>
        </div>
        <Button variant="secondary" onClick={reload} loading={busy === "reload"}><RefreshCw className="h-4 w-4" /> Atualizar</Button>
      </div>

      <Card className={stopped ? "border-danger-line bg-danger-soft" : ""}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-navy">{stopped ? "As duas extensões estão PARADAS" : "As duas extensões estão liberadas"}</p>
            <p className="text-sm text-muted">{overview.control.changedAt ? `Mudado em ${formatDate(overview.control.changedAt)}${overview.control.changedBy ? ` por ${overview.control.changedBy}` : ""}.` : "Elas consultam aqui antes de cada ação."}</p>
          </div>
          <Button variant={stopped ? "primary" : "danger"} onClick={toggleStop} loading={busy === "stop"}>
            {stopped ? <CirclePlay className="h-4 w-4" /> : <CirclePause className="h-4 w-4" />} {stopped ? "Retomar" : "Parar tudo"}
          </Button>
        </div>
      </Card>

      {overview.extensions.map((extension) => (
        <Card key={extension.key} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-navy">{extension.label}</h2>
            <a className={buttonClasses({ variant: "secondary", size: "sm" })} href={extension.downloadUrl} download><Download className="h-4 w-4" /> Baixar versão {extension.health.latestVersion}</a>
          </div>
          <HealthPanel health={extension.health} />
          <div className="border-t border-line pt-4">
            <h3 className="mb-3 font-semibold text-navy">Configuração</h3>
            <ConfigForm extension={extension} onSaved={onSaved} notify={notify} />
          </div>
          {extension.key === "instagram" ? (
            <div className="space-y-2 border-t border-line pt-4 text-sm">
              <h3 className="font-semibold text-navy">Chave do Seguidor</h3>
              <p className="text-muted">{overview.instagramToken.configured ? `Chave criada em ${formatDate(overview.instagramToken.createdAt)}.` : "Nenhuma chave criada ainda — sem ela a extensão não recebe esta configuração nem o Parar tudo."}</p>
              {token ? (
                <Field label="Copie agora (ela aparece uma vez só) e cole nas Opções da extensão">
                  <input readOnly value={token} className={inputClasses} onFocus={(event) => event.target.select()} />
                </Field>
              ) : null}
              <Button variant="secondary" size="sm" onClick={generateToken} loading={busy === "token"}>{overview.instagramToken.configured ? "Gerar chave nova" : "Gerar chave"}</Button>
            </div>
          ) : (
            <div className="space-y-1 border-t border-line pt-4 text-sm">
              <h3 className="font-semibold text-navy">Chat do Marketplace</h3>
              <p className="text-muted">
                {overview.marketplaceChat ? `Sincronização ${overview.marketplaceChat.syncEnabled ? "ligada" : "desligada"}, das ${overview.marketplaceChat.startHour}h às ${overview.marketplaceChat.endHour}h, até ${overview.marketplaceChat.maxSendsPerHour} envios por hora.` : "Configuração do chat indisponível agora."}
                {" "}Mude em <a className="font-medium text-brand underline" href="/admin/chat/marketplace">Chat Marketplace</a>. A chave da extensão fica em <a className="font-medium text-brand underline" href="/admin/marketplace">Cadastros › Marketplace</a>.
              </p>
            </div>
          )}
        </Card>
      ))}

      <Card className="space-y-1 text-sm">
        <h2 className="font-semibold text-navy">Atualização 100% automática (opcional)</h2>
        <p className="text-muted">Hoje você instala o zip à mão. Para o Chrome atualizar sozinho, publique cada extensão na Chrome Web Store como &quot;Não listada&quot; (só quem tem o link instala). O passo a passo está no README de cada extensão.</p>
      </Card>
      {confirmElement}
      {toastElement}
    </section>
  );
}

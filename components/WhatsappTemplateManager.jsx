"use client";

import { useState } from "react";
import { CheckCircle2, CircleX, Clock, LoaderCircle, RefreshCw } from "lucide-react";

const STATUS_LABEL = {
  APPROVED: { label: "Aprovado", tone: "text-emerald-700 bg-emerald-50" },
  PENDING: { label: "Em análise pela Meta", tone: "text-amber-700 bg-amber-50" },
  REJECTED: { label: "Rejeitado pela Meta", tone: "text-red-700 bg-red-50" },
  not_created: { label: "Ainda não criado", tone: "text-muted bg-mist" }
};

// Sugestões prontas de modelos pra usar em Regras de automação (aba
// "Regras" → ação "Enviar WhatsApp"), além dos 3 do resumo diário. Cada uma
// vira 1 clique aqui em vez do formulário avançado — o exemplo pedido
// ("Corretor, você recebeu um novo cliente...") é a primeira da lista.
const SUGGESTED_TEMPLATES = [
  {
    name: "corretor_novo_cliente_aguardando",
    label: "Novo cliente aguardando atendimento",
    bodyText: "Olá {{1}}! Você recebeu um novo cliente: {{2}}. Ele está aguardando seu atendimento — não deixe esperando!",
    bodyExample: ["Ana", "João Silva"]
  }
];

export default function WhatsappTemplateManager({ initialStatus }) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [customName, setCustomName] = useState("");
  const [customBody, setCustomBody] = useState("");
  const [customExample, setCustomExample] = useState("");

  async function refreshStatus() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/whatsapp-master/daily-performance-status");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao atualizar status.");
      setStatus(payload);
    } catch (refreshError) {
      setError(refreshError.message);
    } finally {
      setBusy(false);
    }
  }

  async function provisionDailyPerformanceTemplates() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/whatsapp-master/provision-daily-performance-templates", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao enviar os modelos para a Meta.");
      setMessage("Modelos enviados para revisão da Meta. Pode levar de alguns minutos a 24h para aprovar.");
      await refreshStatus();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  }

  async function createCustomTemplate(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/whatsapp-master/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: customName, bodyText: customBody, bodyExample: customExample })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao criar o modelo.");
      setMessage(`Modelo "${customName}" enviado para revisão da Meta.`);
      setCustomName("");
      setCustomBody("");
      setCustomExample("");
      await refreshStatus();
    } catch (createError) {
      setError(createError.message);
    } finally {
      setBusy(false);
    }
  }

  async function createSuggestedTemplate(template) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/whatsapp-master/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: template.name, bodyText: template.bodyText, bodyExample: template.bodyExample.join(",") })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao criar o modelo.");
      setMessage(`Modelo "${template.label}" enviado para revisão da Meta. Depois é só escolher ele na ação "Enviar WhatsApp" de uma regra em Automações → Regras.`);
    } catch (createError) {
      setError(createError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="container-page mt-6 space-y-6 rounded-[28px] border border-line bg-white p-6 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.12em] text-navy">Resumo diário de desempenho (WhatsApp)</p>
          <p className="mt-1 text-sm text-muted">Mensagem automática pra cada corretor, todo dia às 22:05, com o desempenho dele.</p>
        </div>
        <button type="button" onClick={refreshStatus} disabled={busy} className="premium-button-secondary">
          {busy ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}
          Atualizar status
        </button>
      </div>

      {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 font-bold text-emerald-800">{message}</p> : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 font-bold text-red-700">{error}</p> : null}
      {status.templatesError ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          Não foi possível consultar os modelos na Meta: {status.templatesError}
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        {status.templates.map((template) => {
          const info = STATUS_LABEL[template.status] || STATUS_LABEL.not_created;
          return (
            <div key={template.name} className="rounded-2xl border border-line p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">{template.name}</p>
              <p className={`mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-black ${info.tone}`}>
                {template.status === "APPROVED" ? <CheckCircle2 className="h-4 w-4" /> : template.status === "REJECTED" ? <CircleX className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                {info.label}
              </p>
            </div>
          );
        })}
      </div>

      <div>
        <button type="button" onClick={provisionDailyPerformanceTemplates} disabled={busy} className="premium-button-primary">
          {busy ? <LoaderCircle className="h-5 w-5 animate-spin" /> : null}
          Enviar os 3 modelos para aprovação da Meta
        </button>
        <p className="mt-2 text-xs text-muted">
          Se aparecer erro de permissão, é preciso liberar &quot;Gerenciar modelos de mensagem&quot; para o app conectado em
          Meta Business Suite → Configurações do negócio → Contas → WhatsApp.
        </p>
      </div>

      {status.lastSentDate ? (
        <div>
          <p className="mb-2 text-sm font-black text-navy">Último envio: {formatDate(status.lastSentDate)}</p>
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-mist text-xs font-black uppercase text-muted">
                <tr>
                  <th className="px-4 py-2">Corretor</th>
                  <th className="px-4 py-2">Situação</th>
                </tr>
              </thead>
              <tbody>
                {(status.lastResults || []).map((row) => (
                  <tr key={row.brokerId} className="border-t border-line">
                    <td className="px-4 py-2 font-bold text-navy">{row.brokerName}</td>
                    <td className="px-4 py-2">
                      {row.sent ? (
                        <span className="inline-flex items-center gap-1 font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" />Enviado</span>
                      ) : row.skipped ? (
                        <span className="text-muted">{row.reason}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-bold text-red-700"><CircleX className="h-4 w-4" />{row.error}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">Ainda não houve nenhum envio.</p>
      )}

      <div className="border-t border-line pt-6">
        <p className="text-sm font-black uppercase tracking-[0.12em] text-navy">Modelos para usar em Regras de automação</p>
        <p className="mt-1 text-sm text-muted">
          Pra usar num gatilho (ex.: &quot;corretor recebeu cliente novo&quot;), crie o modelo aqui e depois escolha ele na
          ação &quot;Enviar WhatsApp&quot; em Automações → Regras.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {SUGGESTED_TEMPLATES.map((template) => (
            <div key={template.name} className="rounded-2xl border border-line p-4">
              <p className="font-black text-navy">{template.label}</p>
              <p className="mt-1 text-xs text-muted">&quot;{template.bodyText}&quot;</p>
              <button type="button" disabled={busy} onClick={() => createSuggestedTemplate(template)} className="premium-button-secondary mt-3">
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                Criar este modelo
              </button>
            </div>
          ))}
        </div>
      </div>

      <details className="rounded-2xl border border-line p-4">
        <summary className="cursor-pointer font-black text-navy">Criar um novo modelo (avançado)</summary>
        <form onSubmit={createCustomTemplate} className="mt-4 grid gap-3">
          <label className="text-sm font-bold text-navy">
            Nome (letras minúsculas e _ apenas)
            <input className="mt-1 w-full rounded-lg border border-line p-3 font-normal" value={customName} onChange={(event) => setCustomName(event.target.value)} required />
          </label>
          <label className="text-sm font-bold text-navy">
            Texto (use {"{{1}}"}, {"{{2}}"}... para os valores que variam)
            <textarea className="mt-1 w-full rounded-lg border border-line p-3 font-normal" rows={3} value={customBody} onChange={(event) => setCustomBody(event.target.value)} required />
          </label>
          <label className="text-sm font-bold text-navy">
            Exemplos dos valores, separados por vírgula (na mesma ordem)
            <input className="mt-1 w-full rounded-lg border border-line p-3 font-normal" value={customExample} onChange={(event) => setCustomExample(event.target.value)} />
          </label>
          <button type="submit" disabled={busy} className="premium-button-secondary w-fit">
            {busy ? <LoaderCircle className="h-5 w-5 animate-spin" /> : null}
            Enviar para aprovação da Meta
          </button>
        </form>
      </details>
    </section>
  );
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00-03:00`);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("pt-BR") : value;
}

"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";

// Sugestões prontas de modelos pra usar em Regras de automação (aba
// "Regras" → ação "Enviar WhatsApp"). Cada uma vira 1 clique aqui em vez do
// formulário avançado — o exemplo pedido ("Corretor, você recebeu um novo
// cliente...") é a primeira da lista.
const SUGGESTED_TEMPLATES = [
  {
    name: "corretor_novo_cliente_aguardando",
    label: "Novo cliente aguardando atendimento",
    bodyText: "Olá {{1}}! Você recebeu um novo cliente: {{2}}. Ele está aguardando seu atendimento — não deixe esperando!",
    bodyExample: ["Ana", "João Silva"]
  }
];

export default function WhatsappTemplateManager() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [customName, setCustomName] = useState("");
  const [customBody, setCustomBody] = useState("");
  const [customExample, setCustomExample] = useState("");

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
      <div>
        <p className="text-sm font-black uppercase tracking-[0.12em] text-navy">Modelos para usar em Regras de automação</p>
        <p className="mt-1 text-sm text-muted">
          Pra usar num gatilho (ex.: &quot;corretor recebeu cliente novo&quot;), crie o modelo aqui e depois escolha ele na
          ação &quot;Enviar WhatsApp&quot; em Automações → Regras.
        </p>
      </div>

      {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 font-bold text-emerald-800">{message}</p> : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 font-bold text-red-700">{error}</p> : null}

      <div className="grid gap-3 md:grid-cols-2">
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

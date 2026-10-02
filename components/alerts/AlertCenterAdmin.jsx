"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";

// Automações › Alertas — Central de Alertas (administrador geral).
// Primeira versão (2026-10-02): liga/desliga os alertas existentes e manda
// um alerta de TESTE só para você. Mensagem, público, gatilho, período e
// repetição já existem no banco (crm_alert_definitions) para o construtor
// completo que vem depois.

const KIND_LABEL = { informative: "Informativo", important: "Importante" };

export default function AlertCenterAdmin() {
  const [definitions, setDefinitions] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    try {
      const response = await fetch("/api/admin/alerts/definitions", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar os alertas.");
      setDefinitions(data.definitions || []);
    } catch (failure) {
      setError(failure.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function toggle(definition) {
    setBusy(definition.id);
    setError("");
    try {
      const response = await fetch("/api/admin/alerts/definitions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: definition.id, enabled: !definition.enabled }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
      setDefinitions((current) => current.map((item) => (item.id === definition.id ? { ...item, enabled: data.definition.enabled } : item)));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy("");
    }
  }

  async function sendTest(kind) {
    setBusy(kind);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/alerts/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível enviar o teste.");
      setNotice(`Alerta ${KIND_LABEL[kind].toLowerCase()} de teste enviado só para você.`);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="container-page space-y-4">
      <div className="rounded-card border border-line bg-white p-5 shadow-[0_1px_2px_rgba(13,59,102,0.04)]">
        <h2 className="text-lg font-semibold text-navy">Central de Alertas</h2>
        <p className="mt-1 text-sm text-ink-2">
          <strong>Informativo</strong>: aparece na lateral por ~5 segundos e some sozinho. <strong>Importante</strong>: bloqueia o CRM até a pessoa clicar em “Entendi” (horário em que apareceu e em que confirmou ficam registrados).
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" loading={busy === "informative"} onClick={() => sendTest("informative")}>Testar Informativo em mim</Button>
          <Button variant="secondary" loading={busy === "important"} onClick={() => sendTest("important")}>Testar Importante em mim</Button>
        </div>
        {notice ? <p role="status" className="mt-3 text-xs font-semibold text-success">{notice}</p> : null}
        {error ? <p role="alert" className="mt-3 text-xs font-semibold text-danger">{error}</p> : null}
      </div>

      <div className="rounded-card border border-line bg-white p-5">
        <h3 className="text-sm font-semibold text-navy">Alertas automáticos</h3>
        {!definitions ? <p className="mt-2 text-sm text-muted">{error ? "" : "Carregando…"}</p> : null}
        <ul className="mt-2 divide-y divide-line">
          {(definitions || []).map((definition) => (
            <li key={definition.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-navy">{definition.title} <span className="ml-1 rounded-chip bg-info-soft px-1.5 py-0.5 text-2xs font-semibold text-info">{KIND_LABEL[definition.kind]}</span></span>
                <span className="mt-0.5 block text-xs text-muted">{definition.body_template}</span>
              </span>
              <Button variant={definition.enabled ? "primary" : "secondary"} size="sm" loading={busy === definition.id} onClick={() => toggle(definition)} aria-pressed={definition.enabled}>
                {definition.enabled ? "Ligado" : "Desligado"}
              </Button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">“Cliente aguardando resposta” usa o mesmo detector do aviso falado da Alexa (mesmo horário configurado e só com a Alexa ligada), sem duplicar: uma espera = um alerta.</p>
      </div>
    </section>
  );
}

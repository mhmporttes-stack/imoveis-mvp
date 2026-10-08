"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";

// Registro do número oficial na Cloud API (lib/whatsapp-register.js). O número só envia depois de CONNECTED; "Pendente"
// no Gerenciador do WhatsApp = falta registrar (PIN de 6 dígitos criado aqui pelo dono; não fica gravado no CRM).
const STATUS_LABELS = {
  CONNECTED: "Conectado — pronto para enviar",
  PENDING: "Pendente — falta registrar",
  OFFLINE: "Offline",
  UNVERIFIED: "Não verificado",
  FLAGGED: "Sinalizado pela Meta",
  RESTRICTED: "Restrito pela Meta",
  BANNED: "Banido pela Meta"
};

export default function WhatsappNumberRegistration() {
  const [state, setState] = useState({ loading: true, registration: null, subscription: null, lastWebhookAt: null, appWebhook: null, error: "" });
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await fetch("/api/admin/whatsapp-master/registration", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível consultar o número.");
      setState({ loading: false, registration: data.registration, subscription: data.subscription || null, lastWebhookAt: data.lastWebhookAt || null, appWebhook: data.appWebhook || null, error: "" });
    } catch (error) {
      setState({ loading: false, registration: null, subscription: null, lastWebhookAt: null, error: error.message });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function register(event) {
    event.preventDefault();
    if (!/^\d{6}$/.test(pin) || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/whatsapp-master/registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível registrar o número.");
      setState({ loading: false, registration: data.registration, subscription: data.subscription || null, lastWebhookAt: data.lastWebhookAt || null, appWebhook: data.appWebhook || null, error: "" });
      setPin("");
      setMessage("Número registrado. Anote o PIN: ele protege o número (verificação em duas etapas).");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }


  async function activateReceiving() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/whatsapp-master/registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "subscribe" })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível ativar o recebimento.");
      setState({ loading: false, registration: data.registration, subscription: data.subscription || null, lastWebhookAt: data.lastWebhookAt || null, appWebhook: data.appWebhook || null, error: "" });
      setMessage("Recebimento ativado. Mande uma mensagem de teste para o número e confira se chega no Chat.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }


  async function configureWebhook() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/whatsapp-master/registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "configure-webhook" })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível configurar o webhook.");
      setState({ loading: false, registration: data.registration, subscription: data.subscription || null, lastWebhookAt: data.lastWebhookAt || null, appWebhook: data.appWebhook || null, error: "" });
      setMessage("Webhook configurado. Mande uma mensagem de teste para o número e confira se chega no Chat.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  const registration = state.registration;
  const connected = registration?.status === "CONNECTED";

  return (
    <section className="container-page mb-6 rounded-3xl border border-line bg-white p-5 shadow-soft sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-blue-50 text-brand"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></span>
          <div>
            <h2 className="text-lg font-black text-navy">Registro do número oficial (API da Meta)</h2>
            <p className="text-sm font-semibold text-muted">Estado real do número na Meta. O envio oficial só funciona depois de &quot;Conectado&quot;.</p>
          </div>
        </div>
        <button type="button" onClick={load} disabled={state.loading} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line px-4 text-sm font-extrabold text-navy hover:border-brand disabled:opacity-50">
          {state.loading ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />} Atualizar
        </button>
      </div>

      {state.error ? <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{state.error}</p> : null}

      {registration ? (
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="font-black uppercase tracking-wide text-muted">Número</dt><dd className="font-extrabold text-navy">{registration.displayPhoneNumber || "—"}</dd></div>
          <div><dt className="font-black uppercase tracking-wide text-muted">Situação</dt><dd className={`font-extrabold ${connected ? "text-emerald-700" : "text-amber-700"}`}>{STATUS_LABELS[registration.status] || registration.status || "—"}</dd></div>
          <div><dt className="font-black uppercase tracking-wide text-muted">Nome / qualidade</dt><dd className="font-extrabold text-navy">{registration.verifiedName || "—"} · {registration.qualityRating || "sem dados"}</dd></div>
        </dl>
      ) : null}

      {registration ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4 text-sm">
          <span className="font-black uppercase tracking-wide text-muted">Recebimento de mensagens</span>
          <span className={`font-extrabold ${state.subscription?.subscribed ? "text-emerald-700" : "text-amber-700"}`}>
            {state.subscription?.subscribed === true ? "Ativo (app inscrito na conta)" : state.subscription?.subscribed === false ? "Inativo — a Meta não está entregando mensagens ao CRM" : "Não foi possível verificar"}
          </span>
          <span className="font-semibold text-muted">Última mensagem recebida: {state.lastWebhookAt ? new Date(state.lastWebhookAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "nunca"}</span>
          {state.subscription?.subscribed !== true ? (
            <button type="button" onClick={activateReceiving} disabled={busy} className="premium-button-primary min-h-10 px-5 disabled:opacity-50">{busy ? "Ativando…" : "Ativar recebimento"}</button>
          ) : null}
        </div>
      ) : null}

      {registration && state.appWebhook?.known ? (
        <p className="mt-2 text-xs font-semibold text-muted">
          Webhook do app da Meta: {state.appWebhook.callbackUrl ? state.appWebhook.callbackUrl : "SEM URL configurada"} · campos: {state.appWebhook.fields?.length ? state.appWebhook.fields.join(", ") : "nenhum"}{state.appWebhook.fields?.includes("messages") ? "" : " — falta assinar \"messages\""}
        </p>
      ) : null}
      {registration && state.appWebhook?.known && !state.appWebhook.fields?.includes("messages") ? (
        <button type="button" onClick={configureWebhook} disabled={busy} className="premium-button-primary mt-3 min-h-10 px-5 disabled:opacity-50">{busy ? "Configurando…" : "Configurar webhook (receber mensagens)"}</button>
      ) : null}

      {registration && !connected ? (
        <form onSubmit={register} className="mt-5 flex flex-wrap items-end gap-3 border-t border-line pt-5">
          <label className="grid gap-1 text-sm font-extrabold text-navy">
            Crie um PIN de 6 números
            <input
              autoComplete="off"
              className="admin-input h-12 w-48 rounded-2xl text-center text-lg tracking-[0.4em]"
              inputMode="numeric"
              maxLength={6}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••••"
              type="password"
              value={pin}
            />
          </label>
          <button type="submit" disabled={busy || pin.length !== 6} className="premium-button-primary min-h-12 px-6 disabled:opacity-50">
            {busy ? "Registrando…" : "Registrar número"}
          </button>
          <p className="basis-full text-xs font-semibold text-muted">Escolha um PIN e anote em local seguro: ele é a verificação em duas etapas do número. O CRM não guarda o PIN.</p>
        </form>
      ) : null}

      {connected ? <p className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Número registrado e pronto na Meta.</p> : null}
      {message ? <p className="mt-3 text-sm font-bold text-navy">{message}</p> : null}
    </section>
  );
}

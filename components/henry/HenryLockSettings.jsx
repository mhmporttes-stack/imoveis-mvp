"use client";

import { useEffect, useState } from "react";
import Field, { inputClasses } from "@/components/ui/Field";
import { HENRY_LOCK_EVENT, isValidHenryPin } from "@/lib/henry-lock-core.mjs";

// "Tela de bloqueio" no cartão do Henry (REGRA OFICIAL — dono, 2026-10-24, bloqueio só manual; docs/BUSINESS_RULES.md
// HENRY-LOCK). O dono define/troca a senha de 6 dígitos (trocar exige a atual). Não há mais "minutos sem interação": a tela
// só trava pelo cadeado da barra da tela cheia (ou "Henry, bloqueia"). A senha só vai ao
// servidor (POST /api/admin/henry/lock, guardada como hash); a tela nunca a guarda nem mostra.
const onlyDigits = (value) => String(value || "").replace(/\D/g, "").slice(0, 6);

export default function HenryLockSettings() {
  const [state, setState] = useState(null);
  const [form, setForm] = useState({ current: "", pin: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ tone: "", text: "" });

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/henry/lock", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => alive && setState(data))
      .catch(() => alive && setState(null));
    return () => {
      alive = false;
    };
  }, []);

  if (!state) return null;

  const post = async (body) => {
    const response = await fetch("/api/admin/henry/lock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || "Não foi possível salvar.");
    return data;
  };

  const savePin = async (event) => {
    event.preventDefault();
    if (!isValidHenryPin(form.pin)) return setMessage({ tone: "error", text: "A senha precisa ter exatamente 6 dígitos." });
    if (form.pin !== form.confirm) return setMessage({ tone: "error", text: "A confirmação não bate com a senha nova." });
    if (state.configured && !isValidHenryPin(form.current)) return setMessage({ tone: "error", text: "Digite a senha atual (6 dígitos)." });
    setBusy(true);
    setMessage({ tone: "", text: "" });
    try {
      await post({ action: "set_pin", pin: form.pin, ...(state.configured ? { currentPin: form.current } : {}) });
      const next = { ...state, configured: true };
      setState(next);
      setForm({ current: "", pin: "", confirm: "" });
      setMessage({ tone: "ok", text: state.configured ? "Senha trocada." : "Senha definida. Para travar, toque no cadeado da barra da tela cheia do Henry." });
      window.dispatchEvent(new CustomEvent(HENRY_LOCK_EVENT, { detail: { configured: true } }));
    } catch (error) {
      setForm((current) => ({ ...current, current: "" }));
      setMessage({ tone: "error", text: error?.message || "Não foi possível salvar." });
    } finally {
      setBusy(false);
    }
  };

  const pinInput = (key, label) => (
    <Field label={label}>
      <input
        type="password"
        inputMode="numeric"
        autoComplete={key === "current" ? "current-password" : "new-password"}
        pattern="\d{6}"
        maxLength={6}
        value={form[key]}
        disabled={busy}
        onChange={(event) => setForm((current) => ({ ...current, [key]: onlyDigits(event.target.value) }))}
        className={`${inputClasses} tracking-[0.4em]`}
      />
    </Field>
  );

  return (
    <div className="mt-4 rounded-control border border-line p-4">
      <p className="text-sm font-black text-navy">Tela de bloqueio</p>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        A tela cheia do Henry só bloqueia quando você toca no cadeado da barra de ícones (ou diz “Henry, bloqueia”). Bloqueado, ele conversa e toca
        música, mas não fala nada do CRM até você digitar a senha de 6 dígitos na própria tela. Depois de 5 erros seguidos, espera 1 min; depois 5 min;
        depois 15 min — e você recebe um aviso. O Henry pequeno (no canto) continua como antes.
      </p>
      <form onSubmit={savePin} className="mt-4 grid gap-4 md:grid-cols-3">
        {state.configured ? pinInput("current", "Senha atual") : null}
        {pinInput("pin", state.configured ? "Senha nova (6 dígitos)" : "Senha (6 dígitos)")}
        {pinInput("confirm", "Repita a senha")}
        <div className="flex items-end md:col-span-3">
          <button type="submit" disabled={busy} className="rounded-control bg-navy px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60">
            {state.configured ? "Trocar a senha" : "Definir a senha"}
          </button>
        </div>
      </form>
      {message.text ? (
        <p className={`mt-3 text-sm font-bold ${message.tone === "error" ? "text-red-700" : "text-muted"}`} role="status">
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

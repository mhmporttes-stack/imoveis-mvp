"use client";

import { useCallback, useEffect, useState } from "react";
import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startRegistration } from "@simplewebauthn/browser";
import Field, { inputClasses } from "@/components/ui/Field";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { passkeyLabel } from "./HenryPasskeyUnlockButton";

// "Face ID / Windows Hello" dentro de "Tela de bloqueio" no cartão do Henry (REGRA OFICIAL — dono, 2026-10-24;
// docs/BUSINESS_RULES.md HENRY-LOCK "Face ID"). Cadastrar exige o código do app autenticador AGORA (além da sessão
// com senha + 2FA); a biometria nunca sai do aparelho, o servidor guarda só a chave pública. Lista com "Remover".
// Dois toques de propósito: 1º confere o código e busca o desafio; 2º abre o Face ID direto do toque (exigência do iPhone).
const onlyDigits = (value) => String(value || "").replace(/\D/g, "").slice(0, 6);
const formatDate = (value) =>
  value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "";

async function post(body) {
  const response = await fetch("/api/admin/henry/passkey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Não foi possível concluir.");
  return data;
}

export default function HenryPasskeySettings({ demoState = null }) {
  const [status, setStatus] = useState(demoState);
  const [supported, setSupported] = useState(demoState ? true : null);
  const [step, setStep] = useState("idle"); // idle → code → ready
  const [code, setCode] = useState("");
  const [options, setOptions] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ tone: "", text: "" });
  const [confirmAction, confirmElement] = useConfirm();
  const label = demoState ? "Face ID" : passkeyLabel();

  const load = useCallback(async () => {
    const data = await fetch("/api/admin/henry/passkey", { cache: "no-store" }).then((response) => (response.ok ? response.json() : null)).catch(() => null);
    setStatus(data);
  }, []);

  useEffect(() => {
    if (demoState) return;
    load();
    (async () => setSupported(browserSupportsWebAuthn() && (await platformAuthenticatorIsAvailable().catch(() => false))))();
  }, [demoState, load]);

  if (!status) return null;

  const confirmCode = async (event) => {
    event.preventDefault();
    if (code.length !== 6) return setMessage({ tone: "error", text: "Digite os 6 dígitos do app autenticador." });
    setBusy(true);
    setMessage({ tone: "", text: "" });
    try {
      const data = await post({ action: "register_options", code });
      setOptions(data.options);
      setStep("ready");
    } catch (error) {
      setMessage({ tone: "error", text: error?.message || "Código não conferido." });
    } finally {
      setCode("");
      setBusy(false);
    }
  };

  const register = async () => {
    if (!options) return;
    setBusy(true);
    setMessage({ tone: "", text: "" });
    try {
      const response = await startRegistration({ optionsJSON: options });
      await post({ action: "register", response });
      setMessage({ tone: "ok", text: `${label} ativado neste aparelho. Na tela bloqueada do Henry, toque no rosto ao lado dos cadeados.` });
      await load();
    } catch (error) {
      const cancelled = error?.name === "NotAllowedError" || error?.name === "AbortError";
      setMessage({ tone: "error", text: cancelled ? "Cadastro cancelado. Comece de novo quando quiser." : error?.message || "Não foi possível cadastrar." });
    } finally {
      setOptions(null);
      setStep("idle");
      setBusy(false);
    }
  };

  const remove = async (device) => {
    const ok = await confirmAction({
      title: `Remover “${device.deviceName}”?`,
      description: "Esse aparelho deixa de desbloquear o Henry pelo rosto/digital. A senha de 6 dígitos continua valendo.",
      confirmLabel: "Remover",
      tone: "danger"
    });
    if (!ok) return;
    setBusy(true);
    try {
      await post({ action: "remove", id: device.id });
      setMessage({ tone: "ok", text: "Aparelho removido." });
      await load();
    } catch (error) {
      setMessage({ tone: "error", text: error?.message || "Não foi possível remover." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="text-sm font-black text-navy">Face ID / Windows Hello</p>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Desbloqueie a tela do Henry com o rosto (iPhone) ou com o Windows Hello (computador), sem digitar a senha. A biometria fica só no aparelho;
        a senha de 6 dígitos continua valendo sempre.
      </p>

      {!status.available ? (
        <p className="mt-3 text-sm text-muted">{status.reason || "Indisponível no momento."}</p>
      ) : (
        <>
          {status.devices?.length ? (
            <ul className="mt-3 divide-y divide-line rounded-control border border-line">
              {status.devices.map((device) => (
                <li key={device.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">{device.deviceName}</p>
                    <p className="text-xs text-muted">
                      Cadastrado em {formatDate(device.createdAt)}
                      {device.lastUsedAt ? ` · último uso ${formatDate(device.lastUsedAt)}` : " · ainda não usado"}
                    </p>
                  </div>
                  <button type="button" disabled={busy} onClick={() => remove(device)} className="rounded-control px-3 py-1.5 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-60">
                    Remover
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">Nenhum aparelho cadastrado.</p>
          )}

          {supported === false ? (
            <p className="mt-3 text-sm text-muted">Este aparelho/navegador não oferece Face ID nem Windows Hello. Cadastre pelo iPhone ou pelo computador com Windows Hello.</p>
          ) : step === "idle" ? (
            <button type="button" disabled={busy || supported === null} onClick={() => setStep("code")} className="mt-4 rounded-control bg-navy px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60">
              Ativar {label} neste aparelho
            </button>
          ) : step === "code" ? (
            <form onSubmit={confirmCode} className="mt-4 flex flex-wrap items-end gap-3">
              <div className="w-48">
                <Field label="Código do app autenticador">
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    disabled={busy}
                    onChange={(event) => setCode(onlyDigits(event.target.value))}
                    className={`${inputClasses} tracking-[0.4em]`}
                  />
                </Field>
              </div>
              <button type="submit" disabled={busy} className="rounded-control bg-navy px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60">
                Confirmar código
              </button>
              <button type="button" disabled={busy} onClick={() => setStep("idle")} className="rounded-control px-3 py-2.5 text-sm font-bold text-muted">
                Cancelar
              </button>
            </form>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" disabled={busy} onClick={register} className="rounded-control bg-navy px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60">
                Usar o {label} agora
              </button>
              <span className="text-sm text-muted">Código conferido. Toque para o aparelho pedir o seu rosto/digital (vale por 3 minutos).</span>
            </div>
          )}
        </>
      )}

      {message.text ? (
        <p className={`mt-3 text-sm font-bold ${message.tone === "error" ? "text-red-700" : "text-muted"}`} role="status">
          {message.text}
        </p>
      ) : null}
      {confirmElement}
    </div>
  );
}

"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field, { inputClasses } from "@/components/ui/Field";

// Ativar/desativar a verificação em duas etapas da conta do dono (regra do dono, 2026-10-08).
// Opt-in: nada muda até o primeiro código ser confirmado aqui.
export default function AdminTwoFactorSettings({ initialStatus }) {
  const [status, setStatus] = useState(initialStatus || { enabled: false, available: false });
  const [enrollment, setEnrollment] = useState(null);
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [action, setAction] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState("totp");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function call(payload) {
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/admin/two-factor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error || "Não foi possível concluir agora.");
        setCode("");
        return null;
      }
      return body;
    } finally {
      setLoading(false);
    }
  }

  async function refreshStatus() {
    const response = await fetch("/api/admin/two-factor", { cache: "no-store" });
    if (response.ok) setStatus(await response.json());
  }

  async function startEnrollment() {
    const body = await call({ action: "start" });
    if (body) {
      setEnrollment(body);
      setCode("");
    }
  }

  async function confirmEnrollment(event) {
    event.preventDefault();
    const body = await call({ action: "confirm", code });
    if (!body) return;
    setEnrollment(null);
    setRecoveryCodes(body.recoveryCodes || []);
    setCode("");
    await refreshStatus();
  }

  async function submitAction(event) {
    event.preventDefault();
    const body = await call({ action, code, mode });
    if (!body) return;
    if (action === "regenerate") setRecoveryCodes(body.recoveryCodes || []);
    setAction("");
    setCode("");
    setMode("totp");
    await refreshStatus();
  }

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const codeInput = (recovery) => (
    <Field label={recovery ? "Código de recuperação" : "Código de 6 dígitos do app"} required>
      <input
        autoComplete="one-time-code"
        className={`${inputClasses} tracking-[0.3em]`}
        inputMode={recovery ? "text" : "numeric"}
        maxLength={recovery ? 20 : 6}
        onChange={(event) => setCode(recovery ? event.target.value.toUpperCase() : event.target.value.replace(/\D/g, ""))}
        placeholder={recovery ? "XXXX-XXXX-XXXX" : "000000"}
        value={code}
      />
    </Field>
  );

  const errorBox = error ? (
    <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700" role="alert">{error}</p>
  ) : null;

  if (recoveryCodes.length) {
    return (
      <Card padding="lg" className="grid gap-4">
        <h2 className="text-xl font-black text-navy">Guarde seus códigos de recuperação</h2>
        <p className="text-sm leading-6 text-muted">
          Se perder o celular, cada código abaixo permite entrar UMA vez. Eles não serão mostrados de novo —
          anote ou copie para um lugar seguro (fora deste celular).
        </p>
        <ul className="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-mist p-4 font-mono text-base font-bold text-navy">
          {recoveryCodes.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={copyCodes}>{copied ? "Copiado" : "Copiar códigos"}</Button>
          <Button onClick={() => { setRecoveryCodes([]); setCopied(false); }}>Já guardei os códigos</Button>
        </div>
      </Card>
    );
  }

  if (!status.enabled) {
    if (enrollment) {
      return (
        <Card padding="lg" as="form" onSubmit={confirmEnrollment} className="grid gap-4">
          <h2 className="text-xl font-black text-navy">1. Leia o QR Code no app autenticador</h2>
          <p className="text-sm leading-6 text-muted">
            No iPhone: Ajustes &gt; Senhas (ou app Senhas) &gt; sua conta &gt; Configurar código de verificação. Ou use o Google Authenticator.
          </p>
          <img
            alt="QR Code para o app autenticador"
            className="mx-auto h-56 w-56 rounded-2xl border border-line bg-white p-2"
            src={`data:image/svg+xml;utf8,${encodeURIComponent(enrollment.qrSvg)}`}
          />
          <a className="text-center text-sm font-extrabold text-brand hover:text-navy" href={enrollment.otpauthUri}>
            Está neste celular? Toque aqui para abrir no app de senhas
          </a>
          <div className="rounded-2xl border border-line bg-mist px-4 py-3 text-sm">
            <p className="font-semibold text-muted">Ou digite a chave manualmente:</p>
            <p className="mt-1 break-all font-mono text-base font-bold text-navy">{enrollment.manualKey}</p>
          </div>
          <h2 className="text-xl font-black text-navy">2. Digite o código que aparecer no app</h2>
          {codeInput(false)}
          {errorBox}
          <div className="flex flex-wrap gap-2">
            <Button loading={loading} type="submit" disabled={code.length !== 6}>Confirmar e ativar</Button>
            <Button variant="ghost" onClick={() => { setEnrollment(null); setCode(""); setError(""); }}>Cancelar</Button>
          </div>
        </Card>
      );
    }

    return (
      <Card padding="lg" className="grid gap-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-7 w-7 text-brand" />
          <h2 className="text-xl font-black text-navy">Verificação em duas etapas: desativada</h2>
        </div>
        <p className="text-sm leading-6 text-muted">
          Depois de ativar, entrar no painel com a sua conta vai pedir, além da senha, um código de 6 dígitos do app
          autenticador do seu celular. Nada muda até você confirmar o primeiro código.
        </p>
        {status.available === false && status.reason ? (
          <p className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">{status.reason}</p>
        ) : null}
        {errorBox}
        <div>
          <Button loading={loading} onClick={startEnrollment} disabled={status.available === false}>Ativar verificação em duas etapas</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card padding="lg" className="grid gap-4">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-7 w-7 text-emerald-600" />
        <h2 className="text-xl font-black text-navy">Verificação em duas etapas: ativada</h2>
      </div>
      <p className="text-sm leading-6 text-muted">
        {status.enabledAt ? `Ativada em ${new Date(status.enabledAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}. ` : ""}
        Códigos de recuperação restantes: <strong>{status.recoveryCodesLeft ?? 0}</strong>.
      </p>

      {action ? (
        <form onSubmit={submitAction} className="grid gap-4 rounded-2xl border border-line p-4">
          <p className="text-sm font-semibold text-ink">
            {action === "disable"
              ? "Para desativar, confirme com um código válido. Os aparelhos lembrados deixam de valer."
              : "Para gerar novos códigos, confirme com um código válido. Os códigos antigos e os aparelhos lembrados deixam de valer."}
          </p>
          {codeInput(mode === "recovery")}
          <button
            className="justify-self-start text-sm font-extrabold text-brand hover:text-navy"
            onClick={() => { setMode(mode === "recovery" ? "totp" : "recovery"); setCode(""); }}
            type="button"
          >
            {mode === "recovery" ? "Usar o código do app" : "Usar um código de recuperação"}
          </button>
          {errorBox}
          <div className="flex flex-wrap gap-2">
            <Button loading={loading} type="submit" variant={action === "disable" ? "danger" : "primary"} disabled={!code.trim()}>
              {action === "disable" ? "Desativar" : "Gerar novos códigos"}
            </Button>
            <Button variant="ghost" onClick={() => { setAction(""); setCode(""); setMode("totp"); setError(""); }}>Cancelar</Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setAction("regenerate")}>Gerar novos códigos de recuperação</Button>
          <Button variant="danger-ghost" onClick={() => setAction("disable")}>Desativar verificação em duas etapas</Button>
        </div>
      )}
    </Card>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import Button from "@/components/ui/Button";
import Field, { inputClasses } from "@/components/ui/Field";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

// Etapa do código no login do dono (verificação em duas etapas, regra do dono 2026-10-08). A senha já foi aceita;
// o painel só libera depois que /api/admin/two-factor/verify confere o código no servidor.
export default function AdminTwoFactorChallenge({ email = "" }) {
  const router = useRouter();
  const [mode, setMode] = useState("totp");
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/admin/two-factor/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, mode, remember })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error || "Não foi possível conferir o código.");
        setCode("");
        return;
      }
      const mobileApp = window.navigator.standalone === true
        || window.matchMedia("(display-mode: standalone)").matches
        || window.matchMedia("(max-width: 767px)").matches;
      router.replace(mobileApp ? "/admin/simulacoes" : "/admin");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function useAnotherAccount() {
    await fetch("/api/admin/session", { method: "DELETE" });
    await getSupabaseBrowserClient()?.auth.signOut();
    router.refresh();
  }

  const isRecovery = mode === "recovery";

  return (
    <form onSubmit={handleSubmit} className="grid gap-5">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#E9F2FF] text-brand">
        <ShieldCheck className="h-7 w-7" />
      </div>
      <div>
        <h2 className="text-xl font-black text-navy">Verificação em duas etapas</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          {isRecovery
            ? "Digite um dos códigos de recuperação que você guardou. Cada código funciona uma única vez."
            : `Abra o app autenticador e digite o código de 6 dígitos${email ? ` da conta ${email}` : ""}.`}
        </p>
      </div>

      <Field label={isRecovery ? "Código de recuperação" : "Código de 6 dígitos"} required>
        <input
          autoComplete="one-time-code"
          autoFocus
          className={`${inputClasses} tracking-[0.3em]`}
          inputMode={isRecovery ? "text" : "numeric"}
          maxLength={isRecovery ? 20 : 6}
          onChange={(event) => setCode(isRecovery ? event.target.value.toUpperCase() : event.target.value.replace(/\D/g, ""))}
          placeholder={isRecovery ? "XXXX-XXXX-XXXX" : "000000"}
          value={code}
        />
      </Field>

      <label className="flex items-center gap-3 text-sm font-semibold text-ink">
        <input checked={remember} className="h-5 w-5 accent-navy" onChange={(event) => setRemember(event.target.checked)} type="checkbox" />
        Lembrar este aparelho por 30 dias
      </label>

      {error ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700" role="alert">{error}</p>
      ) : null}

      <Button block loading={loading} size="lg" type="submit" disabled={isRecovery ? code.trim().length < 12 : code.length !== 6}>
        {loading ? "Conferindo..." : "Entrar"}
      </Button>

      <div className="flex flex-col items-center gap-2">
        <button
          className="text-sm font-extrabold text-brand transition hover:text-navy"
          onClick={() => { setMode(isRecovery ? "totp" : "recovery"); setCode(""); setError(""); }}
          type="button"
        >
          {isRecovery ? "Usar o código do app autenticador" : "Perdi o celular: usar código de recuperação"}
        </button>
        <button className="text-sm font-semibold text-muted transition hover:text-navy" onClick={useAnotherAccount} type="button">
          Entrar com outra conta
        </button>
      </div>
    </form>
  );
}

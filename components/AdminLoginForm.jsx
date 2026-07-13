"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

const errorMessages = {
  unauthorized: "Acesso nao autorizado. Entre com o e-mail administrador cadastrado.",
  session: "Sua sessao expirou. Entre novamente."
};

function getPasswordResetRedirectTo() {
  const redirectTo = new URL(
    "/admin/reset-password",
    window.location.origin
  ).toString();

  if (process.env.NODE_ENV === "development" && window.location.hostname === "localhost") {
    console.info("[admin password reset] redirectTo:", redirectTo);
  }

  return redirectTo;
}

export default function AdminLoginForm({ initialError = "" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(errorMessages[initialError] || "");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  useEffect(() => {
    if (!initialError) return;

    fetch("/api/admin/session", { method: "DELETE" });
    getSupabaseBrowserClient()?.auth.signOut();
  }, [initialError]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setError("Supabase nao configurado. Verifique as variaveis de ambiente.");
        return;
      }

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (signInError || !data.session?.access_token) {
        setError("E-mail ou senha invalidos.");
        return;
      }

      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token
        })
      });

      if (response.status === 403) {
        await supabase.auth.signOut();
        setError(errorMessages.unauthorized);
        return;
      }

      if (!response.ok) {
        await supabase.auth.signOut();
        setError("Nao foi possivel iniciar a sessao administrativa.");
        return;
      }

      router.replace("/admin");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function requestPasswordReset() {
    setError("");
    setSuccess("");

    if (!email) {
      setError("Informe seu e-mail no campo acima para receber o link de recuperacao.");
      return;
    }

    setResetLoading(true);

    try {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setError("Supabase nao configurado. Verifique as variaveis de ambiente.");
        return;
      }

      const redirectTo = getPasswordResetRedirectTo();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });

      if (resetError) throw resetError;

      setSuccess("Se o e-mail estiver cadastrado, enviaremos um link para redefinir sua senha.");
    } catch (resetError) {
      setError(resetError?.message || "Nao foi possivel enviar o link de recuperacao.");
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-5">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#E9F2FF] text-brand">
        <LockKeyhole className="h-7 w-7" />
      </div>

      <label className="grid gap-2 font-extrabold text-ink">
        E-mail
        <input
          autoComplete="email"
          className="rounded-2xl border border-line px-4 py-3 outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>

      <label className="grid gap-2 font-extrabold text-ink">
        Senha
        <input
          autoComplete="current-password"
          className="rounded-2xl border border-line px-4 py-3 outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>

      {error ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
          {success}
        </p>
      ) : null}

      <button className="premium-button-primary w-full" disabled={loading} type="submit">
        {loading ? "Entrando..." : "Entrar"}
      </button>

      <button
        className="text-sm font-extrabold text-brand transition hover:text-navy disabled:cursor-not-allowed disabled:text-muted"
        disabled={resetLoading || loading}
        onClick={requestPasswordReset}
        type="button"
      >
        {resetLoading ? "Enviando link..." : "Esqueci minha senha"}
      </button>
    </form>
  );
}

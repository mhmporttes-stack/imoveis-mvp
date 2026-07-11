"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, RefreshCw } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

const invalidLinkMessage =
  "O link de recuperacao esta expirado ou invalido. Solicite um novo link para redefinir sua senha.";

export default function AdminResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [requestingLink, setRequestingLink] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [canUpdatePassword, setCanUpdatePassword] = useState(false);

  const disabled = useMemo(() => loading || checkingSession || !canUpdatePassword, [canUpdatePassword, checkingSession, loading]);

  useEffect(() => {
    let active = true;
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      setError("Supabase nao configurado. Verifique as variaveis de ambiente.");
      setCheckingSession(false);
      return undefined;
    }

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" && session?.access_token) {
        setCanUpdatePassword(true);
        setError("");
      }
    });

    async function prepareRecoverySession() {
      try {
        const url = new URL(window.location.href);
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const queryParams = url.searchParams;
        const urlError = hashParams.get("error_description") || queryParams.get("error_description") || hashParams.get("error") || queryParams.get("error");

        if (urlError) {
          setError(decodeURIComponent(urlError));
          setCanUpdatePassword(false);
          return;
        }

        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");
        const type = hashParams.get("type") || queryParams.get("type");
        const code = queryParams.get("code");

        if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          });

          if (sessionError) throw sessionError;
          if (type !== "recovery") throw new Error(invalidLinkMessage);

          setCanUpdatePassword(true);
          setError("");
          window.history.replaceState({}, document.title, "/admin/reset-password");
          return;
        }

        if (code) {
          const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError || !data.session?.access_token) {
            throw exchangeError || new Error(invalidLinkMessage);
          }

          setCanUpdatePassword(true);
          setError("");
          window.history.replaceState({}, document.title, "/admin/reset-password");
          return;
        }

        setError(invalidLinkMessage);
        setCanUpdatePassword(false);
      } catch (recoveryError) {
        setError(recoveryError?.message || invalidLinkMessage);
        setCanUpdatePassword(false);
      } finally {
        if (active) setCheckingSession(false);
      }
    }

    prepareRecoverySession();

    return () => {
      active = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!canUpdatePassword) {
      setError(invalidLinkMessage);
      return;
    }

    if (password.length < 8) {
      setError("A nova senha deve ter pelo menos 8 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setError("As senhas informadas nao sao iguais.");
      return;
    }

    setLoading(true);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password
      });

      if (updateError) throw updateError;

      setSuccess("Senha alterada com sucesso. Voce sera redirecionado para o login.");
      await fetch("/api/admin/session", { method: "DELETE" });
      await supabase.auth.signOut();
      window.setTimeout(() => {
        router.replace("/admin/login");
      }, 1400);
    } catch (updateError) {
      setError(updateError?.message || "Nao foi possivel alterar a senha. Solicite um novo link.");
    } finally {
      setLoading(false);
    }
  }

  async function requestNewLink() {
    setError("");
    setSuccess("");

    if (!email) {
      setError("Informe seu e-mail para receber um novo link de recuperacao.");
      return;
    }

    setRequestingLink(true);

    try {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setError("Supabase nao configurado. Verifique as variaveis de ambiente.");
        return;
      }

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/admin/reset-password`
      });

      if (resetError) throw resetError;
      setSuccess("Se o e-mail estiver cadastrado, enviaremos um novo link de recuperacao.");
    } catch (resetError) {
      setError(resetError?.message || "Nao foi possivel enviar um novo link de recuperacao.");
    } finally {
      setRequestingLink(false);
    }
  }

  return (
    <div className="grid gap-6">
      <form onSubmit={handleSubmit} className="grid gap-5">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#E9F2FF] text-brand">
          <KeyRound className="h-7 w-7" />
        </div>

        <label className="grid gap-2 font-extrabold text-ink">
          Nova senha
          <input
            autoComplete="new-password"
            className="rounded-2xl border border-line px-4 py-3 outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
            disabled={checkingSession || !canUpdatePassword}
            minLength={8}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>

        <label className="grid gap-2 font-extrabold text-ink">
          Confirmar nova senha
          <input
            autoComplete="new-password"
            className="rounded-2xl border border-line px-4 py-3 outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
            disabled={checkingSession || !canUpdatePassword}
            minLength={8}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            type="password"
            value={confirmPassword}
          />
        </label>

        {checkingSession ? (
          <p className="rounded-2xl border border-blue-100 bg-[#F4F9FF] px-4 py-3 text-sm font-bold text-navy">
            Validando link de recuperacao...
          </p>
        ) : null}

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

        <button className="premium-button-primary w-full" disabled={disabled} type="submit">
          {loading ? "Salvando..." : "Salvar nova senha"}
        </button>
      </form>

      {!checkingSession && !canUpdatePassword ? (
        <div className="grid gap-3 rounded-2xl border border-line bg-mist p-4">
          <label className="grid gap-2 font-extrabold text-ink">
            E-mail para novo link
            <input
              autoComplete="email"
              className="rounded-2xl border border-line bg-white px-4 py-3 outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              value={email}
            />
          </label>
          <button className="premium-button-secondary w-full" disabled={requestingLink} onClick={requestNewLink} type="button">
            <RefreshCw className="mr-2 h-5 w-5" />
            {requestingLink ? "Enviando..." : "Solicitar novo link"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

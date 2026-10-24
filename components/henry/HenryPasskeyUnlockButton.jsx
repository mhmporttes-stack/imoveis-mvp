"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ScanFace } from "lucide-react";
import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startAuthentication } from "@simplewebauthn/browser";
import { isPageHidden } from "@/components/page-visibility";

// Botão do Face ID / Windows Hello na tela bloqueada do Henry (REGRA OFICIAL — dono, 2026-10-24; docs/BUSINESS_RULES.md
// HENRY-LOCK "Face ID"). Alternativa à senha de 6 dígitos, que continua sempre na tela. Só aparece com aparelho
// cadastrado e leitor disponível. Quem confere a assinatura é o SERVIDOR (/api/admin/henry/passkey); o sucesso devolve o
// mesmo estado do desbloqueio por senha (onUnlocked). Componente separado da HenryLockScreen de propósito (encaixe por
// `accessory`). O desafio é pedido ANTES do toque (e renovado enquanto a tela está visível): o iPhone só abre o Face ID
// se a chamada sair direto do toque.
const ACCENT = "#4FC3E0";
const OPTIONS_FRESH_MS = 100 * 1000; // o desafio vale 2 min no servidor
const REFRESH_MS = 90 * 1000;

const post = async (body) => {
  const response = await fetch("/api/admin/henry/passkey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Não consegui confirmar o Face ID. Use a senha.");
  return data;
};

export function passkeyLabel() {
  if (typeof navigator === "undefined") return "Face ID";
  return /Windows/.test(navigator.userAgent || "") ? "Windows Hello" : "Face ID";
}

export default function HenryPasskeyUnlockButton({ onUnlocked, demo = false }) {
  const [ready, setReady] = useState(demo);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const optionsRef = useRef(null);
  const label = demo ? "Face ID" : passkeyLabel();

  const prefetch = useCallback(async () => {
    try {
      const data = await post({ action: "unlock_options" });
      optionsRef.current = { options: data.options, at: Date.now() };
    } catch {
      optionsRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (demo) return undefined;
    let alive = true;
    (async () => {
      if (!browserSupportsWebAuthn() || !(await platformAuthenticatorIsAvailable().catch(() => false))) return;
      const status = await fetch("/api/admin/henry/passkey", { cache: "no-store" }).then((response) => (response.ok ? response.json() : null)).catch(() => null);
      if (!alive || !status?.available || !status.devices?.length) return;
      setReady(true);
      prefetch();
    })();
    const timer = window.setInterval(() => {
      if (!alive || isPageHidden() || !optionsRef.current) return;
      if (Date.now() - optionsRef.current.at > REFRESH_MS) prefetch();
    }, 15 * 1000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [demo, prefetch]);

  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(""), 4000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const unlock = useCallback(
    async (event) => {
      event.stopPropagation();
      if (demo || busy) return;
      setBusy(true);
      setMessage("");
      try {
        let cached = optionsRef.current;
        optionsRef.current = null; // desafio de uso único
        if (!cached || Date.now() - cached.at > OPTIONS_FRESH_MS) cached = { options: (await post({ action: "unlock_options" })).options };
        const response = await startAuthentication({ optionsJSON: cached.options });
        const state = await post({ action: "unlock", response });
        onUnlocked?.(state);
      } catch (error) {
        // Cancelou/fechou o Face ID: sem alarde (a senha continua na tela).
        setMessage(error?.name === "NotAllowedError" || error?.name === "AbortError" ? "" : error?.message || "Não consegui confirmar. Use a senha.");
        prefetch();
      } finally {
        setBusy(false);
      }
    },
    [busy, demo, onUnlocked, prefetch]
  );

  if (!ready) return null;
  return (
    <div className="relative flex flex-col items-center">
      {message ? (
        <p className="absolute bottom-full mb-2 w-56 -translate-x-1/2 text-center text-[11px] text-white/70" style={{ left: "50%" }} role="status">
          {message}
        </p>
      ) : null}
      <button
        type="button"
        onClick={unlock}
        disabled={busy}
        className="flex h-11 w-11 items-center justify-center rounded-full text-white/55 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
        style={{ "--tw-ring-color": ACCENT }}
        aria-label={`Desbloquear com ${label}`}
        title={`Desbloquear com ${label}`}
      >
        <ScanFace size={22} strokeWidth={1.4} aria-hidden="true" style={busy ? { color: ACCENT } : undefined} />
      </button>
    </div>
  );
}

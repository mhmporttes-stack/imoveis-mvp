"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Bell, X } from "lucide-react";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const DISMISS_KEY = "mm_admin_push_hint_dismissed";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function subscribeAndSave() {
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
  }

  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(subscription.toJSON())
  });
}

// O iOS/Safari só exibe o prompt nativo de permissão quando
// Notification.requestPermission() é chamado de forma síncrona dentro de um
// gesto real do usuário (toque num botão) — chamá-lo dentro de um useEffect
// (mesmo com setTimeout) é silenciosamente ignorado pelo WebKit: a Promise
// resolve sem mostrar nada e a permissão nunca sai de "default". Por isso,
// em vez de pedir a permissão sozinho ao carregar a página, mostramos um
// botão discreto e só chamamos requestPermission() dentro do próprio clique.
export default function AdminPushSubscription() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  const shouldRun =
    Boolean(VAPID_PUBLIC_KEY) &&
    pathname?.startsWith("/admin") &&
    !pathname?.startsWith("/admin/login") &&
    !pathname?.startsWith("/admin/reset-password");

  useEffect(() => {
    if (!shouldRun || typeof window === "undefined" || !isPushSupported()) return undefined;
    if (window.localStorage.getItem(DISMISS_KEY) === "1") return undefined;

    let cancelled = false;

    async function check() {
      try {
        if (Notification.permission === "denied") return;

        if (Notification.permission === "granted") {
          // Permissão já concedida antes (ou por outro fluxo): não precisa de
          // gesto do usuário para (re)assinar, só para pedir permissão.
          const registration = await navigator.serviceWorker.ready;
          const existing = await registration.pushManager.getSubscription();
          if (!existing && !cancelled) await subscribeAndSave();
          return;
        }

        // permission === "default": precisa de um toque real do usuário.
        if (!cancelled) setVisible(true);
      } catch (error) {
        console.error("Falha ao verificar assinatura de notificações push.", error);
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, [shouldRun]);

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  }

  async function activate() {
    setBusy(true);
    try {
      // Precisa ser a primeira chamada async do handler de clique — nenhum
      // await antes dela — para preservar o gesto do usuário no Safari/iOS.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        if (permission === "denied") window.localStorage.setItem(DISMISS_KEY, "1");
        return;
      }
      await subscribeAndSave();
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch (error) {
      console.error("Falha ao ativar notificações push.", error);
    } finally {
      setBusy(false);
      setVisible(false);
    }
  }

  if (!visible) return null;

  return (
    <aside className="fixed top-[calc(4.5rem+env(safe-area-inset-top))] left-4 right-4 z-[130] mx-auto max-w-[560px] rounded-[24px] border border-blue-100 bg-white p-4 text-navy shadow-premium md:left-auto md:right-6 md:mx-0">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#E9F2FF] text-brand">
          <Bell className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black uppercase tracking-[0.16em] text-brand">Ativar notificações</p>
          <p className="mt-1 text-sm font-semibold leading-6 text-muted">
            Receba um aviso no celular quando uma atividade agendada vencer, mesmo com o app fechado.
          </p>
          <button
            type="button"
            onClick={activate}
            disabled={busy}
            className="mt-3 inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-white transition hover:bg-brand/90 disabled:opacity-60"
          >
            <Bell className="h-4 w-4" />
            {busy ? "Ativando..." : "Ativar notificações"}
          </button>
        </div>
        <button
          aria-label="Fechar aviso de notificações"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line text-muted transition hover:bg-mist hover:text-navy"
          onClick={dismiss}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}

"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

// Assina o corretor logado (via navegador, sem app de loja) para receber
// notificações push, sem exigir nenhuma UI extra: usa o prompt nativo do
// navegador para permissão e registra a assinatura silenciosamente.
export default function AdminPushSubscription() {
  const pathname = usePathname();
  const shouldRun =
    Boolean(VAPID_PUBLIC_KEY) &&
    pathname?.startsWith("/admin") &&
    !pathname?.startsWith("/admin/login") &&
    !pathname?.startsWith("/admin/reset-password");

  useEffect(() => {
    if (!shouldRun || typeof window === "undefined") return undefined;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return undefined;
    if (Notification.permission === "denied") return undefined;

    let cancelled = false;

    async function ensureSubscription() {
      try {
        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
          const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
          if (cancelled || permission !== "granted") return;
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
          });
        }

        if (cancelled || !subscription) return;

        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(subscription.toJSON())
        });
      } catch (error) {
        console.error("Falha ao registrar notificações push.", error);
      }
    }

    const timer = window.setTimeout(ensureSubscription, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [shouldRun]);

  return null;
}

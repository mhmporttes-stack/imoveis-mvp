"use client";

import { useEffect, useState } from "react";
import { RefreshCw, WifiOff, X } from "lucide-react";

const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000;

export default function PwaLifecycle() {
  const [updateWorker, setUpdateWorker] = useState(null);
  const [offline, setOffline] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    setOffline(!window.navigator.onLine);

    function handleOnline() {
      setOffline(false);
    }

    function handleOffline() {
      setOffline(true);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return undefined;

    let refreshing = false;

    // Com a procura de versão a cada 10 min (abaixo) o app recarrega sozinho depois de cada
    // deploy — nunca no meio de uma mensagem/campo sendo digitado: espera parar de digitar.
    function userIsTyping() {
      const element = document.activeElement;
      if (!element) return false;
      const isField = element.tagName === "TEXTAREA"
        || (element.tagName === "INPUT" && !["button", "checkbox", "radio", "submit", "range", "file"].includes(element.type))
        || element.isContentEditable;
      return Boolean(isField && String(element.value ?? element.textContent ?? "").length > 0);
    }

    function handleControllerChange() {
      if (refreshing) return;
      refreshing = true;
      if (!userIsTyping()) {
        window.location.reload();
        return;
      }
      const waiter = window.setInterval(() => {
        if (userIsTyping()) return;
        window.clearInterval(waiter);
        window.location.reload();
      }, 3000);
    }

    // App instalado (PWA) fica ABERTO por dias sem nenhuma navegação de página, e o
    // navegador só procura service worker novo em navegação (ou no máx. a cada 24 h por
    // push): o app seguia rodando o JavaScript de versões antigas — foi o que fez o botão
    // "WhatsApp" do card abrir o WhatsApp externo (código antigo) depois de a regra mudar
    // (2026-10-02). Procura versão nova ao voltar para o app e a cada 10 min com ele
    // aberto; o service worker novo assume sozinho (skipWaiting + controllerchange abaixo
    // recarrega) e o app passa a rodar o código atual.
    let updateRegistration = null;
    function checkForNewVersion() {
      if (document.visibilityState !== "visible") return;
      updateRegistration?.update().catch(() => {
        // Sem rede: tenta de novo na próxima volta ao app.
      });
    }
    document.addEventListener("visibilitychange", checkForNewVersion);
    const updateTimer = window.setInterval(checkForNewVersion, UPDATE_CHECK_INTERVAL_MS);

    function registerServiceWorker() {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((registration) => {
          updateRegistration = registration;
          checkForNewVersion();
          registration.addEventListener("updatefound", () => {
            const worker = registration.installing;
            if (!worker) return;

            worker.addEventListener("statechange", () => {
              if (worker.state === "installed" && navigator.serviceWorker.controller) {
                setUpdateWorker(worker);
              }
            });
          });
        })
        .catch(() => {
          // A PWA remains optional; registration failures should not block the site.
        });
    }

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    if (document.readyState === "complete") {
      registerServiceWorker();
    } else {
      window.addEventListener("load", registerServiceWorker, { once: true });
    }

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      window.removeEventListener("load", registerServiceWorker);
      document.removeEventListener("visibilitychange", checkForNewVersion);
      window.clearInterval(updateTimer);
    };
  }, []);

  function applyUpdate() {
    updateWorker?.postMessage({ type: "SKIP_WAITING" });
  }

  if (dismissed || (!updateWorker && !offline)) return null;

  return (
    <div className="fixed left-4 right-4 top-[calc(0.75rem+env(safe-area-inset-top))] z-[140] mx-auto flex max-w-[520px] items-center justify-between gap-3 rounded-2xl border border-white/50 bg-white/95 px-4 py-3 text-sm font-bold text-navy shadow-premium backdrop-blur md:left-auto md:right-6 md:mx-0">
      <div className="flex min-w-0 items-center gap-3">
        {offline ? <WifiOff className="h-5 w-5 shrink-0 text-brand" /> : <RefreshCw className="h-5 w-5 shrink-0 text-brand" />}
        <span className="min-w-0">
          {offline ? "Você está sem conexão. Dados privados não ficam disponíveis offline." : "Nova versão do painel disponível."}
        </span>
      </div>

      {updateWorker ? (
        <button
          className="shrink-0 rounded-full bg-navy px-3 py-2 text-xs font-black text-white transition hover:bg-brand"
          onClick={applyUpdate}
          type="button"
        >
          Atualizar
        </button>
      ) : (
        <button
          aria-label="Fechar aviso de conexão"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-muted transition hover:bg-mist hover:text-navy"
          onClick={() => setDismissed(true)}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

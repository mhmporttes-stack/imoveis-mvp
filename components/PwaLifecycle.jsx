"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { RefreshCw, WifiOff, X } from "lucide-react";
import { useHenryFullscreen } from "@/components/henry/useHenryFullscreen";
import { decideUpdateAction, hardNavigationTarget, isRealUpdate, UPDATE_ACTIONS } from "@/components/pwa-update-policy.mjs";

const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const RETURN_CHECK_DELAY_MS = 4000;

// Fora do componente: o PwaLifecycle é montado em ramos diferentes do AppChrome (painel, Academia, /chat-app) e remonta
// ao trocar de ramo — a versão pendente não pode se perder nisso.
let updatePending = false;
let updateReloading = false;

function userIsTyping() {
  const element = document.activeElement;
  if (!element) return false;
  const isField = element.tagName === "TEXTAREA"
    || (element.tagName === "INPUT" && !["button", "checkbox", "radio", "submit", "range", "file"].includes(element.type))
    || element.isContentEditable;
  return Boolean(isField && String(element.value ?? element.textContent ?? "").length > 0);
}

export default function PwaLifecycle() {
  const [updateReady, setUpdateReady] = useState(() => updatePending);
  const pathname = usePathname();
  const [offline, setOffline] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // Tela cheia do Henry aberta (dono, 2026-10-23): os avisos de nova versão/sem conexão esperam ela fechar (a troca
  // automática de versão na próxima troca de tela continua igual).
  const henryOpen = useHenryFullscreen();

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

    // Primeira instalação também dispara controllerchange (clients.claim) — não é versão nova.
    const hadControllerAtStart = Boolean(navigator.serviceWorker.controller);

    function handleControllerChange() {
      if (updateReloading || !isRealUpdate({ hadControllerAtStart })) return;
      // Versão nova (dono, 2026-10-26: "quando eu saio do app e volto, ele tem que carregar tudo de novo"): só marca como
      // pendente. Sair/voltar NUNCA recarrega; ela entra na próxima troca de tela (components/pwa-update-policy.mjs).
      updatePending = true;
      setUpdateReady(true);
    }

    // Toque num link do painel com versão nova pendente: abre a tela pedida por completo (já na versão nova), em vez da
    // troca rápida do Next — é o momento em que a pessoa já espera carregar. Captura na janela: roda antes do onClick do Link do Next.
    function handleLinkClick(event) {
      if (updateReloading || event.defaultPrevented) return;
      if (decideUpdateAction({ pending: updatePending, trigger: "link-click" }) !== UPDATE_ACTIONS.HARD_NAVIGATE) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!anchor) return;
      const url = hardNavigationTarget({
        href: anchor.getAttribute("href"),
        origin: window.location.origin,
        currentHref: window.location.href,
        button: event.button,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        target: anchor.getAttribute("target") || "",
        download: anchor.hasAttribute("download"),
        optOut: anchor.closest("[data-no-hard-nav]") !== null
      });
      if (!url) return;
      event.preventDefault();
      event.stopPropagation();
      updateReloading = true;
      window.location.assign(url);
    }
    window.addEventListener("click", handleLinkClick, true);

    // App instalado (PWA) fica ABERTO por dias sem nenhuma navegação de página, e o
    // navegador só procura service worker novo em navegação (ou no máx. a cada 24 h por
    // push): o app seguia rodando o JavaScript de versões antigas — foi o que fez o botão
    // "WhatsApp" do card abrir o WhatsApp externo (código antigo) depois de a regra mudar
    // (2026-10-02). Procura versão nova ao voltar para o app (alguns segundos depois, para não disputar a rede com a
    // tela) e a cada 10 min com ele aberto; a versão encontrada entra na próxima troca de tela (acima/abaixo).
    let updateRegistration = null;
    let returnTimer = null;
    function checkForNewVersion() {
      if (document.visibilityState !== "visible") return;
      updateRegistration?.update().catch(() => {
        // Sem rede: tenta de novo na próxima volta ao app.
      });
    }
    function handleVisibility() {
      window.clearTimeout(returnTimer);
      if (document.visibilityState === "visible") returnTimer = window.setTimeout(checkForNewVersion, RETURN_CHECK_DELAY_MS);
    }
    document.addEventListener("visibilitychange", handleVisibility);
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
                setUpdateReady(true);
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
      window.removeEventListener("click", handleLinkClick, true);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("load", registerServiceWorker);
      window.clearTimeout(returnTimer);
      window.clearInterval(updateTimer);
    };
  }, []);

  // Troca de tela que não veio de um link (ex.: busca do cabeçalho, botão que chama router.push): com versão nova
  // pendente, recarrega logo depois — nunca com campo sendo digitado.
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    if (updateReloading) return;
    if (decideUpdateAction({ pending: updatePending, trigger: "route-change", typing: userIsTyping() }) === UPDATE_ACTIONS.RELOAD) {
      updateReloading = true;
      window.location.reload();
    }
  }, [pathname]);

  if (dismissed || henryOpen || (!updateReady && !offline)) return null;

  // Versão nova (dono, 2026-10-14): sem botão "Atualizar" (recarregar na hora demorava e interrompia o trabalho) —
  // só um aviso pequeno no canto. Desde 2026-10-26 a versão nova entra sozinha na próxima troca de tela (nunca ao
  // sair/voltar para o app).
  if (!offline) {
    return (
      <div
        role="status"
        className="fixed right-3 top-[calc(0.5rem+env(safe-area-inset-top))] z-[140] flex items-center gap-1.5 rounded-full border border-line bg-white/95 py-1 pl-2.5 pr-1 text-[11px] font-semibold text-navy shadow-float backdrop-blur"
      >
        <RefreshCw className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden="true" />
        <span>Nova versão: entra ao trocar de tela</span>
        <button
          aria-label="Fechar aviso de nova versão"
          className="grid h-6 w-6 place-items-center rounded-full text-muted transition hover:bg-mist hover:text-navy"
          onClick={() => setDismissed(true)}
          type="button"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed left-4 right-4 top-[calc(0.75rem+env(safe-area-inset-top))] z-[140] mx-auto flex max-w-[520px] items-center justify-between gap-3 rounded-2xl border border-white/50 bg-white/95 px-4 py-3 text-sm font-bold text-navy shadow-premium backdrop-blur md:left-auto md:right-6 md:mx-0">
      <div className="flex min-w-0 items-center gap-3">
        <WifiOff className="h-5 w-5 shrink-0 text-brand" />
        <span className="min-w-0">Você está sem conexão. Dados privados não ficam disponíveis offline.</span>
      </div>
      <button
        aria-label="Fechar aviso de conexão"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-muted transition hover:bg-mist hover:text-navy"
        onClick={() => setDismissed(true)}
        type="button"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

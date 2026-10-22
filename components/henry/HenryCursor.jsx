"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CURSOR_CARD_MOVE_MS, CURSOR_CLICK_MS, CURSOR_FADE_MS, CURSOR_MOVE_MS, cursorTargetPoint, isAllowedHenryNavigation, navTargetPath } from "@/lib/henry-navigation-core.mjs";

// Cursor do Henry — "mostrar o caminho" (dono, 2026-10-22: "ele minimiza e me mostra o caminho indo pela página, os
// cliques; seria legal mostrar um mouse diferente simulando ele clicando na tela"). Montado junto do Henry (só o dono).
// Recebe um pedido de navegação { id, path, label, clientId? } já validado (lista fechada ou ficha de cliente):
//   1) aparece perto do ícone do Henry e desliza até o item do menu lateral (computador) ou da barra inferior (celular)
//      que leva à tela — coordenadas reais de [data-henry-target="<caminho>"] (ou do link com esse href);
//   2) "clica" (onda + leve afundar) e a navegação acontece;
//   3) ficha de cliente: desliza até o card [data-henry-client-id] e "clica" — a lista abre a ficha
//      (evento mm:henry-open-client; vindo de outra tela, o ?clientId= da URL já abre);
//   4) some com fade. Total ~1,2–2 s. Qualquer clique/tecla do dono cancela e navega na hora; movimento reduzido →
//      navega direto. Elemento escondido (menu recolhido etc.) → posição aproximada.
// Nada aqui decide o destino: só anima o que o servidor devolveu e a lista fechada permite.

const ACCENT = "#4FC3E0";
const GOLD = "#F3DCA6";
const OPEN_CLIENT_EVENT = "mm:henry-open-client";

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

function findVisible(selector) {
  for (const element of document.querySelectorAll(selector)) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth) return element;
  }
  return null;
}

function menuItemFor(path) {
  const target = navTargetPath(path);
  const safe = window.CSS?.escape ? window.CSS.escape(target) : target.replace(/"/g, "");
  return findVisible(`[data-henry-target="${safe}"]`) || findVisible(`nav a[href="${safe}"], aside a[href="${safe}"]`);
}

async function waitForCard(clientId, timeoutMs = 2500) {
  const safe = window.CSS?.escape ? window.CSS.escape(clientId) : clientId;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const card = findVisible(`[data-henry-client-id="${safe}"]`);
    if (card) return card;
    await wait(120);
  }
  return null;
}

// onNavigate (só a vitrine DEV) substitui o router.push para não sair da página de revisão.
export default function HenryCursor({ request = null, mobile = false, onNavigate = null }) {
  const router = useRouter();
  const [cursor, setCursor] = useState({ visible: false, x: 0, y: 0, pressing: false, ripple: 0 });
  const runRef = useRef(0);

  useEffect(() => {
    if (!request?.path || !isAllowedHenryNavigation(request.path)) return undefined;
    const run = runRef.current + 1;
    runRef.current = run;
    let cancelled = false;
    let navigated = false;
    const alive = () => !cancelled && runRef.current === run;
    const navigate = () => {
      if (navigated) return;
      navigated = true;
      if (onNavigate) onNavigate(request.path);
      else router.push(request.path);
    };
    const openClient = () => {
      if (request.clientId) window.dispatchEvent(new CustomEvent(OPEN_CLIENT_EVENT, { detail: { clientId: request.clientId } }));
    };
    // Dono mexeu: cancela a animação e vai direto.
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      navigate();
      openClient();
      setCursor((current) => ({ ...current, visible: false }));
    };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      navigate();
      openClient();
      return undefined;
    }
    window.addEventListener("pointerdown", cancel, true);
    window.addEventListener("keydown", cancel, true);
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const moveTo = async (point, ms = CURSOR_MOVE_MS) => {
      setCursor((current) => ({ ...current, x: point.x, y: point.y, moveMs: ms }));
      await wait(ms);
    };
    const click = async () => {
      setCursor((current) => ({ ...current, pressing: true, ripple: current.ripple + 1 }));
      await wait(140);
      setCursor((current) => ({ ...current, pressing: false }));
      await wait(CURSOR_CLICK_MS - 140);
    };
    (async () => {
      // Começa perto do ícone do Henry (canto inferior direito no computador; esquerdo no celular).
      const start = mobile ? { x: 60, y: viewport.height - 120 } : { x: viewport.width - 90, y: viewport.height - 90 };
      setCursor({ visible: true, x: start.x, y: start.y, pressing: false, ripple: 0, moveMs: 0 });
      await wait(60);
      if (!alive()) return;
      const alreadyThere = window.location.pathname === navTargetPath(request.path);
      if (!alreadyThere) {
        const item = menuItemFor(request.path);
        const point = cursorTargetPoint(item?.getBoundingClientRect(), viewport, { mobile });
        if (point) {
          await moveTo(point);
          if (!alive()) return;
          await click();
          if (!alive()) return;
        }
      }
      navigate();
      if (request.clientId) {
        const card = await waitForCard(request.clientId);
        if (!alive()) return;
        if (card) {
          const point = cursorTargetPoint(card.getBoundingClientRect(), viewport, { mobile, approx: false });
          if (point) {
            await moveTo(point, CURSOR_CARD_MOVE_MS);
            if (!alive()) return;
            await click();
          }
        }
        openClient();
      }
      if (!alive()) return;
      setCursor((current) => ({ ...current, visible: false }));
      window.removeEventListener("pointerdown", cancel, true);
      window.removeEventListener("keydown", cancel, true);
    })();
    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", cancel, true);
      window.removeEventListener("keydown", cancel, true);
    };
  }, [request, router, mobile, onNavigate]);

  return (
    <div
      aria-hidden="true"
      data-henry-cursor={cursor.visible ? "on" : "off"}
      className="pointer-events-none fixed left-0 top-0 z-[80]"
      style={{
        transform: `translate(${cursor.x}px, ${cursor.y}px)`,
        transition: `transform ${cursor.moveMs || 0}ms cubic-bezier(.22,.8,.24,1), opacity ${CURSOR_FADE_MS}ms ease-out`,
        opacity: cursor.visible ? 1 : 0
      }}
    >
      {/* Rastro/brilho */}
      <span className="absolute -left-4 -top-4 h-10 w-10 rounded-full blur-md" style={{ background: `radial-gradient(circle, ${ACCENT}88, transparent 70%)` }} />
      {/* Onda do clique */}
      {cursor.ripple ? (
        <span key={cursor.ripple} className="henry-cursor-ripple absolute -left-5 -top-5 h-10 w-10 rounded-full" style={{ border: `2px solid ${GOLD}` }} />
      ) : null}
      <svg width="28" height="32" viewBox="0 0 28 32" className="relative transition-transform duration-100" style={{ transform: cursor.pressing ? "scale(0.82)" : "scale(1)", transformOrigin: "2px 2px", filter: `drop-shadow(0 0 6px ${ACCENT}) drop-shadow(0 2px 4px rgba(0,0,0,.45))` }}>
        <defs>
          <linearGradient id="henry-cursor-fill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={ACCENT} />
            <stop offset="100%" stopColor={GOLD} />
          </linearGradient>
        </defs>
        <path d="M2 2 L2 26 L8.5 19.8 L13 29.5 L17.6 27.4 L13.2 17.8 L22 17.6 Z" fill="url(#henry-cursor-fill)" stroke="#07111F" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
      <style>{`@keyframes henry-cursor-ripple { from { transform: scale(.4); opacity: .95; } to { transform: scale(1.9); opacity: 0; } } .henry-cursor-ripple { animation: henry-cursor-ripple 420ms ease-out forwards; }`}</style>
    </div>
  );
}

export { OPEN_CLIENT_EVENT };

"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Acesso WhatsApp BLOQUEADO para o usuário logado (2026-10-04): quem renderiza botões/atalhos de WhatsApp (card do
// cliente, Disparar…) consulta isto e simplesmente NÃO renderiza — nada de botão desabilitado. O valor vem do servidor
// (app/admin/layout.jsx); o bloqueio de verdade está no backend (lib/admin-auth.js e lib/whatsapp-individual.js).
// `basic` (2026-10-05) = MODO BÁSICO: mesma chave, também esconde PDF/apresentação interativa da simulação (não vale para gestor).
const WhatsappAccessContext = createContext(false);
const BasicModeContext = createContext(false);
// `chatHidden` (PRO-15, 2026-10-15) = MODO LISTA IMPRESSA: WhatsApp desconectado (não banido/restrito) — atalhos do Chat
// não são renderizados. A barreira de verdade é o guard do servidor (lib/admin-auth.js).
// `undefined` = fora do provider (vitrine de desenvolvimento): quem usa useLiveChatHidden cai no valor da prop.
const ChatHiddenContext = createContext(undefined);

// Releitura do modo lista impressa enquanto o Chat está escondido (só corretor/associado, `liveCheck`).
const PRINTED_LIST_RECHECK_MS = 20_000;

// O layout do painel (Server Component) calcula `chatHidden` só quando é renderizado de novo — na navegação dentro do
// app instalado ele NÃO é recalculado, e o Chat ficava sumido depois de o WhatsApp reconectar até fechar e reabrir o app
// (PRO-15 diz "reconectou = tudo volta"). Aqui o valor do servidor é só o ponto de partida: a cada volta do app ao
// primeiro plano e, enquanto o Chat estiver escondido, a cada 20 s, relê o MESMO cálculo do servidor
// (`printedListMode` de /api/admin/whatsapp-individual/card-state, lib/whatsapp-manual-disconnect.js). Só apresentação:
// as APIs do Chat continuam barradas no servidor por requisição (requireAdminApi). Falha de leitura mantém o último
// estado conhecido, como o próprio layout (readChatHiddenForNav).
async function readPrintedListMode() {
  try {
    const response = await fetch("/api/admin/whatsapp-individual/card-state", { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    return typeof data?.printedListMode === "boolean" ? data.printedListMode : null;
  } catch {
    return null; // rede fora: mantém o estado atual (a barreira real é o servidor)
  }
}

function useLivePrintedListMode(initial, enabled) {
  const [hidden, setHidden] = useState(Boolean(initial));

  // Nova renderização do layout (refresh/navegação completa) traz o valor do servidor de novo.
  useEffect(() => { setHidden(Boolean(initial)); }, [initial]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let inFlight = false;
    const check = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      const next = await readPrintedListMode();
      inFlight = false;
      if (!cancelled && next !== null) setHidden(next);
    };
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
    };
  }, [enabled]);

  // Enquanto o Chat está escondido, confere de tempos em tempos: reconectou -> o Chat volta sem fechar o app.
  useEffect(() => {
    if (!enabled || !hidden) return undefined;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      if (document.visibilityState === "hidden") return;
      const next = await readPrintedListMode();
      if (!cancelled && next !== null) setHidden(next);
    }, PRINTED_LIST_RECHECK_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [enabled, hidden]);

  return hidden;
}

export function WhatsappAccessProvider({ blocked = false, basic = false, chatHidden = false, liveCheck = false, children }) {
  const liveChatHidden = useLivePrintedListMode(chatHidden, Boolean(liveCheck) && !blocked);
  return (
    <WhatsappAccessContext.Provider value={Boolean(blocked)}>
      <BasicModeContext.Provider value={Boolean(basic)}>
        <ChatHiddenContext.Provider value={liveChatHidden}>{children}</ChatHiddenContext.Provider>
      </BasicModeContext.Provider>
    </WhatsappAccessContext.Provider>
  );
}

export function useChatHidden() {
  return Boolean(useContext(ChatHiddenContext));
}

// Menus que também recebem `chatHidden` por prop (barra inferior, menu do topo): dentro do painel vale o valor vivo do
// provider; fora dele (vitrine), a prop.
export function useLiveChatHidden(fallback = false) {
  const value = useContext(ChatHiddenContext);
  return value === undefined ? Boolean(fallback) : value;
}

export function useWhatsappBlocked() {
  return useContext(WhatsappAccessContext);
}

export function useBasicMode() {
  return useContext(BasicModeContext);
}

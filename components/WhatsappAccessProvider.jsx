"use client";

import { createContext, useContext } from "react";

// Acesso WhatsApp BLOQUEADO para o usuário logado (2026-10-04): quem renderiza botões/atalhos de WhatsApp (card do
// cliente, Disparar…) consulta isto e simplesmente NÃO renderiza — nada de botão desabilitado. O valor vem do servidor
// (app/admin/layout.jsx); o bloqueio de verdade está no backend (lib/admin-auth.js e lib/whatsapp-individual.js).
// `basic` (2026-10-05) = MODO BÁSICO: mesma chave, também esconde PDF/apresentação interativa da simulação (não vale para gestor).
const WhatsappAccessContext = createContext(false);
const BasicModeContext = createContext(false);
// `chatHidden` (PRO-15, 2026-10-15) = MODO LISTA IMPRESSA: WhatsApp desconectado (não banido/restrito) — atalhos do Chat
// não são renderizados. A barreira de verdade é o guard do servidor (lib/admin-auth.js).
const ChatHiddenContext = createContext(false);

export function WhatsappAccessProvider({ blocked = false, basic = false, chatHidden = false, children }) {
  return (
    <WhatsappAccessContext.Provider value={Boolean(blocked)}>
      <BasicModeContext.Provider value={Boolean(basic)}>
        <ChatHiddenContext.Provider value={Boolean(chatHidden)}>{children}</ChatHiddenContext.Provider>
      </BasicModeContext.Provider>
    </WhatsappAccessContext.Provider>
  );
}

export function useChatHidden() {
  return useContext(ChatHiddenContext);
}

export function useWhatsappBlocked() {
  return useContext(WhatsappAccessContext);
}

export function useBasicMode() {
  return useContext(BasicModeContext);
}

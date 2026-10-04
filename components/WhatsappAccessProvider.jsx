"use client";

import { createContext, useContext } from "react";

// Acesso WhatsApp BLOQUEADO para o usuário logado (2026-10-04): quem renderiza botões/atalhos de WhatsApp (card do
// cliente, Disparar…) consulta isto e simplesmente NÃO renderiza — nada de botão desabilitado. O valor vem do servidor
// (app/admin/layout.jsx); o bloqueio de verdade está no backend (lib/admin-auth.js e lib/whatsapp-individual.js).
const WhatsappAccessContext = createContext(false);

export function WhatsappAccessProvider({ blocked = false, children }) {
  return <WhatsappAccessContext.Provider value={Boolean(blocked)}>{children}</WhatsappAccessContext.Provider>;
}

export function useWhatsappBlocked() {
  return useContext(WhatsappAccessContext);
}

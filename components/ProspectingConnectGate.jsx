"use client";

import { MessageCircle } from "lucide-react";

// Prospecção SÓ com WhatsApp conectado (regra do dono, 2026-10-02): corretor com a sessão
// desconectada vê só este aviso curto e a ação para conectar (o modal de conexão do cabeçalho).
export default function ProspectingConnectGate({ message }) {
  return (
    <section className="container-page">
      <div role="status" className="mx-auto max-w-xl rounded-[24px] border border-amber-200 bg-amber-50 p-8 text-center shadow-soft">
        <MessageCircle className="mx-auto h-8 w-8 text-amber-700" aria-hidden="true" />
        <p className="mt-3 text-lg font-black text-navy">{message}</p>
        <button
          type="button"
          className="premium-button-primary mt-5"
          onClick={() => window.dispatchEvent(new CustomEvent("crm:open-whatsapp-connect"))}
        >
          Conectar WhatsApp
        </button>
      </div>
    </section>
  );
}

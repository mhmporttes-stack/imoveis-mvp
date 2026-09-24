"use client";

import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";

import { FORM_COMPLETION_MESSAGE as MESSAGE } from "@/lib/whatsapp-form-completion.mjs";

// Botão da tela final do formulário: abre o WhatsApp oficial com a mensagem
// pronta. Quando o cliente escreve primeiro, a janela de 24h abre e o CRM
// consegue responder sem template. Se o número não estiver configurado, o
// botão simplesmente não aparece (o atendimento segue como antes).
export default function ReceiveSimulationWhatsappButton() {
  const [phone, setPhone] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/whatsapp-contact")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data?.phone) setPhone(data.phone);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!phone) return null;

  return (
    <div className="mx-auto mt-9 max-w-md">
      <a
        className="inline-flex min-h-[58px] w-full items-center justify-center gap-3 rounded-full bg-[#25D366] px-7 py-3 text-lg font-black text-white shadow-[0_18px_45px_rgba(37,211,102,0.25)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#1fb857] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#25D366]"
        href={`https://wa.me/${phone}?text=${encodeURIComponent(MESSAGE)}`}
        rel="noopener noreferrer"
        target="_blank"
      >
        <MessageCircle aria-hidden="true" className="h-6 w-6" />
        Receber minha simulação
      </a>
      <p className="mt-3 text-sm font-semibold leading-6 text-muted">
        Toque no botão e envie a mensagem no WhatsApp para agilizar o seu atendimento.
      </p>
    </div>
  );
}

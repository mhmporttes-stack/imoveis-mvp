"use client";

import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";

import { FORM_COMPLETION_MESSAGE as MESSAGE } from "@/lib/whatsapp-form-completion.mjs";
import { RECEIVE_CONTACT_STATE } from "@/lib/receive-simulation-contact.mjs";

// Enquanto o cadastro espera um corretor on-line (fila de espera da roleta),
// consulta de novo a cada 15 s por até ~10 min — depois disso para e mostra
// que o corretor vai chamar pelo WhatsApp.
const WAITING_POLL_MS = 15000;
const WAITING_MAX_ATTEMPTS = 40;

// Botão da tela final do formulário (WA-10, regra do dono 2026-10-01): abre o
// WhatsApp do corretor RESPONSÁVEL pelo cadastro recém-criado, inclusive o
// escolhido pela roleta. Sem responsável ainda (fila de espera), mostra o
// aviso de espera e consulta de novo; responsável sem WhatsApp válido mostra
// que o corretor vai chamar. Nunca abre um número "de reserva" (outro
// corretor, Matheus ou número oficial). Quando o cliente escreve primeiro,
// quem recebe já tem a mensagem pronta para responder.
export default function ReceiveSimulationWhatsappButton({ brokerRef = "", registrationId = "", accessToken = "" }) {
  const [contact, setContact] = useState({ state: "loading", phone: "" });
  const [gaveUpWaiting, setGaveUpWaiting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    let attempts = 0;

    const query = registrationId && accessToken
      ? `?registrationId=${encodeURIComponent(registrationId)}&token=${encodeURIComponent(accessToken)}`
      : brokerRef ? `?ref=${encodeURIComponent(brokerRef)}` : "";

    async function load() {
      attempts += 1;
      try {
        const response = await fetch(`/api/whatsapp-contact${query}`, { cache: "no-store" });
        const data = response.ok ? await response.json() : null;
        if (cancelled) return;
        if (data?.state === RECEIVE_CONTACT_STATE.READY && data.phone) {
          setContact({ state: RECEIVE_CONTACT_STATE.READY, phone: data.phone });
          return;
        }
        if (data?.state === RECEIVE_CONTACT_STATE.WAITING) {
          setContact({ state: RECEIVE_CONTACT_STATE.WAITING, phone: "" });
          if (attempts < WAITING_MAX_ATTEMPTS) timer = setTimeout(load, WAITING_POLL_MS);
          else setGaveUpWaiting(true);
          return;
        }
        setContact({ state: RECEIVE_CONTACT_STATE.UNAVAILABLE, phone: "" });
      } catch {
        if (!cancelled) setContact({ state: RECEIVE_CONTACT_STATE.UNAVAILABLE, phone: "" });
      }
    }

    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [brokerRef, registrationId, accessToken]);

  if (contact.state === "loading") return null;

  if (contact.state === RECEIVE_CONTACT_STATE.READY) {
    return (
      <div className="mx-auto mt-9 max-w-md">
        <a
          className="inline-flex min-h-[58px] w-full items-center justify-center gap-3 rounded-full bg-[#25D366] px-7 py-3 text-lg font-black text-white shadow-[0_18px_45px_rgba(37,211,102,0.25)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#1fb857] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#25D366]"
          href={`https://wa.me/${contact.phone}?text=${encodeURIComponent(MESSAGE)}`}
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

  const waiting = contact.state === RECEIVE_CONTACT_STATE.WAITING && !gaveUpWaiting;
  return (
    <div className="mx-auto mt-9 max-w-md rounded-3xl border border-line bg-slate-50 px-6 py-5" role="status">
      <p className="inline-flex items-center justify-center gap-2 text-base font-black text-navy">
        <MessageCircle aria-hidden="true" className="h-5 w-5 text-[#25D366]" />
        {waiting ? "Estamos direcionando você para um corretor" : "Seu corretor vai falar com você"}
      </p>
      <p className="mt-2 text-sm font-semibold leading-6 text-muted">
        {waiting
          ? "Assim que um corretor for definido, o botão do WhatsApp aparece aqui. Pode deixar esta página aberta."
          : "Ele vai entrar em contato pelo WhatsApp informado no cadastro para enviar a sua simulação."}
      </p>
    </div>
  );
}

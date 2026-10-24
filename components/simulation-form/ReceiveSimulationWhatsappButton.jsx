"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";

import {
  AUTO_OPEN_WHATSAPP_DELAY_MS,
  RECEIVE_CONTACT_STATE,
  buildReceiveContactQuery,
  buildReceiveSimulationWhatsappUrl,
  shouldAutoOpenWhatsapp
} from "@/lib/receive-simulation-contact.mjs";

// Enquanto o cadastro espera um corretor on-line (fila de espera da roleta),
// consulta de novo a cada 15 s por até ~10 min — depois disso para e mostra
// que o corretor vai chamar pelo WhatsApp.
const WAITING_POLL_MS = 15000;
const WAITING_MAX_ATTEMPTS = 40;

// Botão da tela final do formulário (WA-10). Desde 2026-10-09 (dono) abre o
// número OFICIAL (a rota devolve OFFICIAL_WHATSAPP_DIGITS); desde 2026-10-18
// (dono) a mensagem leva o código do atendimento do cadastro, e o webhook do
// oficial entrega a conversa ao corretor responsável (sem roleta, sem cliente
// novo — lib/whatsapp-contact-code.js). Os estados de espera/indisponível
// continuam tratados aqui (modo antigo da rota).
// Desde 2026-10-24 (dono, "Ir direto ao WhatsApp") o formulário passa `autoOpen`: com o link pronto, abre o MESMO link
// sozinho (location.href — funciona no iPhone, onde abrir janela sem toque é bloqueado); o botão fica como reserva.
// `alreadyOpened`: o formulário já mandou abrir o WhatsApp direto do botão "Enviar informações" e a troca de app não
// aconteceu — a tela vira só a reserva (não abre de novo sozinha, não mostra "Abrindo o WhatsApp…").
export default function ReceiveSimulationWhatsappButton({ brokerRef = "", registrationId = "", accessToken = "", autoOpen = false, alreadyOpened = false }) {
  const [contact, setContact] = useState({ state: "loading", phone: "" });
  const [gaveUpWaiting, setGaveUpWaiting] = useState(false);
  const openedRef = useRef(Boolean(alreadyOpened));

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    let attempts = 0;

    const query = buildReceiveContactQuery({ registrationId, accessToken, brokerRef });

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

  const whatsappUrl = contact.state === RECEIVE_CONTACT_STATE.READY ? buildReceiveSimulationWhatsappUrl(contact.phone, registrationId) : "";

  useEffect(() => {
    if (!whatsappUrl || !shouldAutoOpenWhatsapp({ autoOpen, state: contact.state, phone: contact.phone, alreadyOpened: openedRef.current })) return undefined;
    const timer = setTimeout(() => {
      openedRef.current = true;
      window.location.href = whatsappUrl;
    }, AUTO_OPEN_WHATSAPP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [autoOpen, contact.state, contact.phone, whatsappUrl]);

  if (contact.state === "loading") return null;

  if (contact.state === RECEIVE_CONTACT_STATE.READY) {
    return (
      <div className="mx-auto mt-9 max-w-md">
        {autoOpen && !alreadyOpened ? (
          <p className="mb-4 text-base font-black text-navy" role="status">Abrindo o WhatsApp…</p>
        ) : null}
        <a
          className="inline-flex min-h-[58px] w-full items-center justify-center gap-3 rounded-full bg-[#25D366] px-7 py-3 text-lg font-black text-white shadow-[0_18px_45px_rgba(37,211,102,0.25)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#1fb857] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#25D366]"
          href={whatsappUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          <MessageCircle aria-hidden="true" className="h-6 w-6" />
          {autoOpen ? "Abrir o WhatsApp" : "Receber minha simulação"}
        </a>
        <p className="mt-3 text-sm font-semibold leading-6 text-muted">
          {autoOpen
            ? "Se o WhatsApp não abrir sozinho, toque no botão. Depois é só enviar a mensagem pronta para receber a sua simulação."
            : "Toque no botão e envie a mensagem no WhatsApp para agilizar o seu atendimento."}
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

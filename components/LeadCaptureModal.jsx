"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MessageCircle, Phone, UserRound, X } from "lucide-react";
import { whatsappMessageLink } from "@/lib/format";

const SESSION_KEY = "mm_lead_capture_modal_state";
const SESSION_ENTERED_AT_KEY = "mm_lead_capture_modal_entered_at";
const DISPLAY_DELAY_MS = 30000;
const SCROLL_THRESHOLD = 0.5;
const WHATSAPP_HELP_MESSAGE = "Olá, gostaria de receber ajuda para encontrar um imóvel.";

export default function LeadCaptureModal() {
  const pathname = usePathname();
  const nameRef = useRef(null);
  const dialogRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isAdminRoute = pathname?.startsWith("/admin");
  const isSimulationRoute = pathname?.startsWith("/simulacao");
  const whatsappUrl = whatsappMessageLink(WHATSAPP_HELP_MESSAGE);

  useEffect(() => {
    if (isAdminRoute || isSimulationRoute || typeof window === "undefined") return undefined;
    if (readSessionValue(SESSION_KEY)) return undefined;

    const openModal = () => {
      if (readSessionValue(SESSION_KEY)) return;
      writeSessionValue(SESSION_KEY, "shown");
      setIsOpen(true);
    };

    const now = Date.now();
    const enteredAt = Number(readSessionValue(SESSION_ENTERED_AT_KEY)) || now;
    writeSessionValue(SESSION_ENTERED_AT_KEY, String(enteredAt));

    const timer = window.setTimeout(openModal, Math.max(DISPLAY_DELAY_MS - (now - enteredAt), 0));

    function handleScroll() {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollable <= 0) return;
      const progress = window.scrollY / scrollable;
      if (progress >= SCROLL_THRESHOLD) {
        window.clearTimeout(timer);
        openModal();
      }
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [isAdminRoute, isSimulationRoute, pathname]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => nameRef.current?.focus(), 80);

    function handleKeyDown(event) {
      if (event.key === "Escape") closeModal("closed");
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function closeModal(state = "closed") {
    writeSessionValue(SESSION_KEY, state);
    setIsOpen(false);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const phoneDigits = phone.replace(/\D/g, "");
    if (name.trim().length < 3) {
      setError("Informe seu nome completo.");
      return;
    }

    if (phoneDigits.length < 10 || phoneDigits.length > 11) {
      setError("Informe um telefone/WhatsApp válido.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone,
          pageUrl: window.location.href
        })
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || "Não foi possível enviar seus dados agora.");
      }

      writeSessionValue(SESSION_KEY, "submitted");
      setSuccess(result.message || "Cadastro realizado com sucesso. Em breve entraremos em contato.");
      setName("");
      setPhone("");
    } catch (submitError) {
      setError(submitError.message || "Não foi possível enviar seus dados agora.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isOpen || isAdminRoute || isSimulationRoute) return null;

  return (
    <div
      aria-labelledby="lead-capture-title"
      aria-modal="true"
      className="fixed inset-0 z-[120] grid place-items-center bg-[#03101F]/72 px-4 py-6 backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeModal("closed");
      }}
      role="dialog"
    >
      <div
        ref={dialogRef}
        className="relative max-h-[calc(100svh-48px)] w-full max-w-[540px] overflow-x-hidden overflow-y-auto rounded-[30px] border border-white/20 bg-white shadow-[0_34px_100px_rgba(3,16,31,0.36)] outline-none transition duration-300 motion-reduce:transition-none"
      >
        <button
          aria-label="Fechar cadastro"
          className="absolute right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-full bg-white/90 text-navy shadow-soft transition hover:-translate-y-0.5 hover:bg-white focus:outline-none focus:ring-4 focus:ring-brand/20"
          onClick={() => closeModal("closed")}
          type="button"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="relative h-44 overflow-hidden rounded-t-[30px] bg-navy sm:h-52">
          <Image
            src="/assets/hero-premium-casal.png"
            alt="Atendimento imobiliário Matheus Machado"
            fill
            sizes="(max-width: 640px) 100vw, 540px"
            className="object-cover object-[58%_center]"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#061A2F]/92 via-[#061A2F]/64 to-[#061A2F]/15" />
        </div>

        <div className="min-w-0 p-6 sm:p-8">
          <h2 id="lead-capture-title" className="max-w-full whitespace-nowrap text-[clamp(1rem,3.85vw,1.55rem)] font-black leading-tight text-navy">
            Quer ganhar tempo na sua busca?
          </h2>
          <p className="mt-3 max-w-full text-[clamp(0.84rem,2.5vw,1rem)] font-semibold leading-7 text-muted sm:whitespace-nowrap">
            Deixe seus dados e receba um atendimento rápido e objetivo.
          </p>

          <form onSubmit={handleSubmit} className="mt-7 grid gap-4">
            <label className="grid gap-2 font-extrabold text-ink">
              Nome completo
              <span className="flex min-h-14 items-center gap-3 rounded-2xl border border-line px-4 transition focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/10">
                <UserRound className="h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
                <input
                  ref={nameRef}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full bg-transparent py-3 text-base font-semibold outline-none"
                  placeholder="Seu nome"
                  required
                />
              </span>
            </label>

            <label className="grid gap-2 font-extrabold text-ink">
              Telefone / WhatsApp
              <span className="flex min-h-14 items-center gap-3 rounded-2xl border border-line px-4 transition focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/10">
                <Phone className="h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
                <input
                  inputMode="tel"
                  value={phone}
                  onChange={(event) => setPhone(maskBrazilianPhone(event.target.value))}
                  className="w-full bg-transparent py-3 text-base font-semibold outline-none"
                  placeholder="(14) 9 9840-7380"
                  required
                />
              </span>
            </label>

            {error ? (
              <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                {error}
              </p>
            ) : null}

            {success ? (
              <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
                {success}
              </p>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                disabled={isSubmitting}
                className="premium-button-primary disabled:cursor-not-allowed disabled:opacity-60"
                type="submit"
              >
                {isSubmitting ? "Enviando..." : "Receber atendimento"}
              </button>
              <a
                href={whatsappUrl}
                onClick={() => writeSessionValue(SESSION_KEY, "clicked-whatsapp")}
                target="_blank"
                rel="noopener noreferrer"
                className="premium-button-secondary gap-2"
              >
                <MessageCircle className="h-5 w-5" aria-hidden="true" />
                Falar pelo WhatsApp
              </a>
            </div>

            <p className="text-center text-xs font-semibold leading-6 text-muted">
              Ao enviar seus dados, você concorda com nossa{" "}
              <Link href="/politica-de-privacidade" className="font-extrabold text-brand hover:text-navy">
                Política de Privacidade
              </Link>
              .
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

function maskBrazilianPhone(value = "") {
  const digits = value.replace(/\D/g, "").slice(0, 11);

  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function readSessionValue(key) {
  try {
    return window.sessionStorage?.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeSessionValue(key, value) {
  try {
    window.sessionStorage?.setItem(key, value);
  } catch {
    // Some restricted browser contexts can block sessionStorage. The modal still works for the current page.
  }
}

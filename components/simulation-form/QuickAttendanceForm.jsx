"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Check, MessageCircle, Phone } from "lucide-react";
import PhoneInputStep from "@/components/simulation-form/PhoneInputStep";
import TextInputStep from "@/components/simulation-form/TextInputStep";
import { isValidBrazilianMobile, toBrazilianE164 } from "@/lib/phone-utils";
import { normalizePersonName } from "@/lib/name-utils";
import { readStoredCampaignId } from "@/lib/campaign-link-client";
import { trackMetaLead } from "@/lib/meta-pixel-client";

const NAME_STEP = { id: "fullName", title: "Nome", placeholder: "Seu nome completo", autoComplete: "name" };
const PHONE_STEP = { id: "phone", title: "WhatsApp", placeholder: "(00) 00000-0000", autoComplete: "tel" };

const PREFERENCE_OPTIONS = [
  { value: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { value: "call", label: "Ligação", icon: Phone }
];

export default function QuickAttendanceForm({ brokerRefOverride = "", onBack, journeySelected = "" }) {
  const searchParams = useSearchParams();
  const brokerRef = brokerRefOverride || searchParams.get("ref") || "";
  const campaignId = searchParams.get("c") || readStoredCampaignId();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [contactPreference, setContactPreference] = useState("whatsapp");
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleContinue() {
    if (submitting || done) return;

    const errors = {};
    if (normalizePersonName(fullName).length < 2) errors.fullName = "Informe seu nome.";
    if (!isValidBrazilianMobile(phone)) errors.phone = "Informe um WhatsApp válido com DDD.";
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setSubmitting(true);
    setSubmitError("");

    // eventId compartilhado entre o pixel do navegador e o envio server-side
    // (Conversions API) — mesma lógica de SimulationForm.jsx.
    const eventId = crypto.randomUUID();

    try {
      const response = await fetch("/api/simulation-registrations/quick-attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          phone,
          contactPreference,
          brokerRef,
          campaignId,
          metaEventId: eventId,
          attribution: {
            ...Object.fromEntries(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].map((key) => [key, searchParams.get(key) || ""])),
            ...(journeySelected ? { journey_selected: journeySelected } : {})
          }
        })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setSubmitError(data.error || "Não foi possível enviar seus dados. Tente novamente.");
        setSubmitting(false);
        return;
      }

      setDone(true);
      trackMetaLead({ phone: toBrazilianE164(phone), eventId });
    } catch {
      setSubmitError("Não foi possível enviar seus dados. Verifique sua conexão e tente novamente.");
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <article className="mx-auto w-full max-w-2xl rounded-[32px] border border-line bg-white p-8 text-center shadow-soft sm:p-10">
        <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <Check className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-[clamp(1.7rem,4vw,2.5rem)] font-black leading-tight text-navy">Tudo certo! ✓</h1>
        <p className="mx-auto mt-4 max-w-md text-base font-semibold leading-7 text-muted">
          {contactPreference === "call"
            ? "Recebemos seu contato. Um de nossos especialistas entrará em contato por ligação."
            : "Recebemos seu contato. Um de nossos especialistas falará com você em breve pelo WhatsApp."}
        </p>
      </article>
    );
  }

  return (
    <article className="mx-auto w-full max-w-2xl rounded-[32px] border border-line bg-white p-6 shadow-soft sm:p-8 lg:p-10">
      {onBack ? (
        <button
          className="inline-flex items-center gap-1.5 text-sm font-bold text-muted transition hover:text-brand"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Voltar
        </button>
      ) : null}

      <p className="mt-5 text-sm font-black uppercase tracking-[0.18em] text-brand">Atendimento rápido</p>
      <h1 className="mt-3 text-[clamp(1.7rem,4vw,2.5rem)] font-black leading-[1.05] text-navy">
        Deixe seu contato
      </h1>

      <div className="mt-7 space-y-5">
        <TextInputStep
          error={fieldErrors.fullName}
          onChange={(value) => { setFullName(value); setFieldErrors((current) => ({ ...current, fullName: "" })); }}
          step={NAME_STEP}
          value={fullName}
        />
        <PhoneInputStep
          error={fieldErrors.phone}
          onChange={(value) => { setPhone(value); setFieldErrors((current) => ({ ...current, phone: "" })); }}
          step={PHONE_STEP}
          value={phone}
        />

        <div>
          <p className="mb-2.5 text-sm font-black text-navy">Como prefere nosso contato?</p>
          <div className="grid grid-cols-2 gap-3">
            {PREFERENCE_OPTIONS.map((option) => {
              const selected = contactPreference === option.value;
              return (
                <button
                  key={option.value}
                  aria-pressed={selected}
                  className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3.5 text-sm font-black transition ${
                    selected ? "border-brand bg-blue-50 text-brand" : "border-line bg-white text-navy hover:border-brand/40"
                  }`}
                  onClick={() => setContactPreference(option.value)}
                  type="button"
                >
                  <option.icon className="h-4 w-4" aria-hidden="true" />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {submitError ? (
        <p className="mt-6 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 font-bold text-red-800">{submitError}</p>
      ) : null}

      <button
        className="premium-button-primary mt-8 w-full justify-center disabled:pointer-events-none disabled:opacity-70"
        disabled={submitting}
        onClick={handleContinue}
        type="button"
      >
        {submitting ? "Enviando..." : "Continuar"}
      </button>
    </article>
  );
}

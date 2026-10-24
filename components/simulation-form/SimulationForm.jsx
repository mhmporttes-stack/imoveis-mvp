"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";
import ChoiceStep from "@/components/simulation-form/ChoiceStep";
import CurrencyInputStep from "@/components/simulation-form/CurrencyInputStep";
import DateInputStep from "@/components/simulation-form/DateInputStep";
import PhoneInputStep from "@/components/simulation-form/PhoneInputStep";
import PropertyPreferencesFlow from "@/components/simulation-form/PropertyPreferencesFlow";
import PropertyPreferencesInvite from "@/components/simulation-form/PropertyPreferencesInvite";
import SimulationProgress from "@/components/simulation-form/SimulationProgress";
import SimulationSuccess from "@/components/simulation-form/SimulationSuccess";
import TextInputStep from "@/components/simulation-form/TextInputStep";
import { PROPERTY_PREFERENCE_STATUS } from "@/lib/property-preference-display";
import { persistCampaignId, readStoredCampaignId } from "@/lib/campaign-link-client";
import { incomeBracketLabel } from "@/lib/meta-pixel-shared";
import { trackMetaLead } from "@/lib/meta-pixel-client";
import {
  FORM_WHATSAPP_FALLBACK_MS,
  buildReceiveContactQuery,
  resolveFormWhatsappRedirect,
  shouldShowWhatsappFallback
} from "@/lib/receive-simulation-contact.mjs";
import {
  buildRegistrationSteps,
  getDefaultSimulationRegistration,
  sanitizeText,
  validateSimulationRegistration,
  validateStepValue
} from "@/lib/simulation-registration-schema";

const booleanOptions = [
  { value: true, label: "Sim" },
  { value: false, label: "Não" }
];

export default function SimulationForm({ brokerRefOverride = "", journeySelected = "" }) {
  const searchParams = useSearchParams();
  const initialType = searchParams.get("tipo") === "joint"
    ? "joint"
    : searchParams.get("tipo") === "individual"
      ? "individual"
      : "";
  const brokerRef = brokerRefOverride || searchParams.get("ref") || "";
  const campaignIdFromUrl = searchParams.get("c") || "";
  const campaignId = campaignIdFromUrl || readStoredCampaignId();

  useEffect(() => {
    if (campaignIdFromUrl) persistCampaignId(campaignIdFromUrl);
  }, [campaignIdFromUrl]);

  const [form, setForm] = useState(() => getDefaultSimulationRegistration(initialType));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [stepError, setStepError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [completionView, setCompletionView] = useState("form");
  const [registrationContext, setRegistrationContext] = useState({
    id: "",
    preferencesAccessToken: ""
  });
  const [firstName, setFirstName] = useState("");
  // "Abrindo o WhatsApp…" no próprio botão "Enviar informações" (WA-10b, dono 2026-10-24: "sem essa outra aba").
  const [openingWhatsapp, setOpeningWhatsapp] = useState(false);
  // A troca de app não aconteceu → a tela de reserva aparece sem abrir de novo sozinha.
  const [whatsappAlreadyOpened, setWhatsappAlreadyOpened] = useState(false);
  const advanceTimer = useRef(null);
  const fallbackCleanup = useRef(null);

  const steps = useMemo(() => buildRegistrationSteps(form), [form.simulationType]);
  const currentStep = steps[currentIndex] || steps[0];
  const isLastStep = currentIndex === steps.length - 1;

  useEffect(() => {
    if (currentIndex > steps.length - 1) {
      setCurrentIndex(Math.max(steps.length - 1, 0));
    }
  }, [currentIndex, steps.length]);

  useEffect(() => {
    return () => {
      if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
      if (fallbackCleanup.current) fallbackCleanup.current();
    };
  }, []);

  function updateField(field, value) {
    setStepError("");
    setSubmitError("");

    setForm((previous) => {
      return applyRegistrationFieldUpdate(previous, field, value);
    });
  }

  function handleChoiceChange(value) {
    const nextForm = applyRegistrationFieldUpdate(form, currentStep.id, value);
    const nextSteps = buildRegistrationSteps(nextForm);

    updateField(currentStep.id, value);

    if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
    advanceTimer.current = window.setTimeout(() => {
      setCurrentIndex((index) => {
        if (currentStep.id === "primaryMaritalStatus" && value === "married" && form.simulationType !== "joint") {
          const secondaryIncomeIndex = nextSteps.findIndex((step) => step.id === "secondaryIncomeType");
          if (secondaryIncomeIndex >= 0) return secondaryIncomeIndex;
        }

        const currentStepIndex = nextSteps.findIndex((step) => step.id === currentStep.id);
        const baseIndex = currentStepIndex >= 0 ? currentStepIndex : index;
        return Math.min(baseIndex + 1, nextSteps.length - 1);
      });
    }, 220);
  }

  function normalizeTextField(field) {
    setForm((previous) => ({
      ...previous,
      [field]: sanitizeText(previous[field])
    }));
  }

  function goBack() {
    setStepError("");
    setSubmitError("");
    setCurrentIndex((index) => Math.max(index - 1, 0));
  }

  async function goNext() {
    const normalizedForm = normalizeCurrentTextStep(form, currentStep);
    if (normalizedForm !== form) setForm(normalizedForm);

    const validationMessage = validateStepValue(currentStep, normalizedForm);
    if (validationMessage) {
      setStepError(validationMessage);
      return;
    }

    if (!isLastStep) {
      setStepError("");
      setSubmitError("");
      setCurrentIndex((index) => Math.min(index + 1, steps.length - 1));
      return;
    }

    await submitForm();
  }

  async function submitForm() {
    if (submitting) return;

    const validation = validateSimulationRegistration(form);
    if (!validation.ok) {
      moveToFirstInvalidStep(validation.fieldErrors);
      setSubmitError(validation.formError || "Revise as informações antes de enviar.");
      return;
    }

    setSubmitting(true);
    setSubmitError("");

    // eventId compartilhado entre o pixel do navegador e o envio server-side
    // (Conversions API) — a Meta usa isso para deduplicar o mesmo evento
    // vindo dos dois canais, em vez de contar a conversão duas vezes.
    const eventId = crypto.randomUUID();

    try {
      const response = await fetch("/api/simulation-registrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          brokerRef,
          campaignId,
          metaEventId: eventId,
          attribution: {
            ...Object.fromEntries(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].map(key => [key, searchParams.get(key) || ""])),
            ...(journeySelected ? { journey_selected: journeySelected } : {})
          }
        })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (data.fieldErrors) moveToFirstInvalidStep(data.fieldErrors);
        setSubmitError(data.error || "Não foi possível enviar seus dados. Tente novamente.");
        return;
      }

      const nextContext = {
        id: data.registrationId || "",
        preferencesAccessToken: data.preferencesAccessToken || ""
      };

      setRegistrationContext(nextContext);
      setFirstName(String(validation.data.fullName || "").trim().split(/\s+/)[0] || "");

      const totalIncome = validation.data.primaryMonthlyIncome + (validation.data.secondaryMonthlyIncome || 0);
      // Só conta lead na Meta quando virou cadastro novo no CRM (mesma regra do servidor). Antes de trocar de app; o
      // servidor também manda o Lead pela Conversions API com o mesmo eventId.
      if (data.isNewRegistration !== false) trackMetaLead({ phone: validation.data.phoneNormalized, eventId, incomeBracket: incomeBracketLabel(totalIncome) });

      // [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24] "Ir direto ao WhatsApp", refinada no mesmo dia: "ele deve abrir no
      // botão anterior já, sem informar, sem essa outra aba". Cadastro salvo → o próprio botão vira "Abrindo o WhatsApp…" e a
      // página vai na hora para o MESMO link do botão de reserva (a simulação chega por lá, SIM-AUTO-ENVIO). A tela
      // "Recebemos" com o botão de reserva só aparece se a troca de app não acontecer (~3 s com a página visível) ou nos
      // estados espera/indisponível da WA-10. O convite de preferências de imóvel não aparece neste caminho.
      setOpeningWhatsapp(true);
      await openWhatsappOrFallback(nextContext);
    } catch {
      setSubmitError("Não foi possível enviar seus dados. Verifique sua conexão e tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  // Cadastro JÁ salvo: nada aqui pode virar "não foi possível enviar seus dados". Qualquer falha ao descobrir o link leva à
  // tela de reserva, cujo botão consulta a rota de novo e mostra espera/indisponível (WA-10).
  async function openWhatsappOrFallback(context) {
    let url = "";
    try {
      const query = buildReceiveContactQuery({ registrationId: context.id, accessToken: context.preferencesAccessToken, brokerRef });
      const response = await fetch(`/api/whatsapp-contact${query}`, { cache: "no-store" });
      const contact = response.ok ? await response.json() : null;
      url = resolveFormWhatsappRedirect({ state: contact?.state, phone: contact?.phone, registrationId: context.id });
    } catch (error) {
      console.warn("WhatsApp do formulário: link não resolvido, mostrando a tela de reserva.", error?.message || error);
    }

    if (!url) {
      setOpeningWhatsapp(false);
      setCompletionView("success");
      return;
    }

    setWhatsappAlreadyOpened(true);
    window.location.href = url;
    watchWhatsappFallback();
  }

  // Se a página continuar visível ~3 s depois (WhatsApp não abriu) — ou quando o cliente voltar do WhatsApp — mostra a tela
  // com o botão de reserva "Abrir o WhatsApp".
  function watchWhatsappFallback() {
    if (fallbackCleanup.current) fallbackCleanup.current();
    let timer = null;
    const showFallback = () => {
      cleanup();
      setOpeningWhatsapp(false);
      setCompletionView("success");
    };
    const onVisibility = () => {
      if (shouldShowWhatsappFallback(document.visibilityState)) showFallback();
    };
    function cleanup() {
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      fallbackCleanup.current = null;
    }
    timer = window.setTimeout(() => {
      timer = null;
      if (shouldShowWhatsappFallback(document.visibilityState)) showFallback();
      else document.addEventListener("visibilitychange", onVisibility);
    }, FORM_WHATSAPP_FALLBACK_MS);
    fallbackCleanup.current = cleanup;
  }

  async function skipPreferences() {
    const { id, preferencesAccessToken } = registrationContext;

    if (id && preferencesAccessToken) {
      try {
        await fetch(`/api/simulation-registrations/${id}/preferences`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: PROPERTY_PREFERENCE_STATUS.IGNORED,
            token: preferencesAccessToken
          })
        });
      } catch {
        // A etapa de preferências é opcional; o cadastro principal já foi salvo.
      }
    }

    setCompletionView("success");
  }

  function moveToFirstInvalidStep(fieldErrors) {
    const firstInvalidIndex = steps.findIndex((step) => fieldErrors?.[step.id]?.length);
    if (firstInvalidIndex >= 0) {
      setCurrentIndex(firstInvalidIndex);
      setStepError(fieldErrors[steps[firstInvalidIndex].id][0]);
    }
  }

  if (completionView === "invite") {
    return <PropertyPreferencesInvite onSkip={skipPreferences} onStart={() => setCompletionView("preferences")} />;
  }

  if (completionView === "preferences") {
    return (
      <PropertyPreferencesFlow
        onComplete={() => setCompletionView("success")}
        onSkip={skipPreferences}
        registrationId={registrationContext.id}
        token={registrationContext.preferencesAccessToken}
      />
    );
  }

  if (completionView === "success") return <SimulationSuccess accessToken={registrationContext.preferencesAccessToken} autoOpenWhatsapp brokerRef={brokerRef} firstName={firstName} registrationId={registrationContext.id} whatsappAlreadyOpened={whatsappAlreadyOpened} />;

  return (
    <article className="mx-auto w-full max-w-3xl rounded-[32px] border border-line bg-white p-6 shadow-soft sm:p-8 lg:p-10">
      <SimulationProgress currentStep={currentIndex + 1} totalSteps={steps.length} />

      <div className="min-h-[390px]">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">
          Simulação imobiliária
        </p>
        <h2 className="mt-4 text-[clamp(1.8rem,4vw,3.25rem)] font-black leading-[1.05] text-navy">
          {currentStep.title}
        </h2>
        {currentStep.help ? <p className="mt-4 max-w-2xl text-base leading-7 text-muted">{currentStep.help}</p> : null}

        <div className="mt-8">
          <StepRenderer
            error={stepError}
            form={form}
            onBlurText={normalizeTextField}
            onChange={updateField}
            onChoiceChange={handleChoiceChange}
            step={currentStep}
          />
        </div>

        <div className="mt-8 rounded-2xl border border-blue-100 bg-blue-50/70 px-5 py-4 text-sm leading-6 text-muted">
          <div className="flex items-center gap-2 font-black text-navy">
            <ShieldCheck className="h-5 w-5 text-brand" aria-hidden="true" />
            Seus dados estão protegidos
          </div>
          <p className="mt-1">
            As informações serão usadas somente para analisar seu perfil e preparar um atendimento personalizado.
          </p>
        </div>

        {submitError ? (
          <p className="mt-5 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 font-bold text-red-800">
            {submitError}
          </p>
        ) : null}
      </div>

      <div className="mt-8 flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
        <button
          className="premium-button-secondary justify-center disabled:pointer-events-none disabled:opacity-40"
          disabled={currentIndex === 0 || submitting || openingWhatsapp}
          onClick={goBack}
          type="button"
        >
          <ArrowLeft className="mr-2 h-5 w-5" aria-hidden="true" />
          Voltar
        </button>

        <button
          className="premium-button-primary justify-center disabled:pointer-events-none disabled:opacity-70"
          disabled={submitting || openingWhatsapp}
          onClick={goNext}
          type="button"
        >
          {openingWhatsapp ? "Abrindo o WhatsApp…" : submitting ? "Enviando informações..." : isLastStep ? "Enviar informações" : "Continuar"}
          {!submitting && !openingWhatsapp ? <ArrowRight className="ml-2 h-5 w-5" aria-hidden="true" /> : null}
        </button>
      </div>
    </article>
  );
}

function StepRenderer({ error, form, onBlurText, onChange, onChoiceChange, step }) {
  const value = form[step.id];

  if (step.kind === "choice") {
    return <ChoiceStep error={error} onChange={onChoiceChange} options={step.options} value={value} />;
  }

  if (step.kind === "boolean") {
    return <ChoiceStep error={error} onChange={onChoiceChange} options={booleanOptions} value={value} />;
  }

  if (step.kind === "phone") {
    return <PhoneInputStep error={error} onChange={(nextValue) => onChange(step.id, nextValue)} step={step} value={value} />;
  }

  if (step.kind === "currency") {
    return <CurrencyInputStep error={error} onChange={(nextValue) => onChange(step.id, nextValue)} step={step} value={value} />;
  }

  if (step.kind === "date") {
    return <DateInputStep error={error} onChange={(nextValue) => onChange(step.id, nextValue)} step={step} value={value} />;
  }

  return (
    <div onBlur={() => onBlurText(step.id)}>
      <TextInputStep error={error} onChange={(nextValue) => onChange(step.id, nextValue)} step={step} value={value} />
    </div>
  );
}

function normalizeCurrentTextStep(form, step) {
  if (step.kind !== "text") return form;

  const nextValue = sanitizeText(form[step.id]);
  return nextValue === form[step.id] ? form : { ...form, [step.id]: nextValue };
}

function applyRegistrationFieldUpdate(previous, field, value) {
  const next = { ...previous, [field]: value };

  if (field === "primaryMaritalStatus" && value === "married") {
    next.simulationType = "joint";
  }

  if (field === "simulationType" && value === "individual") {
    if (previous.primaryMaritalStatus === "married") {
      next.simulationType = "joint";
      return next;
    }

    next.secondaryIncomeType = "";
    next.secondaryMonthlyIncome = "";
    next.secondaryMaritalStatus = "";
  }

  return next;
}

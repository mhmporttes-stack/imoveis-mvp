"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";
import ChoiceStep from "@/components/simulation-form/ChoiceStep";
import CurrencyInputStep from "@/components/simulation-form/CurrencyInputStep";
import DateInputStep from "@/components/simulation-form/DateInputStep";
import PhoneInputStep from "@/components/simulation-form/PhoneInputStep";
import SimulationProgress from "@/components/simulation-form/SimulationProgress";
import SimulationSuccess from "@/components/simulation-form/SimulationSuccess";
import TextInputStep from "@/components/simulation-form/TextInputStep";
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

export default function SimulationForm() {
  const searchParams = useSearchParams();
  const initialType = searchParams.get("tipo") === "joint"
    ? "joint"
    : searchParams.get("tipo") === "individual"
      ? "individual"
      : "";

  const [form, setForm] = useState(() => getDefaultSimulationRegistration(initialType));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [stepError, setStepError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const advanceTimer = useRef(null);

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
    };
  }, []);

  function updateField(field, value) {
    setStepError("");
    setSubmitError("");

    setForm((previous) => {
      const next = { ...previous, [field]: value };

      if (field === "simulationType" && value === "individual") {
        next.secondaryIncomeType = "";
        next.secondaryMonthlyIncome = "";
        next.secondaryMaritalStatus = "";
      }

      return next;
    });
  }

  function handleChoiceChange(value) {
    updateField(currentStep.id, value);

    if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
    advanceTimer.current = window.setTimeout(() => {
      setCurrentIndex((index) => Math.min(index + 1, buildRegistrationSteps({ ...form, [currentStep.id]: value }).length - 1));
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

    try {
      const response = await fetch("/api/simulation-registrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (data.fieldErrors) moveToFirstInvalidStep(data.fieldErrors);
        setSubmitError(data.error || "Não foi possível enviar seus dados. Tente novamente.");
        return;
      }

      setCompleted(true);
    } catch {
      setSubmitError("Não foi possível enviar seus dados. Verifique sua conexão e tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  function moveToFirstInvalidStep(fieldErrors) {
    const firstInvalidIndex = steps.findIndex((step) => fieldErrors?.[step.id]?.length);
    if (firstInvalidIndex >= 0) {
      setCurrentIndex(firstInvalidIndex);
      setStepError(fieldErrors[steps[firstInvalidIndex].id][0]);
    }
  }

  if (completed) return <SimulationSuccess />;

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
          disabled={currentIndex === 0 || submitting}
          onClick={goBack}
          type="button"
        >
          <ArrowLeft className="mr-2 h-5 w-5" aria-hidden="true" />
          Voltar
        </button>

        <button
          className="premium-button-primary justify-center disabled:pointer-events-none disabled:opacity-70"
          disabled={submitting}
          onClick={goNext}
          type="button"
        >
          {submitting ? "Enviando informações..." : isLastStep ? "Enviar informações" : "Continuar"}
          {!submitting ? <ArrowRight className="ml-2 h-5 w-5" aria-hidden="true" /> : null}
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

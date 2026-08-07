"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import ChoiceStep from "@/components/simulation-form/ChoiceStep";
import SimulationProgress from "@/components/simulation-form/SimulationProgress";
import {
  PROPERTY_PREFERENCE_STATUS,
  buildPropertyPreferenceSteps,
  getDefaultPropertyPreferences,
  validatePropertyPreferenceStep
} from "@/lib/property-preferences";

const booleanOptions = [
  { value: true, label: "Sim" },
  { value: false, label: "Não" }
];

function getVisiblePreferenceSteps(values) {
  return buildPropertyPreferenceSteps(values).filter((step) => step.kind !== "textarea");
}

export default function PropertyPreferencesFlow({ onComplete, registrationId, token }) {
  const [form, setForm] = useState(() => getDefaultPropertyPreferences());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [stepError, setStepError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const advanceTimer = useRef(null);
  const startedRef = useRef(false);

  const steps = useMemo(() => getVisiblePreferenceSteps(form), [form.rentsCurrently]);
  const currentStep = steps[currentIndex] || steps[0];

  useEffect(() => {
    if (currentIndex > steps.length - 1) {
      setCurrentIndex(Math.max(steps.length - 1, 0));
    }
  }, [currentIndex, steps.length]);

  useEffect(() => {
    if (!registrationId || !token || startedRef.current) return;
    startedRef.current = true;

    fetch(`/api/simulation-registrations/${registrationId}/preferences`, {
      body: JSON.stringify({ status: PROPERTY_PREFERENCE_STATUS.STARTED, token }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH"
    }).catch(() => {});
  }, [registrationId, token]);

  useEffect(() => {
    return () => {
      if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!saved) return undefined;

    const completionTimer = window.setTimeout(() => {
      onComplete();
    }, 1200);

    return () => window.clearTimeout(completionTimer);
  }, [onComplete, saved]);

  useEffect(() => {
    if (registrationId && token) return undefined;

    const fallbackTimer = window.setTimeout(() => {
      onComplete();
    }, 1600);

    return () => window.clearTimeout(fallbackTimer);
  }, [onComplete, registrationId, token]);

  function handleChoiceChange(value) {
    const nextForm = { ...form, [currentStep.id]: value };
    if (currentStep.id === "rentsCurrently" && value !== true) nextForm.rentPriceRange = "";

    setForm(nextForm);
    setStepError("");
    setSubmitError("");
    scheduleAutomaticAdvance(nextForm);
  }

  function handleMultiChange(field, value) {
    const nextForm = { ...form, [field]: [value] };

    setForm(nextForm);
    setStepError("");
    setSubmitError("");
    scheduleAutomaticAdvance(nextForm);
  }

  function scheduleAutomaticAdvance(nextForm) {
    if (advanceTimer.current) window.clearTimeout(advanceTimer.current);

    advanceTimer.current = window.setTimeout(() => {
      const nextSteps = getVisiblePreferenceSteps(nextForm);
      const activeStep = nextSteps[currentIndex] || nextSteps[0];
      const validationMessage = validatePropertyPreferenceStep(activeStep, nextForm);

      if (validationMessage) {
        setStepError(validationMessage);
        return;
      }

      if (currentIndex >= nextSteps.length - 1) {
        submitPreferences(nextForm, nextSteps);
        return;
      }

      setCurrentIndex((index) => Math.min(index + 1, nextSteps.length - 1));
    }, 260);
  }

  async function submitPreferences(preferences = form, activeSteps = steps) {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError("");

    try {
      const response = await fetch(`/api/simulation-registrations/${registrationId}/preferences`, {
        body: JSON.stringify({ preferences, token }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH"
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (data.fieldErrors) moveToFirstInvalidStep(data.fieldErrors, activeSteps);
        setSubmitError(data.error || "Não foi possível salvar suas preferências. Tente novamente.");
        return;
      }

      setSaved(true);
    } catch {
      setSubmitError("Não foi possível salvar suas preferências. Verifique sua conexão e tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  function moveToFirstInvalidStep(fieldErrors, activeSteps = steps) {
    const firstInvalidIndex = activeSteps.findIndex((step) => fieldErrors?.[step.id]?.length);
    if (firstInvalidIndex >= 0) {
      setCurrentIndex(firstInvalidIndex);
      setStepError(fieldErrors[activeSteps[firstInvalidIndex].id][0]);
    }
  }

  if (!registrationId || !token) {
    return (
      <article className="mx-auto w-full max-w-3xl rounded-[32px] border border-line bg-white p-6 text-center shadow-soft sm:p-8 lg:p-10">
        <h1 className="text-3xl font-black text-navy">Cadastro recebido.</h1>
        <p className="mx-auto mt-4 max-w-xl text-base font-semibold leading-7 text-muted">
          Não foi possível abrir as preferências agora, mas suas informações principais foram enviadas.
        </p>
        <p className="mt-6 text-sm font-black uppercase tracking-[0.18em] text-brand">
          Finalizando...
        </p>
      </article>
    );
  }

  if (saved) {
    return (
      <article className="mx-auto w-full max-w-3xl rounded-[32px] border border-line bg-white p-6 text-center shadow-soft sm:p-8 lg:p-10">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-blue-50 text-brand">
          <Check className="h-8 w-8" aria-hidden="true" />
        </div>
        <h1 className="mx-auto mt-7 max-w-2xl text-[clamp(2rem,4.4vw,3.3rem)] font-black leading-[1.04] text-navy">
          Preferências salvas com sucesso!
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base font-semibold leading-8 text-muted sm:text-lg">
          Agora seu corretor poderá selecionar opções mais compatíveis com o que você procura.
        </p>
        <p className="mt-6 text-sm font-black uppercase tracking-[0.18em] text-brand">
          Finalizando...
        </p>
      </article>
    );
  }

  return (
    <article className="mx-auto w-full max-w-3xl rounded-[32px] border border-line bg-white p-6 shadow-soft sm:p-8 lg:p-10">
      <SimulationProgress currentStep={currentIndex + 1} totalSteps={steps.length} />

      <div className="min-h-[390px]">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">
          Preferências do imóvel
        </p>
        <h2 className="mt-4 text-[clamp(1.8rem,4vw,3.15rem)] font-black leading-[1.05] text-navy">
          {currentStep.title}
        </h2>

        <div className="mt-8">
          <StepRenderer
            error={stepError}
            form={form}
            onChoiceChange={handleChoiceChange}
            onMultiChange={handleMultiChange}
            step={currentStep}
          />
        </div>

        <div className="mt-8 rounded-2xl border border-blue-100 bg-blue-50/70 px-5 py-4 text-sm leading-6 text-muted">
          <div className="flex items-center gap-2 font-black text-navy">
            <ShieldCheck className="h-5 w-5 text-brand" aria-hidden="true" />
            Essas respostas ajudam na curadoria
          </div>
          <p className="mt-1">
            Use suas preferências para receber opções mais próximas do imóvel que você procura.
          </p>
        </div>

        {submitting ? (
          <p className="mt-5 flex items-center justify-center gap-2 rounded-2xl border border-blue-100 bg-blue-50/70 px-5 py-4 text-sm font-black uppercase tracking-[0.16em] text-brand">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            Salvando preferências
          </p>
        ) : null}

        {submitError ? (
          <p className="mt-5 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 font-bold text-red-800">
            {submitError}
          </p>
        ) : null}
      </div>
    </article>
  );
}

function StepRenderer({ error, form, onChoiceChange, onMultiChange, step }) {
  const value = form[step.id];

  if (step.kind === "choice") {
    return <ChoiceStep error={error} onChange={onChoiceChange} options={step.options} value={value} />;
  }

  if (step.kind === "boolean") {
    return <ChoiceStep error={error} onChange={onChoiceChange} options={booleanOptions} value={value} />;
  }

  return (
    <MultiChoiceStep
      error={error}
      onChange={(nextValue) => onMultiChange(step.id, nextValue)}
      options={step.options}
      value={Array.isArray(value) ? value : []}
    />
  );
}

function MultiChoiceStep({ error, onChange, options = [], value = [] }) {
  return (
    <div className="grid gap-3">
      {options.map((option) => {
        const selected = value.includes(option.value);

        return (
          <button
            aria-pressed={selected}
            className={`group relative flex min-h-[88px] w-full items-center gap-4 rounded-[22px] border p-5 text-left transition duration-300 focus:outline-none focus:ring-4 focus:ring-brand/20 ${
              selected
                ? "border-brand bg-brand text-white shadow-[0_20px_45px_rgba(13,59,102,0.20)]"
                : "border-blue-100 bg-white text-navy shadow-[0_12px_28px_rgba(13,59,102,0.05)] hover:-translate-y-0.5 hover:border-brand hover:bg-blue-50/70 hover:shadow-soft"
            }`}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            <span
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl transition duration-300 ${
                selected ? "bg-white/15 text-white" : "bg-blue-50 text-brand group-hover:bg-white"
              }`}
            >
              <Check className="h-6 w-6" aria-hidden="true" />
            </span>
            <span className="block min-w-0 pr-8 text-[1.02rem] font-black leading-tight">
              {option.label}
            </span>
            <Check
              className={`absolute right-5 top-5 h-5 w-5 transition duration-300 ${selected ? "opacity-100" : "opacity-0"}`}
              aria-hidden="true"
            />
          </button>
        );
      })}
      {error ? <p className="text-sm font-bold text-red-700">{error}</p> : null}
    </div>
  );
}

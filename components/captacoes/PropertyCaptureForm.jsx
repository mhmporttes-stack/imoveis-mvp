"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Home, ImagePlus, Loader2, Plus, UploadCloud, X } from "lucide-react";
import {
  CAPTACAO_TYPE_OPTIONS,
  CURRENT_SITUATION_OPTIONS,
  EXCHANGE_OPTIONS,
  SALE_TIMELINE_OPTIONS
} from "@/lib/captacoes-schema";

const INITIAL_FORM = {
  ownerName: "",
  ownerPhone: "",
  ownerEmail: "",
  propertyType: "",
  propertyTypeOther: "",
  street: "",
  number: "",
  neighborhood: "",
  city: "Marília",
  state: "SP",
  intendedPrice: "",
  requestsEvaluation: false,
  saleTimeline: "",
  exchangeAcceptance: "",
  currentSituation: "",
  saleReason: "",
  notes: "",
  details: {},
  customDifferential: "",
  photoFiles: [],
  photos: []
};

const AUTO_ADVANCE_DELAY = 220;

const HOUSE_DIFFERENTIALS = [
  "Piscina",
  "Área gourmet",
  "Churrasqueira",
  "Móveis planejados",
  "Ar-condicionado",
  "Portão eletrônico",
  "Garagem coberta",
  "Energia solar",
  "Aquecimento solar",
  "Pé-direito alto",
  "Piso em porcelanato",
  "Banheira / hidromassagem",
  "Cozinha com ilha",
  "Quintal amplo",
  "Fechadura eletrônica",
  "Iluminação em LED",
  "Despensa",
  "Escritório / home office",
  "Sistema de segurança / câmeras",
  "Cerca elétrica"
];

const APARTMENT_DIFFERENTIALS = [
  "Sacada",
  "Varanda gourmet",
  "Churrasqueira na varanda",
  "Móveis planejados",
  "Ar-condicionado",
  "Fechadura eletrônica",
  "Vaga de garagem coberta",
  "Duas vagas de garagem",
  "Suíte",
  "Piso em porcelanato",
  "Cozinha integrada",
  "Cozinha com ilha",
  "Vista privilegiada",
  "Andar alto",
  "Sol da manhã",
  "Elevador",
  "Condomínio com piscina",
  "Academia no condomínio",
  "Salão de festas",
  "Portaria 24 horas"
];

export default function PropertyCaptureForm() {
  const searchParams = useSearchParams();
  const brokerRef = searchParams.get("ref") || "";
  const [form, setForm] = useState(INITIAL_FORM);
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const autoAdvanceTimer = useRef(null);

  const steps = useMemo(() => buildCaptureSteps(form.propertyType), [form.propertyType]);
  const currentStep = steps[stepIndex] || steps[0];
  const progress = Math.round(((stepIndex + 1) / steps.length) * 100);

  useEffect(() => {
    return () => {
      clearAutoAdvanceTimer();
    };
  }, []);

  function clearAutoAdvanceTimer() {
    if (autoAdvanceTimer.current) {
      clearTimeout(autoAdvanceTimer.current);
      autoAdvanceTimer.current = null;
    }
  }

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
  }

  function updateDetail(field, value) {
    setForm((current) => ({
      ...current,
      details: {
        ...current.details,
        [field]: value
      }
    }));
    setError("");
  }

  function toggleDetail(field) {
    setForm((current) => ({
      ...current,
      details: {
        ...current.details,
        [field]: !current.details?.[field]
      }
    }));
    setError("");
  }

  function toggleDifferential(label) {
    setForm((current) => {
      const currentList = Array.isArray(current.details?.differentials) ? current.details.differentials : [];
      const exists = currentList.includes(label);
      const nextList = exists ? currentList.filter((item) => item !== label) : [...currentList, label];

      return {
        ...current,
        details: {
          ...current.details,
          differentials: nextList
        }
      };
    });
    setError("");
  }

  function addCustomDifferential() {
    const label = form.customDifferential.trim().replace(/\s+/g, " ");
    if (!label) return;

    setForm((current) => {
      const currentList = Array.isArray(current.details?.differentials) ? current.details.differentials : [];
      const alreadyExists = currentList.some((item) => item.toLocaleLowerCase("pt-BR") === label.toLocaleLowerCase("pt-BR"));
      return {
        ...current,
        customDifferential: "",
        details: {
          ...current.details,
          differentials: alreadyExists ? currentList : [...currentList, label]
        }
      };
    });
    setError("");
  }

  function selectPropertyType(value) {
    const nextForm = {
      ...form,
      propertyType: value,
      propertyTypeOther: value === "outro" ? form.propertyTypeOther : "",
      details: {}
    };
    setForm(nextForm);
    setError("");
    if (value !== "outro") {
      scheduleAutoAdvance(nextForm, stepIndex);
    }
  }

  function scheduleAutoAdvance(nextForm, currentIndex) {
    const nextSteps = buildCaptureSteps(nextForm.propertyType);
    const step = nextSteps[currentIndex] || nextSteps[0];
    const message = validateStep(step, nextForm);
    if (message || step.id === "photos" || step.multiSelect) return;

    clearAutoAdvanceTimer();
    autoAdvanceTimer.current = setTimeout(() => {
      autoAdvanceTimer.current = null;
      setStepIndex((current) => Math.min(current + 1, buildCaptureSteps(nextForm.propertyType).length - 1));
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, AUTO_ADVANCE_DELAY);
  }

  function continueStep() {
    clearAutoAdvanceTimer();
    const message = validateStep(currentStep, form);
    if (message) {
      setError(message);
      return;
    }

    setError("");
    setStepIndex((current) => Math.min(current + 1, steps.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function previousStep() {
    clearAutoAdvanceTimer();
    setError("");
    setStepIndex((current) => Math.max(current - 1, 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleFiles(event) {
    const files = Array.from(event.target.files || []).slice(0, 20);
    update("photoFiles", files);
  }

  async function submit(event) {
    event.preventDefault();
    const message = validateStep(currentStep, form) || validateAll(form);
    if (message) {
      setError(message);
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const photos = await uploadPhotos(form.photoFiles);
      const submissionForm = { ...form };
      delete submissionForm.customDifferential;
      delete submissionForm.photoFiles;
      const response = await fetch("/api/captacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...submissionForm,
          brokerRef,
          photos,
          details: normalizeDetails(form.details)
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Nao foi possivel enviar seu imovel.");
      }

      setSuccess(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (submitError) {
      setError(submitError.message || "Nao foi possivel enviar seu imovel.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-[32px] border border-line bg-white p-8 text-center shadow-soft md:p-12">
        <div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-[#E9F2FF] text-brand">
          <Check className="h-10 w-10" aria-hidden="true" />
        </div>
        <h2 className="mt-8 text-[clamp(2rem,4vw,3.6rem)] font-black leading-tight text-navy">
          Cadastro de imóvel enviado com sucesso! ✅
        </h2>
        <p className="mx-auto mt-5 max-w-3xl text-lg leading-8 text-muted">
          Recebemos as informações e entraremos em contato para analisar seu imóvel.
        </p>
        <a href="/" className="premium-button-primary mt-8 inline-flex">
          Voltar para o site
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-[32px] border border-line bg-white p-6 shadow-soft md:p-10">
      <div className="flex items-center justify-between gap-4 text-sm font-black text-navy">
        <span>Etapa {stepIndex + 1} de {steps.length}</span>
        <span>{progress}%</span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#D9E9FA]">
        <div className="h-full rounded-full bg-brand transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>

      <div className="mt-9">
        <p className="text-sm font-black uppercase tracking-[0.22em] text-brand">{currentStep.eyebrow}</p>
        <h2 className="mt-3 text-[clamp(2rem,4vw,3.6rem)] font-black leading-[1.05] text-navy">{currentStep.title}</h2>
        {currentStep.description ? <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">{currentStep.description}</p> : null}
      </div>

      <div className="mt-8">
        {renderStep({
          step: currentStep,
          form,
          update,
          updateDetail,
          toggleDetail,
          toggleDifferential,
          addCustomDifferential,
          selectPropertyType,
          handleFiles
        })}
      </div>

      <div className="mt-8 rounded-2xl border border-blue-100 bg-[#F4F9FF] p-5 text-navy">
        <p className="font-black">Suas informações serão avaliadas com cuidado</p>
        <p className="mt-2 leading-7 text-muted">Usaremos os dados enviados apenas para analisar a captação e entrar em contato.</p>
      </div>

      {error ? (
        <p className="mt-5 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 font-bold text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-9 flex flex-col gap-3 border-t border-line pt-7 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={previousStep}
          disabled={stepIndex === 0 || isSubmitting}
          className="premium-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          Voltar
        </button>

        {stepIndex === steps.length - 1 ? (
          <button type="submit" disabled={isSubmitting} className="premium-button-primary disabled:cursor-wait disabled:opacity-75">
            {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <UploadCloud className="h-5 w-5" aria-hidden="true" />}
            {isSubmitting ? "Enviando informações..." : "Enviar imóvel"}
          </button>
        ) : (
          <button type="button" onClick={continueStep} className="premium-button-primary">
            Continuar
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>
    </form>
  );
}

function renderStep({ step, form, update, updateDetail, toggleDetail, toggleDifferential, addCustomDifferential, selectPropertyType, handleFiles }) {
  if (step.id === "type") {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {CAPTACAO_TYPE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => selectPropertyType(option.value)}
            className={`flex min-h-24 items-center gap-4 rounded-3xl border p-5 text-left transition duration-300 hover:-translate-y-0.5 hover:border-brand hover:bg-[#F4F9FF] ${
              form.propertyType === option.value ? "border-brand bg-[#E9F2FF] shadow-soft" : "border-line bg-white"
            }`}
          >
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#E9F2FF] text-brand">
              <Home className="h-6 w-6" aria-hidden="true" />
            </span>
            <span className="font-black text-navy">{option.label}</span>
          </button>
        ))}
        {form.propertyType === "outro" ? (
          <label className="grid gap-2 md:col-span-2 text-sm font-extrabold text-ink">
            Qual tipo de imóvel?
            <input className="admin-input" value={form.propertyTypeOther} onChange={(event) => update("propertyTypeOther", event.target.value)} placeholder="Ex.: Sobrado, galpão, ponto comercial" />
          </label>
        ) : null}
      </div>
    );
  }

  if (step.id === "address") {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Input label="Rua" value={form.street} onChange={(value) => update("street", value)} placeholder="Nome da rua" />
        <Input label="Número" value={form.number} onChange={(value) => update("number", value)} placeholder="Nº" />
        <Input label="Bairro" value={form.neighborhood} onChange={(value) => update("neighborhood", value)} placeholder="Ex.: Centro, Zona Norte" />
        <Input label="Cidade" value={form.city} onChange={(value) => update("city", value)} />
        <Input label="Estado" value={form.state} onChange={(value) => update("state", value.toUpperCase().slice(0, 2))} />
      </div>
    );
  }

  if (step.id === "details") {
    return <DetailsFields type={form.propertyType} details={form.details} updateDetail={updateDetail} toggleDetail={toggleDetail} />;
  }

  if (step.id === "differentials") {
    return (
      <DifferentialsStep
        type={form.propertyType}
        details={form.details}
        customDifferential={form.customDifferential}
        update={update}
        toggleDifferential={toggleDifferential}
        addCustomDifferential={addCustomDifferential}
      />
    );
  }

  if (step.id === "sale") {
    return (
      <div className="grid gap-5">
        <label className="flex items-center gap-3 rounded-2xl border border-line bg-white p-4 font-bold text-navy">
          <input
            type="checkbox"
            checked={form.requestsEvaluation}
            onChange={(event) => update("requestsEvaluation", event.target.checked)}
            className="h-5 w-5 accent-brand"
          />
          Quero solicitar avaliação de valor
        </label>
        {!form.requestsEvaluation ? (
          <Input label="Valor pretendido" value={form.intendedPrice} onChange={(value) => update("intendedPrice", value)} placeholder="R$ 450.000,00" inputMode="decimal" />
        ) : null}
        <Select label="Prazo desejado para venda" value={form.saleTimeline} onChange={(value) => update("saleTimeline", value)} options={SALE_TIMELINE_OPTIONS} />
        <Select label="Situação atual" value={form.currentSituation} onChange={(value) => update("currentSituation", value)} options={CURRENT_SITUATION_OPTIONS} />
        <Select label="Aceita permuta?" value={form.exchangeAcceptance} onChange={(value) => update("exchangeAcceptance", value)} options={EXCHANGE_OPTIONS} />
        <Input label="Motivo da venda" value={form.saleReason} onChange={(value) => update("saleReason", value)} placeholder="Ex.: mudança, investimento, compra de outro imóvel" />
      </div>
    );
  }

  if (step.id === "owner") {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Input label="Nome completo" value={form.ownerName} onChange={(value) => update("ownerName", value)} autoComplete="name" />
        <PhoneInput value={form.ownerPhone} onChange={(value) => update("ownerPhone", value)} />
        <Input label="E-mail" value={form.ownerEmail} onChange={(value) => update("ownerEmail", value)} type="email" autoComplete="email" placeholder="Opcional" />
        <label className="grid gap-2 md:col-span-2 text-sm font-extrabold text-ink">
          Observações
          <textarea
            value={form.notes}
            onChange={(event) => update("notes", event.target.value.slice(0, 500))}
            className="admin-input min-h-32 resize-y"
            maxLength={500}
            placeholder="Conte algum detalhe importante sobre o imóvel."
          />
        </label>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-dashed border-brand/35 bg-[#F4F9FF] p-6">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl bg-white px-6 py-10 text-center shadow-soft">
        <ImagePlus className="h-10 w-10 text-brand" aria-hidden="true" />
        <span className="text-lg font-black text-navy">Adicionar fotos do imóvel</span>
        <span className="max-w-xl text-sm leading-6 text-muted">Você pode enviar até 20 fotos. As imagens ajudam na avaliação e na preparação do cadastro.</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={handleFiles} />
      </label>
      {form.photoFiles.length ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          {form.photoFiles.map((file, index) => (
            <div key={`${file.name}-${index}`} className="rounded-2xl border border-line bg-white p-3 text-sm font-bold text-muted">
              {file.name}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DetailsFields({ type, details, updateDetail, toggleDetail }) {
  if (type === "terreno") {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Input label="Frente" value={details.front || ""} onChange={(value) => updateDetail("front", value)} placeholder="Ex.: 10 m" />
        <Input label="Profundidade" value={details.depth || ""} onChange={(value) => updateDetail("depth", value)} placeholder="Ex.: 25 m" />
        <Input label="Área total" value={details.totalArea || ""} onChange={(value) => updateDetail("totalArea", value)} placeholder="Ex.: 250" inputMode="decimal" />
        <Input label="Topografia" value={details.topography || ""} onChange={(value) => updateDetail("topography", value)} placeholder="Plano, aclive, declive" />
        <Checkbox label="Possui escritura" checked={details.hasDeed} onChange={() => toggleDetail("hasDeed")} />
      </div>
    );
  }

  if (type === "sala_comercial") {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Input label="Área" value={details.area || ""} onChange={(value) => updateDetail("area", value)} inputMode="decimal" />
        <Input label="Salas/ambientes" value={details.rooms || ""} onChange={(value) => updateDetail("rooms", value)} inputMode="numeric" />
        <Input label="Banheiros" value={details.bathrooms || ""} onChange={(value) => updateDetail("bathrooms", value)} inputMode="numeric" />
        <Input label="Vagas" value={details.parkingSpots || ""} onChange={(value) => updateDetail("parkingSpots", value)} inputMode="numeric" />
        <Input label="Condomínio" value={details.condoFee || ""} onChange={(value) => updateDetail("condoFee", value)} inputMode="decimal" />
        <Checkbox label="Está alugado" checked={details.isRented} onChange={() => toggleDetail("isRented")} />
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Input label="Quartos" value={details.bedrooms || ""} onChange={(value) => updateDetail("bedrooms", value)} inputMode="numeric" />
      <Input label="Suítes" value={details.suites || ""} onChange={(value) => updateDetail("suites", value)} inputMode="numeric" />
      <Input label="Banheiros" value={details.bathrooms || ""} onChange={(value) => updateDetail("bathrooms", value)} inputMode="numeric" />
      <Input label="Vagas" value={details.parkingSpots || ""} onChange={(value) => updateDetail("parkingSpots", value)} inputMode="numeric" />
      <Input label="Área construída" value={details.builtArea || ""} onChange={(value) => updateDetail("builtArea", value)} inputMode="decimal" />
      <Input label="Área total" value={details.totalArea || ""} onChange={(value) => updateDetail("totalArea", value)} inputMode="decimal" />
      <Checkbox label="Piscina" checked={details.hasPool} onChange={() => toggleDetail("hasPool")} />
      <Checkbox label="Churrasqueira" checked={details.hasBarbecue} onChange={() => toggleDetail("hasBarbecue")} />
      <Checkbox label="Elevador" checked={details.hasElevator} onChange={() => toggleDetail("hasElevator")} />
      <Checkbox label="Lazer completo" checked={details.hasLeisure} onChange={() => toggleDetail("hasLeisure")} />
    </div>
  );
}

function DifferentialsStep({ type, details = {}, customDifferential, update, toggleDifferential, addCustomDifferential }) {
  const selected = Array.isArray(details.differentials) ? details.differentials : [];
  const baseOptions = getDifferentialOptions(type);
  const customSelected = selected.filter((item) => !baseOptions.includes(item));

  return (
    <div className="grid gap-6">
      {baseOptions.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {baseOptions.map((option) => {
            const isSelected = selected.includes(option);
            return (
              <button
                key={option}
                type="button"
                onClick={() => toggleDifferential(option)}
                className={`flex min-h-16 items-center gap-3 rounded-2xl border px-4 py-3 text-left font-black transition duration-200 hover:-translate-y-0.5 hover:border-brand hover:bg-[#F4F9FF] ${
                  isSelected ? "border-brand bg-[#E9F2FF] text-navy shadow-soft" : "border-line bg-white text-ink"
                }`}
              >
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${isSelected ? "bg-brand text-white" : "bg-[#E9F2FF] text-brand"}`}>
                  <Check className="h-5 w-5" aria-hidden="true" />
                </span>
                <span>{option}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="rounded-2xl border border-blue-100 bg-[#F4F9FF] p-5 font-bold text-muted">
          Adicione abaixo os diferenciais mais importantes desse imóvel.
        </p>
      )}

      {customSelected.length ? (
        <div className="flex flex-wrap gap-2">
          {customSelected.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => toggleDifferential(item)}
              className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-[#E9F2FF] px-4 py-2 text-sm font-black text-navy transition hover:border-brand"
              aria-label={`Remover diferencial ${item}`}
            >
              {item}
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 rounded-3xl border border-line bg-[#F7FAFF] p-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <Input
          label="Adicionar outro diferencial"
          value={customDifferential}
          onChange={(value) => update("customDifferential", value)}
          placeholder="Ex.: edícula, pomar, depósito, vista livre"
        />
        <button type="button" onClick={addCustomDifferential} className="premium-button-secondary justify-center">
          <Plus className="h-5 w-5" aria-hidden="true" />
          Adicionar
        </button>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = "text", placeholder = "", inputMode = "text", autoComplete = "off" }) {
  return (
    <label className="grid gap-2 text-sm font-extrabold text-ink">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete}
        className="admin-input"
      />
    </label>
  );
}

function PhoneInput({ value, onChange }) {
  return (
    <label className="grid gap-2 text-sm font-extrabold text-ink">
      WhatsApp
      <div className="flex overflow-hidden rounded-2xl border border-line bg-white focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/10">
        <span className="grid min-h-14 place-items-center border-r border-line px-4 font-black text-navy">+55</span>
        <input
          type="tel"
          value={value}
          onChange={(event) => onChange(maskPhone(event.target.value))}
          placeholder="(14) 99999-9999"
          inputMode="numeric"
          autoComplete="tel"
          className="min-h-14 flex-1 bg-transparent px-4 text-base font-bold text-ink outline-none placeholder:font-semibold placeholder:text-muted"
        />
      </div>
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="grid gap-2 text-sm font-extrabold text-ink">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="admin-input">
        <option value="">Selecione</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function Checkbox({ label, checked, onChange }) {
  return (
    <label className="flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-white px-4 font-bold text-navy">
      <input type="checkbox" checked={Boolean(checked)} onChange={onChange} className="h-5 w-5 accent-brand" />
      {label}
    </label>
  );
}

function buildSteps(propertyType) {
  return [
    { id: "type", eyebrow: "Tipo do imóvel", title: "Qual imóvel você quer vender?", description: "Escolha a categoria para mostrarmos as próximas perguntas corretamente." },
    { id: "address", eyebrow: "Localização", title: "Onde fica o imóvel?", description: "Informe os dados principais do endereço para facilitar a análise." },
    { id: "details", eyebrow: "Características", title: propertyType ? "Conte os principais detalhes" : "Detalhes do imóvel", description: "Preencha o que souber. Depois você poderá complementar com o corretor." },
    { id: "sale", eyebrow: "Venda", title: "Como você pretende vender?", description: "Essas informações ajudam na avaliação comercial." },
    { id: "owner", eyebrow: "Contato", title: "Como podemos falar com você?", description: "Usaremos esse contato apenas para retornar sobre a captação." },
    { id: "photos", eyebrow: "Fotos", title: "Envie fotos do imóvel", description: "As fotos são opcionais, mas ajudam bastante na avaliação." }
  ];
}

function buildCaptureSteps(propertyType) {
  const steps = buildSteps(propertyType);
  const saleIndex = steps.findIndex((step) => step.id === "sale");
  const differentialStep = {
    id: "differentials",
    eyebrow: "Diferenciais do imóvel",
    title: "Quais diferenciais valorizam o imóvel?",
    description: "Selecione quantas opções quiser e adicione algum detalhe relevante para a captação.",
    multiSelect: true
  };

  if (saleIndex === -1) return [...steps, differentialStep];
  return [
    ...steps.slice(0, saleIndex),
    differentialStep,
    ...steps.slice(saleIndex)
  ];
}

function getDifferentialOptions(type) {
  if (type === "apartamento") return APARTMENT_DIFFERENTIALS;
  if (type === "casa") return HOUSE_DIFFERENTIALS;
  return [];
}

function validateStep(step, form) {
  if (step.id === "type") {
    if (!form.propertyType) return "Escolha o tipo do imóvel.";
    if (form.propertyType === "outro" && !form.propertyTypeOther.trim()) return "Informe o tipo do imóvel.";
  }
  if (step.id === "address") {
    if (!form.neighborhood.trim() || !form.city.trim() || !form.state.trim()) return "Informe pelo menos bairro, cidade e estado.";
  }
  if (step.id === "sale") {
    if (!form.requestsEvaluation && !form.intendedPrice.trim()) return "Informe o valor pretendido ou marque a opção de avaliação.";
  }
  if (step.id === "owner") {
    if (!form.ownerName.trim()) return "Informe seu nome.";
    if (!phoneDigits(form.ownerPhone)) return "Informe um WhatsApp válido com DDD e 9 dígitos.";
  }
  return "";
}

function validateAll(form) {
  for (const step of buildCaptureSteps(form.propertyType)) {
    const message = validateStep(step, form);
    if (message) return message;
  }
  return "";
}

async function uploadPhotos(files = []) {
  const uploaded = [];
  for (const file of files.slice(0, 20)) {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch("/api/uploads/captacoes", { method: "POST", body: formData });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Não foi possível enviar a imagem ${file.name}.`);
    }
    uploaded.push(payload);
  }
  return uploaded;
}

function normalizeDetails(details = {}) {
  return Object.fromEntries(
    Object.entries(details)
      .map(([key, value]) => [
        key,
        Array.isArray(value)
          ? [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))]
          : typeof value === "string"
            ? value.trim()
            : value
      ])
      .filter(([, value]) => value !== "" && value !== undefined && value !== null)
      .filter(([, value]) => !Array.isArray(value) || value.length > 0)
  );
}

function phoneDigits(value = "") {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 ? digits : "";
}

function maskPhone(value = "") {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length > 11) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : "";
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

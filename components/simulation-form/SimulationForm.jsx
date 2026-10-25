"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import CurrencyInputStep from "@/components/simulation-form/CurrencyInputStep";
import DateInputStep from "@/components/simulation-form/DateInputStep";
import { FichaChoice, FichaIcon, FichaPhone, FichaText } from "@/components/simulation-form/FichaFields";
import PropertyPreferencesFlow from "@/components/simulation-form/PropertyPreferencesFlow";
import PropertyPreferencesInvite from "@/components/simulation-form/PropertyPreferencesInvite";
import SimulationSuccess from "@/components/simulation-form/SimulationSuccess";
import styles from "@/components/simulation-form/SimulationForm.module.css";
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
  parseCurrencyNumber,
  validateStepValue
} from "@/lib/simulation-registration-schema";

const booleanOptions = [
  { value: true, label: "Sim" },
  { value: false, label: "Não" }
];

export default function SimulationForm({ brokerRefOverride = "", journeySelected = "", onExit = null }) {
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
  // Só apresentação (ficha escura, 2026-10-24): aviso do pulo "casado(a) → renda da 2ª pessoa", tremida do erro e foco
  // no título a cada pergunta (leitor de tela anuncia a pergunta nova).
  const [marriedNotice, setMarriedNotice] = useState(false);
  const [errorPulse, setErrorPulse] = useState(0);
  const titleRef = useRef(null);
  const firstRender = useRef(true);

  const steps = useMemo(() => buildRegistrationSteps(form), [form.simulationType]);
  const currentStep = steps[currentIndex] || steps[0];
  const isLastStep = currentIndex === steps.length - 1;

  useEffect(() => {
    if (currentIndex > steps.length - 1) {
      setCurrentIndex(Math.max(steps.length - 1, 0));
    }
  }, [currentIndex, steps.length]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    titleRef.current?.focus({ preventScroll: true });
  }, [currentIndex]);

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
      // Mesmo critério do pulo abaixo — só liga o aviso "casado(a) → renda da 2ª pessoa" (apresentação).
      if (currentStep.id === "primaryMaritalStatus" && value === "married" && form.simulationType !== "joint") setMarriedNotice(true);
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
      setErrorPulse((count) => count + 1);
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

  const chapter = chapterOf(currentStep.id);
  const sending = submitting || openingWhatsapp;
  const errorId = `simulation-${currentStep.id}-error`;
  const shownError = stepError ? teachingError(currentStep, form[currentStep.id], stepError) : "";
  const isFirstStep = currentIndex === 0;
  const chapterSteps = [0, 1, 2].map((index) => steps.filter((step) => chapterOf(step.id) === index));

  return (
    <div className={`${styles.root} ${sending ? styles.sending : ""}`}>
      <div aria-hidden="true" className={styles.stage}>
        <div className={styles.city} />
        <div className={styles.veil} />
        <div className={styles.tint} />
        <div className={styles.glow} />
        <svg className={styles.art} fill="none" preserveAspectRatio="xMidYMax slice" stroke="rgba(141,180,243,.28)" strokeWidth="1.2" viewBox="0 0 400 260">
          <path d="M18 260V150l70-62 70 62v110" /><path d="M34 260V157l54-48 54 48v103" /><rect height="20" width="20" x="58" y="176" /><rect height="20" width="20" x="98" y="176" /><path d="M76 260v-38h24v38" />
          <path d="M214 260V96h112v164" /><path d="M214 140h112M214 184h112M214 228h112M251 96v164M289 96v164" /><path d="M340 260V170h46v90" /><path d="M0 259.5h400" />
        </svg>
      </div>

      <div className={styles.shell}>
        <section aria-label="Simulação de financiamento" className={styles.col}>
          <header className={styles.top}>
            <div className={styles.brand}>
              <Image alt="" height={27} priority src="/assets/matheus-machado-symbol.png" width={34} />
              <span aria-hidden="true">
                <span className={styles.brandName}>MATHEUS MACHADO</span>
                <span className={styles.brandSub}>CORRETOR DE IMÓVEIS</span>
              </span>
              <span className={styles.sr}>Matheus Machado Corretor de Imóveis</span>
            </div>
            <span aria-hidden="true" className={styles.count}>{currentIndex + 1} de {steps.length}</span>
          </header>

          <nav aria-label={`Progresso: pergunta ${currentIndex + 1} de ${steps.length}, parte ${chapter + 1} de 3 (${CHAPTERS[chapter]})`} className={styles.progress}>
            <div aria-hidden="true" className={styles.bars}>
              {chapterSteps.map((list, index) => {
                const done = list.filter((step) => steps.indexOf(step) < currentIndex).length;
                const pct = index < chapter ? 100 : index > chapter ? 0 : Math.max(6, Math.round((done / Math.max(list.length, 1)) * 100));
                return <div className={styles.bar} key={CHAPTERS[index]}><i style={{ width: `${pct}%` }} /></div>;
              })}
            </div>
            <ol aria-hidden="true" className={styles.labels}>
              {CHAPTERS.map((name, index) => (
                <li data-state={index === chapter ? "on" : index < chapter ? "done" : ""} key={name}>{name}</li>
              ))}
            </ol>
          </nav>

          {isFirstStep ? (
            <div className={styles.intro}>
              <h1 className={styles.rise} style={{ "--d": "0.15s" }}>Descubra quanto você pode <span>financiar</span></h1>
              <p className={styles.rise} style={{ "--d": "0.25s" }}>Leva menos de 2 minutos.</p>
              <div aria-hidden="true" className={styles.who}>
                <span className={styles.halo} />
                <OrbitRings id="intro" />
                <span className={styles.pic}>
                  <Image alt="" fill priority sizes="(max-width: 1023px) 46vw, 1px" src="/assets/matheus-machado-bracos-cruzados-recorte.webp" />
                </span>
              </div>
            </div>
          ) : (
            <h1 className={styles.sr}>Simulação de financiamento</h1>
          )}

          <div className={styles.q}>
            {/* 1ª tela (dono, 2026-10-24): a pergunta fica só para leitor de tela; o título e as 2 opções bastam. */}
            <h2 className={isFirstStep ? styles.sr : styles.rise} id="simulation-question" key={`title-${currentStep.id}`} ref={titleRef} style={{ "--d": "0.05s" }} tabIndex={-1}>
              {currentStep.title}
            </h2>
            {currentStep.help ? <p className={`${styles.help} ${styles.rise}`} key={`help-${currentStep.id}`} style={{ "--d": "0.1s" }}>{currentStep.help}</p> : null}
            {marriedNotice && currentStep.id === "secondaryIncomeType" ? (
              <div className={`${styles.info} ${styles.rise}`} style={{ "--d": "0.2s" }}>
                {FichaIcon.info}
                <span>Como você é casado(a), a simulação passa a considerar também a renda da segunda pessoa.</span>
              </div>
            ) : null}

            <div className={`${styles.ctrl} ${stepError ? styles.shake : styles.rise}`} key={`ctrl-${currentStep.id}-${errorPulse}`} style={{ "--d": "0.14s" }}>
              <StepRenderer
                error={shownError}
                errorId={errorId}
                form={form}
                onBlurText={normalizeTextField}
                onChange={updateField}
                onChoiceChange={handleChoiceChange}
                onEnter={goNext}
                step={currentStep}
              />
            </div>

            {submitError ? (
              <div className={styles.notice} role="alert">
                {FichaIcon.alert}
                <span>{submitError}</span>
              </div>
            ) : null}
            {submitting ? (
              <p className={styles.sendingNote} role="status">
                <span aria-hidden="true" className={styles.spinner} />
                Enviando suas respostas. Não feche esta tela.
              </p>
            ) : null}
          </div>

          <div className={styles.grow} />
          <p className={styles.privacy}>
            {FichaIcon.lock}
            <span>Seus dados ficam protegidos. <Link href="/politica-de-privacidade" target="_blank">Política de privacidade</Link></span>
          </p>

          <div className={styles.actions}>
            <div className={styles.row}>
              {!isFirstStep || onExit ? (
                <button
                  aria-label="Voltar"
                  className={`${styles.btn} ${styles.back}`}
                  disabled={sending}
                  onClick={isFirstStep ? onExit : goBack}
                  type="button"
                >
                  {FichaIcon.back}
                </button>
              ) : null}
              <button
                aria-busy={sending ? "true" : undefined}
                className={`${styles.btn} ${styles.primary}`}
                disabled={sending}
                onClick={goNext}
                type="button"
              >
                {/* Cadastro recebido (cena de 2026-10-25, ~700 ms): ao virar "Abrindo o WhatsApp…" um check se desenha e o anel fecha.
                    Só apresentação: roda em paralelo, o redirecionamento (location.href) sai na mesma hora de antes. */}
                {openingWhatsapp ? (
                  <svg aria-hidden="true" className={styles.sentCheck} data-scene="sent" viewBox="0 0 24 24" fill="none">
                    <circle className={styles.sentRing} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" transform="rotate(-90 12 12)" />
                    <path className={styles.sentTick} d="M7.5 12.6l3.1 3.1 6-6.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : sending ? <span aria-hidden="true" className={styles.spinner} /> : null}
                {openingWhatsapp ? "Abrindo o WhatsApp…" : submitting ? "Enviando informações..." : isLastStep ? "Enviar informações" : "Continuar"}
                {!sending ? FichaIcon.next : null}
              </button>
            </div>
          </div>
        </section>

        {/* Computador: a cena do Matheus à direita, com o caminho Simule → Aprovação → Chaves. */}
        <aside aria-hidden="true" className={styles.aside}>
          <div className={styles.asideCity} />
          <div className={styles.asideVeil} />
          <OrbitRings id="aside" />
          <div className={styles.photo}>
            <Image alt="" fill sizes="(min-width: 1024px) 45vw, 1px" src="/assets/matheus-machado-bracos-cruzados-recorte.webp" />
          </div>
          <div className={styles.foot}>
            <p className={styles.eyebrow}>Do primeiro contato às chaves</p>
            <h3>Com alguém do seu lado em cada etapa.</h3>
            <div className={styles.track}>
              <div className={styles.dots}>
                <span className={`${styles.dot} ${styles.dotOn}`} />
                <span className={styles.ln} />
                <span className={styles.dot} />
                <span className={styles.ln} />
                <span className={styles.dot} />
              </div>
              <ol>
                <li><b>Simule</b><span className={styles.here}>Você está aqui</span></li>
                <li><b>Aprovação</b>Caixa e MCMV</li>
                <li><b>Chaves</b>Seu imóvel</li>
              </ol>
            </div>
            <span className={styles.creci}>{FichaIcon.shield}CRECI 323106-F</span>
          </div>
        </aside>
      </div>
    </div>
  );
}

// Partes da ficha para as barras de progresso (só apresentação; a ordem das perguntas vem de buildRegistrationSteps).
const CHAPTERS = ["Sobre você", "Sua renda", "Sua situação"];
const CHAPTER_BY_STEP = {
  simulationType: 0,
  fullName: 0,
  phone: 0,
  oldestBirthDate: 0,
  primaryIncomeType: 1,
  primaryMonthlyIncome: 1,
  secondaryIncomeType: 1,
  secondaryMonthlyIncome: 1
};
function chapterOf(stepId) {
  return CHAPTER_BY_STEP[stepId] ?? 2;
}

// Rótulo visível e dica de cada campo digitável (a pergunta continua sendo o título da tela).
const FIELD_COPY = {
  fullName: { label: "Nome completo" },
  phone: { label: "Celular com DDD", hint: "É por ele que vamos falar com você no WhatsApp." },
  oldestBirthDate: { label: "Data de nascimento", hint: "Toque no campo e escolha o dia no calendário." },
  primaryMonthlyIncome: { label: "Renda mensal", suffix: "por mês", hint: "Digite só os reais. Os centavos já ficam ,00." },
  secondaryMonthlyIncome: { label: "Renda mensal da segunda pessoa", suffix: "por mês", hint: "Digite só os reais. Os centavos já ficam ,00." },
  availablePurchaseResource: { label: "Valor disponível" }
};

const brl = (value) => Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Erros que ensinam (2026-10-24): a VALIDAÇÃO continua a de lib/simulation-registration-format.js (validateStepValue);
// aqui só se troca o texto curto por um que diz o que aconteceu e como corrigir. Mensagem desconhecida aparece como veio.
function teachingError(step, value, message) {
  if (message === "Escolha uma opção para continuar.") return "Toque em uma das opções acima para continuar.";

  if (step.kind === "phone") {
    const digits = String(value || "").replace(/\D/g, "");
    if (!digits) return "Digite o celular com DDD, como (14) 99812-3456.";
    if (digits.length < 11) {
      const missing = 11 - digits.length;
      return `Faltam ${missing} número${missing > 1 ? "s" : ""}. O celular tem DDD + 9 dígitos, como (14) 99812-3456.`;
    }
    if (digits.length === 11 && digits[2] !== "9") return "O celular começa com 9 depois do DDD, como (14) 99812-3456. Telefone fixo não recebe WhatsApp.";
    return "Confira o celular: DDD + 9 dígitos, como (14) 99812-3456.";
  }

  if (step.kind === "date") {
    if (message === "Informe uma data." || message === "Informe uma data válida.") return "Toque no campo e escolha o dia, o mês e o ano no calendário.";
    if (message === "A data não pode ser futura.") return "A data não pode ser no futuro. Confira o ano.";
    if (message === "É necessário ter pelo menos 18 anos.") return "Para simular o financiamento é preciso ter pelo menos 18 anos. Confira o ano.";
  }

  if (step.kind === "currency") {
    if (message === "renda não compativel") {
      const parsed = parseCurrencyNumber(value);
      const typed = Number.isFinite(parsed) ? `Você digitou ${brl(parsed)} por mês. ` : "";
      return `${typed}Para simular, a renda mensal precisa ser de pelo menos R$\u00a01.000,00. Faltou um número? Ex.:\u00a03.800.`;
    }
    if (message === "Informe um valor válido.") return "Digite o valor em reais, só com números. Ex.: 3.800.";
  }

  if (step.kind === "text" && step.id === "fullName") {
    if (message === "Campo obrigatório.") return "Digite seu nome completo para continuar.";
    if (message === "Informe uma resposta válida.") return "Use letras no nome, como está no seu documento.";
  }

  return message;
}

function OrbitRings({ id }) {
  const gradient = `simulation-orbit-${id}`;
  return (
    <svg aria-hidden="true" className={styles.orbit} fill="none" viewBox="0 0 200 200">
      <circle cx="100" cy="100" r="88" stroke="#8DB4F3" strokeOpacity=".28" strokeWidth="1" />
      <g className={styles.o1}><circle cx="100" cy="100" r="96" stroke="#8DB4F3" strokeDasharray="1.2 5" strokeLinecap="round" strokeOpacity=".5" strokeWidth=".9" /></g>
      <g className={styles.o2}>
        <circle cx="100" cy="100" r="88" stroke={`url(#${gradient})`} strokeDasharray="150 403" strokeLinecap="round" strokeWidth="2.2" />
        <circle cx="188" cy="100" fill="#fff" r="3.2" />
        <circle cx="188" cy="100" fill="#6FA8FA" opacity=".35" r="7" />
      </g>
      <g className={styles.o3}><circle cx="100" cy="100" r="80" stroke="#4C8DF6" strokeDasharray="40 120 12 330" strokeLinecap="round" strokeOpacity=".45" strokeWidth="1.2" /></g>
      <defs>
        <linearGradient id={gradient} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#4C8DF6" stopOpacity="0" />
          <stop offset="1" stopColor="#DCE8FC" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function StepRenderer({ error, errorId, form, onBlurText, onChange, onChoiceChange, onEnter, step }) {
  const value = form[step.id];
  const copy = FIELD_COPY[step.id] || {};

  if (step.kind === "choice") {
    return <FichaChoice error={error} errorId={errorId} labelledBy="simulation-question" onChange={onChoiceChange} options={step.options} value={value} />;
  }

  if (step.kind === "boolean") {
    return <FichaChoice error={error} errorId={errorId} labelledBy="simulation-question" onChange={onChoiceChange} options={booleanOptions} value={value} yesNo />;
  }

  if (step.kind === "phone") {
    return <FichaPhone error={error} errorId={errorId} hint={copy.hint} label={copy.label || step.title} onChange={(nextValue) => onChange(step.id, nextValue)} onEnter={onEnter} step={step} value={value} />;
  }

  if (step.kind === "currency") {
    return <CurrencyInputStep error={error} errorId={errorId} hint={copy.hint} label={copy.label} onChange={(nextValue) => onChange(step.id, nextValue)} onEnter={onEnter} step={step} suffix={copy.suffix} value={value} />;
  }

  if (step.kind === "date") {
    return <DateInputStep error={error} errorId={errorId} hint={copy.hint} label={copy.label} onChange={(nextValue) => onChange(step.id, nextValue)} step={step} value={value} />;
  }

  return (
    <FichaText
      error={error}
      errorId={errorId}
      hint={copy.hint}
      label={copy.label || step.title}
      onBlur={() => onBlurText(step.id)}
      onChange={(nextValue) => onChange(step.id, nextValue)}
      onEnter={onEnter}
      step={step}
      value={value}
    />
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

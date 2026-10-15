"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useBasicMode } from "@/components/WhatsappAccessProvider";
import { Check, GripVertical, Save, Search, Sparkles, Trash2 } from "lucide-react";
import { moveItem, useDragReorder } from "@/components/ui/useDragReorder";
import { coverImage, propertyCardFeatures, propertyRegion, propertyPrice, typeLabel } from "@/lib/format";
import { normalizePersonName } from "@/lib/name-utils";
import { buildExternalWhatsappUrl, detectDevice } from "@/lib/client-card-whatsapp-core.mjs";
import { withWhatsappText } from "@/lib/documents-forecast-core.mjs";
import { formatInterestRateInput, parseInterestRateInput } from "@/lib/interest-rate.mjs";
import { DEFAULT_RECOMMENDATION_REASON } from "@/lib/simulation-mapper";
import { getPropertyPreferenceDetails } from "@/lib/property-preference-display";
import {
  MARITAL_STATUS_OPTIONS,
  PRIMARY_INCOME_OPTIONS,
  SIMULATION_TYPE_OPTIONS
} from "@/lib/simulation-registration-format";
import {
  SIMULATION_MODEL_TYPES,
  enabledModelsFromModels,
  toggleSimulationModel,
  extractSimulationModelsFromNote,
  getPrimarySimulationModel,
  getRenderableSimulationModels,
  mergeSimulationModelsIntoNote,
  cleanTermMonths,
  normalizeSimulationModels,
  removeSimulationModelsFromNote,
  simulationModelLabel,
  simulationModelTotals
} from "@/lib/simulation-models";

const CLIENT_WHATSAPP_NOTE_PREFIX = "WhatsApp do cadastro:";

// Pedido do dono (2026-10-09): a simulação é enviada ao cliente só pelo LINK (apresentação interativa). Em 2026-10-15 o
// dono pediu para remover TUDO de gerar PDF/imagens da apresentação (botões, prévia de páginas e o gerador).
const SEND_FORMAT_OPTIONS = [
  { value: "presentation", label: "Link (apresentação)" }
];

const BENEFIT_OPTIONS = [
  "Documentação gratuita",
  "Entrada parcelada",
  "Entrada facilitada",
  "Possibilidade de uso do FGTS",
  "Imóvel pronto para morar",
  "Imóvel novo",
  "Casa não geminada",
  "Terreno inteiro",
  "Varanda",
  "Lazer completo",
  "Condomínio fechado",
  "IPTU isento",
  "Subsídio do Minha Casa Minha Vida",
  "Financiamento pela Caixa",
  "Menor desembolso inicial",
  "Parcelas compatíveis com a renda",
  "Potencial de valorização",
  "Boa localização",
  "Entrega programada",
  "Possibilidade de renda formal e informal",
  "Possibilidade de compor renda"
];

const RECOMMENDATION_REASONS = [
  DEFAULT_RECOMMENDATION_REASON,
  "Imóvel pensado para reduzir o custo imediato da compra.",
  "Melhor aproveitamento do subsídio disponível.",
  "Possibilidade de parcelamento da entrada.",
  "Compatível com o poder de compra apresentado.",
  "Boa relação entre valor e benefícios.",
  "Possibilidade de ampliar as opções utilizando entrada ou FGTS.",
  "Estratégia de compra com potencial de valorização."
];

const INITIAL_FORM = {
  registrationId: "",
  registration: null,
  clientName: "",
  clientWhatsApp: "",
  simulationDate: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()),
  simulationType: "usado",
  simulationModels: normalizeSimulationModels(),
  financingValue: "",
  subsidyValue: "",
  firstInstallment: "",
  lastInstallment: "",
  interestRateAnnual: "",
  downPaymentValue: "",
  fgtsValue: "",
  showExpandedPower: false,
  publicNote: "",
  internalNote: "",
  outputMode: "individual",
  properties: []
};

const SYNCED_MODEL_FIELDS = ["financingValue", "firstInstallment", "lastInstallment"];
const MODEL_PEER = { novo: "usado", usado: "novo" };

export default function SimulationGenerator({ properties = [], initialSimulation = null }) {
  const router = useRouter();
  // Modo básico (automação desativada, 2026-10-05): só lança/salva os valores — sem PDF, imagens, apresentação nem envio.
  const basicMode = useBasicMode();
  const [form, setForm] = useState(() => normalizeInitialSimulation(initialSimulation));
  // Preferências de imóvel que o cliente preencheu no formulário (dono, 2026-10-14): mostradas no topo da Etapa C.
  const clientPreferences = useMemo(() => getPropertyPreferenceDetails(initialSimulation?.registration?.propertyPreferences || {}), [initialSimulation]);
  const formRef = useRef(form);
  const autoSaveTimerRef = useRef(null);
  const autoSaveRequestRef = useRef(null);
  const lastSavedPayloadRef = useRef(JSON.stringify(serializeForm(form)));
  const syncingFieldsRef = useRef(createModelSyncState(form));
  // Caixas "Imóvel novo" / "Imóvel usado" (pedido do dono 2026-10-06): tipo desligado some da simulação, sem comparação.
  const [enabledModels, setEnabledModels] = useState(() => enabledModelsFromModels(form.simulationModels));
  const enabledModelsRef = useRef(enabledModels);
  enabledModelsRef.current = enabledModels;
  const [propertyQuery, setPropertyQuery] = useState("");
  const [sendFormat, setSendFormat] = useState("presentation");
  const [saving, setSaving] = useState(false);
  const [registrationSaving, setRegistrationSaving] = useState(false);
  const [sendingSimulation, setSendingSimulation] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState(form.id ? "saved" : "idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const normalizedModels = useMemo(() => normalizeSimulationModels(form.simulationModels, form), [form]);
  const interestRateCheck = useMemo(() => parseInterestRateInput(form.interestRateAnnual), [form.interestRateAnnual]);
  const modelTotals = useMemo(
    () => Object.fromEntries(
      SIMULATION_MODEL_TYPES.map(({ key }) => [key, simulationModelTotals(normalizedModels[key], form)])
    ),
    [form, normalizedModels]
  );
  const renderableModels = useMemo(
    () => getRenderableSimulationModels({ ...form, simulationModels: normalizedModels }),
    [form, normalizedModels]
  );

  const filteredProperties = useMemo(() => {
    const term = propertyQuery.trim().toLowerCase();
    return properties.filter((property) => {
      if (form.properties.some((item) => item.propertyId === property.id)) return false;
      const haystack = [property.name, property.builder, property.location, property.region, property.price, property.type].join(" ").toLowerCase();
      return !term || haystack.includes(term);
    });
  }, [form.properties, properties, propertyQuery]);

  useEffect(() => {
    formRef.current = form;
  }, [form]);

  useEffect(() => {
    if (!form.id) return undefined;

    const payload = JSON.stringify(serializeForm(form));
    if (payload === lastSavedPayloadRef.current) return undefined;

    setAutoSaveStatus("saving");
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);

    autoSaveTimerRef.current = window.setTimeout(() => {
      persistSimulation({ silent: true });
    }, 1000);

    return () => {
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    };
  }, [form]);

  useEffect(() => {
    if (!form.id) return undefined;

    function flushAutosave() {
      if (document.visibilityState === "hidden") {
        flushAutoSave(formRef.current);
      }
    }

    function beforeUnload() {
      flushAutoSave(formRef.current);
    }

    document.addEventListener("visibilitychange", flushAutosave);
    window.addEventListener("beforeunload", beforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", flushAutosave);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [form.id]);

  useEffect(() => {
    setForm((current) => {
      let changed = false;
      const nextProperties = current.properties.map((item) => {
        const sourceProperty = properties.find((property) => property.id === item.propertyId);
        if (!sourceProperty) return item;

        const sourceImage = coverImage(sourceProperty);
        const shouldHydrateImage = !item.imageUrl || (item.imageUrl === "/assets/hero-marilia.png" && sourceImage !== item.imageUrl);
        if (!shouldHydrateImage) return item;

        changed = true;
        return { ...item, imageUrl: sourceImage };
      });

      return changed ? { ...current, properties: nextProperties } : current;
    });
  }, [properties]);

  function update(field, value) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "clientName") {
        next.registration = {
          ...normalizeRegistrationDraft(current.registration, current),
          fullName: value
        };
      }
      if (field === "clientWhatsApp") {
        next.registration = {
          ...normalizeRegistrationDraft(current.registration, current),
          phone: value
        };
      }
      return next;
    });
  }

  function updateRegistration(field, value) {
    setForm((current) => {
      const registration = {
        ...normalizeRegistrationDraft(current.registration, current),
        [field]: value
      };

      return {
        ...current,
        registration,
        ...(field === "fullName" ? { clientName: value } : {}),
        ...(field === "phone" ? { clientWhatsApp: formatPhoneInput(value) } : {})
      };
    });
  }

  function updateSimulationModel(type, field, value) {
    setForm((current) => {
      const models = normalizeSimulationModels(current.simulationModels, current);
      // tipo desligado nas caixas não recebe a cópia automática (senão voltaria a aparecer no PDF/apresentação)
      const peerType = enabledModelsRef.current[MODEL_PEER[type]] === false ? null : MODEL_PEER[type];
      const syncState = syncingFieldsRef.current[field] || { linked: true, lastSource: "", lastValue: "" };
      const currentValue = models[type]?.[field] || "";
      const peerValue = peerType ? (models[peerType]?.[field] || "") : "";
      const editingSyncedPeer =
        isSyncedModelField(field) &&
        syncState.linked &&
        syncState.lastSource &&
        syncState.lastSource !== type &&
        currentValue === peerValue &&
        currentValue === syncState.lastValue &&
        value !== currentValue;

      if (editingSyncedPeer) {
        syncingFieldsRef.current[field] = { ...syncState, linked: false };
        return {
          ...current,
          simulationType: type,
          simulationModels: {
            ...models,
            [type]: {
              ...models[type],
              [field]: value
            }
          }
        };
      }

      if (isSyncedModelField(field) && peerType && syncState.linked) {
        syncingFieldsRef.current[field] = { linked: true, lastSource: type, lastValue: value };
        return {
          ...current,
          simulationType: type,
          simulationModels: {
            ...models,
            [type]: {
              ...models[type],
              [field]: value
            },
            [peerType]: {
              ...models[peerType],
              [field]: value
            }
          }
        };
      }

      return {
        ...current,
        simulationType: type,
        simulationModels: {
          ...models,
          [type]: {
            ...models[type],
            [field]: value
          }
        }
      };
    });
  }

  // SAC (2026-10-08, opcional, raro): mesmos 4 campos do Price, independentes (sem a cópia automática entre novo e usado).
  function updateSacModel(type, field, value) {
    setForm((current) => {
      const models = normalizeSimulationModels(current.simulationModels, current);
      return {
        ...current,
        simulationType: type,
        simulationModels: { ...models, [type]: { ...models[type], sac: { ...models[type].sac, [field]: value } } }
      };
    });
  }

  function setModelEnabled(type, on) {
    const current = normalizeSimulationModels(formRef.current.simulationModels, formRef.current);
    const result = toggleSimulationModel(current, enabledModelsRef.current, type, on);
    if (!result) return; // nunca os dois desligados
    setEnabledModels(result.enabled);
    const remaining = SIMULATION_MODEL_TYPES.find(({ key }) => result.enabled[key])?.key || "novo";
    // os valores já estão no formato da tela: copia como estão (sem reformatar)
    setForm((form) => ({ ...form, simulationType: on ? type : remaining, simulationModels: result.models }));
  }

  function addProperty(property) {
    const snapshot = propertySnapshot(property, form.properties.length);
    setForm((current) => ({ ...current, properties: [...current.properties, snapshot] }));
  }

  function removeProperty(index) {
    setForm((current) => ({
      ...current,
      properties: current.properties.filter((_, itemIndex) => itemIndex !== index)
    }));
  }

  // Arrastar para reordenar (pedido do dono, 2026-10-09): imóvel da posição `from` para `to`.
  function moveProperty(from, to) {
    setForm((current) => ({ ...current, properties: moveItem(current.properties, from, to).map((item, displayOrder) => ({ ...item, displayOrder })) }));
  }

  function updateSelectedProperty(index, field, value) {
    setForm((current) => ({
      ...current,
      properties: current.properties.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item)
    }));
  }

  function toggleBenefit(propertyIndex, benefitText) {
    setForm((current) => ({
      ...current,
      properties: current.properties.map((property, itemIndex) => {
        if (itemIndex !== propertyIndex) return property;
        const exists = property.benefits.some((benefit) => benefit.text === benefitText);
        const benefits = exists
          ? property.benefits.filter((benefit) => benefit.text !== benefitText)
          : [...property.benefits, { text: benefitText, isCustom: false, displayOrder: property.benefits.length }];
        return { ...property, benefits: benefits.map((benefit, displayOrder) => ({ ...benefit, displayOrder })) };
      })
    }));
  }

  function addCustomBenefit(propertyIndex, text) {
    const value = text.trim();
    if (!value) return;
    setForm((current) => ({
      ...current,
      properties: current.properties.map((property, itemIndex) => {
        if (itemIndex !== propertyIndex) return property;
        return {
          ...property,
          customBenefitDraft: "",
          benefits: [...property.benefits, { text: value, isCustom: true, displayOrder: property.benefits.length }]
        };
      })
    }));
  }

  function moveBenefit(propertyIndex, from, to) {
    setForm((current) => ({
      ...current,
      properties: current.properties.map((property, itemIndex) => {
        if (itemIndex !== propertyIndex) return property;
        return { ...property, benefits: moveItem(property.benefits, from, to).map((benefit, displayOrder) => ({ ...benefit, displayOrder })) };
      })
    }));
  }

  function removeBenefit(propertyIndex, benefitIndex) {
    setForm((current) => ({
      ...current,
      properties: current.properties.map((property, itemIndex) => {
        if (itemIndex !== propertyIndex) return property;
        const benefits = property.benefits
          .filter((_, index) => index !== benefitIndex)
          .map((benefit, displayOrder) => ({ ...benefit, displayOrder }));
        return { ...property, benefits };
      })
    }));
  }

  async function saveSimulation() {
    return persistSimulation();
  }

  /*
    setSaving(true);
    setError("");
    setMessage("");

    const endpoint = form.id ? `/api/simulations/${form.id}` : "/api/simulations";
    const method = form.id ? "PUT" : "POST";
    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serializeForm(form))
    });
    const data = await response.json();
    setSaving(false);

    if (!response.ok) {
      setError(data.error || "Não foi possível salvar a simulação.");
      return;
    }

    setMessage("Simulação salva com sucesso.");
    if (!form.id && data.id) router.replace(`/admin/simulacoes/${data.id}`);
    router.refresh();
  }

  */

  async function persistSimulation({ silent = false } = {}) {
    const currentForm = formRef.current;
    const formToSave = currentForm;
    const payload = JSON.stringify(serializeForm(formToSave));
    const endpoint = currentForm.id ? `/api/simulations/${currentForm.id}` : "/api/simulations";
    const method = currentForm.id ? "PUT" : "POST";

    // Taxa de juros digitada e inválida: o clique em Salvar avisa em vez de gravar sem ela (o autosave só a omite).
    const interestCheck = parseInterestRateInput(formToSave.interestRateAnnual);
    if (!interestCheck.ok && !silent) {
      setError(interestCheck.error);
      return null;
    }

    if (payload === lastSavedPayloadRef.current) {
      setAutoSaveStatus("saved");
      if (!silent) setMessage("Simulacao salva com sucesso.");
      return currentForm;
    }

    if (silent && autoSaveRequestRef.current) {
      return null;
    }

    if (!silent) {
      setSaving(true);
      setError("");
      setMessage("");
    }

    const request = fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: payload
    }).then(async (response) => ({
      data: await response.json().catch(() => ({})),
      response
    }));

    autoSaveRequestRef.current = request;

    try {
      const { data, response } = await request;

      if (!response.ok) {
        if (silent) {
          setAutoSaveStatus("error");
        } else {
          setError(data.error || "Nao foi possivel salvar a simulacao.");
        }
        return null;
      }

      lastSavedPayloadRef.current = payload;
      setAutoSaveStatus("saved");
      if (!silent) setMessage("Simulacao salva com sucesso.");
      // Coluna da taxa de juros ainda não existe no banco: o resto foi salvo, mas a taxa não (aviso claro, nada some em silêncio).
      if (data?.saveWarning) setError(data.saveWarning);

      if (data?.id || data?.registrationId || data?.registration) {
        setForm((current) => {
          const nextRegistration = data.registration
            ? normalizeRegistrationDraft(data.registration, data, current.clientWhatsApp)
            : current.registration;
          const next = {
            ...current,
            id: data.id || current.id,
            registrationId: data.registrationId || current.registrationId,
            registration: nextRegistration,
            clientName: data.clientName || current.clientName
          };
          return JSON.stringify(next) === JSON.stringify(current) ? current : next;
        });
      }

      if (!currentForm.id && data.id) {
        router.replace(`/admin/simulacoes/${data.id}`);
      }

      return data;
    } catch {
      if (silent) {
        setAutoSaveStatus("error");
      } else {
        setError("Nao foi possivel salvar a simulacao.");
      }
      return null;
    } finally {
      if (autoSaveRequestRef.current === request) autoSaveRequestRef.current = null;
      if (!silent) setSaving(false);
    }
  }

  async function saveClientRegistration() {
    const currentForm = formRef.current;
    const registration = normalizeRegistrationDraft(currentForm.registration, currentForm, currentForm.clientWhatsApp);
    setRegistrationSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/simulation-registrations/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...registration,
          registrationId: currentForm.registrationId,
          fullName: currentForm.clientName || registration.fullName,
          phone: currentForm.clientWhatsApp || registration.phone,
          includeDetails: true
        })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || "Nao foi possivel salvar o cadastro do cliente.");
        return null;
      }

      setForm((current) => ({
        ...current,
        registrationId: data.id,
        registration: normalizeRegistrationDraft(data, current, current.clientWhatsApp),
        clientName: data.fullName || current.clientName,
        clientWhatsApp: formatPhoneInput(data.phoneNormalized || data.phone || current.clientWhatsApp)
      }));
      setMessage("Cadastro do cliente salvo.");
      return data;
    } catch {
      setError("Nao foi possivel salvar o cadastro do cliente.");
      return null;
    } finally {
      setRegistrationSaving(false);
    }
  }

  function flushAutoSave(currentForm) {
    if (!currentForm?.id) return;
    const payload = JSON.stringify(serializeForm(currentForm));
    if (payload === lastSavedPayloadRef.current) return;
    lastSavedPayloadRef.current = payload;

    fetch(`/api/simulations/${currentForm.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true
    }).catch(() => {});
  }

  async function sendSimulationToWhatsApp() {
    const phone = normalizeClientWhatsApp(form.clientWhatsApp);
    if (!phone) {
      setError("Informe um WhatsApp válido do cliente antes de enviar a simulação.");
      setMessage("");
      return;
    }

    // PDF/imagem foram removidos (dono, 2026-10-15): a simulação vai só pelo link da apresentação interativa.
    await sendPresentationToWhatsApp();
  }

  // "Enviar simulação" (regra do dono, 2026-10-11 — substitui a de 2026-10-09):
  //  1) o cliente INICIOU conversa no número OFICIAL e a janela de 24 h está aberta -> envia direto pelo Chat (imagem + botão
  //     "Visualizar simulação") e abre a conversa;
  //  2) senão -> abre o WhatsApp do PRÓPRIO corretor (app no celular/PWA, WhatsApp Web no computador) com SÓ o link (sem
  //     texto: com texto junto a prévia não carrega) — o app dele monta a prévia, o que o envio pelo Chat no pessoal não faz.
  async function sendPresentationToWhatsApp() {
    if (!form.id) {
      setError("Salve a simulação antes de enviar a apresentação.");
      setMessage("");
      return;
    }
    setSendingSimulation(true);
    setError("");
    setMessage("");
    const endpoint = `/api/admin/simulacoes/${encodeURIComponent(form.id)}/apresentacao`;
    const post = (action) => fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    });

    try {
      const saved = await persistSimulation();
      if (!saved) throw new Error("Salve a simulação antes de enviar a apresentação.");
      const registrationId = saved?.registrationId || form.registrationId;
      if (!registrationId) throw new Error("Crie o cadastro do cliente antes de enviar: a simulação é enviada pela conversa dele no Chat.");
      const response = await post("enviar-preparar");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.message) throw new Error(data.error || "Não foi possível preparar a apresentação.");
      const jsonHeaders = { "Content-Type": "application/json" };
      if (data.officialConversationId) {
        const sendResponse = await fetch(`/api/admin/whatsapp-chat/conversations/${encodeURIComponent(data.officialConversationId)}/messages`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ text: data.message }) }).catch(() => null);
        if (sendResponse?.ok) {
          await post("enviar-registrar").catch(() => null);
          router.push(`/admin/chat?client=${encodeURIComponent(registrationId)}`);
          return;
        }
        // Janela do oficial aberta mas o envio automático falhou: NÃO joga para o WhatsApp pessoal (o cliente está
        // falando pelo oficial). Abre a conversa do oficial no Chat com o link no campo e mostra o motivo.
        const failure = sendResponse ? await sendResponse.json().catch(() => ({})) : {};
        setError(failure?.error ? `Não deu para enviar sozinho: ${failure.error} Abri a conversa com o link pronto.` : "Não deu para enviar sozinho. Abri a conversa com o link pronto para você enviar.");
        router.push(`/admin/chat?client=${encodeURIComponent(registrationId)}&text=${encodeURIComponent(data.message)}`);
        setSendingSimulation(false);
        return;
      }
      await post("enviar-registrar").catch(() => null);
      const phone = saved?.registration?.phoneNormalized || saved?.registration?.phone || form.registration?.phone || form.clientWhatsApp || "";
      const device = detectDevice({ userAgent: navigator.userAgent, standalone: window.matchMedia?.("(display-mode: standalone)").matches === true, maxTouchPoints: navigator.maxTouchPoints || 0 });
      // SÓ o link, sem texto junto (dono, 2026-10-11): com mensagem acompanhando o WhatsApp não carrega a prévia.
      const onlyLink = data.link || data.message;
      const externalUrl = withWhatsappText(buildExternalWhatsappUrl(phone, device), onlyLink);
      if (externalUrl) {
        window.location.assign(externalUrl);
        setSendingSimulation(false);
        return;
      }
      // Sem telefone válido no cadastro: abre a conversa no Chat com o link no campo.
      router.push(`/admin/chat?client=${encodeURIComponent(registrationId)}&text=${encodeURIComponent(onlyLink)}`);
    } catch (sendError) {
      setError(sendError.message || "Não foi possível preparar o envio da apresentação.");
      setSendingSimulation(false);
    }
  }

  return (
    <div className="container-page grid min-w-0 gap-8">
      <div className="grid min-w-0 gap-6">
        <Panel title="Dados do cliente" eyebrow="Etapa A">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome completo do cliente" value={form.clientName} onChange={(value) => update("clientName", value)} />
            <Field
              autoComplete="tel"
              inputMode="numeric"
              label="WhatsApp do cliente"
              placeholder="(14) 99999-9999"
              type="tel"
              value={form.clientWhatsApp}
              onChange={(value) => update("clientWhatsApp", formatPhoneInput(value))}
            />
            <Field label="Data da simulação" type="date" value={form.simulationDate} onChange={(value) => update("simulationDate", value)} />
          </div>
          <Field label="Observação interna" textarea value={form.internalNote} onChange={(value) => update("internalNote", value)} />

          <div className="mt-6 rounded-[24px] border border-blue-100 bg-[#F5FAFF] p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-brand">Cadastro do cliente</p>
                <h3 className="mt-1 text-2xl font-black text-navy">Ficha completa</h3>
                <p className="mt-1 text-sm font-semibold text-muted">
                  Use estes campos para criar ou atualizar manualmente o cadastro vinculado a esta simulação.
                </p>
              </div>
              <button
                className="premium-button-secondary shrink-0"
                disabled={registrationSaving}
                onClick={saveClientRegistration}
                type="button"
              >
                {registrationSaving ? "Salvando..." : form.registrationId ? "Atualizar cadastro" : "Criar cadastro"}
              </button>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Nome no cadastro" value={form.registration?.fullName || form.clientName} onChange={(value) => updateRegistration("fullName", value)} />
              <Field
                autoComplete="tel"
                inputMode="numeric"
                label="WhatsApp no cadastro"
                placeholder="(14) 99999-9999"
                type="tel"
                value={form.registration?.phone || form.clientWhatsApp}
                onChange={(value) => updateRegistration("phone", formatPhoneInput(value))}
              />
              <Field label="Data de nascimento" type="date" value={form.registration?.oldestBirthDate || ""} onChange={(value) => updateRegistration("oldestBirthDate", value)} />
              <Field label="Início do atendimento" type="date" value={form.registration?.serviceStartedAt || ""} onChange={(value) => updateRegistration("serviceStartedAt", value)} />
              <Field label="Venda concluída em" type="date" value={form.registration?.saleCompletedAt || ""} onChange={(value) => updateRegistration("saleCompletedAt", value)} />
              <SelectField
                label="Tipo de simulação"
                options={SIMULATION_TYPE_OPTIONS}
                value={form.registration?.simulationType || "individual"}
                onChange={(value) => updateRegistration("simulationType", value)}
              />
              <SelectField
                label="Regime de trabalho"
                options={PRIMARY_INCOME_OPTIONS}
                value={form.registration?.primaryIncomeType || "self_employed_unregistered"}
                onChange={(value) => updateRegistration("primaryIncomeType", value)}
              />
              <MoneyField label="Renda mensal" value={form.registration?.primaryMonthlyIncome || ""} onChange={(value) => updateRegistration("primaryMonthlyIncome", value)} />
              <SelectField
                label="Estado civil"
                options={MARITAL_STATUS_OPTIONS}
                value={form.registration?.primaryMaritalStatus || "single"}
                onChange={(value) => updateRegistration("primaryMaritalStatus", value)}
              />
              <MoneyField label="Recurso próprio / entrada" value={form.registration?.availablePurchaseResource || ""} onChange={(value) => updateRegistration("availablePurchaseResource", value)} />
              <BooleanField
                label="Mais de 3 anos de registro?"
                value={form.registration?.hasOverThreeYearsRegisteredWork}
                onChange={(value) => updateRegistration("hasOverThreeYearsRegisteredWork", value)}
              />
              <BooleanField
                label="Filhos menores de 18 anos?"
                value={form.registration?.hasChildrenUnder18}
                onChange={(value) => updateRegistration("hasChildrenUnder18", value)}
              />
              <BooleanField
                label="Possui imóvel residencial?"
                value={form.registration?.hasResidentialProperty}
                onChange={(value) => updateRegistration("hasResidentialProperty", value)}
              />
            </div>

            {form.registration?.simulationType === "joint" ? (
              <div className="mt-5 grid gap-4 border-t border-blue-100 pt-5 md:grid-cols-2">
                <SelectField
                  label="Regime da segunda pessoa"
                  options={PRIMARY_INCOME_OPTIONS}
                  value={form.registration?.secondaryIncomeType || "self_employed_unregistered"}
                  onChange={(value) => updateRegistration("secondaryIncomeType", value)}
                />
                <MoneyField label="Renda da segunda pessoa" value={form.registration?.secondaryMonthlyIncome || ""} onChange={(value) => updateRegistration("secondaryMonthlyIncome", value)} />
                <SelectField
                  label="Estado civil da segunda pessoa"
                  options={MARITAL_STATUS_OPTIONS}
                  value={form.registration?.secondaryMaritalStatus || "single"}
                  onChange={(value) => updateRegistration("secondaryMaritalStatus", value)}
                />
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel title="Dados da simulação" eyebrow="Etapa B">
          <div className="grid gap-4">
            <label className="grid gap-2 text-sm font-extrabold text-ink">
              Modo de páginas dos imóveis
              <select className="admin-input" value={form.outputMode} onChange={(event) => update("outputMode", event.target.value)}>
                <option value="individual">Individual</option>
                <option value="comparativo">Comparativo</option>
              </select>
            </label>
          </div>

          <fieldset className="mt-5 rounded-2xl border border-blue-100 bg-white p-4">
            <legend className="px-1 text-sm font-extrabold text-ink">Tipos de imóvel desta simulação</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {SIMULATION_MODEL_TYPES.map(({ key, label }) => {
                const onlyOne = enabledModels[key] && SIMULATION_MODEL_TYPES.filter((item) => enabledModels[item.key]).length === 1;
                return (
                  <label key={key} className={`flex min-h-11 items-center gap-2 text-sm font-bold text-navy ${onlyOne ? "opacity-70" : "cursor-pointer"}`}>
                    <input type="checkbox" className="h-5 w-5 accent-brand" checked={Boolean(enabledModels[key])} disabled={onlyOne} onChange={(event) => setModelEnabled(key, event.target.checked)} data-model-toggle={key} />
                    {label}
                  </label>
                );
              })}
            </div>
            <p className="mt-2 text-xs leading-5 text-muted">
              Desmarque o tipo que o cliente não quer: os valores dele são apagados e a simulação (PDF, imagem e apresentação) mostra só o outro, sem comparação entre novo e usado.
            </p>
          </fieldset>

          <div className="mt-5 grid gap-5">
            {SIMULATION_MODEL_TYPES.filter(({ key }) => enabledModels[key]).map(({ key, label }) => (
              <div key={key} className="rounded-[24px] border border-blue-100 bg-blue-50/45 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-brand">
                      Modelo de simulação
                    </p>
                    <h3 className="mt-1 text-2xl font-black text-navy">{label}</h3>
                  </div>
                  <span className="rounded-full bg-white px-4 py-2 text-sm font-black text-navy shadow-soft">
                    {formatCurrency(modelTotals[key]?.total || 0)}
                  </span>
                </div>

                <p className="mt-5 text-sm font-black uppercase tracking-[0.14em] text-navy">Price</p>
                <div className="mt-2 grid gap-4 md:grid-cols-2" data-system="price">
                  <MoneyField
                    label="Valor do financiamento"
                    value={normalizedModels[key]?.financingValue || ""}
                    onChange={(value) => updateSimulationModel(key, "financingValue", value)}
                  />
                  <MoneyField
                    label="Valor do subsídio"
                    value={normalizedModels[key]?.subsidyValue || ""}
                    onChange={(value) => updateSimulationModel(key, "subsidyValue", value)}
                  />
                  <MoneyField
                    label="Primeira parcela"
                    value={normalizedModels[key]?.firstInstallment || ""}
                    onChange={(value) => updateSimulationModel(key, "firstInstallment", value)}
                  />
                  <MoneyField
                    label="Última parcela"
                    value={normalizedModels[key]?.lastInstallment || ""}
                    onChange={(value) => updateSimulationModel(key, "lastInstallment", value)}
                  />
                  <Field
                    label="Prazo (meses)"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="Ex.: 420"
                    autoComplete="off"
                    value={normalizedModels[key]?.termMonths || ""}
                    onChange={(value) => updateSimulationModel(key, "termMonths", cleanTermMonths(value))}
                  />
                </div>

                <div className="mt-6 border-t border-blue-100 pt-4">
                  <p className="text-sm font-black uppercase tracking-[0.14em] text-navy">SAC</p>
                  <p className="mt-1 text-xs leading-5 text-muted">Opcional. Preencha o SAC (além do Price) para a apresentação do cliente mostrar também o comparativo SAC x Price. Com um sistema só, não há comparação.</p>
                  <div className="mt-3 grid gap-4 md:grid-cols-2" data-system="sac">
                    <MoneyField
                      label="Valor do financiamento (SAC)"
                      value={normalizedModels[key]?.sac?.financingValue || ""}
                      onChange={(value) => updateSacModel(key, "financingValue", value)}
                    />
                    <MoneyField
                      label="Valor do subsídio (SAC)"
                      value={normalizedModels[key]?.sac?.subsidyValue || ""}
                      onChange={(value) => updateSacModel(key, "subsidyValue", value)}
                    />
                    <MoneyField
                      label="Primeira parcela (SAC)"
                      value={normalizedModels[key]?.sac?.firstInstallment || ""}
                      onChange={(value) => updateSacModel(key, "firstInstallment", value)}
                    />
                    <MoneyField
                      label="Última parcela (SAC)"
                      value={normalizedModels[key]?.sac?.lastInstallment || ""}
                      onChange={(value) => updateSacModel(key, "lastInstallment", value)}
                    />
                    <Field
                      label="Prazo em meses (SAC)"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="Ex.: 420"
                      autoComplete="off"
                      value={normalizedModels[key]?.sac?.termMonths || ""}
                      onChange={(value) => updateSacModel(key, "termMonths", cleanTermMonths(value))}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-2xl border border-blue-100 bg-white p-4 sm:p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid min-w-0 gap-2 text-sm font-extrabold text-ink">
                Taxa de juros (% ao ano)
                <input
                  className="admin-input min-w-0"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  enterKeyHint="next"
                  maxLength={8}
                  placeholder="Ex.: 5,4"
                  value={form.interestRateAnnual || ""}
                  onChange={(event) => update("interestRateAnnual", event.target.value)}
                  aria-invalid={!interestRateCheck.ok}
                  aria-describedby="interest-rate-help"
                />
              </label>
              <p id="interest-rate-help" className={`self-end text-xs font-semibold ${interestRateCheck.ok ? "text-muted" : "text-red-700"}`}>
                {interestRateCheck.ok
                  ? "Opcional. Aparece ao lado das parcelas na apresentação interativa do cliente (não entra no PDF). Vale para a simulação toda."
                  : interestRateCheck.error}
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <MoneyField label="Entrada disponível" value={form.downPaymentValue} onChange={(value) => update("downPaymentValue", value)} />
            <MoneyField label="FGTS disponível" value={form.fgtsValue} onChange={(value) => update("fgtsValue", value)} />
          </div>
          <label className="mt-5 flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 text-sm font-bold text-ink">
            <input type="checkbox" checked={form.showExpandedPower} onChange={(event) => update("showExpandedPower", event.target.checked)} />
            Mostrar poder de compra ampliado na apresentação
          </label>
          <div className="mt-5 grid gap-4 rounded-2xl border border-blue-100 bg-blue-50/70 p-5 md:grid-cols-2">
            {renderableModels.map((model) => (
              <Metric
                key={`${model.type}-${model.system}`}
                label={`Poder total - ${simulationModelLabel(model.type)}${model.systemLabel ? ` · ${model.systemLabel}` : ""}`}
                value={formatCurrency(model.totals.total)}
              />
            ))}
          </div>
          <Field label="Observação pública" textarea value={form.publicNote} onChange={(value) => update("publicNote", value)} />
        </Panel>

        <Panel title="Imóveis sugeridos" eyebrow="Etapa C">
          {clientPreferences.length ? (
            <div className="mb-5 rounded-2xl border border-brand/20 bg-[#F3F8FF] p-4">
              <p className="text-sm font-black text-navy">O que o cliente procura</p>
              <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {clientPreferences.map((item) => (
                  <div key={item.label} className="min-w-0">
                    <dt className="text-xs font-bold text-muted">{item.label}</dt>
                    <dd className="text-sm font-semibold text-ink">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
          <label className="relative block">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-brand" />
            <input
              className="admin-input admin-search-input"
              value={propertyQuery}
              onChange={(event) => setPropertyQuery(event.target.value)}
              placeholder="Pesquisar imóvel por nome, região, valor ou construtora"
            />
          </label>
          <div className="mt-5 grid max-h-[420px] gap-3 overflow-auto pr-1">
            {filteredProperties.slice(0, 10).map((property) => (
              <button
                key={property.id}
                className="grid gap-4 rounded-2xl border border-line bg-white p-3 text-left transition hover:-translate-y-0.5 hover:border-brand hover:shadow-soft sm:grid-cols-[92px_1fr_auto] sm:items-center"
                onClick={() => addProperty(property)}
                type="button"
              >
                <img src={coverImage(property)} alt="" className="h-24 w-full rounded-xl object-cover sm:h-20 sm:w-[92px]" />
                <span>
                  <span className="block text-lg font-black text-navy">{property.name}</span>
                  <span className="mt-1 block text-sm text-muted">{typeLabel(property.type)} · {propertyRegion(property)} · {propertyPrice(property)}</span>
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-[#E9F2FF] px-4 py-2 text-sm font-black text-navy">
                  <Check className="h-4 w-4" /> Selecionar
                </span>
              </button>
            ))}
          </div>
        </Panel>

        {form.properties.length > 1 ? <PropertyOrderList properties={form.properties} onMove={moveProperty} /> : null}

        {form.properties.map((property, propertyIndex) => (
          <Panel key={`${property.propertyId}-${propertyIndex}`} title={property.customName || "Imóvel sugerido"} eyebrow={`Imóvel ${propertyIndex + 1}`}>
            <div className="mb-5 flex flex-wrap gap-3">
              <button className="premium-button border border-red-200 bg-white text-red-700" onClick={() => removeProperty(propertyIndex)} type="button">
                <Trash2 className="mr-2 h-4 w-4" /> Remover
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <Field label="Nome na apresentação" value={property.customName} onChange={(value) => updateSelectedProperty(propertyIndex, "customName", value)} />
              <Field label="Valor na apresentação" value={property.customPrice} onChange={(value) => updateSelectedProperty(propertyIndex, "customPrice", value)} />
              <Field label="Localização" value={property.customLocation} onChange={(value) => updateSelectedProperty(propertyIndex, "customLocation", value)} />
              <Field label="Tipo" value={property.customType} onChange={(value) => updateSelectedProperty(propertyIndex, "customType", value)} />
              <Field label="Área" value={property.customArea} onChange={(value) => updateSelectedProperty(propertyIndex, "customArea", value)} />
              <Field label="Dormitórios" value={property.customBedrooms} onChange={(value) => updateSelectedProperty(propertyIndex, "customBedrooms", value)} />
              <Field label="Construtora" value={property.customBuilder} onChange={(value) => updateSelectedProperty(propertyIndex, "customBuilder", value)} />
              <Field label="Entrega" value={property.customDelivery} onChange={(value) => updateSelectedProperty(propertyIndex, "customDelivery", value)} />
            </div>

            <label className="mt-5 grid gap-2 text-sm font-extrabold text-ink">
              Por que este imóvel foi sugerido?
              <select className="admin-input" value={property.recommendationReason} onChange={(event) => updateSelectedProperty(propertyIndex, "recommendationReason", event.target.value)}>
                {RECOMMENDATION_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
              </select>
            </label>
            <Field textarea label="Editar motivo da indicação" value={property.recommendationReason} onChange={(value) => updateSelectedProperty(propertyIndex, "recommendationReason", value)} />

            <div className="mt-6">
              <p className="text-sm font-black uppercase tracking-[0.16em] text-brand">Benefícios e destaques</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {BENEFIT_OPTIONS.map((benefit) => (
                  <label key={benefit} className="flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 text-sm font-bold text-ink">
                    <input
                      type="checkbox"
                      checked={property.benefits.some((item) => item.text === benefit)}
                      onChange={() => toggleBenefit(propertyIndex, benefit)}
                    />
                    {benefit}
                  </label>
                ))}
              </div>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <input
                  className="admin-input"
                  value={property.customBenefitDraft || ""}
                  onChange={(event) => updateSelectedProperty(propertyIndex, "customBenefitDraft", event.target.value)}
                  placeholder="Adicionar benefício personalizado"
                />
                <button className="premium-button-secondary" onClick={() => addCustomBenefit(propertyIndex, property.customBenefitDraft || "")} type="button">
                  Adicionar
                </button>
              </div>
              <BenefitOrderList benefits={property.benefits} onMove={(from, to) => moveBenefit(propertyIndex, from, to)} onRemove={(benefitIndex) => removeBenefit(propertyIndex, benefitIndex)} />
            </div>
          </Panel>
        ))}

        {error ? <Alert tone="error">{error}</Alert> : null}
        {message ? <Alert tone="success">{message}</Alert> : null}

        <div className="grid gap-4 rounded-3xl border border-line bg-white p-4 shadow-soft sm:p-5">
          {basicMode ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-black uppercase tracking-[0.14em] text-amber-800">CRM básico</p>
              <p className="mt-1 text-sm font-semibold text-amber-900">Sua automação está desativada: aqui você lança e salva os valores da simulação para controle. A apresentação interativa fica indisponível. Fale com a gestão para reativar.</p>
            </div>
          ) : (
          <div className="grid gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.14em] text-brand">Formato para envio</p>
              <p className="mt-1 text-sm font-semibold text-muted">A simulação é enviada ao cliente pelo link da apresentação interativa.</p>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {SEND_FORMAT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={`rounded-full px-3 py-3 text-sm font-black transition sm:px-5 ${
                    sendFormat === option.value
                      ? "bg-navy text-white shadow-soft"
                      : "border border-line bg-white text-navy hover:border-brand"
                  }`}
                  onClick={() => setSendFormat(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          )}
          <button className="premium-button-primary" disabled={saving} onClick={saveSimulation} type="button">
            <Save className="mr-2 h-5 w-5" /> {saving ? "Salvando..." : "Salvar simulação"}
          </button>
          {form.id ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm font-extrabold text-navy">
              <span>{autoSaveStatusLabel(autoSaveStatus)}</span>
              {autoSaveStatus === "error" ? (
                <button className="text-brand underline-offset-4 hover:underline" onClick={() => persistSimulation({ silent: true })} type="button">
                  Tentar novamente
                </button>
              ) : null}
            </div>
          ) : null}
          {basicMode ? null : (<>
          <button
            className="premium-button bg-[#25D366] text-white shadow-[0_18px_45px_rgba(18,140,82,0.24)] hover:-translate-y-0.5 hover:bg-[#20BF5A] hover:shadow-[0_22px_56px_rgba(18,140,82,0.32)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={sendingSimulation}
            onClick={sendSimulationToWhatsApp}
            type="button"
          >
            <WhatsAppIcon className="mr-2 h-5 w-5" /> {sendingSimulation ? "Preparando..." : "Enviar simulação"}
          </button>
          </>)}
          <Link href="/admin/simulacoes" className="premium-button-secondary">Histórico</Link>
        </div>
      </div>

    </div>
  );
}

function Panel({ children, eyebrow, title }) {
  return (
    <section className="min-w-0 rounded-[28px] border border-line bg-white p-4 shadow-soft sm:p-6 md:p-8">
      <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">{eyebrow}</p>
      <h2 className="mt-2 text-[clamp(1.65rem,7vw,1.875rem)] font-black leading-tight text-navy">{title}</h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Field({ label, onChange, textarea = false, type = "text", value, ...props }) {
  const Component = textarea ? "textarea" : "input";
  return (
    <label className="mt-4 grid min-w-0 gap-2 text-sm font-extrabold text-ink">
      {label}
      <Component
        className={`admin-input min-w-0 ${textarea ? "min-h-28 py-3" : ""}`}
        {...(textarea ? props : { type, ...props })}
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SelectField({ label, onChange, options = [], value }) {
  return (
    <label className="mt-4 grid min-w-0 gap-2 text-sm font-extrabold text-ink">
      {label}
      <select className="admin-input min-w-0" value={value || ""} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function BooleanField({ label, onChange, value }) {
  return (
    <label className="mt-4 grid min-w-0 gap-2 text-sm font-extrabold text-ink">
      {label}
      <select
        className="admin-input min-w-0"
        value={value === true ? "true" : value === false ? "false" : ""}
        onChange={(event) => onChange(event.target.value === "true")}
      >
        <option value="false">Não</option>
        <option value="true">Sim</option>
      </select>
    </label>
  );
}

function MoneyField({ label, onChange, value }) {
  return (
    <Field
      label={label}
      type="text"
      inputMode="decimal"
      pattern="[0-9,.]*"
      enterKeyHint="next"
      autoComplete="off"
      value={value}
      onChange={(nextValue) => onChange(formatCurrencyInput(nextValue))}
    />
  );
}

function Metric({ label, value }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-black uppercase tracking-[0.12em] text-brand">{label}</p>
      <p className="mt-1 break-words text-[clamp(1.5rem,8vw,1.875rem)] font-black leading-tight text-navy">{value}</p>
    </div>
  );
}

function Alert({ children, tone }) {
  const classes = tone === "success"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-red-200 bg-red-50 text-red-800";
  return <div className={`rounded-2xl border px-5 py-4 font-bold ${classes}`}>{children}</div>;
}

function normalizeInitialSimulation(simulation) {
  if (!simulation) return INITIAL_FORM;
  const internalNote = simulation.internalNote || "";
  const registration = normalizeRegistrationDraft(simulation.registration, simulation, extractClientWhatsApp(internalNote));
  const clientName = normalizePersonName(simulation.clientName || registration.fullName || "");
  const clientWhatsApp = formatPhoneInput(registration.phone || registration.phoneNormalized || extractClientWhatsApp(internalNote));
  const legacyModels = normalizeSimulationModels(null, {
    simulationType: simulation.simulationType,
    financingValue: formatStoredCurrencyInput(simulation.financingValue),
    subsidyValue: formatStoredCurrencyInput(simulation.subsidyValue),
    firstInstallment: formatStoredCurrencyInput(simulation.firstInstallment),
    lastInstallment: formatStoredCurrencyInput(simulation.lastInstallment)
  });
  const savedModels = simulation.simulationModels || extractSimulationModelsFromNote(internalNote);
  return {
    ...INITIAL_FORM,
    ...simulation,
    registrationId: simulation.registrationId || registration.id || "",
    registration,
    clientName,
    clientWhatsApp,
    internalNote: removeSimulationModelsFromNote(removeClientWhatsAppLine(internalNote)),
    simulationModels: formatSimulationModelsForForm(savedModels || legacyModels),
    financingValue: formatStoredCurrencyInput(simulation.financingValue),
    subsidyValue: formatStoredCurrencyInput(simulation.subsidyValue),
    firstInstallment: formatStoredCurrencyInput(simulation.firstInstallment),
    lastInstallment: formatStoredCurrencyInput(simulation.lastInstallment),
    interestRateAnnual: formatInterestRateInput(simulation.interestRateAnnual),
    downPaymentValue: formatStoredCurrencyInput(simulation.downPaymentValue),
    fgtsValue: formatStoredCurrencyInput(simulation.fgtsValue),
    properties: (simulation.properties || []).map((property, index) => ({
      ...property,
      displayOrder: index,
      customBenefitDraft: ""
    }))
  };
}

function normalizeRegistrationDraft(registration = null, simulation = {}, fallbackPhone = "") {
  const source = registration || {};
  const safeSimulation = simulation || {};
  return {
    id: source.id || "",
    simulationType: source.simulationType === "joint" ? "joint" : "individual",
    fullName: normalizePersonName(source.fullName || safeSimulation.clientName || ""),
    phone: formatPhoneInput(source.phone || source.phoneNormalized || fallbackPhone || ""),
    phoneNormalized: source.phoneNormalized || "",
    oldestBirthDate: normalizeDateInput(source.oldestBirthDate),
    serviceStartedAt: normalizeDateInput(source.serviceStartedAt),
    saleCompletedAt: normalizeDateInput(source.saleCompletedAt),
    primaryIncomeType: source.primaryIncomeType || "self_employed_unregistered",
    primaryMonthlyIncome: formatStoredCurrencyInput(source.primaryMonthlyIncome),
    secondaryIncomeType: source.secondaryIncomeType || "self_employed_unregistered",
    secondaryMonthlyIncome: formatStoredCurrencyInput(source.secondaryMonthlyIncome),
    hasOverThreeYearsRegisteredWork: source.hasOverThreeYearsRegisteredWork === true,
    hasChildrenUnder18: source.hasChildrenUnder18 === true,
    primaryMaritalStatus: source.primaryMaritalStatus || "single",
    secondaryMaritalStatus: source.secondaryMaritalStatus || "single",
    hasResidentialProperty: source.hasResidentialProperty === true,
    availablePurchaseResource: formatStoredCurrencyInput(source.availablePurchaseResource)
  };
}

function normalizeDateInput(value) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && text !== "1900-01-01" ? text : "";
}

function propertySnapshot(property, displayOrder) {
  return {
    propertyId: property.id,
    displayOrder,
    customName: property.name || "",
    customPrice: property.price || "",
    customLocation: propertyRegion(property),
    customType: typeLabel(property.type),
    customArea: property.area || "",
    customBedrooms: property.bedrooms || "",
    customBuilder: property.builder || "",
    customDelivery: property.delivery || "",
    customTerms: property.terms || "",
    customDiscounts: property.discounts || "",
    customSalesText: property.salesText || "",
    recommendationReason: DEFAULT_RECOMMENDATION_REASON,
    imageUrl: coverImage(property),
    layoutMode: "individual",
    benefits: propertyCardFeatures(property, 5).map((feature, index) => ({
      text: feature.text,
      displayOrder: index,
      isCustom: false
    })),
    customBenefitDraft: ""
  };
}

function serializeForm(form) {
  const { registration: _registration, ...simulationForm } = form;
  const models = normalizeSimulationModels(form.simulationModels, form);
  const primaryModel = getPrimarySimulationModel({ ...form, simulationModels: models });
  const internalNote = mergeSimulationModelsIntoNote(
    mergeClientWhatsAppIntoInternalNote(form.internalNote, form.clientWhatsApp),
    models
  );

  // Taxa de juros: válida/vazia vai como número/null; digitada e inválida é OMITIDA (o servidor não mexe na taxa gravada
  // e o formulário mostra o erro) — nunca grava lixo nem apaga a taxa enquanto se digita ("5," → "5,4").
  const interestRate = parseInterestRateInput(form.interestRateAnnual);

  return {
    ...simulationForm,
    interestRateAnnual: interestRate.ok ? interestRate.value : undefined,
    internalNote,
    simulationType: primaryModel.type,
    financingValue: primaryModel.totals.financing,
    subsidyValue: primaryModel.totals.subsidy,
    firstInstallment: moneyNumber(primaryModel.values.firstInstallment),
    lastInstallment: moneyNumber(primaryModel.values.lastInstallment),
    downPaymentValue: primaryModel.totals.downPayment,
    fgtsValue: primaryModel.totals.fgts,
    totalPurchasePower: primaryModel.totals.total,
    expandedPurchasePower: primaryModel.totals.expanded,
    properties: form.properties.map(({ customBenefitDraft, ...property }) => property)
  };
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
}

function formatCurrencyInput(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return formatCurrency(Number(digits) / 100);
}

function formatStoredCurrencyInput(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) return formatCurrency(value);

  const text = String(value).trim();
  if (!text) return "";
  if (/^-?\d+(\.\d+)?$/.test(text) && !text.includes(",")) {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? formatCurrency(parsed) : "";
  }

  return formatCurrencyInput(text);
}

function formatSimulationModelsForForm(models) {
  const normalized = normalizeSimulationModels(models);
  return Object.fromEntries(
    SIMULATION_MODEL_TYPES.map(({ key }) => [
      key,
      {
        financingValue: formatStoredCurrencyInput(normalized[key]?.financingValue),
        subsidyValue: formatStoredCurrencyInput(normalized[key]?.subsidyValue),
        firstInstallment: formatStoredCurrencyInput(normalized[key]?.firstInstallment),
        lastInstallment: formatStoredCurrencyInput(normalized[key]?.lastInstallment),
        termMonths: cleanTermMonths(normalized[key]?.termMonths),
        sac: {
          financingValue: formatStoredCurrencyInput(normalized[key]?.sac?.financingValue),
          subsidyValue: formatStoredCurrencyInput(normalized[key]?.sac?.subsidyValue),
          firstInstallment: formatStoredCurrencyInput(normalized[key]?.sac?.firstInstallment),
          lastInstallment: formatStoredCurrencyInput(normalized[key]?.sac?.lastInstallment),
          termMonths: cleanTermMonths(normalized[key]?.sac?.termMonths)
        }
      }
    ])
  );
}

function createModelSyncState(form) {
  const models = normalizeSimulationModels(form.simulationModels, form);
  return Object.fromEntries(SYNCED_MODEL_FIELDS.map((field) => {
    const novoValue = models.novo?.[field] || "";
    const usadoValue = models.usado?.[field] || "";
    const sharedValue = novoValue && novoValue === usadoValue ? novoValue : "";
    return [
      field,
      {
        linked: !novoValue || !usadoValue || novoValue === usadoValue,
        lastSource: sharedValue ? "novo" : "",
        lastValue: sharedValue
      }
    ];
  }));
}

function isSyncedModelField(field) {
  return SYNCED_MODEL_FIELDS.includes(field);
}

function autoSaveStatusLabel(status) {
  if (status === "saving") return "Salvando automaticamente...";
  if (status === "saved") return "Alteracoes salvas automaticamente";
  if (status === "error") return "Erro ao salvar automaticamente";
  return "Salvamento automatico ativo";
}

function formatPhoneInput(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length > 11) digits = digits.slice(2);
  digits = digits.slice(0, 11);

  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function normalizeClientWhatsApp(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return "";
}

function extractClientWhatsApp(note) {
  const line = String(note || "")
    .split(/\r?\n/)
    .find((item) => item.trim().toLowerCase().startsWith(CLIENT_WHATSAPP_NOTE_PREFIX.toLowerCase()));
  return line ? line.replace(CLIENT_WHATSAPP_NOTE_PREFIX, "").replace(/\D/g, "") : "";
}

function removeClientWhatsAppLine(note) {
  return String(note || "")
    .split(/\r?\n/)
    .filter((item) => !item.trim().toLowerCase().startsWith(CLIENT_WHATSAPP_NOTE_PREFIX.toLowerCase()))
    .join("\n")
    .trim();
}

function mergeClientWhatsAppIntoInternalNote(note, phone) {
  const cleanedNote = removeClientWhatsAppLine(note);
  const digits = String(phone || "").replace(/\D/g, "");
  return [
    digits ? `${CLIENT_WHATSAPP_NOTE_PREFIX} ${digits}` : "",
    cleanedNote
  ].filter(Boolean).join("\n");
}

function moneyNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  const normalized = String(value || "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function WhatsAppIcon({ className }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className} fill="currentColor">
      <path d="M16.04 3.2A12.74 12.74 0 0 0 5.2 22.65L3.72 28l5.48-1.43A12.75 12.75 0 1 0 16.04 3.2Zm0 2.27a10.47 10.47 0 0 1 8.86 16.04 10.47 10.47 0 0 1-14.96 2.74l-.39-.24-3.25.85.87-3.16-.26-.41A10.46 10.46 0 0 1 16.04 5.47Zm-4.45 5.62c-.22 0-.58.08-.88.42-.3.34-1.15 1.12-1.15 2.74s1.18 3.18 1.34 3.4c.16.22 2.27 3.64 5.63 4.96 2.79 1.1 3.36.88 3.96.82.6-.05 1.94-.79 2.21-1.55.27-.76.27-1.42.19-1.55-.08-.14-.3-.22-.63-.38-.33-.16-1.94-.96-2.24-1.07-.3-.11-.52-.16-.74.16-.22.33-.85 1.07-1.04 1.29-.19.22-.38.25-.71.08-.33-.16-1.38-.51-2.63-1.62-.97-.86-1.63-1.93-1.82-2.26-.19-.33-.02-.5.14-.67.15-.15.33-.38.49-.57.16-.19.22-.33.33-.55.11-.22.05-.41-.03-.57-.08-.16-.74-1.79-1.01-2.45-.27-.64-.54-.55-.74-.56h-.63Z" />
    </svg>
  );
}


// Ordem dos imóveis da apresentação (pedido do dono, 2026-10-09): arrastar com o mouse ou segurar e mover no celular.
function PropertyOrderList({ properties, onMove }) {
  const drag = useDragReorder(onMove);
  return (
    <Panel title="Ordem dos imóveis" eyebrow="Arraste para ordenar">
      <div className="grid gap-2">
        {properties.map((property, index) => (
          <div key={`${property.propertyId}-${index}`} {...drag.itemProps(index)} className={`flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 ${drag.itemClass(index)}`}>
            <GripVertical className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-navy text-xs font-black text-white">{index + 1}</span>
            <span className="min-w-0 truncate font-bold text-navy">{property.customName || "Imóvel sugerido"}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function BenefitOrderList({ benefits, onMove, onRemove }) {
  const drag = useDragReorder(onMove);
  return (
    <div className="mt-4 grid gap-2">
      {benefits.map((benefit, benefitIndex) => (
        <div key={`${benefit.text}-${benefitIndex}`} {...drag.itemProps(benefitIndex)} className={`flex items-center justify-between gap-3 rounded-2xl bg-mist px-4 py-3 ${drag.itemClass(benefitIndex)}`}>
          <span className="flex min-w-0 items-center gap-2 font-bold text-navy"><GripVertical className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />{benefit.text}</span>
          <button
            aria-label={`Remover ${benefit.text}`}
            className="rounded-full border border-red-100 bg-white px-3 py-1 text-red-600 transition hover:border-red-200 hover:bg-red-50"
            onClick={() => onRemove(benefitIndex)}
            type="button"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

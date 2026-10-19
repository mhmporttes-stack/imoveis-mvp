"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useBasicMode } from "@/components/WhatsappAccessProvider";
import { ArrowLeft, Check, ChevronDown, GripVertical, Pencil, Plus, Save, Search, Trash2 } from "lucide-react";
import Button from "@/components/ui/Button";
import Sheet from "@/components/ui/Sheet";
import Switch from "@/components/ui/Switch";
import { inputClasses } from "@/components/ui/Field";
import { SimulationTabContext } from "@/components/simulation-tab-context";
import { moveItem, useDragReorder } from "@/components/ui/useDragReorder";
import { coverImage, propertyCardFeatures, propertyRegion, propertyPrice, typeLabel } from "@/lib/format";
import { normalizePersonName } from "@/lib/name-utils";
import { buildExternalWhatsappUrl, detectDevice } from "@/lib/client-card-whatsapp-core.mjs";
import { PRINTED_LIST_MODE_CODE } from "@/lib/whatsapp-manual-disconnect-core.mjs";
import { withWhatsappText } from "@/lib/documents-forecast-core.mjs";
import { formatInterestRateInput, parseInterestRateInput } from "@/lib/interest-rate.mjs";
import { RATE_REQUIRED_ERROR, simulationRequiredFieldsError } from "@/lib/simulation-required-fields.mjs";
import { AUTO_PRESENTATION_LOCKED_MESSAGE, automaticIncomeFromNote, isAutomaticSimulationSource } from "@/lib/simulation-status-lock-core.mjs";
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
  simulationModelHasValues,
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

// Props para o redesenho da aba (designer-crm, 2026-10-19): `fieldSuggestions` = { termMonths, annualRate } de
// simulationFieldSuggestions (lib/financiamento-estimativa-core.mjs), cada um { value, source, label } ou null — a tela
// marca "confira" com a origem. `clientSheetHref` = onde editar o cadastro completo.
// Blocos da página (redesenho 2026-10-19): `reviewSlot` (conferência da automática), `redoSlot` (Refazer),
// `scenariosSlot` (Comparar simulações, vira aba) e `presentationSlot` (link da apresentação, na coluna de envio).
export default function SimulationGenerator({ properties = [], initialSimulation = null, fieldSuggestions = null, clientSheetHref = "", reviewSlot = null, redoSlot = null, scenariosSlot = null, presentationSlot = null }) {
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
  // Corpo ao abrir a tela: na simulação automática, "Salvar correção da Caixa" só aparece depois de alguma edição.
  const initialPayloadRef = useRef(lastSavedPayloadRef.current);
  const syncingFieldsRef = useRef(createModelSyncState(form));
  // Caixas "Imóvel novo" / "Imóvel usado" (pedido do dono 2026-10-06): tipo desligado some da simulação, sem comparação.
  const [enabledModels, setEnabledModels] = useState(() => enabledModelsFromModels(form.simulationModels));
  const enabledModelsRef = useRef(enabledModels);
  enabledModelsRef.current = enabledModels;
  const [propertyQuery, setPropertyQuery] = useState("");
  // Formato único (link). O seletor "Formato para envio" saiu da tela no redesenho de 2026-10-19 (tinha uma opção só).
  const [sendFormat] = useState("presentation");
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
    const body = serializeForm(formToSave);
    const payload = JSON.stringify(body);
    const endpoint = currentForm.id ? `/api/simulations/${currentForm.id}` : "/api/simulations";
    const method = currentForm.id ? "PUT" : "POST";

    // Taxa de juros digitada e inválida: o clique em Salvar avisa em vez de gravar sem ela (o autosave só a omite).
    const interestCheck = parseInterestRateInput(formToSave.interestRateAnnual);
    if (!interestCheck.ok && !silent) {
      setError(interestCheck.error);
      return null;
    }
    // Prazo e taxa obrigatórios no Salvar/Enviar (regra do dono, 2026-10-18); o autosave segue sem barrar (o servidor também).
    const requiredError = silent ? "" : simulationRequiredFieldsError({ ...formToSave, interestRateAnnual: interestCheck.value });
    if (requiredError) {
      setError(requiredError);
      setMessage("");
      return null;
    }

    if (payload === lastSavedPayloadRef.current) {
      setAutoSaveStatus("saved");
      if (!silent) setMessage("Simulação salva com sucesso.");
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
      body: silent ? JSON.stringify({ ...body, autosave: true }) : payload
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
          setError(data.error || "Não foi possível salvar a simulação.");
        }
        return null;
      }

      lastSavedPayloadRef.current = payload;
      setAutoSaveStatus("saved");
      if (!silent) setMessage("Simulação salva com sucesso.");
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
            clientName: data.clientName || current.clientName,
            // Depois de salvar a correção da simulação automática ela vira do corretor (o Enviar volta a funcionar).
            createdBy: data.createdBy !== undefined ? data.createdBy : current.createdBy
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
        setError("Não foi possível salvar a simulação.");
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
        setError(data.error || "Não foi possível salvar o cadastro do cliente.");
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
      setError("Não foi possível salvar o cadastro do cliente.");
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
      body: JSON.stringify({ ...JSON.parse(payload), autosave: true }),
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
    // Simulação automática ainda não conferida (SIM-AUTO): o Enviar NÃO pode salvar por cima (isso a converteria sem o
    // OK/Corrigir obrigatório) nem gerar o link — mostra o aviso da conferência.
    if (isAutomaticSimulationSource(formRef.current?.createdBy)) {
      setError(AUTO_PRESENTATION_LOCKED_MESSAGE);
      setMessage("");
      return;
    }
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
      if (!saved) {
        // falta prazo/taxa: a mensagem diz qual campo (senão, a genérica)
        const current = formRef.current;
        const rate = parseInterestRateInput(current.interestRateAnnual);
        throw new Error((rate.ok && simulationRequiredFieldsError({ ...current, interestRateAnnual: rate.value })) || "Salve a simulação antes de enviar a apresentação.");
      }
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
        // Modo lista impressa (PRO-15, 2026-10-15): sem Chat — segue para o WhatsApp do celular/Web, como sem conversa oficial.
        if (failure?.code === PRINTED_LIST_MODE_CODE) return await sendPresentationExternally(saved, registrationId, data, post);
        setError(failure?.error ? `Não deu para enviar sozinho: ${failure.error} Abri a conversa com o link pronto.` : "Não deu para enviar sozinho. Abri a conversa com o link pronto para você enviar.");
        router.push(`/admin/chat?client=${encodeURIComponent(registrationId)}&text=${encodeURIComponent(data.message)}`);
        setSendingSimulation(false);
        return;
      }
      await sendPresentationExternally(saved, registrationId, data, post);
    } catch (sendError) {
      setError(sendError.message || "Não foi possível preparar o envio da apresentação.");
      setSendingSimulation(false);
    }
  }

  // Envio pelo WhatsApp do celular/Web (sem conversa do oficial ou modo lista impressa).
  async function sendPresentationExternally(saved, registrationId, data, post) {
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
  }

  // Estado só de tela do layout da aba (redesenho 2026-10-19).
  const [view, setView] = useState("simulacao");
  const [activeType, setActiveType] = useState(() => SIMULATION_MODEL_TYPES.find(({ key }) => enabledModels[key])?.key || "novo");
  const [sacOpen, setSacOpen] = useState({});
  const [usadoOwn, setUsadoOwn] = useState(false);
  const [cadastroOpen, setCadastroOpen] = useState(() => !form.id || !form.clientName);
  const [notesOpen, setNotesOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [startedNew] = useState(() => !form.id);
  const propertyDrag = useDragReorder(moveProperty);

  // ---------- Apresentação da aba (redesenho aprovado pelo dono em 2026-10-19, designer-crm) ----------
  // Ordem pensada para a tarefa principal: conferir/lançar os valores da Caixa e enviar. O que é raro (SAC, cadastro
  // completo, observações, campos de cada imóvel) fica recolhido, mas continua na própria aba — nada foi removido.
  const isAutomatic = isAutomaticSimulationSource(form.createdBy);
  const enabledTypes = SIMULATION_MODEL_TYPES.filter(({ key }) => enabledModels[key]);
  const shownType = enabledModels[activeType] ? activeType : enabledTypes[0]?.key || "novo";
  const filledModels = renderableModels.filter((model) => simulationModelHasValues(model.values));
  const requiredIssue = interestRateCheck.ok ? simulationRequiredFieldsError({ ...form, interestRateAnnual: interestRateCheck.value }) : "";
  // Campo obrigatório em falta (prazo/taxa): aviso no próprio campo, selo "Incompleto" e Enviar desativado com o motivo.
  const requiredShown = Boolean(requiredIssue);
  const missingRate = requiredShown && requiredIssue === RATE_REQUIRED_ERROR;
  const missingTerm = requiredShown && !missingRate ? filledModels[0] || null : null;
  const usadoMirrorsNovo = Boolean(enabledModels.novo && enabledModels.usado) && !usadoOwn
    && SYNCED_MODEL_FIELDS.some((field) => normalizedModels.novo?.[field])
    && SYNCED_MODEL_FIELDS.every((field) => (normalizedModels.novo?.[field] || "") === (normalizedModels.usado?.[field] || ""));
  const termSuggestion = fieldSuggestions?.termMonths || null;
  const rateSuggestion = fieldSuggestions?.annualRate || null;
  const incomeForCaixa = isAutomatic ? automaticIncomeFromNote(initialSimulation?.internalNote || "") : "";
  const automaticEdited = isAutomatic && JSON.stringify(serializeForm(form)) !== initialPayloadRef.current;
  const showSaveButton = !form.id || automaticEdited;
  const missingLabel = missingRate ? "falta a taxa" : missingTerm ? `falta o prazo do ${simulationModelLabel(missingTerm.type).toLowerCase()}${missingTerm.system === "sac" ? " (SAC)" : ""}` : "";
  // Motivo de o Enviar estar desativado (o envio faria a mesma checagem e pararia com aviso).
  const sendBlockedReason = isAutomatic
    ? "Confira a simulação (OK ou Corrigir) para liberar o envio."
    : !interestRateCheck.ok ? interestRateCheck.error
      : missingLabel ? `Para enviar, ${missingLabel}.`
        : !form.id ? "Salve a simulação para poder enviar."
          : "";
  const editingProperty = editingIndex !== null ? form.properties[editingIndex] || null : null;
  const preferenceLine = clientPreferences.map((item) => item.value).filter(Boolean).join(" · ");

  function useOwnUsadoValues() {
    SYNCED_MODEL_FIELDS.forEach((field) => {
      syncingFieldsRef.current[field] = { ...(syncingFieldsRef.current[field] || {}), linked: false };
    });
    setUsadoOwn(true);
  }

  function termField(key) {
    const value = normalizedModels[key]?.termMonths || "";
    const missing = missingTerm && missingTerm.type === key && missingTerm.system !== "sac";
    const matchesSuggestion = termSuggestion && String(value) === String(termSuggestion.value);
    return (
      <Field
        label="Prazo (meses)"
        required
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder="Ex.: 420"
        autoComplete="off"
        value={value}
        error={missing ? "Informe o prazo para salvar e enviar." : ""}
        badge={matchesSuggestion ? <ConfirmBadge /> : null}
        hint={matchesSuggestion ? termSuggestion.label : !value && termSuggestion ? (
          <SuggestionButton onClick={() => updateSimulationModel(key, "termMonths", String(termSuggestion.value))}>
            Usar {termSuggestion.value} meses ({termSuggestion.label.toLowerCase()})
          </SuggestionButton>
        ) : ""}
        onChange={(next) => updateSimulationModel(key, "termMonths", cleanTermMonths(next))}
      />
    );
  }

  function rateField() {
    const matchesSuggestion = rateSuggestion && rateSuggestion.source !== "ultima_usada" && interestRateCheck.ok && interestRateCheck.value === rateSuggestion.value;
    const empty = !String(form.interestRateAnnual || "").trim();
    return (
      <Field
        label="Taxa de juros (% a.a.)"
        aria-label="Taxa de juros (% ao ano)"
        required
        type="text"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="next"
        maxLength={8}
        placeholder="Ex.: 5,4"
        value={form.interestRateAnnual || ""}
        error={!interestRateCheck.ok ? interestRateCheck.error : missingRate ? "Obrigatória para salvar e enviar." : ""}
        badge={matchesSuggestion ? <ConfirmBadge /> : null}
        hint={matchesSuggestion ? rateSuggestion.label : empty && rateSuggestion ? (
          <SuggestionButton onClick={() => update("interestRateAnnual", formatInterestRateInput(rateSuggestion.value))}>
            Usar {formatInterestRateInput(rateSuggestion.value)}% ({rateSuggestion.label.toLowerCase()})
          </SuggestionButton>
        ) : "Vale para novo e usado; aparece ao lado das parcelas."}
        onChange={(next) => update("interestRateAnnual", next)}
      />
    );
  }

  const saveStatus = form.id && missingLabel ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-2.5 py-1 text-xs font-semibold text-danger" role="status">
      Incompleto: {missingLabel}
    </span>
  ) : form.id ? (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${autoSaveStatus === "error" ? "bg-danger-soft text-danger" : autoSaveStatus === "saving" ? "bg-neutral-soft text-ink-2" : "bg-success-soft text-success"}`} role="status">
        {autoSaveStatus === "saved" ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
        {autoSaveStatusLabel(autoSaveStatus)}
      </span>
      {autoSaveStatus === "error" ? (
        <button className="min-h-touch text-sm font-semibold text-brand underline-offset-4 hover:underline" onClick={() => persistSimulation({ silent: true })} type="button">
          Tentar novamente
        </button>
      ) : null}
    </span>
  ) : (
    <span className="rounded-full bg-neutral-soft px-2.5 py-1 text-xs font-semibold text-ink-2">Ainda não salva</span>
  );

  // Ações de salvar/enviar (coluna lateral no computador; barra fixa no celular). Mesmos botões e regras de antes.
  function renderActions(place) {
    return (
      <div className={place === "bar" ? "grid gap-2" : "grid gap-3"}>
        {error ? <Alert tone="error" compact={place === "bar"}>{error}</Alert> : null}
        {message ? <Alert tone="success" compact={place === "bar"}>{message}</Alert> : null}
        <div className={place === "bar" && !showSaveButton && !missingLabel ? "flex items-center gap-2" : "grid gap-2"}>
          {place === "bar" && !showSaveButton && !missingLabel ? <span className="shrink-0">{saveStatus}</span> : null}
          {!form.id || isAutomaticSimulationSource(form.createdBy) ? (!form.id || automaticEdited) && (
            <Button variant={isAutomatic || basicMode || !form.id ? "primary" : "secondary"} size="lg" className="w-full" disabled={saving} onClick={saveSimulation}>
              <Save className="h-5 w-5" aria-hidden="true" /> {saving ? "Salvando..." : isAutomaticSimulationSource(form.createdBy) ? "Salvar correção da Caixa" : "Salvar simulação"}
            </Button>
          ) : null}
          {basicMode ? null : (<>
          <button
            className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-control px-5 text-[15px] font-semibold transition-[background-color,transform] duration-150 ease-out-ui active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100 ${sendBlockedReason ? "bg-neutral-soft text-ink-2" : "bg-[#25D366] text-white hover:bg-[#20BF5A] disabled:opacity-60"} ${place === "bar" && !showSaveButton && !missingLabel ? "min-w-0 flex-1" : "w-full"}`}
            disabled={sendingSimulation || Boolean(sendBlockedReason)}
            onClick={sendSimulationToWhatsApp}
            type="button"
          >
            <WhatsAppIcon className="h-5 w-5" /> {sendingSimulation ? "Preparando..." : "Enviar simulação"}
          </button>
          </>)}
        </div>
        {!basicMode && sendBlockedReason ? <p className={`text-center text-xs font-semibold ${isAutomatic || !form.id ? "text-warning" : "text-danger"}`}>{sendBlockedReason}</p> : null}
        {!basicMode && !sendBlockedReason && place !== "bar" ? <p className="text-xs text-muted">Enviar salva, cria o link (se ainda não existir) e abre a conversa do cliente.</p> : null}
      </div>
    );
  }

  // Cadastro do cliente: recolhido no fim da aba; numa simulação NOVA vem primeiro e aberto (nome e WhatsApp antes dos valores).
  const cadastroBlock = (
    <Disclosure
      title="Cadastro do cliente"
      summary={registrationSummary(form) || "Nome, WhatsApp, renda, regime e demais dados do cadastro"}
      actionLabel="Editar"
      open={cadastroOpen}
      onToggle={() => setCadastroOpen((current) => !current)}
    >
      <div className="grid gap-3 sm:grid-cols-2">
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
        <Field label="Data de nascimento" type="date" value={form.registration?.oldestBirthDate || ""} onChange={(value) => updateRegistration("oldestBirthDate", value)} />
        <SelectField label="Tipo de simulação" options={SIMULATION_TYPE_OPTIONS} value={form.registration?.simulationType || "individual"} onChange={(value) => updateRegistration("simulationType", value)} />
        <SelectField label="Regime de trabalho" options={PRIMARY_INCOME_OPTIONS} value={form.registration?.primaryIncomeType || "self_employed_unregistered"} onChange={(value) => updateRegistration("primaryIncomeType", value)} />
        <MoneyField label="Renda mensal" value={form.registration?.primaryMonthlyIncome || ""} onChange={(value) => updateRegistration("primaryMonthlyIncome", value)} />
        <SelectField label="Estado civil" options={MARITAL_STATUS_OPTIONS} value={form.registration?.primaryMaritalStatus || "single"} onChange={(value) => updateRegistration("primaryMaritalStatus", value)} />
        <MoneyField label="Recurso próprio / entrada" value={form.registration?.availablePurchaseResource || ""} onChange={(value) => updateRegistration("availablePurchaseResource", value)} />
        <BooleanField label="Mais de 3 anos de registro?" value={form.registration?.hasOverThreeYearsRegisteredWork} onChange={(value) => updateRegistration("hasOverThreeYearsRegisteredWork", value)} />
        <BooleanField label="Filhos menores de 18 anos?" value={form.registration?.hasChildrenUnder18} onChange={(value) => updateRegistration("hasChildrenUnder18", value)} />
        <BooleanField label="Possui imóvel residencial?" value={form.registration?.hasResidentialProperty} onChange={(value) => updateRegistration("hasResidentialProperty", value)} />
        <Field label="Início do atendimento" type="date" value={form.registration?.serviceStartedAt || ""} onChange={(value) => updateRegistration("serviceStartedAt", value)} />
        <Field label="Venda concluída em" type="date" value={form.registration?.saleCompletedAt || ""} onChange={(value) => updateRegistration("saleCompletedAt", value)} />
      </div>
      {form.registration?.simulationType === "joint" ? (
        <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
          <p className="text-sm font-semibold text-navy sm:col-span-2">Segunda pessoa</p>
          <SelectField label="Regime da segunda pessoa" options={PRIMARY_INCOME_OPTIONS} value={form.registration?.secondaryIncomeType || "self_employed_unregistered"} onChange={(value) => updateRegistration("secondaryIncomeType", value)} />
          <MoneyField label="Renda da segunda pessoa" value={form.registration?.secondaryMonthlyIncome || ""} onChange={(value) => updateRegistration("secondaryMonthlyIncome", value)} />
          <SelectField label="Estado civil da segunda pessoa" options={MARITAL_STATUS_OPTIONS} value={form.registration?.secondaryMaritalStatus || "single"} onChange={(value) => updateRegistration("secondaryMaritalStatus", value)} />
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Button variant="secondary" loading={registrationSaving} onClick={saveClientRegistration}>
          {registrationSaving ? "Salvando..." : form.registrationId ? "Atualizar cadastro" : "Criar cadastro"}
        </Button>
        {clientSheetHref ? <Link href={clientSheetHref} className="inline-flex min-h-touch items-center text-sm font-semibold text-brand hover:text-navy">Abrir ficha do cliente</Link> : null}
        <p className="w-full text-xs text-muted">Os dados do cadastro são gravados ao tocar em {form.registrationId ? "“Atualizar cadastro”" : "“Criar cadastro”"}; o refazer da simulação automática usa estes dados.</p>
      </div>
    </Disclosure>
  );

  const body = (
    <div className="container-page min-w-0 pb-6">
      <header className="flex min-h-touch flex-wrap items-center gap-x-3 gap-y-0">
        <Link href="/admin/simulacoes" className="inline-flex min-h-touch items-center gap-1.5 text-sm font-semibold text-brand transition-colors hover:text-navy">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Clientes
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold tracking-[-0.01em] text-navy sm:text-xl">{form.clientName || "Nova simulação"}</h1>
        <p className="hidden text-sm text-muted sm:block tabular-nums">
          {[form.clientWhatsApp, form.simulationDate ? `simulação de ${formatDateLabel(form.simulationDate)}` : ""].filter(Boolean).join(" · ")}
        </p>
      </header>

      {scenariosSlot ? (
        <div role="tablist" aria-label="Seções da simulação" className="mt-2 flex gap-1 border-b border-line">
          {[["simulacao", "Simulação"], ["comparar", "Comparar simulações"]].map(([value, label]) => (
            <button
              key={value}
              role="tab"
              type="button"
              aria-selected={view === value}
              onClick={() => setView(value)}
              className={`-mb-px min-h-touch whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition-colors ${view === value ? "border-brand text-navy" : "border-transparent text-muted hover:text-navy"}`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {view === "comparar" && scenariosSlot ? (
        <div className="mt-4">{scenariosSlot}</div>
      ) : (
        <>
          <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6">
            {reviewSlot ? <div className="min-w-0 lg:col-span-2">{reviewSlot}</div> : null}

            <div className="grid min-w-0 gap-4">
              {startedNew ? cadastroBlock : null}
              <Section
                title="Valores da Caixa"
                hint={<>O que o cliente vai ver na apresentação. <strong className="font-semibold text-ink">Prazo</strong> e <strong className="font-semibold text-ink">taxa</strong> são obrigatórios.</>}
              >
                <div className="flex items-center gap-2">
                  {enabledTypes.length > 1 ? (
                    <div role="tablist" aria-label="Tipo de imóvel" className="flex min-w-0 flex-1 gap-1 rounded-control bg-mist p-1">
                      {SIMULATION_MODEL_TYPES.filter(({ key }) => enabledModels[key]).map(({ key, label }) => {
                        const hasError = missingTerm && missingTerm.type === key;
                        return (
                          <button
                            key={key}
                            role="tab"
                            type="button"
                            aria-selected={shownType === key}
                            onClick={() => setActiveType(key)}
                            className={`flex min-h-touch min-w-0 flex-1 flex-wrap items-center justify-center gap-x-2 gap-y-0.5 rounded-[8px] px-2 text-sm font-semibold transition-colors ${shownType === key ? "bg-white text-navy shadow-[0_1px_3px_rgba(13,59,102,0.12)]" : "text-muted hover:text-navy"}`}
                          >
                            {label}
                            {key === "usado" && usadoMirrorsNovo ? (
                              <span className="rounded-full bg-info-soft px-1.5 py-0.5 text-2xs font-semibold text-info"><span className="sm:hidden">= novo</span><span className="hidden sm:inline">igual ao novo</span></span>
                            ) : null}
                            {hasError ? <span className="h-2 w-2 rounded-full bg-danger-strong" aria-label="Falta campo obrigatório" /> : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="min-w-0 flex-1 text-[15px] font-semibold text-navy">{enabledTypes[0]?.label}</p>
                  )}
                  <details className="relative shrink-0">
                    <summary className="flex min-h-touch cursor-pointer list-none items-center gap-1 rounded-control px-2 text-sm font-semibold text-brand hover:bg-navy/[0.06] [&::-webkit-details-marker]:hidden">
                      Tipos <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    </summary>
                    <fieldset className="absolute right-0 z-20 mt-1 w-72 rounded-card border border-line bg-white p-3 shadow-float">
                      <legend className="sr-only">Tipos de imóvel desta simulação</legend>
                      <p className="text-sm font-semibold text-navy">Tipos de imóvel desta simulação</p>
                      {SIMULATION_MODEL_TYPES.map(({ key, label }) => {
                        const onlyOne = enabledModels[key] && enabledTypes.length === 1;
                        return (
                          <label key={key} className={`flex min-h-touch items-center gap-2 text-sm font-semibold text-navy ${onlyOne ? "opacity-70" : "cursor-pointer"}`}>
                            <input type="checkbox" className="h-5 w-5 accent-brand" checked={Boolean(enabledModels[key])} disabled={onlyOne} onChange={(event) => setModelEnabled(key, event.target.checked)} data-model-toggle={key} />
                            {label}
                          </label>
                        );
                      })}
                      <p className="mt-1 text-xs leading-5 text-muted">
                        Desmarque o tipo que o cliente não quer: os valores dele são apagados e a apresentação mostra só o outro, sem comparação entre novo e usado.
                      </p>
                    </fieldset>
                  </details>
                </div>

                {SIMULATION_MODEL_TYPES.filter(({ key }) => enabledModels[key]).map(({ key, label }) => key !== shownType ? null : (
                  <div key={key} role="tabpanel" aria-label={label} className="mt-4">
                    {key === "usado" && usadoMirrorsNovo ? (
                      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control bg-info-soft px-3 py-2 text-sm text-navy">
                        <p className="min-w-0 flex-1">Financiamento e parcelas estão <strong className="font-semibold">iguais ao novo</strong> e acompanham o que você lançar lá.</p>
                        <Button size="md" variant="secondary" onClick={useOwnUsadoValues}>Usar valores próprios</Button>
                      </div>
                    ) : null}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-system="price">
                      <MoneyField label="Financiamento" value={normalizedModels[key]?.financingValue || ""} onChange={(value) => updateSimulationModel(key, "financingValue", value)} />
                      <MoneyField label="Subsídio" value={normalizedModels[key]?.subsidyValue || ""} onChange={(value) => updateSimulationModel(key, "subsidyValue", value)} />
                      {rateField()}
                      <MoneyField label="1ª parcela" value={normalizedModels[key]?.firstInstallment || ""} onChange={(value) => updateSimulationModel(key, "firstInstallment", value)} />
                      <MoneyField label="Última parcela" value={normalizedModels[key]?.lastInstallment || ""} onChange={(value) => updateSimulationModel(key, "lastInstallment", value)} />
                      {termField(key)}
                    </div>

                    {sacOpen[key] || modelHasSac(normalizedModels[key]) ? (
                      <div className="mt-5 border-t border-line pt-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-navy">SAC · {label.toLowerCase()}</h3>
                            <p className="text-xs leading-5 text-muted">Opcional. Com o SAC preenchido (além do Price), a apresentação mostra o comparativo SAC x Price.</p>
                          </div>
                          {!modelHasSac(normalizedModels[key]) ? (
                            <Button size="md" variant="ghost" onClick={() => setSacOpen((current) => ({ ...current, [key]: false }))}>Esconder SAC</Button>
                          ) : null}
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3" data-system="sac">
                          <MoneyField label="Financiamento (SAC)" value={normalizedModels[key]?.sac?.financingValue || ""} onChange={(value) => updateSacModel(key, "financingValue", value)} />
                          <MoneyField label="Subsídio (SAC)" value={normalizedModels[key]?.sac?.subsidyValue || ""} onChange={(value) => updateSacModel(key, "subsidyValue", value)} />
                          <Field
                            label="Prazo em meses (SAC)"
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            placeholder="Ex.: 420"
                            autoComplete="off"
                            value={normalizedModels[key]?.sac?.termMonths || ""}
                            error={missingTerm && missingTerm.type === key && missingTerm.system === "sac" ? "Informe o prazo para salvar e enviar." : ""}
                            onChange={(value) => updateSacModel(key, "termMonths", cleanTermMonths(value))}
                          />
                          <MoneyField label="1ª parcela (SAC)" value={normalizedModels[key]?.sac?.firstInstallment || ""} onChange={(value) => updateSacModel(key, "firstInstallment", value)} />
                          <MoneyField label="Última parcela (SAC)" value={normalizedModels[key]?.sac?.lastInstallment || ""} onChange={(value) => updateSacModel(key, "lastInstallment", value)} />
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 border-t border-dashed border-line pt-1">
                        <Button size="md" variant="ghost" className="-ml-2 text-brand" onClick={() => setSacOpen((current) => ({ ...current, [key]: true }))}>
                          <Plus className="h-4 w-4" aria-hidden="true" /> Comparar com SAC
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
                {!isAutomatic && redoSlot ? <div className="mt-4 border-t border-line pt-4">{redoSlot}</div> : null}
              </Section>

              <Section title="Recursos do cliente">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <MoneyField label="Entrada disponível" value={form.downPaymentValue} onChange={(value) => update("downPaymentValue", value)} />
                  <MoneyField label="FGTS disponível" value={form.fgtsValue} onChange={(value) => update("fgtsValue", value)} />
                  <label className="col-span-2 flex min-h-touch cursor-pointer items-center gap-3 self-end text-sm font-medium text-ink sm:col-span-1">
                    <Switch checked={Boolean(form.showExpandedPower)} onChange={(value) => update("showExpandedPower", value)} label="Mostrar poder de compra ampliado na apresentação" />
                    Mostrar poder ampliado na apresentação
                  </label>
                </div>
              </Section>

              <Section
                title={<>Imóveis da apresentação {form.properties.length ? <span className="font-medium text-muted">({form.properties.length})</span> : null}</>}
                hint={form.properties.length > 1 ? "Arraste para mudar a ordem." : preferenceLine ? `O cliente procura: ${preferenceLine}` : ""}
                action={<Button variant="secondary" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" aria-hidden="true" /> Adicionar imóvel</Button>}
              >
                {form.properties.length ? (
                  <ol className="grid">
                    {form.properties.map((property, propertyIndex) => (
                      <li
                        key={`${property.propertyId}-${propertyIndex}`}
                        {...propertyDrag.itemProps(propertyIndex)}
                        className={`grid grid-cols-[16px_56px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-line py-3 last:border-b-0 sm:grid-cols-[20px_72px_minmax(0,1fr)_auto] sm:gap-3 ${propertyDrag.itemClass(propertyIndex)}`}
                      >
                        <GripVertical className="h-5 w-5 text-faint" aria-hidden="true" />
                        {property.imageUrl ? <img src={property.imageUrl} alt="" className="h-12 w-14 rounded-control object-cover sm:h-14 sm:w-[72px]" /> : <span className="h-12 w-14 rounded-control bg-mist sm:h-14 sm:w-[72px]" />}
                        <div className="min-w-0">
                          <p className="line-clamp-2 font-semibold leading-5 text-navy">{propertyIndex + 1} · {property.customName || "Imóvel sugerido"}</p>
                          <p className="text-[13px] text-muted">{[property.customType, property.customLocation].filter(Boolean).join(" · ")}{property.customPrice ? <>{property.customType || property.customLocation ? " · " : ""}<span className="whitespace-nowrap">{property.customPrice}</span></> : null}</p>
                          {property.benefits.length ? (
                            <p className="mt-1 flex flex-wrap gap-1">
                              {property.benefits.slice(0, 2).map((benefit) => <span key={benefit.text} className="rounded-chip bg-info-soft px-1.5 py-0.5 text-2xs font-semibold text-navy">{shortBenefitLabel(benefit.text)}</span>)}
                              {property.benefits.length > 2 ? <span className="px-1 text-2xs font-semibold text-muted">+{property.benefits.length - 2}</span> : null}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex justify-end">
                          <Button variant="ghost" className="min-w-touch px-2 text-brand" aria-label={`Editar imóvel ${propertyIndex + 1}`} onClick={() => setEditingIndex(propertyIndex)}><Pencil className="h-4 w-4 sm:hidden" aria-hidden="true" /><span className="hidden sm:inline">Editar</span></Button>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="rounded-control bg-mist px-4 py-5 text-center text-sm text-muted">Nenhum imóvel ainda. Adicione os que vão na apresentação do cliente.</p>
                )}
              </Section>

              <Disclosure
                title="Observações"
                summary={[form.publicNote ? "para o cliente preenchida" : "", form.internalNote ? "interna preenchida" : ""].filter(Boolean).join(" · ") || "Para o cliente (aparece na apresentação), interna e data da simulação"}
                open={notesOpen}
                onToggle={() => setNotesOpen((current) => !current)}
              >
                <div className="grid gap-3">
                  <Field label="Observação pública" textarea hint="Aparece para o cliente na apresentação." value={form.publicNote} onChange={(value) => update("publicNote", value)} />
                  <Field label="Observação interna" textarea hint="Só a equipe vê." value={form.internalNote} onChange={(value) => update("internalNote", value)} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Data da simulação" type="date" value={form.simulationDate} onChange={(value) => update("simulationDate", value)} />
                  </div>
                </div>
              </Disclosure>

              {startedNew ? null : cadastroBlock}
            </div>

            <aside className="min-w-0 lg:sticky lg:top-4">
              <div className="rounded-card border border-line bg-white p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-bold text-navy">Poder de compra</h2>
                  <span className={basicMode ? "inline-flex" : "hidden lg:inline-flex"}>{saveStatus}</span>
                </div>
                {filledModels.length ? (
                  <dl className="mt-3 grid grid-cols-2 gap-2">
                    {renderableModels.map((model) => (
                      <div key={`${model.type}-${model.system}`} className="min-w-0 rounded-control bg-info-soft px-3 py-2">
                        <dt className="truncate text-xs font-medium text-ink-2">{simulationModelLabel(model.type)}{model.systemLabel ? ` · ${model.systemLabel}` : ""}</dt>
                        <dd className="text-lg font-bold tabular-nums text-navy">{formatCurrency(model.totals.total)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="mt-2 text-sm text-muted">Lance os valores da Caixa para ver o poder de compra.</p>
                )}
                {basicMode ? (
                  <p className="mt-4 rounded-control border border-warning-line bg-warning-soft px-3 py-2 text-sm font-medium text-warning">
                    CRM básico: sua automação está desativada. Aqui você lança os valores da simulação para controle (eles são salvos automaticamente); a apresentação interativa fica indisponível. Fale com a gestão para reativar.
                  </p>
                ) : null}
                <div className="mt-4 hidden lg:block">{renderActions("aside")}</div>
                {presentationSlot ? <div className="mt-4">{presentationSlot}</div> : null}
              </div>
            </aside>
          </div>

          {showSaveButton || !basicMode || error || message ? (
            <div className="sticky bottom-[var(--admin-bottom-nav-space,0px)] z-20 mt-4 rounded-card border border-line bg-white/95 p-3 shadow-float backdrop-blur lg:hidden">
              {showSaveButton || missingLabel ? <div className="mb-2 flex items-center justify-between gap-2">{saveStatus}</div> : null}
              {renderActions("bar")}
            </div>
          ) : null}
        </>
      )}

      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Adicionar imóvel" description="Toque em Incluir; os já incluídos somem da lista.">
        {clientPreferences.length ? (
          <div className="mb-4 rounded-control bg-info-soft p-3">
            <p className="text-sm font-semibold text-navy">O que o cliente procura</p>
            <dl className="mt-1 grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {clientPreferences.map((item) => (
                <div key={item.label} className="min-w-0">
                  <dt className="text-xs text-muted">{item.label}</dt>
                  <dd className="text-sm font-medium text-ink">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
        <label className="relative block">
          <span className="sr-only">Pesquisar imóvel</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-brand" aria-hidden="true" />
          <input
            className={`${inputClasses} pl-10`}
            value={propertyQuery}
            onChange={(event) => setPropertyQuery(event.target.value)}
            placeholder="Nome, região, valor ou construtora"
          />
        </label>
        <ul className="mt-3 grid">
          {filteredProperties.slice(0, 10).map((property) => (
            <li key={property.id} className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line py-2.5 last:border-b-0">
              <img src={coverImage(property)} alt="" className="h-12 w-16 rounded-control object-cover" />
              <span className="min-w-0">
                <span className="block truncate font-semibold text-navy">{property.name}</span>
                <span className="block truncate text-[13px] text-muted">{typeLabel(property.type)} · {propertyRegion(property)} · {propertyPrice(property)}</span>
              </span>
              <Button variant="secondary" onClick={() => addProperty(property)}><Plus className="h-4 w-4" aria-hidden="true" /> Incluir</Button>
            </li>
          ))}
        </ul>
        {!filteredProperties.length ? <p className="py-6 text-center text-sm text-muted">Nenhum imóvel encontrado.</p> : null}
      </Sheet>

      <Sheet
        open={Boolean(editingProperty)}
        onClose={() => setEditingIndex(null)}
        title={editingProperty ? `Imóvel ${editingIndex + 1}` : ""}
        description="Mudanças valem só para esta apresentação; o cadastro do imóvel não muda."
        footer={editingProperty ? (
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="danger-ghost" onClick={() => { removeProperty(editingIndex); setEditingIndex(null); }}><Trash2 className="h-4 w-4" aria-hidden="true" /> Remover da apresentação</Button>
            <Button onClick={() => setEditingIndex(null)}>Pronto</Button>
          </div>
        ) : null}
      >
        {editingProperty ? (
          <div className="grid gap-4">
            {editingProperty.imageUrl ? <img src={editingProperty.imageUrl} alt="" className="h-36 w-full rounded-card object-cover" /> : null}
            <div className="grid grid-cols-2 gap-3">
              <Field className="col-span-2" label="Nome na apresentação" value={editingProperty.customName} onChange={(value) => updateSelectedProperty(editingIndex, "customName", value)} />
              <Field label="Valor na apresentação" value={editingProperty.customPrice} onChange={(value) => updateSelectedProperty(editingIndex, "customPrice", value)} />
              <Field label="Localização" value={editingProperty.customLocation} onChange={(value) => updateSelectedProperty(editingIndex, "customLocation", value)} />
              <Field label="Tipo" value={editingProperty.customType} onChange={(value) => updateSelectedProperty(editingIndex, "customType", value)} />
              <Field label="Área" value={editingProperty.customArea} onChange={(value) => updateSelectedProperty(editingIndex, "customArea", value)} />
              <Field label="Dormitórios" value={editingProperty.customBedrooms} onChange={(value) => updateSelectedProperty(editingIndex, "customBedrooms", value)} />
              <Field label="Construtora" value={editingProperty.customBuilder} onChange={(value) => updateSelectedProperty(editingIndex, "customBuilder", value)} />
              <Field label="Entrega" value={editingProperty.customDelivery} onChange={(value) => updateSelectedProperty(editingIndex, "customDelivery", value)} />
            </div>
            <div className="grid gap-2">
              <SelectField
                label="Motivo pronto"
                options={[...(RECOMMENDATION_REASONS.includes(editingProperty.recommendationReason) ? [] : [{ value: editingProperty.recommendationReason || "", label: "Motivo personalizado (abaixo)" }]), ...RECOMMENDATION_REASONS.map((reason) => ({ value: reason, label: reason }))]}
                value={editingProperty.recommendationReason}
                onChange={(value) => updateSelectedProperty(editingIndex, "recommendationReason", value)}
              />
              <Field textarea label="Por que este imóvel foi sugerido?" value={editingProperty.recommendationReason} onChange={(value) => updateSelectedProperty(editingIndex, "recommendationReason", value)} />
            </div>
            <div>
              <p className="text-sm font-semibold text-navy">Benefícios e destaques</p>
              <p className="text-xs text-muted">Toque para ligar ou desligar.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {BENEFIT_OPTIONS.map((benefit) => {
                  const on = editingProperty.benefits.some((item) => item.text === benefit);
                  return (
                    <button
                      key={benefit}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleBenefit(editingIndex, benefit)}
                      className={`inline-flex min-h-touch items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors ${on ? "border-navy bg-navy text-white" : "border-line bg-white text-navy hover:border-brand/40"}`}
                    >
                      {on ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}{benefit}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  className={inputClasses}
                  aria-label="Adicionar benefício personalizado"
                  value={editingProperty.customBenefitDraft || ""}
                  onChange={(event) => updateSelectedProperty(editingIndex, "customBenefitDraft", event.target.value)}
                  placeholder="Benefício personalizado"
                />
                <Button variant="secondary" onClick={() => addCustomBenefit(editingIndex, editingProperty.customBenefitDraft || "")}>Adicionar</Button>
              </div>
              {editingProperty.benefits.length ? (
                <>
                  <p className="mt-4 text-sm font-semibold text-navy">Ordem na apresentação</p>
                  <p className="text-xs text-muted">Arraste para ordenar.</p>
                  <BenefitOrderList benefits={editingProperty.benefits} onMove={(from, to) => moveBenefit(editingIndex, from, to)} onRemove={(benefitIndex) => removeBenefit(editingIndex, benefitIndex)} />
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </Sheet>
    </div>
  );

  return (
    <SimulationTabContext.Provider value={{
      compactPresentation: true,
      embeddedScenarios: true,
      reviewExtras: {
        before: incomeForCaixa ? (
          <p className="inline-flex flex-wrap gap-x-1 rounded-control border border-warning-line bg-white px-3 py-2 text-sm text-navy tabular-nums">
            <span className="text-ink-2">Renda para usar na Caixa —</span> <strong className="font-semibold">{incomeForCaixa}</strong>
          </p>
        ) : null,
        actions: redoSlot
      }
    }}>
      {body}
    </SimulationTabContext.Provider>
  );
}

function Section({ title, hint = "", action = null, children }) {
  return (
    <section className="min-w-0 rounded-card border border-line bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-navy">{title}</h2>
          {hint ? <p className="mt-0.5 text-sm text-muted">{hint}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

// Bloco recolhível (Observações, Cadastro): título + resumo de uma linha; abre ali mesmo.
function Disclosure({ title, summary, actionLabel = "Abrir", open, onToggle, children }) {
  const id = useId();
  return (
    <section className="min-w-0 rounded-card border border-line bg-white">
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id} className="flex min-h-16 w-full items-center gap-3 rounded-card px-4 py-3 text-left transition-colors hover:bg-mist/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand sm:px-5">
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold text-navy">{title}</span>
          <span className="block truncate text-[13px] text-muted">{summary}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand">
          {open ? "Fechar" : actionLabel}
          <ChevronDown className={`h-4 w-4 transition-transform duration-200 ease-out-ui ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </span>
      </button>
      {open ? <div id={id} className="border-t border-line px-4 pb-5 pt-4 sm:px-5">{children}</div> : null}
    </section>
  );
}

function ConfirmBadge() {
  return <span className="rounded-full bg-warning-soft px-1.5 py-0.5 text-2xs font-semibold text-warning">confira</span>;
}

function SuggestionButton({ children, onClick }) {
  return (
    <button type="button" onClick={onClick} className="min-h-touch text-left text-xs font-semibold text-brand underline-offset-4 hover:underline">
      {children}
    </button>
  );
}

function Field({ label, onChange, textarea = false, type = "text", value, hint = "", error = "", required = false, badge = null, className = "", ...props }) {
  const id = useId();
  const Component = textarea ? "textarea" : "input";
  const messageId = error || hint ? `${id}-msg` : undefined;
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="flex flex-wrap items-center gap-x-1.5 text-sm font-medium text-ink">
        <span>{label}{required ? <span className="ml-0.5 text-danger" aria-hidden="true">*</span> : null}</span>
        {badge}
      </label>
      <Component
        id={id}
        className={`${inputClasses} min-w-0 tabular-nums ${textarea ? "min-h-24 py-2.5" : ""}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={messageId}
        aria-required={required || undefined}
        {...(textarea ? props : { type, ...props })}
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? <p id={messageId} className="text-xs font-medium text-danger">{error}</p> : hint ? <div id={messageId} className="text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

function SelectField({ label, onChange, options = [], value }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">{label}</label>
      <select id={id} className={`${inputClasses} min-w-0`} value={value || ""} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

function BooleanField({ label, onChange, value }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">{label}</label>
      <select
        id={id}
        className={`${inputClasses} min-w-0`}
        value={value === true ? "true" : value === false ? "false" : ""}
        onChange={(event) => onChange(event.target.value === "true")}
      >
        <option value="false">Não</option>
        <option value="true">Sim</option>
      </select>
    </div>
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

function Alert({ children, tone, compact = false }) {
  const classes = tone === "success"
    ? "border-success-line bg-success-soft text-success"
    : "border-danger-line bg-danger-soft text-danger";
  return <div role={tone === "success" ? "status" : "alert"} className={`rounded-control border font-medium ${compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm"} ${classes}`}>{children}</div>;
}

function modelHasSac(model) {
  const sac = model?.sac || {};
  return ["financingValue", "subsidyValue", "firstInstallment", "lastInstallment", "termMonths"].some((field) => String(sac[field] || "").trim());
}

// Rótulo curto só para a etiqueta da lista (o texto completo continua na apresentação e na edição).
function shortBenefitLabel(text) {
  return text === "Subsídio do Minha Casa Minha Vida" ? "Subsídio MCMV" : text;
}

function formatDateLabel(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

function optionLabel(options, value) {
  return options.find((option) => option.value === value)?.label || "";
}

// Resumo de uma linha do cadastro (bloco recolhido). Só exibe o que está preenchido.
function registrationSummary(form) {
  const registration = form.registration || {};
  const income = registration.primaryMonthlyIncome ? `renda ${registration.primaryMonthlyIncome}` : "";
  const birth = registration.oldestBirthDate ? `nasc. ${formatDateLabel(registration.oldestBirthDate)}` : "";
  return [
    form.clientWhatsApp,
    optionLabel(PRIMARY_INCOME_OPTIONS, registration.primaryIncomeType),
    income,
    birth,
    optionLabel(MARITAL_STATUS_OPTIONS, registration.primaryMaritalStatus),
    registration.hasChildrenUnder18 ? "com filhos" : ""
  ].filter(Boolean).join(" · ");
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
  if (status === "saving") return "Salvando…";
  if (status === "saved") return "Salvo";
  if (status === "error") return "Erro ao salvar";
  return "Salvamento automático ativo";
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


function BenefitOrderList({ benefits, onMove, onRemove }) {
  const drag = useDragReorder(onMove);
  return (
    <ol className="mt-2 grid gap-1.5">
      {benefits.map((benefit, benefitIndex) => (
        <li key={`${benefit.text}-${benefitIndex}`} {...drag.itemProps(benefitIndex)} className={`flex items-center justify-between gap-3 rounded-control bg-mist pl-3 ${drag.itemClass(benefitIndex)}`}>
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-navy"><GripVertical className="h-4 w-4 shrink-0 text-faint" aria-hidden="true" />{benefit.text}</span>
          <button
            aria-label={`Remover ${benefit.text}`}
            className="inline-flex h-touch w-touch shrink-0 items-center justify-center rounded-control text-danger transition-colors hover:bg-danger-soft"
            onClick={() => onRemove(benefitIndex)}
            type="button"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ol>
  );
}

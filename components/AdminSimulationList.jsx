"use client";
import ClientDocumentsModal from "@/components/ClientDocumentsModal";
import ClientJourneyActions from "@/components/ClientJourneyActions";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calculator,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  SlidersHorizontal,
  TriangleAlert,
  Trash2,
  UserRound,
  X
} from "lucide-react";
import {
  CLIENT_FUNNEL_SALE_STATUS_VALUES,
  CLIENT_STATUS,
  CLIENT_STATUS_FILTER_GROUPS,
  CLIENT_STATUS_META,
  isOverdueActivityClient,
  isStaleContactClient,
  mergeActivitySignal,
  normalizeClientStatus
} from "@/lib/client-status";
import { buildWhatsAppUrl, formatBrazilianPhone, toWhatsAppDigits } from "@/lib/phone-utils";
import { resolveClientWhatsappDestination } from "@/lib/whatsapp-contact-channel";
import {
  booleanLabel,
  calculateFamilyIncome,
  formatCurrency,
  formatDateBR,
  formatDateTimeBR,
  incomeTypeLabel,
  maritalStatusLabel,
  simulationTypeLabel
} from "@/lib/simulation-registration-schema";
import { getPropertyPreferenceDetails, getPropertyPreferenceSummary } from "@/lib/property-preferences";
import { getDoNotContactReasonOptions } from "@/lib/do-not-contact-reasons";
import { formatMoneyBR } from "@/lib/simulation-list-utils";

const PAGE_SIZE_OPTIONS = [5, 10, 20];
const ACTIVITY_TYPE_OPTIONS = [
  { value: "follow_up", label: "Follow-up" },
  { value: "documentacao", label: "Documentação" },
  { value: "ligacao", label: "Ligação" },
  { value: "reuniao", label: "Reunião" },
  { value: "visita", label: "Visita" },
  { value: "outro", label: "Outro" }
];
const SALE_STATUS_OPTIONS = [{ value: CLIENT_STATUS.SALE_COMPLETED, label: "Venda realizada" }];
const SALE_STATUS_VALUES = new Set(CLIENT_FUNNEL_SALE_STATUS_VALUES);
const MAIN_STATUS_VALUES = [
  CLIENT_STATUS.PENDING,
  CLIENT_STATUS.COMPLETED,
  CLIENT_STATUS.SIMULATION_SENT,
  CLIENT_STATUS.AWAITING_RETURN,
  CLIENT_STATUS.IN_SERVICE,
  CLIENT_STATUS.DOCUMENTATION,
  CLIENT_STATUS.DOCUMENTS_PENDING,
  CLIENT_STATUS.APPROVAL_PENDING,
  CLIENT_STATUS.RESTRICTION,
  CLIENT_STATUS.SHIELDING,
  CLIENT_STATUS.APPROVED,
  CLIENT_STATUS.REJECTED,
  CLIENT_STATUS.MEETING_PENDING,
  CLIENT_STATUS.MEETING_DONE,
  CLIENT_STATUS.ARCHIVED,
  CLIENT_STATUS.DO_NOT_CONTACT
];
const MAIN_STATUS_OPTIONS = MAIN_STATUS_VALUES.map((value) => ({ value, label: CLIENT_STATUS_META[value].label }));
const TAG_COLORS = [
  { label: "Azul institucional", value: "#0D4F8B" },
  { label: "Azul vivo", value: "#1D4ED8" },
  { label: "Verde", value: "#047857" },
  { label: "Vermelho", value: "#B91C1C" },
  { label: "Amarelo", value: "#CA8A04" },
  { label: "Cinza", value: "#475569" },
  { label: "Roxo", value: "#7C3AED" },
  { label: "Ciano", value: "#0891B2" },
  { label: "Rosa", value: "#BE185D" },
  { label: "Preto suave", value: "#1F2937" }
];

const DEFAULT_FILTERS = {
  query: "",
  responsibleUserId: "all",
  tagId: "all",
  pendingOnly: false,
  staleContactOnly: false,
  noFutureActivityOnly: false,
  statusGroup: "all",
  status: "all"
};

// Cliente não arquivado sem atividade futura (legada ou extra) e sem contato
// há mais de 3 dias — mesma regra que decidia o selo vermelho "Pendentes" no
// topo, agora também reaproveitada para o indicador de urgência do card.
function isPendingClient(client, extraActivities) {
  if ([CLIENT_STATUS.ARCHIVED, CLIENT_STATUS.DO_NOT_CONTACT].includes(client.status)) return false;
  const merged = mergeActivitySignal(client, extraActivities);
  const now = Date.now();
  const scheduledAt = new Date(merged.scheduledActivityAt || "").getTime();
  if (Number.isFinite(scheduledAt) && scheduledAt > now) return false;
  const referenceAt = new Date(client.lastWhatsappContactAt || client.createdAt || "").getTime();
  return Number.isFinite(referenceAt) && referenceAt < now - (3 * 24 * 60 * 60 * 1000);
}

// Único indicador de urgência do card — usa só sinais que já existem no CRM
// (atividade atrasada > sem contato recente > pendente), sem criar um score
// novo. Ordem = prioridade: o primeiro que bater é o único mostrado.
function getUrgencySignal(client, extraActivities) {
  if (isOverdueActivityClient(client)) {
    return { key: "overdue", label: "Atividade atrasada" };
  }
  if (isStaleContactClient(client)) {
    return { key: "stale", label: "Sem contato há +3 dias" };
  }
  if (isPendingClient(client, extraActivities)) {
    return { key: "pending", label: "Aguardando ação" };
  }
  return null;
}

export default function AdminSimulationList({
  adminProfiles = [],
  canManageResponsibleUsers = false,
  canReturnAssignedProspecting = false,
  isOwner = false,
  initialData,
  initialFilters,
  tags = []
}) {
  const router = useRouter();
  const listTopRef = useRef(null);

  const [filters, setFilters] = useState(() => ({ ...DEFAULT_FILTERS, ...initialFilters }));
  const [searchInput, setSearchInput] = useState(() => initialFilters?.query || "");
  const [pageSize, setPageSize] = useState(() => (PAGE_SIZE_OPTIONS.includes(initialData?.pageSize) ? initialData.pageSize : PAGE_SIZE_OPTIONS[0]));
  const [page, setPage] = useState(() => initialData?.page || 1);

  const [items, setItems] = useState(() => initialData?.items || []);
  const [total, setTotal] = useState(() => initialData?.total || 0);
  const [totalPages, setTotalPages] = useState(() => initialData?.totalPages || 1);
  const [counters, setCounters] = useState(() => initialData?.counters || { all: 0, byStatus: {}, byGroup: {} });
  const [pendingClientsCount, setPendingClientsCount] = useState(() => initialData?.pendingClientsCount || 0);
  const [localClientActivities, setLocalClientActivities] = useState(() => initialData?.clientActivities || {});
  const [loading, setLoading] = useState(false);
  const [loadWarning, setLoadWarning] = useState("");

  const [localTags, setLocalTags] = useState(() => ensureArray(tags));
  const [tagDraft, setTagDraft] = useState("");
  const [tagColor, setTagColor] = useState(TAG_COLORS[0].value);
  const [expandedClientId, setExpandedClientId] = useState("");
  const [editingTagsClientId, setEditingTagsClientId] = useState("");
  const [busyClientId, setBusyClientId] = useState("");
  const [dncTarget, setDncTarget] = useState(null);
  const [schedulingClientId, setSchedulingClientId] = useState("");
  const [scheduleDraft, setScheduleDraft] = useState({ date: "", time: "", type: "follow_up", note: "" });
  const [addingActivityClientId, setAddingActivityClientId] = useState("");
  const [newActivityDraft, setNewActivityDraft] = useState({ date: "", time: "", type: "follow_up", note: "" });
  const [expandedActivitiesClientId, setExpandedActivitiesClientId] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const responsibleProfiles = useMemo(() => (
    ensureArray(adminProfiles).filter((profile) => profile.id && profile.status !== "inactive")
  ), [adminProfiles]);
  const responsibleProfileMap = useMemo(() => new Map(
    responsibleProfiles.map((profile) => [profile.id, profile])
  ), [responsibleProfiles]);

  // Debounce da busca: só entra como filtro (e refaz a consulta) 350ms depois
  // de o usuário parar de digitar — evita uma consulta ao banco por tecla.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput !== filters.query) updateFilters({ query: searchInput });
    }, 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    fetchClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page, pageSize]);

  // Vindo de outra tela (ex.: Central de Oportunidades, "Abrir cliente" ->
  // /admin/simulacoes?clientId=X) — expande o card desse cliente ao montar,
  // sem mexer no filtro/paginação atual da lista.
  useEffect(() => {
    const clientId = new URLSearchParams(window.location.search).get("clientId");
    if (clientId) setExpandedClientId(clientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateFilters(patch) {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }

  async function fetchClients() {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.query) params.set("query", filters.query);
    if (filters.responsibleUserId !== "all") params.set("responsibleUserId", filters.responsibleUserId);
    if (filters.tagId !== "all") params.set("tagId", filters.tagId);
    if (filters.pendingOnly) params.set("pending", "1");
    if (filters.staleContactOnly) params.set("staleContact", "1");
    if (filters.noFutureActivityOnly) params.set("noFutureActivity", "1");
    if (filters.statusGroup !== "all") params.set("statusGroup", filters.statusGroup);
    if (filters.status !== "all") params.set("status", filters.status);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));

    try {
      const response = await fetch(`/api/simulation-registrations/list?${params.toString()}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLoadWarning(data.error || "Não foi possível carregar os clientes.");
        return;
      }
      setLoadWarning("");
      setItems(data.items || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
      setCounters(data.counters || { all: 0, byStatus: {}, byGroup: {} });
      setPendingClientsCount(data.pendingClientsCount || 0);
      setLocalClientActivities(data.clientActivities || {});
    } catch {
      setLoadWarning("Não foi possível carregar os clientes.");
    } finally {
      setLoading(false);
    }
  }

  function goToPage(nextPage) {
    const clamped = Math.min(Math.max(nextPage, 1), totalPages);
    setPage(clamped);
    listTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Atualização otimista de um cliente já carregado nesta página — deixa a UI
  // reagir na hora, sem esperar o refetch. Quando o campo alterado pode mudar
  // a que aba/filtro o cliente pertence, refreshAfter mantém a paginação e os
  // contadores corretos buscando a página de novo logo em seguida.
  function patchClientRegistration(clientId, patch, { refreshAfter = false } = {}) {
    setItems((current) => current.map((item) => {
      if (item.id !== clientId) return item;
      const nextRegistration = { ...item.registration, ...patch, tags: item.registration.tags || patch.tags || [] };
      const nextStatus = patch.status !== undefined ? normalizeClientStatus(patch.status) : item.status;
      return { ...item, registration: nextRegistration, status: nextStatus };
    }));
    if (refreshAfter) fetchClients();
  }

  function removeClientLocally(clientId) {
    setItems((current) => current.filter((item) => item.id !== clientId));
    fetchClients();
  }

  async function ensureSimulationId(client) {
    if (client.simulation?.id) {
      await touchClientRegistration(client);
      return client.simulation.id;
    }

    setBusyClientId(client.id);
    try {
      const response = await fetch("/api/simulations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildDraftSimulationPayload(client.registration))
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        alert(data.error || "Não foi possível abrir a simulação deste cliente.");
        return "";
      }

      return data.id;
    } finally {
      setBusyClientId("");
    }
  }

  async function openSimulation(client) {
    const id = await ensureSimulationId(client);
    if (!id) return;
    router.push(`/admin/simulacoes/${id}/empreendimentos`);
  }

  async function openValues(client) {
    const id = await ensureSimulationId(client);
    if (!id) return;
    router.push(`/admin/simulacoes/${id}`);
  }

  async function removeClient(client) {
    const clientName = client.name || "este cliente";
    if (!confirm(`Excluir o cadastro de "${clientName}"?`)) return;

    setBusyClientId(client.id);
    try {
      if (client.simulation?.id) {
        const simulationResponse = await fetch(`/api/simulations/${client.simulation.id}`, { method: "DELETE" });
        if (!simulationResponse.ok) {
          const data = await simulationResponse.json().catch(() => ({}));
          alert(data.error || "Não foi possível excluir a simulação.");
          return;
        }
      }

      const registrationResponse = await fetch(`/api/simulation-registrations/${client.registration.id}`, { method: "DELETE" });
      if (!registrationResponse.ok) {
        const data = await registrationResponse.json().catch(() => ({}));
        alert(data.error || "Não foi possível excluir o cadastro.");
        return;
      }

      removeClientLocally(client.id);
    } finally {
      setBusyClientId("");
    }
  }

  async function touchClientRegistration(client) {
    setBusyClientId(client.id);
    try {
      const response = await fetch(`/api/simulation-registrations/${client.registration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        console.error("Nao foi possivel registrar a atividade administrativa:", data.error || response.statusText);
        return client.registration;
      }

      patchClientRegistration(client.id, data);
      return data;
    } catch (error) {
      console.error("Nao foi possivel registrar a atividade administrativa:", error);
      return client.registration;
    } finally {
      setBusyClientId("");
    }
  }

  async function updateClientStatus(client, status) {
    const nextStatus = normalizeClientStatus(status);
    setBusyClientId(client.id);
    try {
      const response = await fetch(`/api/simulation-registrations/${client.registration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        alert(data.error || "Não foi possível atualizar o status.");
        return;
      }

      patchClientRegistration(client.id, { ...data, status: nextStatus }, { refreshAfter: true });
    } finally {
      setBusyClientId("");
    }
  }

  async function updateClientResponsibleUser(client, responsibleUserId) {
    if (!canManageResponsibleUsers) return;

    setBusyClientId(client.id);
    try {
      const response = await fetch(`/api/simulation-registrations/${client.registration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responsibleUserId })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        alert(data.error || "Não foi possível alterar o corretor responsável.");
        return;
      }

      patchClientRegistration(client.id, data, { refreshAfter: true });
    } finally {
      setBusyClientId("");
    }
  }

  async function handleProspectingAction(client, action, extraPayload = {}) {
    if (action === "do_not_contact") { setDncTarget(client); return; }
    if (action === "return_to_queue" && !confirm("Devolver este cliente imediatamente para a fila de prospecção?")) return;
    const whatsappWindow = action === "prospect" ? window.open("about:blank", "_blank") : null;
    setBusyClientId(client.id);
    try {
      const response = await fetch(`/api/prospecting/clients/${client.registration.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extraPayload }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { whatsappWindow?.close(); alert(data.error || "Não foi possível atualizar a prospecção."); return; }
      if (data.whatsappUrl && whatsappWindow) whatsappWindow.location.href = data.whatsappUrl;
      if (data.removed) removeClientLocally(client.id);
      else patchClientRegistration(client.id, { status: data.status, prospectingAssignedPending: data.prospectingAssignedPending ?? client.registration.prospectingAssignedPending }, { refreshAfter: true });
    } finally { setBusyClientId(""); }
  }

  async function confirmDoNotContact(reasonKey, reasonText) {
    const client = dncTarget;
    if (!client) return;
    setDncTarget(null);
    setBusyClientId(client.id);
    try {
      const response = await fetch(`/api/prospecting/clients/${client.registration.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "do_not_contact", reasonKey, reasonText }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { alert(data.error || "Não foi possível registrar \"não contactar novamente\"."); return; }
      if (data.removed) removeClientLocally(client.id);
      else fetchClients();
    } finally { setBusyClientId(""); }
  }

  function openScheduleEditor(client) {
    setScheduleDraft(getScheduleDraft(client.registration));
    setSchedulingClientId(client.id);
  }

  async function saveClientSchedule(client) {
    const date = String(scheduleDraft.date || "").trim();
    const time = String(scheduleDraft.time || "").trim();
    const note = String(scheduleDraft.note || "").replace(/\s+/g, " ").trim();
    const type = String(scheduleDraft.type || "follow_up");

    if (!date) { alert("Selecione o dia da atividade."); return; }
    if (!time) { alert("Selecione o horário da atividade."); return; }
    if (!note) { alert("Explique rapidamente qual é a atividade."); return; }

    setBusyClientId(client.id);
    try {
      const response = await fetch(`/api/simulation-registrations/${client.registration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledActivityDate: date,
          scheduledActivityTime: time,
          scheduledActivityType: type,
          scheduledActivityNote: note
        })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        alert(data.error || "Não foi possível agendar a atividade.");
        return;
      }

      patchClientRegistration(client.id, data, { refreshAfter: filters.noFutureActivityOnly || filters.pendingOnly });
      setSchedulingClientId("");
    } finally {
      setBusyClientId("");
    }
  }

  async function clearClientSchedule(client) {
    if (!confirm(`Remover a atividade agendada de "${client.name || "cliente"}"?`)) return;

    setBusyClientId(client.id);
    try {
      const response = await fetch(`/api/simulation-registrations/${client.registration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledActivityAt: null,
          scheduledActivityType: "follow_up",
          scheduledActivityNote: ""
        })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        alert(data.error || "Não foi possível remover a atividade.");
        return;
      }

      patchClientRegistration(client.id, data, { refreshAfter: filters.noFutureActivityOnly || filters.pendingOnly });
      setSchedulingClientId("");
    } finally {
      setBusyClientId("");
    }
  }

  function clientActivitiesFor(client) {
    return localClientActivities[client.id] || [];
  }

  async function createClientActivity(client) {
    const date = String(newActivityDraft.date || "").trim();
    const time = String(newActivityDraft.time || "").trim();
    const note = String(newActivityDraft.note || "").replace(/\s+/g, " ").trim();
    const type = String(newActivityDraft.type || "follow_up");

    if (!date) { alert("Selecione o dia da atividade."); return; }
    if (!time) { alert("Selecione o horário da atividade."); return; }
    if (!note) { alert("Explique rapidamente qual é a atividade."); return; }

    setBusyClientId(client.id);
    try {
      const response = await fetch("/api/calendar-activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.registration.id,
          responsibleUserId: client.registration.responsibleUserId || "",
          title: note,
          activityType: type,
          note,
          scheduledAt: `${date}T${time}:00`
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        alert(data.error || "Não foi possível agendar a atividade.");
        return;
      }

      setLocalClientActivities((current) => ({
        ...current,
        [client.id]: [...(current[client.id] || []), data.activity].sort(
          (a, b) => new Date(a.scheduledActivityAt) - new Date(b.scheduledActivityAt)
        )
      }));
      setAddingActivityClientId("");
      setNewActivityDraft({ date: "", time: "", type: "follow_up", note: "" });
      if (filters.noFutureActivityOnly || filters.pendingOnly) fetchClients();
    } finally {
      setBusyClientId("");
    }
  }

  async function completeClientActivity(client, activityId) {
    setBusyClientId(client.id);
    try {
      const response = await fetch(`/api/calendar-activities/${activityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete" })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        alert(data.error || "Não foi possível concluir a atividade.");
        return;
      }
      updateClientActivity(client.id, activityId, data.activity);
      if (filters.noFutureActivityOnly || filters.pendingOnly) fetchClients();
    } finally {
      setBusyClientId("");
    }
  }

  async function cancelClientActivity(client, activityId) {
    if (!confirm("Cancelar esta atividade?")) return;
    setBusyClientId(client.id);
    try {
      const response = await fetch(`/api/calendar-activities/${activityId}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        alert(data.error || "Não foi possível cancelar a atividade.");
        return;
      }
      setLocalClientActivities((current) => ({
        ...current,
        [client.id]: (current[client.id] || []).filter((activity) => activity.id !== activityId)
      }));
      if (filters.noFutureActivityOnly || filters.pendingOnly) fetchClients();
    } finally {
      setBusyClientId("");
    }
  }

  function updateClientActivity(clientId, activityId, nextActivity) {
    setLocalClientActivities((current) => ({
      ...current,
      [clientId]: (current[clientId] || []).map((activity) => (activity.id === activityId ? nextActivity : activity))
    }));
  }

  async function saveClientTags(client, nextTagIds) {
    const cleanIds = Array.from(new Set(nextTagIds.filter(Boolean)));
    setBusyClientId(client.id);
    try {
      const response = await fetch(`/api/simulation-registrations/${client.registration.id}/tags`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagIds: cleanIds })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        alert(data.error || "Não foi possível atualizar as tags.");
        return;
      }

      const nextTags = localTags.filter((tagItem) => cleanIds.includes(tagItem.id));
      patchClientRegistration(client.id, { ...(data.registration || {}), tags: nextTags }, { refreshAfter: filters.tagId !== "all" });
    } finally {
      setBusyClientId("");
    }
  }

  async function createTagForClient(client) {
    const name = tagDraft.replace(/\s+/g, " ").trim();
    if (!name) return;

    setBusyClientId(client.id);
    try {
      const response = await fetch("/api/client-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color: tagColor })
      });
      const tag = await response.json().catch(() => ({}));

      if (!response.ok) {
        alert(tag.error || "Não foi possível criar a tag.");
        return;
      }

      setLocalTags((current) => {
        if (current.some((item) => item.id === tag.id)) return current;
        return [...current, tag].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      });
      setTagDraft("");
      const currentItem = items.find((item) => item.id === client.id);
      await saveClientTags(client, [...ensureArray(currentItem?.tags).map((item) => item.id), tag.id]);
    } finally {
      setBusyClientId("");
    }
  }

  async function deleteTagFromSystem(tagItem) {
    if (!confirm(`Excluir a tag "${tagItem.name}"? Ela será removida de todos os clientes que a usarem.`)) return;

    const response = await fetch(`/api/client-tags/${tagItem.id}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      alert(data.error || "Não foi possível excluir a tag.");
      return;
    }

    setLocalTags((current) => current.filter((item) => item.id !== tagItem.id));
    setItems((current) => current.map((item) => ({
      ...item,
      tags: (item.tags || []).filter((tagRow) => tagRow.id !== tagItem.id)
    })));
    if (filters.tagId === tagItem.id) updateFilters({ tagId: "all" });
  }

  async function openWhatsApp(client) {
    const value = client.registration?.phoneNormalized || client.registration?.phone;
    // Dentro da janela de 24h o atendimento abre no Chat (número oficial); fora
    // dela abre o WhatsApp do próprio corretor. Em ambos os casos o botão
    // continua registrando o contato (mesma API de sempre).
    if (!toWhatsAppDigits(value)) {
      alert("Este cliente não possui um WhatsApp válido.");
      return;
    }

    const whatsappWindow = window.open("about:blank", "_blank");

    try {
      const [response, destination] = await Promise.all([
        fetch(`/api/simulation-registrations/${client.registration.id}/whatsapp-contact`, { method: "POST" }),
        resolveClientWhatsappDestination(client.registration.id, value)
      ]);
      const whatsapp = destination.url;
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível registrar o contato.");
      patchClientRegistration(client.id, data, { refreshAfter: filters.staleContactOnly || filters.pendingOnly });

      if (whatsappWindow) {
        whatsappWindow.opener = null;
        whatsappWindow.location.href = whatsapp;
      } else {
        window.open(whatsapp, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      if (whatsappWindow) whatsappWindow.close();
      alert(error.message || "Não foi possível registrar o contato via WhatsApp.");
    }
  }

  const pageStart = total ? (page - 1) * pageSize : 0;
  const pageEnd = pageStart + items.length;
  const activeChips = buildActiveFilterChips(filters, responsibleProfileMap, localTags, updateFilters);
  const hasActiveExtraFilters = activeChips.length > 0;

  return (
    <section className="container-page relative max-w-full overflow-visible" ref={listTopRef}>
      <div className="overflow-hidden rounded-[28px] border border-line bg-white p-4 shadow-soft sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative block w-full flex-1">
            <span className="sr-only">Buscar cliente</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-brand" aria-hidden="true" />
            <input
              className="h-12 w-full rounded-2xl border border-line bg-white pl-12 pr-4 text-base font-bold text-navy outline-none transition duration-300 placeholder:text-muted/70 focus:border-brand focus:ring-4 focus:ring-brand/10"
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar cliente..."
              type="search"
              value={searchInput}
            />
          </label>

          <div className="flex items-center gap-2">
            <FiltersPopover
              open={filtersOpen}
              onOpenChange={setFiltersOpen}
              filters={filters}
              onChange={updateFilters}
              canManageResponsibleUsers={canManageResponsibleUsers}
              responsibleProfiles={responsibleProfiles}
              localTags={localTags}
              activeCount={activeChips.filter((chip) => chip.key === "responsibleUserId" || chip.key === "tagId" || chip.key === "staleContactOnly" || chip.key === "noFutureActivityOnly").length}
            />
            <button
              aria-label="Clientes pendentes"
              className={`inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-2xl border px-4 text-sm font-black transition ${filters.pendingOnly ? "border-red-300 bg-red-50 text-red-700" : "border-line bg-white text-navy hover:border-red-200 hover:bg-red-50"}`}
              onClick={() => updateFilters({ pendingOnly: !filters.pendingOnly, statusGroup: "all", status: "all" })}
              title="Clientes pendentes"
              type="button"
            >
              <TriangleAlert className="h-5 w-5 text-red-600" aria-hidden="true" />
              {pendingClientsCount}
            </button>
          </div>
        </div>

        {hasActiveExtraFilters ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {activeChips.map((chip) => (
              <button
                key={chip.key}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-brand/25 bg-[#EAF3FF] px-3 text-[11px] font-black text-brand transition hover:border-brand"
                onClick={chip.onRemove}
                type="button"
              >
                {chip.label}
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          <div className="flex gap-1.5 overflow-x-auto pb-1 lg:grid lg:grid-cols-10 lg:overflow-visible lg:pb-0">
            {CLIENT_STATUS_FILTER_GROUPS.map((group) => {
              const active = filters.statusGroup === group.key;
              const count = counters.byGroup?.[group.key] || 0;

              return (
                <button
                  className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full px-3 text-center text-[11px] font-extrabold uppercase transition duration-300 lg:shrink lg:whitespace-normal lg:px-1 xl:px-2 xl:text-[13px] ${
                    active
                      ? "bg-navy text-white shadow-[0_10px_24px_rgba(13,46,87,0.18)]"
                      : "bg-transparent text-navy/80 hover:bg-[#F5FAFF] hover:text-navy"
                  }`}
                  key={group.key}
                  onClick={() => updateFilters({ statusGroup: group.key, status: "all", pendingOnly: false })}
                  type="button"
                >
                  {group.label}
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${active ? "bg-white/20 text-white" : "bg-[#EEF4FB] text-navy"}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {filters.statusGroup !== "all" ? (
            <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible lg:pb-0">
              {(CLIENT_STATUS_FILTER_GROUPS.find((group) => group.key === filters.statusGroup)?.statuses || []).filter((status) => status !== CLIENT_STATUS.SIMULATION_SENT).map((status) => {
                const active = filters.status === status;
                const meta = CLIENT_STATUS_META[status];

                return (
                  <button
                    className={`inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-center text-[11px] font-extrabold transition duration-300 sm:text-xs ${
                      active
                        ? (meta?.activeClass || "border-brand bg-[#EAF3FF] text-brand")
                        : "border-line bg-white text-navy hover:border-brand/40 hover:bg-[#F5FAFF]"
                    }`}
                    key={status}
                    onClick={() => updateFilters({ status: active ? "all" : status })}
                    type="button"
                  >
                    {meta?.label || status}
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${meta?.counterClass || "bg-[#EEF4FB] text-navy"}`}>
                      {counters.byStatus?.[status] || 0}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 text-sm font-bold text-muted sm:flex-row sm:items-center sm:justify-between">
        <p className={loading ? "opacity-60" : ""}>{getPaginationLabel(pageStart, pageEnd, total)}</p>
      </div>

      <div className={`mt-4 grid gap-3 transition-opacity [grid-template-columns:repeat(auto-fit,minmax(460px,1fr))] ${loading ? "opacity-70" : ""}`}>
        {loadWarning ? (
          <div className="rounded-[18px] border border-amber-100 bg-amber-50 p-4 text-sm font-bold text-amber-900">
            {loadWarning}
          </div>
        ) : null}
        {items.length ? items.map((client) => (
          <ClientCard
            activities={clientActivitiesFor(client)}
            addingActivity={addingActivityClientId === client.id}
            expandedActivities={expandedActivitiesClientId === client.id}
            newActivityDraft={newActivityDraft}
            setNewActivityDraft={setNewActivityDraft}
            onAddActivityStart={() => setAddingActivityClientId(client.id)}
            onAddActivityCancel={() => setAddingActivityClientId("")}
            onCreateActivity={() => createClientActivity(client)}
            onCompleteActivity={(activityId) => completeClientActivity(client, activityId)}
            onCancelActivity={(activityId) => cancelClientActivity(client, activityId)}
            onToggleExpandActivities={() => setExpandedActivitiesClientId((current) => (current === client.id ? "" : client.id))}
            busy={busyClientId === client.id}
            client={client}
            deleteTagFromSystem={deleteTagFromSystem}
            editingTagsClientId={editingTagsClientId}
            expanded={expandedClientId === client.id}
            key={client.id}
            localTags={localTags}
            onCreateTag={createTagForClient}
            onOpenSimulation={openSimulation}
            onOpenSchedule={openScheduleEditor}
            onOpenWhatsApp={openWhatsApp}
            onRemoveClient={removeClient}
            onSaveSchedule={saveClientSchedule}
            onClearSchedule={clearClientSchedule}
            onSaveTags={saveClientTags}
            onCloseSchedule={() => setSchedulingClientId("")}
            onOpenValues={() => openValues(client)}
            onToggleDetails={() => setExpandedClientId((current) => current === client.id ? "" : client.id)}
            onToggleTagEditor={() => setEditingTagsClientId((current) => current === client.id ? "" : client.id)}
            onUpdateResponsibleUser={updateClientResponsibleUser}
            onUpdateStatus={updateClientStatus}
            onProspectingAction={handleProspectingAction}
            canReturnAssignedProspecting={canReturnAssignedProspecting}
            isOwner={isOwner}
            responsibleProfileMap={responsibleProfileMap}
            responsibleProfiles={responsibleProfiles}
            scheduleDraft={scheduleDraft}
            scheduling={schedulingClientId === client.id}
            setScheduleDraft={setScheduleDraft}
            showResponsibleSelector={canManageResponsibleUsers}
            setTagColor={setTagColor}
            setTagDraft={setTagDraft}
            tagColor={tagColor}
            tagDraft={tagDraft}
          />
        )) : (
          <EmptyState hasClients={total > 0 || hasActiveExtraFilters} hasFilter={hasActiveExtraFilters || filters.statusGroup !== "all" || filters.status !== "all"} hasQuery={filters.query.trim().length > 0} />
        )}
      </div>

      {total > 0 ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm font-bold text-muted">
            <span className="sr-only">Clientes por página</span>
            <select
              className="h-10 rounded-2xl border border-line bg-white px-4 font-extrabold text-navy outline-none transition duration-300 focus:border-brand focus:ring-4 focus:ring-brand/10"
              onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}
              value={pageSize}
            >
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>{option} por página</option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <PaginationButton disabled={page === 1} onClick={() => goToPage(page - 1)}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Anterior
            </PaginationButton>

            {getPageNumbers(page, totalPages).map((pageNumber) => (
              <button
                aria-current={pageNumber === page ? "page" : undefined}
                className={`h-10 min-w-10 rounded-full border px-3 text-sm font-extrabold transition duration-300 ${
                  pageNumber === page
                    ? "border-brand bg-brand text-white"
                    : "border-line bg-white text-navy hover:border-brand hover:bg-[#F5FAFF]"
                }`}
                key={pageNumber}
                onClick={() => goToPage(pageNumber)}
                type="button"
              >
                {pageNumber}
              </button>
            ))}

            <PaginationButton disabled={page === totalPages} onClick={() => goToPage(page + 1)}>
              Próxima
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </PaginationButton>
          </div>
        </div>
      ) : null}

      {dncTarget ? (
        <DoNotContactModal
          clientName={dncTarget.name || dncTarget.registration?.fullName || "este cliente"}
          onCancel={() => setDncTarget(null)}
          onConfirm={confirmDoNotContact}
        />
      ) : null}
    </section>
  );
}

// Monta os chips removíveis de filtro ativo — cobre tanto filtro escolhido na
// própria tela quanto filtro que chegou pronto por link externo (ex.: painel
// de Desempenho), para nunca deixar um filtro "invisível" aplicado.
function buildActiveFilterChips(filters, responsibleProfileMap, localTags, updateFilters) {
  const chips = [];

  if (filters.responsibleUserId !== "all") {
    const label = filters.responsibleUserId === "unassigned"
      ? "Sem corretor"
      : (responsibleProfileMap.get(filters.responsibleUserId)?.name || "Corretor selecionado");
    chips.push({ key: "responsibleUserId", label: `Corretor: ${label}`, onRemove: () => updateFilters({ responsibleUserId: "all" }) });
  }

  if (filters.tagId !== "all") {
    const label = localTags.find((tagItem) => tagItem.id === filters.tagId)?.name || "Tag selecionada";
    chips.push({ key: "tagId", label: `Tag: ${label}`, onRemove: () => updateFilters({ tagId: "all" }) });
  }

  if (filters.staleContactOnly) {
    chips.push({ key: "staleContactOnly", label: "Sem contato há +3 dias", onRemove: () => updateFilters({ staleContactOnly: false }) });
  }

  if (filters.noFutureActivityOnly) {
    chips.push({ key: "noFutureActivityOnly", label: "Sem atividade futura", onRemove: () => updateFilters({ noFutureActivityOnly: false }) });
  }

  return chips;
}

function FiltersPopover({ open, onOpenChange, filters, onChange, canManageResponsibleUsers, responsibleProfiles, localTags, activeCount }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) onOpenChange(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, onOpenChange]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className={`inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl border px-4 text-sm font-black transition ${activeCount ? "border-brand bg-[#EAF3FF] text-brand" : "border-line bg-white text-navy hover:border-brand"}`}
        onClick={() => onOpenChange(!open)}
        type="button"
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        Filtros
        {activeCount ? <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] text-white">{activeCount}</span> : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-72 space-y-3 rounded-2xl border border-navy/10 bg-white p-4 shadow-[0_18px_48px_rgba(13,59,102,0.18)]">
          {canManageResponsibleUsers ? (
            <label className="block text-xs font-black text-navy">
              Corretor
              <select
                className="mt-1 h-11 w-full rounded-xl border border-line bg-white px-3 text-sm font-bold text-navy outline-none focus:border-brand"
                onChange={(event) => onChange({ responsibleUserId: event.target.value })}
                value={filters.responsibleUserId}
              >
                <option value="all">Todos os corretores</option>
                {responsibleProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.name}</option>
                ))}
                <option value="unassigned">Sem corretor</option>
              </select>
            </label>
          ) : null}

          <label className="block text-xs font-black text-navy">
            Tag
            <select
              className="mt-1 h-11 w-full rounded-xl border border-line bg-white px-3 text-sm font-bold text-navy outline-none focus:border-brand"
              onChange={(event) => onChange({ tagId: event.target.value })}
              value={filters.tagId}
            >
              <option value="all">Todas as tags</option>
              {localTags.map((tagItem) => (
                <option key={tagItem.id} value={tagItem.id}>{tagItem.name}</option>
              ))}
            </select>
          </label>

          <label className="flex items-center justify-between gap-3 text-xs font-black text-navy">
            Sem contato há +3 dias
            <input
              checked={filters.staleContactOnly}
              className="h-5 w-5 accent-brand"
              onChange={(event) => onChange({ staleContactOnly: event.target.checked })}
              type="checkbox"
            />
          </label>

          <label className="flex items-center justify-between gap-3 text-xs font-black text-navy">
            Sem atividade futura
            <input
              checked={filters.noFutureActivityOnly}
              className="h-5 w-5 accent-brand"
              onChange={(event) => onChange({ noFutureActivityOnly: event.target.checked })}
              type="checkbox"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

const DO_NOT_CONTACT_REASONS = getDoNotContactReasonOptions();

// Motivo obrigatório para "Não contactar novamente" (pente-fino Meta Diária):
// nunca uma ação silenciosa/sem justificativa — registrada com auditoria
// completa no servidor (lib/daily-goal-wallet.js), inclusive com trava
// anti-abuso contra remoções em massa.
function DoNotContactModal({ clientName, onCancel, onConfirm }) {
  const [reasonKey, setReasonKey] = useState("client_requested");
  const [reasonText, setReasonText] = useState("");

  function handleConfirm() {
    if (reasonKey === "other" && !reasonText.trim()) return;
    onConfirm(reasonKey, reasonText.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4">
      <div className="w-full max-w-md rounded-[24px] bg-white p-6 shadow-soft">
        <h3 className="text-lg font-black text-navy">Não contactar novamente</h3>
        <p className="mt-1 text-sm font-bold text-muted">Selecione o motivo para {clientName}. Essa ação é registrada e auditável.</p>
        <div className="mt-4 space-y-2">
          {DO_NOT_CONTACT_REASONS.map((option) => (
            <label key={option.key} className="flex items-center gap-2 text-sm font-bold text-navy">
              <input checked={reasonKey === option.key} name="dnc-reason" onChange={() => setReasonKey(option.key)} type="radio" value={option.key} />
              {option.label}
            </label>
          ))}
        </div>
        {reasonKey === "other" ? (
          <textarea
            className="mt-3 w-full rounded-2xl border border-line p-3 text-sm font-normal text-navy outline-none focus:border-brand"
            onChange={(event) => setReasonText(event.target.value)}
            placeholder="Descreva o motivo"
            rows={3}
            value={reasonText}
          />
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button className="premium-button-secondary" onClick={onCancel} type="button">Cancelar</button>
          <button className="premium-button-primary bg-red-600 hover:bg-red-700" disabled={reasonKey === "other" && !reasonText.trim()} onClick={handleConfirm} type="button">Confirmar</button>
        </div>
      </div>
    </div>
  );
}

function ClientCard({
  activities,
  addingActivity,
  expandedActivities,
  newActivityDraft,
  setNewActivityDraft,
  onAddActivityStart,
  onAddActivityCancel,
  onCreateActivity,
  onCompleteActivity,
  onCancelActivity,
  onToggleExpandActivities,
  busy,
  client,
  deleteTagFromSystem,
  editingTagsClientId,
  expanded,
  localTags,
  onCreateTag,
  onClearSchedule,
  onCloseSchedule,
  onOpenSimulation,
  onOpenSchedule,
  onOpenValues,
  onOpenWhatsApp,
  onRemoveClient,
  onSaveSchedule,
  onSaveTags,
  onToggleDetails,
  onToggleTagEditor,
  onUpdateResponsibleUser,
  onUpdateStatus,
  onProspectingAction,
  canReturnAssignedProspecting,
  isOwner,
  responsibleProfileMap,
  responsibleProfiles,
  scheduleDraft,
  scheduling,
  setScheduleDraft,
  showResponsibleSelector,
  setTagColor,
  setTagDraft,
  tagColor,
  tagDraft
}) {
  const [showDocuments, setShowDocuments] = useState(false);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const clientTags = ensureArray(client.tags);
  const currentTagIds = clientTags.map((tagItem) => tagItem.id).filter(Boolean);
  const responsibleUserId = client.registration?.responsibleUserId || "";
  const responsibleName = responsibleProfileMap?.get(responsibleUserId)?.name || client.lastAdminLabel || "Sem corretor";
  const urgency = getUrgencySignal(client, activities);
  const dateLabel = safeFormatDateLabel(client.registration);
  const lastContactLabel = client.lastWhatsappContactAt ? formatLastContactLabel(client.lastWhatsappContactAt) : "Nenhum contato realizado";

  return (
    <article className="relative max-w-full overflow-visible rounded-[18px] border border-line bg-white p-4 shadow-[0_12px_30px_rgba(13,59,102,0.06)] transition duration-300 focus-within:z-50 hover:z-50 hover:-translate-y-0.5 hover:shadow-soft sm:p-[18px]">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <div className="mb-1 flex max-w-full flex-wrap items-center gap-2">
            <p
              className="truncate text-[10px] font-black uppercase tracking-[0.12em] text-muted"
              title="Corretor responsável"
            >
              Responsável: {responsibleName}
            </p>
            {showResponsibleSelector ? (
              <select
                aria-label={`Alterar corretor responsável de ${client.name || "cliente"}`}
                className="h-7 max-w-[220px] rounded-full border border-brand/20 bg-white px-2 text-[11px] font-black text-navy outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
                disabled={busy}
                onChange={(event) => onUpdateResponsibleUser(client, event.target.value)}
                value={responsibleUserId}
              >
                <option value="">Sem corretor</option>
                {responsibleProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <h2 className="truncate text-lg font-black text-navy sm:text-xl" title={client.name}>
            {client.name || "Cliente sem nome"}
            {client.registration?.clientCode ? <span className="ml-2 text-xs font-bold text-muted">{client.registration.clientCode}</span> : null}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ClientStatusSelector busy={busy} client={client} onChange={(status) => onUpdateStatus(client, status)} />
            {urgency ? (
              <span className="inline-flex h-6 items-center rounded-full bg-amber-50 px-2.5 text-[10px] font-black uppercase tracking-[0.06em] text-amber-800">
                {urgency.label}
              </span>
            ) : null}
          </div>
          {client.registration ? <ClientJourneyActions registration={client.registration} canManage={showResponsibleSelector} responsibleName={responsibleName} tags={clientTags} /> : null}
        </div>

        <div className="flex flex-wrap items-start justify-start gap-1.5 sm:max-w-xs sm:justify-end">
          {clientTags.slice(0, 4).map((tagItem) => (
            <TagPill key={tagItem.id} tag={tagItem} />
          ))}
          {clientTags.length > 4 ? (
            <span className="rounded-full bg-[#EEF4FB] px-2 py-1 text-[11px] font-black text-navy">+{clientTags.length - 4}</span>
          ) : null}
          <button
            className="inline-flex h-8 items-center gap-1 rounded-full border border-brand/25 bg-white px-3 text-[11px] font-black text-brand transition hover:border-brand hover:bg-[#EEF6FF]"
            disabled={busy}
            onClick={onToggleTagEditor}
            type="button"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Tags
          </button>
        </div>
      </div>

      {editingTagsClientId === client.id ? (
        <TagEditor
          currentTagIds={currentTagIds}
          localTags={localTags}
          onCreateTag={() => onCreateTag(client)}
          onDeleteTag={deleteTagFromSystem}
          onToggleTag={(tagId) => {
            const nextIds = currentTagIds.includes(tagId)
              ? currentTagIds.filter((id) => id !== tagId)
              : [...currentTagIds, tagId];
            onSaveTags(client, nextIds);
          }}
          setTagColor={setTagColor}
          setTagDraft={setTagDraft}
          tagColor={tagColor}
          tagDraft={tagDraft}
        />
      ) : null}

      <div className="mt-2 space-y-1 text-sm text-muted">
        <p className={urgency ? "font-bold" : "font-bold"}>Data do cadastro: {dateLabel}</p>
        <p className={!client.lastWhatsappContactAt ? "font-extrabold text-amber-800" : "font-bold"}>Último contato: {lastContactLabel}</p>
        {client.scheduledActivityAt ? (
          <p className="font-bold text-navy">
            Atividade: {formatScheduledActivityLabel(client.scheduledActivityAt)}
            {client.scheduledActivityNote ? ` · ${client.scheduledActivityNote}` : ""}
          </p>
        ) : null}
        <ContactPreferenceBadge registration={client.registration} />
      </div>

      {client.completed ? (
        <div className="mt-2 space-y-1.5">
          <p className="break-words text-sm leading-6 text-muted [overflow-wrap:anywhere]">
            Poder total de compra: <strong className="text-navy">{formatMoneyBR(client.summary.purchasePower)}</strong>
          </p>
          {client.summary.components.length ? (
            <p className="break-words text-sm leading-6 text-muted [overflow-wrap:anywhere]">{client.summary.components.join(" · ")}</p>
          ) : null}
        </div>
      ) : (
        <PendingClientInfo registration={client.registration} status={client.status} />
      )}

      {expanded ? (
        <InlineRegistrationDetails registration={client.registration} simulation={client.simulation} />
      ) : null}

      {scheduling ? (
        <ScheduleEditor
          busy={busy}
          draft={scheduleDraft}
          hasSchedule={Boolean(client.scheduledActivityAt)}
          onChange={setScheduleDraft}
          onClear={() => onClearSchedule(client)}
          onClose={onCloseSchedule}
          onSave={() => onSaveSchedule(client)}
        />
      ) : null}

      <ClientActivitiesPanel
        activities={activities}
        adding={addingActivity}
        busy={busy}
        draft={newActivityDraft}
        expanded={expandedActivities}
        onAddCancel={onAddActivityCancel}
        onAddStart={onAddActivityStart}
        onCancel={onCancelActivity}
        onComplete={onCompleteActivity}
        onCreate={onCreateActivity}
        onDraftChange={setNewActivityDraft}
        onToggleExpand={onToggleExpandActivities}
      />

      {client.registration?.prospectingContactId && (client.registration.prospectingAssignedPending || client.status === CLIENT_STATUS.AWAITING_RETURN || (client.status === CLIENT_STATUS.IN_SERVICE && canReturnAssignedProspecting && client.registration.prospectingAssignedByUserId)) ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {client.registration.prospectingAssignedPending ? <button className="premium-button-secondary" disabled={busy} onClick={() => onProspectingAction(client, "prospect")} type="button">Prospectar</button> : null}
          {client.registration.prospectingAssignedPending || client.status === CLIENT_STATUS.AWAITING_RETURN ? <button className="premium-button-secondary" disabled={busy} onClick={() => onProspectingAction(client, "in_service")} type="button">Em atendimento</button> : null}
          {client.status === CLIENT_STATUS.AWAITING_RETURN ? <button className="premium-button-secondary text-red-700" disabled={busy} onClick={() => onProspectingAction(client, "do_not_contact")} type="button">Não contactar novamente</button> : null}
          {canReturnAssignedProspecting && client.registration.prospectingAssignedByUserId ? <button className="premium-button-secondary px-4 py-2 text-sm" disabled={busy} onClick={() => onProspectingAction(client, "return_to_queue")} type="button">Devolver à fila</button> : null}
        </div>
      ) : null}

      {/* Ações principais: WhatsApp e Agenda ficam sempre visíveis (as mais
          usadas no dia a dia). Cadastro some para dentro de "Mais ações" só
          no mobile, pra não empilhar 3+ linhas de botão em telas estreitas —
          no desktop continua visível junto das outras. Empreendimentos,
          Valores, Documentação e Excluir vivem só em "Mais ações"; Excluir
          fica visualmente separado por uma divisória e mantém a mesma
          confirmação nativa de antes. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          aria-label={`Abrir WhatsApp de ${client.name || "cliente"}`}
          className="premium-button-primary h-11 flex-1 gap-2 px-4 text-sm sm:flex-none"
          onClick={() => onOpenWhatsApp(client)}
          type="button"
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          WhatsApp
        </button>
        <button
          aria-label={`${client.scheduledActivityAt ? "Editar atividade agendada" : "Agendar atividade"} de ${client.name || "cliente"}`}
          className="client-action-button h-11 flex-1 px-4 text-sm sm:flex-none"
          disabled={busy}
          onClick={() => onOpenSchedule(client)}
          type="button"
        >
          {client.scheduledActivityAt ? (
            <Clock className="h-4 w-4" aria-hidden="true" />
          ) : (
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
          )}
          {client.scheduledActivityAt ? "Agenda" : "Agendar"}
        </button>
        <button
          aria-label={`Ver cadastro de ${client.name || "cliente"}`}
          className="client-action-button hidden h-11 px-4 text-sm sm:inline-flex"
          disabled={busy}
          onClick={onToggleDetails}
          type="button"
        >
          <UserRound className="h-4 w-4" aria-hidden="true" />
          Cadastro
        </button>

        <MoreActionsMenu
          open={moreActionsOpen}
          onOpenChange={setMoreActionsOpen}
        >
          <button
            aria-label={`Ver cadastro de ${client.name || "cliente"}`}
            className="flex h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs font-extrabold text-navy hover:bg-mist sm:hidden"
            disabled={busy}
            onClick={() => { setMoreActionsOpen(false); onToggleDetails(); }}
            role="menuitem"
            type="button"
          >
            <UserRound className="h-4 w-4" aria-hidden="true" /> Cadastro
          </button>
          <button
            aria-label={`Simular empreendimentos para ${client.name || "cliente"}`}
            className="flex h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs font-extrabold text-navy hover:bg-mist"
            disabled={busy}
            onClick={() => { setMoreActionsOpen(false); onOpenSimulation(client); }}
            role="menuitem"
            type="button"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" /> Empreendimentos
          </button>
          <button
            aria-label={`Inserir valores da simulação de ${client.name || "cliente"}`}
            className="flex h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs font-extrabold text-navy hover:bg-mist"
            disabled={busy}
            onClick={() => { setMoreActionsOpen(false); onOpenValues(client); }}
            role="menuitem"
            type="button"
          >
            <Calculator className="h-4 w-4" aria-hidden="true" /> Valores
          </button>
          <button
            aria-label={`Documentação de ${client.name || "cliente"}`}
            className="flex h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs font-extrabold text-navy hover:bg-mist"
            disabled={busy}
            onClick={() => { setMoreActionsOpen(false); setShowDocuments(true); }}
            role="menuitem"
            type="button"
          >
            <FileText className="h-4 w-4" aria-hidden="true" /> Documentação
          </button>
          {isOwner ? (
            <>
              <div className="my-1 border-t border-line" />
              <button
                aria-label={`Excluir cliente ${client.name || ""}`.trim()}
                className="flex h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs font-extrabold text-red-700 hover:bg-red-50"
                disabled={busy}
                onClick={() => { setMoreActionsOpen(false); onRemoveClient(client); }}
                role="menuitem"
                type="button"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" /> Excluir
              </button>
            </>
          ) : null}
        </MoreActionsMenu>
      </div>
      {showDocuments && client.registration?.id ? (
        <ClientDocumentsModal
          client={{ id: client.registration.id, fullName: client.name || "Cliente" }}
          canSendToCca={showResponsibleSelector}
          canManage={showResponsibleSelector}
          onClose={() => setShowDocuments(false)}
        />
      ) : null}
    </article>
  );
}

function MoreActionsMenu({ open, onOpenChange, children }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) onOpenChange(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, onOpenChange]);

  return (
    <div className="relative ml-auto" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Mais ações"
        className="client-action-button h-11 w-11 px-0"
        onClick={() => onOpenChange(!open)}
        type="button"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-60 rounded-xl border border-line bg-white p-1.5 shadow-xl" role="menu">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function ClientStatusSelector({ busy, client, onChange }) {
  const containerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState("main");
  const currentStatus = client.status;
  const currentMeta = CLIENT_STATUS_META[currentStatus] || CLIENT_STATUS_META.pending;

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.key === "Escape" || (event.type === "mousedown" && !containerRef.current?.contains(event.target))) {
        setOpen(false);
        setLevel("main");
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  function choose(status) {
    setOpen(false);
    setLevel("main");
    if (status !== currentStatus) onChange(status);
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Alterar status de ${client.name}`}
        className={`inline-flex min-h-7 items-center gap-1.5 rounded-full border-0 px-3 py-1 text-[11px] font-black outline-none transition focus:ring-4 focus:ring-brand/15 disabled:opacity-60 ${currentMeta.badgeClass}`}
        disabled={busy}
        onClick={() => {
          setOpen((value) => !value);
          setLevel(SALE_STATUS_VALUES.has(currentStatus) ? "sale" : "main");
        }}
        type="button"
      >
        {currentMeta.label}
        <ChevronRight className={`h-3 w-3 transition ${open ? "rotate-90" : ""}`} aria-hidden="true" />
      </button>
      {open ? (
        <div className="fixed inset-x-4 bottom-4 z-40 max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-white p-1.5 shadow-xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-[calc(100%+6px)] sm:w-[286px]" role="menu">
          {level === "sale" ? (
            <>
              <button className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs font-black text-brand hover:bg-mist" onClick={() => setLevel("main")} role="menuitem" type="button">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Retroceder
              </button>
              <div className="my-1 border-t border-line" />
              {SALE_STATUS_OPTIONS.map((option) => <StatusMenuItem current={currentStatus} key={option.value} onClick={() => choose(option.value)} option={option} />)}
            </>
          ) : (
            <>
              {MAIN_STATUS_OPTIONS.map((option) => <StatusMenuItem current={currentStatus} key={option.value} onClick={() => choose(option.value)} option={option} />)}
              <button className={`flex h-9 w-full items-center justify-between rounded-lg px-2.5 text-left text-xs font-extrabold hover:bg-mist ${SALE_STATUS_VALUES.has(currentStatus) ? "bg-green-50 text-green-700" : "text-navy"}`} onClick={() => setLevel("sale")} role="menuitem" type="button">
                <span className="flex items-center gap-2">{SALE_STATUS_VALUES.has(currentStatus) ? <Check className="h-4 w-4" aria-hidden="true" /> : <span className="h-4 w-4" />}Venda</span>
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function StatusMenuItem({ current, onClick, option }) {
  const selected = current === option.value;
  return <button aria-checked={selected} className={`flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs font-extrabold hover:bg-mist ${selected ? "bg-[#EEF6FF] text-brand" : "text-navy"}`} onClick={onClick} role="menuitemradio" type="button">{selected ? <Check className="h-4 w-4" aria-hidden="true" /> : <span className="h-4 w-4" />}{option.label}</button>;
}

function ScheduleEditor({ busy, draft, hasSchedule, onChange, onClear, onClose, onSave }) {
  return (
    <div className="mt-4 rounded-2xl border border-blue-100 bg-[#F5FAFF] p-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
        <label className="text-xs font-black text-navy">
          Dia da atividade
          <input
            className="mt-1 h-11 w-full rounded-xl border border-line bg-white px-3 text-sm font-bold text-navy outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
            disabled={busy}
            onChange={(event) => onChange((current) => ({ ...current, date: event.target.value }))}
            type="date"
            value={draft.date}
          />
        </label>
        {draft.date ? (
          <label className="text-xs font-black text-navy">
            Horário
            <input
              className="mt-1 h-11 w-full rounded-xl border border-line bg-white px-3 text-sm font-bold text-navy outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
              disabled={busy}
              onChange={(event) => onChange((current) => ({ ...current, time: event.target.value }))}
              type="time"
              value={draft.time}
            />
          </label>
        ) : null}
      </div>
      {draft.date && draft.time ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
          <label className="text-xs font-black text-navy">
            Tipo
            <select className="mt-1 h-11 w-full rounded-xl border border-line bg-white px-3 text-sm font-bold text-navy outline-none focus:border-brand" disabled={busy} onChange={(event) => onChange((current) => ({ ...current, type: event.target.value }))} value={draft.type || "follow_up"}>
              {ACTIVITY_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-black text-navy">
            O que será feito?
            <textarea className="mt-1 min-h-[84px] w-full rounded-xl border border-line bg-white px-3 py-2 text-sm font-bold text-navy outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10" disabled={busy} maxLength={240} onChange={(event) => onChange((current) => ({ ...current, note: event.target.value }))} placeholder="Ex.: cobrar documentação, retornar ligação, enviar opções de imóveis..." value={draft.note} />
          </label>
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="client-action-button h-10 px-4" disabled={busy} onClick={onSave} type="button">
          Salvar atividade
        </button>
        {hasSchedule ? (
          <button className="client-action-button h-10 px-4" disabled={busy} onClick={onClear} type="button">
            Remover
          </button>
        ) : null}
        <button className="client-action-button h-10 px-4" disabled={busy} onClick={onClose} type="button">
          Cancelar
        </button>
      </div>
    </div>
  );
}

const ACTIVITY_DISPLAY_LIMIT = 3;

// Atividades extras do cliente (calendar_activities): ao contrário do
// agendamento único acima, o cliente pode ter várias simultâneas — criar uma
// nova nunca substitui as demais, e cada uma é concluída/cancelada sozinha.
function ClientActivitiesPanel({
  activities,
  adding,
  busy,
  draft,
  expanded,
  onAddCancel,
  onAddStart,
  onCancel,
  onComplete,
  onCreate,
  onDraftChange,
  onToggleExpand
}) {
  const pending = activities.filter((activity) => activity.status === "pending");
  const now = Date.now();
  const overdue = pending.filter((activity) => new Date(activity.scheduledActivityAt).getTime() < now);
  const upcoming = pending.filter((activity) => new Date(activity.scheduledActivityAt).getTime() >= now);
  const ordered = [...overdue, ...upcoming];
  const visible = expanded ? ordered : ordered.slice(0, ACTIVITY_DISPLAY_LIMIT);
  const hiddenCount = ordered.length - visible.length;

  if (!ordered.length && !adding) {
    return (
      <div className="mt-3">
        <button className="text-xs font-black text-brand hover:underline" disabled={busy} onClick={onAddStart} type="button">
          + Outra atividade
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-2xl border border-line bg-white p-3">
      <p className="text-xs font-black uppercase tracking-[0.1em] text-muted">Próximas atividades</p>
      <div className="mt-2 space-y-2">
        {visible.map((activity) => {
          const isOverdue = new Date(activity.scheduledActivityAt).getTime() < now;
          return (
            <div key={activity.id} className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm ${isOverdue ? "border-red-200 bg-red-50" : "border-line bg-mist/40"}`}>
              <div className="min-w-0">
                <p className={`font-extrabold ${isOverdue ? "text-red-700" : "text-navy"}`}>{formatScheduledActivityLabel(activity.scheduledActivityAt)}</p>
                <p className="truncate text-xs font-bold text-muted">{activity.note || activity.title}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button aria-label="Concluir atividade" className="rounded-lg border border-line px-2 py-1 text-[11px] font-black text-navy hover:border-brand" disabled={busy} onClick={() => onComplete(activity.id)} type="button">
                  Concluir
                </button>
                <button aria-label="Cancelar atividade" className="rounded-lg border border-line px-2 py-1 text-[11px] font-black text-red-700 hover:border-red-300" disabled={busy} onClick={() => onCancel(activity.id)} type="button">
                  Cancelar
                </button>
              </div>
            </div>
          );
        })}
        {hiddenCount > 0 ? (
          <button className="text-xs font-black text-brand hover:underline" onClick={onToggleExpand} type="button">
            Ver todas ({ordered.length})
          </button>
        ) : null}
        {expanded && ordered.length > ACTIVITY_DISPLAY_LIMIT ? (
          <button className="text-xs font-black text-brand hover:underline" onClick={onToggleExpand} type="button">
            Ver menos
          </button>
        ) : null}
      </div>

      {adding ? (
        <div className="mt-3 rounded-xl border border-blue-100 bg-[#F5FAFF] p-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
            <label className="text-xs font-black text-navy">
              Dia
              <input className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm font-bold text-navy outline-none focus:border-brand" disabled={busy} onChange={(event) => onDraftChange((current) => ({ ...current, date: event.target.value }))} type="date" value={draft.date} />
            </label>
            <label className="text-xs font-black text-navy">
              Horário
              <input className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm font-bold text-navy outline-none focus:border-brand" disabled={busy} onChange={(event) => onDraftChange((current) => ({ ...current, time: event.target.value }))} type="time" value={draft.time} />
            </label>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
            <label className="text-xs font-black text-navy">
              Tipo
              <select className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm font-bold text-navy outline-none focus:border-brand" disabled={busy} onChange={(event) => onDraftChange((current) => ({ ...current, type: event.target.value }))} value={draft.type || "follow_up"}>
                {ACTIVITY_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-black text-navy">
              O que será feito?
              <textarea className="mt-1 min-h-[70px] w-full rounded-xl border border-line bg-white px-3 py-2 text-sm font-bold text-navy outline-none focus:border-brand" disabled={busy} maxLength={240} onChange={(event) => onDraftChange((current) => ({ ...current, note: event.target.value }))} value={draft.note} />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button className="client-action-button h-9 px-4" disabled={busy} onClick={onCreate} type="button">Salvar</button>
            <button className="client-action-button h-9 px-4" disabled={busy} onClick={onAddCancel} type="button">Cancelar</button>
          </div>
        </div>
      ) : (
        <button className="mt-3 text-xs font-black text-brand hover:underline" disabled={busy} onClick={onAddStart} type="button">
          + Outra atividade
        </button>
      )}
    </div>
  );
}

function TagEditor({
  currentTagIds,
  localTags,
  onCreateTag,
  onDeleteTag,
  onToggleTag,
  setTagColor,
  setTagDraft,
  tagColor,
  tagDraft
}) {
  return (
    <div className="mt-4 rounded-2xl border border-blue-100 bg-[#F5FAFF] p-3">
      <div className="flex flex-wrap gap-2">
        {!localTags.length ? (
          <p className="text-sm font-bold text-muted">
            Nenhuma tag criada ainda. Digite um nome abaixo e clique em criar tag.
          </p>
        ) : null}
        {localTags.map((tagItem) => {
          const active = currentTagIds.includes(tagItem.id);
          return (
            <span key={tagItem.id} className="inline-flex items-center overflow-hidden rounded-full border border-line bg-white">
              <button
                className={`inline-flex h-9 items-center gap-1.5 px-3 text-xs font-black transition ${active ? "text-white" : "text-navy hover:bg-blue-50"}`}
                onClick={() => onToggleTag(tagItem.id)}
                style={active ? { backgroundColor: tagItem.color } : undefined}
                type="button"
              >
                {active ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
                {tagItem.name}
              </button>
              {active ? (
                <button
                  aria-label={`Remover tag ${tagItem.name} deste cliente`}
                  className="inline-flex h-9 w-8 items-center justify-center border-l border-line text-muted transition hover:bg-blue-50 hover:text-brand"
                  onClick={() => onToggleTag(tagItem.id)}
                  title="Remover deste cliente"
                  type="button"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
              <button
                aria-label={`Excluir tag ${tagItem.name} do sistema`}
                className="inline-flex h-9 w-8 items-center justify-center border-l border-line text-muted transition hover:bg-red-50 hover:text-red-700"
                onClick={() => onDeleteTag(tagItem)}
                title="Excluir tag do sistema"
                type="button"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </span>
          );
        })}
      </div>

      <div className="mt-3 grid gap-2">
        <input
          className="h-10 rounded-2xl border border-line bg-white px-4 text-sm font-bold text-navy outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
          onChange={(event) => setTagDraft(event.target.value)}
          placeholder="Nova tag"
          value={tagDraft}
        />
        <div
          aria-label="Escolha a cor da tag"
          className="flex flex-wrap gap-2 rounded-2xl border border-line bg-white p-2"
          role="radiogroup"
        >
          {TAG_COLORS.map((color) => (
            <button
              aria-checked={tagColor === color.value}
              aria-label={color.label}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border transition hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-brand/15 ${
                tagColor === color.value ? "border-brand bg-[#EEF6FF]" : "border-line bg-white"
              }`}
              key={color.value}
              onClick={() => setTagColor(color.value)}
              role="radio"
              title={color.label}
              type="button"
            >
              <span
                className="h-5 w-5 rounded-md border border-white shadow-[0_4px_10px_rgba(13,59,102,0.18)]"
                style={{ backgroundColor: color.value }}
              />
            </button>
          ))}
        </div>
        <button
          className="inline-flex h-10 items-center justify-center rounded-2xl bg-navy px-4 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-[#082f55]"
          onClick={onCreateTag}
          type="button"
        >
          Criar tag
        </button>
      </div>
    </div>
  );
}

// O alerta vermelho só vale para quem está na etapa "Aguardando simulação". Em
// qualquer outra etapa sem simulação preenchida (ex.: corretor cadastrou o
// cliente e já está atendendo), o texto é só informativo — antes ele
// contradizia a etapa escolhida ("Em atendimento" + "aguardando simulação").
function PendingClientInfo({ registration, status }) {
  const awaitingSimulation = normalizeClientStatus(status) === CLIENT_STATUS.PENDING;
  const headline = awaitingSimulation
    ? <p className="text-sm font-extrabold text-red-700">Cliente aguardando simulação</p>
    : <p className="text-sm font-bold text-muted">Simulação ainda não realizada</p>;

  if (!registration) {
    return <div className="mt-2">{headline}</div>;
  }

  const lines = [
    Number(registration.primaryMonthlyIncome) > 0 ? `Renda: ${formatCurrency(registration.primaryMonthlyIncome)}` : "",
    registration.primaryIncomeType ? `Regime de trabalho: ${incomeTypeLabel(registration.primaryIncomeType)}` : "",
    Number(registration.availablePurchaseResource) > 0 ? `Recurso próprio: ${formatCurrency(registration.availablePurchaseResource)}` : ""
  ].filter(Boolean);

  return (
    <div className="mt-2 space-y-1.5">
      {headline}
      {lines.length ? <p className="break-words text-sm leading-6 text-muted [overflow-wrap:anywhere]">{lines.join(" · ")}</p> : null}
    </div>
  );
}

function InlineRegistrationDetails({ registration, simulation }) {
  if (!registration) {
    return (
      <div className="mt-4 rounded-2xl border border-line bg-[#F8FBFF] p-4 text-sm font-bold text-muted">
        Cadastro completo ainda não localizado para este cliente.
      </div>
    );
  }

  const familyIncome = calculateFamilyIncome(registration);
  return (
    <div className="mt-4 rounded-2xl border border-blue-100 bg-[#F8FBFF] p-4">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-brand">Dados do cadastro</p>
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Nome" value={registration.fullName} />
        <Detail label="Telefone" value={formatBrazilianPhone(registration.phoneNormalized || registration.phone)} />
        <Detail label="Tipo de simulação" value={simulationTypeLabel(registration.simulationType)} />
        <Detail label="Nascimento" value={formatDateBR(registration.oldestBirthDate)} />
        <Detail label="Enviado em" value={formatDateTimeBR(registration.createdAt)} />
        <Detail label="Renda familiar" value={formatCurrency(familyIncome)} />
        <Detail label="Renda do titular" value={formatCurrency(registration.primaryMonthlyIncome)} />
        <Detail label="Tipo de renda" value={incomeTypeLabel(registration.primaryIncomeType)} />
        <Detail label="Estado civil" value={maritalStatusLabel(registration.primaryMaritalStatus)} />
        {registration.simulationType === "joint" ? (
          <>
            <Detail label="Renda da segunda pessoa" value={formatCurrency(registration.secondaryMonthlyIncome)} />
            <Detail label="Renda da segunda pessoa" value={incomeTypeLabel(registration.secondaryIncomeType)} />
            <Detail label="Estado civil da segunda pessoa" value={maritalStatusLabel(registration.secondaryMaritalStatus)} />
          </>
        ) : null}
        <Detail label="Mais de 3 anos de registro" value={booleanLabel(registration.hasOverThreeYearsRegisteredWork)} />
        <Detail label="Filhos menores de 18 anos" value={booleanLabel(registration.hasChildrenUnder18)} />
        <Detail label="Possui imóvel no nome" value={booleanLabel(registration.hasResidentialProperty)} />
        <Detail label="Recurso próprio" value={formatCurrency(registration.availablePurchaseResource)} />
        {simulation?.id ? <Detail label="Simulação vinculada" value="Sim" /> : <Detail label="Simulação vinculada" value="Não" />}
        <EditableDetail label="E-mail" registrationId={registration.id} field="email" initialValue={registration.email} placeholder="cliente@exemplo.com" />
        <EditableDetail label="PIS" registrationId={registration.id} field="pis" initialValue={registration.pis} placeholder="Número do PIS" />
      </div>
      <InlinePropertyPreferences preferences={registration.propertyPreferences} />
    </div>
  );
}

function InlinePropertyPreferences({ preferences }) {
  const summary = getPropertyPreferenceSummary(preferences);
  const details = getPropertyPreferenceDetails(preferences);

  return (
    <div className="mt-4 rounded-2xl border border-line bg-white p-4">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-brand">Preferencias do imovel</p>
      {details.length ? (
        <>
          {summary ? <p className="mt-2 text-sm font-extrabold leading-6 text-navy">{summary}</p> : null}
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {details.map((item) => (
              <Detail key={item.label} label={item.label} value={item.value} />
            ))}
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm font-bold text-muted">Preferencias ainda nao preenchidas.</p>
      )}
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="rounded-2xl border border-line bg-white px-3 py-2">
      <p className="text-[11px] font-black uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="mt-1 break-words font-extrabold text-navy">{value || "Não informado"}</p>
    </div>
  );
}

// E-mail e PIS não vêm de nenhum formulário público (a simulação não coleta
// isso) — o corretor precisa poder preencher direto aqui, no cadastro, pra
// já estar pronto quando a documentação for analisada e enviada pra CCA (em
// vez de só descobrir que falta na hora de gerar o PDF consolidado).
function EditableDetail({ label, registrationId, field, initialValue, placeholder }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue || "");
  const [saved, setSaved] = useState(initialValue || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/simulation-registrations/${registrationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error);
      setSaved(value);
      setEditing(false);
    } catch (saveError) {
      setError(saveError.message || "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="rounded-2xl border border-brand/30 bg-white px-3 py-2">
        <p className="text-[11px] font-black uppercase tracking-[0.12em] text-muted">{label}</p>
        <input
          autoFocus
          className="mt-1 w-full rounded-lg border border-line px-2 py-1 text-sm font-bold text-navy"
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") save(); if (event.key === "Escape") { setValue(saved); setEditing(false); } }}
        />
        {error ? <p className="mt-1 text-[11px] font-bold text-red-700">{error}</p> : null}
        <div className="mt-1 flex gap-2">
          <button type="button" disabled={busy} className="text-[11px] font-black text-brand disabled:opacity-60" onClick={save}>{busy ? "Salvando..." : "Salvar"}</button>
          <button type="button" className="text-[11px] font-bold text-muted" onClick={() => { setValue(saved); setEditing(false); }}>Cancelar</button>
        </div>
      </div>
    );
  }

  return (
    <button type="button" className="rounded-2xl border border-line bg-white px-3 py-2 text-left hover:border-brand/40" onClick={() => { setValue(saved); setEditing(true); }}>
      <p className="text-[11px] font-black uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="mt-1 break-words font-extrabold text-navy">{saved || <span className="text-muted">Clique para preencher</span>}</p>
    </button>
  );
}

function TagPill({ tag }) {
  return (
    <span
      className="rounded-full px-2.5 py-1 text-[11px] font-black text-white shadow-[0_8px_20px_rgba(13,59,102,0.08)]"
      style={{ backgroundColor: tag.color || "#0D4F8B" }}
    >
      {tag.name}
    </span>
  );
}

function ContactPreferenceBadge({ registration }) {
  const preference = registration?.contactPreference;
  if (preference !== "whatsapp" && preference !== "call") return null;

  const Icon = preference === "call" ? Phone : MessageCircle;
  const label = preference === "call" ? "Prefere contato por ligação" : "Prefere contato por WhatsApp";

  return (
    <p className="inline-flex items-center gap-1.5 text-navy">
      <Icon className="h-3.5 w-3.5 text-brand" aria-hidden="true" />
      {label}
    </p>
  );
}

function EmptyState({ hasClients, hasFilter, hasQuery }) {
  let message = "Nenhum cliente cadastrado.";

  if (hasClients && hasQuery) {
    message = "Nenhum cliente encontrado para esta busca.";
  } else if (hasClients && hasFilter) {
    message = "Nenhum cliente encontrado neste filtro.";
  }

  return (
    <div className="rounded-[18px] border border-line bg-white p-8 text-center shadow-soft">
      <p className="text-lg font-black text-navy">{message}</p>
    </div>
  );
}

function PaginationButton({ children, disabled, onClick }) {
  return (
    <button
      className="inline-flex h-10 items-center gap-1 rounded-full border border-line bg-white px-4 text-sm font-extrabold text-navy transition duration-300 hover:border-brand hover:bg-[#F5FAFF] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-line disabled:hover:bg-white"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function buildDraftSimulationPayload(registration = {}) {
  return {
    registrationId: registration.id,
    clientName: registration.fullName || "Cliente sem nome",
    clientWhatsApp: formatBrazilianPhone(registration.phoneNormalized || registration.phone),
    simulationDate: new Date().toISOString().slice(0, 10),
    simulationType: "usado",
    financingValue: "",
    subsidyValue: "",
    firstInstallment: "",
    lastInstallment: "",
    downPaymentValue: registration.availablePurchaseResource || "",
    fgtsValue: "",
    showExpandedPower: false,
    publicNote: "",
    internalNote: [
      `WhatsApp do cadastro: ${toWhatsAppDigits(registration.phoneNormalized || registration.phone)}`,
      "Aguardando simulação"
    ].filter(Boolean).join("\n"),
    outputMode: "individual",
    properties: []
  };
}

function formatScheduledActivityLabel(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "Data a confirmar";

  const parts = getSaoPauloDateParts(date);
  return `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}/${parts.year} às ${parts.hour}:${parts.minute}`;
}

function getScheduleDraft(registration = {}) {
  const date = new Date(registration.scheduledActivityAt || "");
  if (!Number.isFinite(date.getTime())) {
    return {
      date: "",
      time: "",
      type: registration.scheduledActivityType || "follow_up",
      note: registration.scheduledActivityNote || ""
    };
  }

  const parts = getSaoPauloDateParts(date);
  return {
    date: `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
    time: `${parts.hour}:${parts.minute}`,
    type: registration.scheduledActivityType || "follow_up",
    note: registration.scheduledActivityNote || ""
  };
}

function formatRelativeDateTimeLabel(value, fallbackLabel) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return fallbackLabel;

  const todayParts = getSaoPauloDateParts(new Date());
  const valueParts = getSaoPauloDateParts(date);
  const diffDays = Math.max(0, getDatePartDayNumber(todayParts) - getDatePartDayNumber(valueParts));

  if (diffDays === 0) return `Hoje às ${valueParts.hour}:${valueParts.minute}`;
  if (diffDays < 30) return `${diffDays} ${diffDays === 1 ? "dia" : "dias"} atrás`;

  const diffMonths = Math.max(1, ((todayParts.year - valueParts.year) * 12) + todayParts.month - valueParts.month);
  if (diffMonths < 12) return diffMonths === 1 ? "1 mês atrás" : `${diffMonths} meses`;

  const diffYears = Math.max(1, Math.floor(diffMonths / 12));
  return `${diffYears} ${diffYears === 1 ? "ano" : "anos"}`;
}

function getSaoPauloDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    year: "numeric"
  }).formatToParts(date);

  const partMap = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    day: Number(partMap.day),
    hour: partMap.hour === "24" ? "00" : partMap.hour,
    minute: partMap.minute,
    month: Number(partMap.month),
    year: Number(partMap.year)
  };
}

function getDatePartDayNumber(parts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000);
}

function getPaginationLabel(start, end, total) {
  if (!total) return "Mostrando 0 de 0 clientes";
  return `Mostrando ${start + 1} a ${end} de ${total} clientes`;
}

function getPageNumbers(currentPage, totalPages) {
  const maxVisible = 5;
  const start = Math.max(1, Math.min(currentPage - 2, totalPages - maxVisible + 1));
  const end = Math.min(totalPages, start + maxVisible - 1);

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function ensureArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function safeFormatDateLabel(registration) {
  try {
    return formatRelativeDateTimeLabel(registration?.createdAt, "Sem data");
  } catch {
    const value = registration?.createdAt;
    return value ? String(value).slice(0, 10) : "Sem data";
  }
}

function formatLastContactLabel(value) {
  return formatRelativeDateTimeLabel(value, "Nenhum contato realizado");
}

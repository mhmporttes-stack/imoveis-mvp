"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CLIENT_STATUS, normalizeClientStatus } from "@/lib/client-status";
import { toWhatsAppDigits } from "@/lib/phone-utils";
import { decideCardWhatsapp, detectDevice, buildExternalWhatsappUrl, CARD_WA_EXTERNAL } from "@/lib/client-card-whatsapp-core.mjs";
import { flagContactNotSaved } from "@/lib/whatsapp-contact-warning.mjs";
import { withWhatsappText } from "@/lib/documents-forecast-core.mjs";
import { DEFAULT_FILTERS, PAGE_SIZE_OPTIONS, TAG_COLORS, buildDraftSimulationPayload, ensureArray, getScheduleDraft } from "./client-format";

// Estado e ações da Lista de clientes. Mesmas chamadas de API, mesmas regras
// e a mesma ordem de efeitos da tela anterior (AdminSimulationList, removida
// em 2026-10-01 no redesenho) — o que mudou é só a
// apresentação: `notify` (toast) no lugar de alert() e `confirmAction`
// (diálogo da página) no lugar de confirm(). Busca, filtros, contadores e
// paginação continuam no servidor (/api/simulation-registrations/list).
// Só escolhe QUAL link externo usar (Web x app) quando o estado real já mandou abrir fora — nunca decide o destino.
function readCardDevice() {
  return detectDevice({
    userAgent: navigator.userAgent || "",
    standalone: navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches,
    maxTouchPoints: navigator.maxTouchPoints || 0
  });
}

export function useClientList({
  adminProfiles = [],
  canManageResponsibleUsers = false,
  brokerSimulationLink = "",
  initialData,
  initialFilters,
  tags = [],
  notify,
  confirmAction,
  pinClientId = ""
}) {
  const router = useRouter();
  const [filters, setFilters] = useState(() => ({ ...DEFAULT_FILTERS, ...initialFilters }));
  const [searchInput, setSearchInput] = useState(() => initialFilters?.query || "");
  const [pageSize, setPageSize] = useState(() => (PAGE_SIZE_OPTIONS.includes(initialData?.pageSize) ? initialData.pageSize : 20));
  const [page, setPage] = useState(() => initialData?.page || 1);
  const [items, setItems] = useState(() => initialData?.items || []);
  const [total, setTotal] = useState(() => initialData?.total || 0);
  const [totalPages, setTotalPages] = useState(() => initialData?.totalPages || 1);
  const [counters, setCounters] = useState(() => initialData?.counters || { all: 0, byStatus: {}, byGroup: {} });
  const [pendingClientsCount, setPendingClientsCount] = useState(() => initialData?.pendingClientsCount || 0);
  const [activitiesByClient, setActivitiesByClient] = useState(() => initialData?.clientActivities || {});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [localTags, setLocalTags] = useState(() => ensureArray(tags));
  const [busyClientId, setBusyClientId] = useState("");
  const [openingChatClientId, setOpeningChatClientId] = useState("");
  const [chatNavPending, startChatNavigation] = useTransition();
  // Estado real do WhatsApp do usuário (decide o destino do botão "WhatsApp"). Desconhecido = Chat interno.
  const [waState, setWaState] = useState(null);
  const [dncTarget, setDncTarget] = useState(null);
  const [receivedDateTarget, setReceivedDateTarget] = useState(null);
  // Botão "Enviar lista de documentos" da ficha: mensagem pronta aguardando a confirmação do corretor ({ client, message, decision })
  const [docsListTarget, setDocsListTarget] = useState(null);

  const responsibleProfiles = useMemo(() => (
    ensureArray(adminProfiles).filter((profile) => profile.id && profile.status !== "inactive")
  ), [adminProfiles]);
  const responsibleProfileMap = useMemo(() => new Map(responsibleProfiles.map((profile) => [profile.id, profile])), [responsibleProfiles]);

  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/admin/whatsapp-individual/card-state", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (alive && data) setWaState(data); })
      .catch(() => {});
    load();
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  // Busca com debounce (350ms): uma consulta por pausa de digitação, não por tecla.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput !== filters.query) updateFilters({ query: searchInput });
    }, 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  // Guarda contra refetch duplicado na primeira montagem (dados iniciais vêm do servidor).
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    fetchClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page, pageSize, pinClientId]);

  function updateFilters(patch) {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }

  function resetFilters() {
    setSearchInput("");
    setFilters({ ...DEFAULT_FILTERS });
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
    if (filters.needsFirstContact) params.set("needsFirstContact", "1");
    if (filters.statusGroup !== "all") params.set("statusGroup", filters.statusGroup);
    if (filters.status !== "all") params.set("status", filters.status);
    if (pinClientId) params.set("clientId", pinClientId);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));

    try {
      const response = await fetch(`/api/simulation-registrations/list?${params.toString()}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLoadError(data.error || "Não foi possível carregar os clientes.");
        return;
      }
      setLoadError("");
      setItems(data.items || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
      setCounters(data.counters || { all: 0, byStatus: {}, byGroup: {} });
      setPendingClientsCount(data.pendingClientsCount || 0);
      setActivitiesByClient(data.clientActivities || {});
    } catch {
      setLoadError("Não foi possível carregar os clientes. Verifique a conexão e tente de novo.");
    } finally {
      setLoading(false);
    }
  }

  function goToPage(nextPage) {
    setPage(Math.min(Math.max(nextPage, 1), totalPages));
  }

  function changePageSize(size) {
    setPageSize(size);
    setPage(1);
  }

  // Atualização otimista; refreshAfter refaz a página quando o campo pode
  // mudar a aba/filtro do cliente (mantém contadores e paginação certos).
  function patchClientRegistration(clientId, patch, { refreshAfter = false } = {}) {
    setItems((current) => current.map((item) => {
      if (item.id !== clientId) return item;
      const nextRegistration = { ...item.registration, ...patch, tags: patch.tags || item.registration.tags || [] };
      const nextStatus = patch.status !== undefined ? normalizeClientStatus(patch.status) : item.status;
      const nextItem = { ...item, registration: nextRegistration, status: nextStatus };
      if (patch.tags) nextItem.tags = patch.tags;
      if (patch.scheduledActivityAt !== undefined) {
        nextItem.scheduledActivityAt = patch.scheduledActivityAt;
        nextItem.scheduledActivityNote = patch.scheduledActivityNote ?? item.scheduledActivityNote;
      }
      if (patch.lastWhatsappContactAt !== undefined) nextItem.lastWhatsappContactAt = patch.lastWhatsappContactAt;
      return nextItem;
    }));
    if (refreshAfter) fetchClients();
  }

  function removeClientLocally(clientId) {
    setItems((current) => current.filter((item) => item.id !== clientId));
    fetchClients();
  }

  async function withBusy(client, task) {
    setBusyClientId(client.id);
    try {
      return await task();
    } finally {
      setBusyClientId("");
    }
  }

  async function touchClientRegistration(client) {
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
    }
  }

  async function ensureSimulationId(client) {
    if (client.simulation?.id) {
      await withBusy(client, () => touchClientRegistration(client));
      return client.simulation.id;
    }
    return withBusy(client, async () => {
      const response = await fetch("/api/simulations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildDraftSimulationPayload(client.registration))
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(data.error || "Não foi possível abrir a simulação deste cliente.", "danger");
        return "";
      }
      return data.id;
    });
  }

  async function openSimulation(client) {
    const id = await ensureSimulationId(client);
    if (id) router.push(`/admin/simulacoes/${id}/empreendimentos`);
  }

  async function openValues(client) {
    const id = await ensureSimulationId(client);
    if (id) router.push(`/admin/simulacoes/${id}`);
  }

  async function removeClient(client) {
    const ok = await confirmAction({
      title: `Excluir ${client.name || "este cliente"}?`,
      description: "O cadastro e a simulação vinculada serão apagados. Essa ação não pode ser desfeita.",
      confirmLabel: "Excluir cliente",
      tone: "danger"
    });
    if (!ok) return false;
    return withBusy(client, async () => {
      if (client.simulation?.id) {
        const simulationResponse = await fetch(`/api/simulations/${client.simulation.id}`, { method: "DELETE" });
        if (!simulationResponse.ok) {
          const data = await simulationResponse.json().catch(() => ({}));
          notify(data.error || "Não foi possível excluir a simulação.", "danger");
          return false;
        }
      }
      const registrationResponse = await fetch(`/api/simulation-registrations/${client.registration.id}`, { method: "DELETE" });
      if (!registrationResponse.ok) {
        const data = await registrationResponse.json().catch(() => ({}));
        notify(data.error || "Não foi possível excluir o cadastro.", "danger");
        return false;
      }
      removeClientLocally(client.id);
      notify("Cliente excluído.");
      return true;
    });
  }

  async function applyStatusUpdate(client, nextStatus, { receivedDate } = {}) {
    await withBusy(client, async () => {
      const response = await fetch(`/api/simulation-registrations/${client.registration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, ...(receivedDate ? { receivedDate } : {}) })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(data.error || "Não foi possível atualizar a etapa.", "danger");
        return;
      }
      patchClientRegistration(client.id, { ...data, status: nextStatus }, { refreshAfter: true });
      notify("Etapa atualizada.");
    });
  }

  // Cliente indo para "Pago" (fim do pipeline de venda) pede a data do
  // recebimento antes de gravar — pedido do dono, 2026-10-01: "sempre que eu
  // lançar uma venda como paga quero [...] me perguntando qual a data do
  // recebimento" (sem isso, o recebimento automático (lib/financial.js) usava
  // sempre o dia de hoje, e podia cair no mês errado se o lançamento no CRM
  // acontecesse depois do dia real do pagamento). Mesmo padrão de dncTarget
  // (motivo de "não contactar"): a tela mostra um diálogo, e só grava depois
  // de confirmado.
  async function updateClientStatus(client, status) {
    const nextStatus = normalizeClientStatus(status);
    if (nextStatus === client.status) return;
    if (nextStatus === CLIENT_STATUS.SALE_PAID) {
      setReceivedDateTarget({ client, nextStatus });
      return;
    }
    await applyStatusUpdate(client, nextStatus);
  }

  async function confirmReceivedDate(receivedDate) {
    const target = receivedDateTarget;
    if (!target) return;
    setReceivedDateTarget(null);
    await applyStatusUpdate(target.client, target.nextStatus, { receivedDate });
  }

  async function updateClientResponsibleUser(client, responsibleUserId) {
    if (!canManageResponsibleUsers) return;
    await withBusy(client, async () => {
      const response = await fetch(`/api/simulation-registrations/${client.registration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responsibleUserId })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(data.error || "Não foi possível alterar o corretor responsável.", "danger");
        return;
      }
      patchClientRegistration(client.id, data, { refreshAfter: true });
      notify("Responsável alterado.");
    });
  }

  async function handleProspectingAction(client, action, extraPayload = {}) {
    if (action === "do_not_contact") {
      setDncTarget(client);
      return;
    }
    // A janela do WhatsApp precisa abrir no mesmo gesto do clique (antes de
    // qualquer await), senão o navegador bloqueia como pop-up.
    const whatsappWindow = action === "prospect" ? window.open("about:blank", "_blank") : null;
    if (action === "return_to_queue") {
      const ok = await confirmAction({
        title: "Devolver à fila de prospecção?",
        description: `${client.name || "O cliente"} volta imediatamente para a fila e sai da sua carteira.`,
        confirmLabel: "Devolver à fila"
      });
      if (!ok) return;
    }
    await withBusy(client, async () => {
      const response = await fetch(`/api/prospecting/clients/${client.registration.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extraPayload })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        whatsappWindow?.close();
        notify(data.error || "Não foi possível atualizar a prospecção.", "danger");
        return;
      }
      if (data.whatsappUrl && whatsappWindow) whatsappWindow.location.href = data.whatsappUrl;
      if (data.removed) removeClientLocally(client.id);
      else patchClientRegistration(client.id, { status: data.status, prospectingAssignedPending: data.prospectingAssignedPending ?? client.registration.prospectingAssignedPending }, { refreshAfter: true });
    });
  }

  async function confirmDoNotContact(reasonKey, reasonText) {
    const client = dncTarget;
    if (!client) return;
    setDncTarget(null);
    await withBusy(client, async () => {
      const response = await fetch(`/api/prospecting/clients/${client.registration.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "do_not_contact", reasonKey, reasonText })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(data.error || "Não foi possível registrar \"não contactar novamente\".", "danger");
        return;
      }
      if (data.removed) removeClientLocally(client.id);
      else fetchClients();
      notify("Registrado: não contactar novamente.");
    });
  }

  function validateDraft(draft) {
    if (!String(draft.date || "").trim()) return "Escolha o dia da atividade.";
    if (!String(draft.time || "").trim()) return "Escolha o horário da atividade.";
    if (!String(draft.note || "").replace(/\s+/g, " ").trim()) return "Escreva em poucas palavras o que será feito.";
    return "";
  }

  // Agendamento único legado (scheduled_activity_* no cadastro).
  async function saveClientSchedule(client, draft) {
    const problem = validateDraft(draft);
    if (problem) return { error: problem };
    return withBusy(client, async () => {
      const response = await fetch(`/api/simulation-registrations/${client.registration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledActivityDate: draft.date.trim(),
          scheduledActivityTime: draft.time.trim(),
          scheduledActivityType: String(draft.type || "follow_up"),
          scheduledActivityNote: draft.note.replace(/\s+/g, " ").trim()
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return { error: data.error || "Não foi possível agendar a atividade." };
      patchClientRegistration(client.id, data, { refreshAfter: filters.noFutureActivityOnly || filters.pendingOnly });
      notify("Atividade agendada.");
      return { ok: true };
    });
  }

  async function clearClientSchedule(client) {
    const ok = await confirmAction({
      title: "Remover o agendamento?",
      description: `A atividade agendada de ${client.name || "este cliente"} será removida.`,
      confirmLabel: "Remover",
      tone: "danger"
    });
    if (!ok) return false;
    return withBusy(client, async () => {
      const response = await fetch(`/api/simulation-registrations/${client.registration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledActivityAt: null, scheduledActivityType: "follow_up", scheduledActivityNote: "" })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(data.error || "Não foi possível remover a atividade.", "danger");
        return false;
      }
      patchClientRegistration(client.id, { ...data, scheduledActivityAt: data.scheduledActivityAt ?? "" }, { refreshAfter: filters.noFutureActivityOnly || filters.pendingOnly });
      notify("Agendamento removido.");
      return true;
    });
  }

  // Concluir o agendamento único legado: some da agenda (mesmo efeito visual
  // de "remover"), mas grava scheduled_activity_completed_at/by em vez de só
  // limpar — histórico, automações e métricas ("activity_completed") contam
  // como concluída, não como cancelada. Processado em dois blocos separados
  // em lib/simulation-registrations.js#updateSimulationRegistration: o bloco
  // de scheduledActivityCompleted roda depois do de scheduledActivityAt, por
  // isso o completed_at final prevalece mesmo mandando os dois no mesmo PATCH.
  async function completeClientSchedule(client) {
    return withBusy(client, async () => {
      const response = await fetch(`/api/simulation-registrations/${client.registration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledActivityAt: null,
          scheduledActivityType: "follow_up",
          scheduledActivityNote: "",
          scheduledActivityCompleted: true
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(data.error || "Não foi possível concluir a atividade.", "danger");
        return false;
      }
      patchClientRegistration(client.id, { ...data, scheduledActivityAt: data.scheduledActivityAt ?? "" }, { refreshAfter: filters.noFutureActivityOnly || filters.pendingOnly });
      notify("Atividade concluída.");
      return true;
    });
  }

  function activitiesFor(client) {
    return activitiesByClient[client.id] || [];
  }

  // Atividades extras (calendar_activities): várias por cliente.
  async function createClientActivity(client, draft) {
    const problem = validateDraft(draft);
    if (problem) return { error: problem };
    const note = draft.note.replace(/\s+/g, " ").trim();
    return withBusy(client, async () => {
      const response = await fetch("/api/calendar-activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.registration.id,
          responsibleUserId: client.registration.responsibleUserId || "",
          title: note,
          activityType: String(draft.type || "follow_up"),
          note,
          scheduledAt: `${draft.date.trim()}T${draft.time.trim()}:00`
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return { error: data.error || "Não foi possível agendar a atividade." };
      setActivitiesByClient((current) => ({
        ...current,
        [client.id]: [...(current[client.id] || []), data.activity].sort((a, b) => new Date(a.scheduledActivityAt) - new Date(b.scheduledActivityAt))
      }));
      if (filters.noFutureActivityOnly || filters.pendingOnly) fetchClients();
      notify("Atividade criada.");
      return { ok: true };
    });
  }

  async function completeClientActivity(client, activityId) {
    await withBusy(client, async () => {
      const response = await fetch(`/api/calendar-activities/${activityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete" })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(data.error || "Não foi possível concluir a atividade.", "danger");
        return;
      }
      setActivitiesByClient((current) => ({
        ...current,
        [client.id]: (current[client.id] || []).map((activity) => (activity.id === activityId ? data.activity : activity))
      }));
      if (filters.noFutureActivityOnly || filters.pendingOnly) fetchClients();
      notify("Atividade concluída.");
    });
  }

  async function cancelClientActivity(client, activityId) {
    const ok = await confirmAction({ title: "Cancelar esta atividade?", confirmLabel: "Cancelar atividade", cancelLabel: "Manter", tone: "danger" });
    if (!ok) return;
    await withBusy(client, async () => {
      const response = await fetch(`/api/calendar-activities/${activityId}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(data.error || "Não foi possível cancelar a atividade.", "danger");
        return;
      }
      setActivitiesByClient((current) => ({
        ...current,
        [client.id]: (current[client.id] || []).filter((activity) => activity.id !== activityId)
      }));
      if (filters.noFutureActivityOnly || filters.pendingOnly) fetchClients();
      notify("Atividade cancelada.");
    });
  }

  async function saveClientTags(client, nextTagIds) {
    const cleanIds = Array.from(new Set(nextTagIds.filter(Boolean)));
    await withBusy(client, async () => {
      const response = await fetch(`/api/simulation-registrations/${client.registration.id}/tags`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagIds: cleanIds })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(data.error || "Não foi possível atualizar as tags.", "danger");
        return;
      }
      const nextTags = localTags.filter((tagItem) => cleanIds.includes(tagItem.id));
      patchClientRegistration(client.id, { ...(data.registration || {}), tags: nextTags }, { refreshAfter: filters.tagId !== "all" });
    });
  }

  // keepExisting (corretor/associado): nome que já existe NÃO é enviado de novo ao
  // servidor — só marca a etiqueta existente no cliente, sem mudar a cor dela.
  // A barreira real é o servidor (POST /api/client-tags não recolore para esses perfis).
  async function createTagForClient(client, name, color = TAG_COLORS[0].value, { keepExisting = false } = {}) {
    const cleanName = String(name || "").replace(/\s+/g, " ").trim();
    if (!cleanName) return false;
    if (keepExisting) {
      const key = (value) => String(value || "").replace(/\s+/g, " ").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const existingTag = localTags.find((item) => key(item.name) === key(cleanName));
      if (existingTag) {
        const currentItem = items.find((item) => item.id === client.id);
        const currentIds = ensureArray(currentItem?.tags).map((item) => item.id);
        if (currentIds.includes(existingTag.id)) {
          notify(`A etiqueta "${existingTag.name}" já existe e já está neste cliente.`);
        } else {
          notify(`A etiqueta "${existingTag.name}" já existe; foi marcada neste cliente.`);
          await saveClientTags(client, [...currentIds, existingTag.id]);
        }
        return true;
      }
    }
    const response = await fetch("/api/client-tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: cleanName, color })
    });
    const tag = await response.json().catch(() => ({}));
    if (!response.ok) {
      notify(tag.error || "Não foi possível criar a tag.", "danger");
      return false;
    }
    setLocalTags((current) => (current.some((item) => item.id === tag.id) ? current : [...current, tag].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))));
    const currentItem = items.find((item) => item.id === client.id);
    await saveClientTags(client, [...ensureArray(currentItem?.tags).map((item) => item.id), tag.id]);
    return true;
  }

  async function deleteTagFromSystem(tagItem) {
    const ok = await confirmAction({
      title: `Excluir a tag "${tagItem.name}"?`,
      description: "Ela será removida de todos os clientes que a usam.",
      confirmLabel: "Excluir tag",
      tone: "danger"
    });
    if (!ok) return;
    const response = await fetch(`/api/client-tags/${tagItem.id}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      notify(response.status === 403 ? "Só o gestor ou o administrador pode excluir etiquetas." : (data.error || "Não foi possível excluir a tag."), "danger");
      return;
    }
    setLocalTags((current) => current.filter((item) => item.id !== tagItem.id));
    setItems((current) => current.map((item) => ({ ...item, tags: (item.tags || []).filter((tagRow) => tagRow.id !== tagItem.id) })));
    if (filters.tagId === tagItem.id) updateFilters({ tagId: "all" });
    notify("Tag excluída.");
  }

  function openWhatsApp(client) {
    const value = client.registration?.phoneNormalized || client.registration?.phone;
    if (!toWhatsAppDigits(value)) {
      notify("Este cliente não tem um WhatsApp válido. Corrija o telefone no cadastro.", "danger");
      return;
    }
    // Regra do dono (2026-10-02): o botão abre a conversa do cliente DENTRO do Chat
    // do CRM (nada de WhatsApp Web/app externo). O Chat localiza a conversa vinculada
    // (ou a do mesmo telefone), cria uma só se não houver nenhuma e já a deixa
    // selecionada — sem mudar atendente/responsável (POST /whatsapp-chat/open-client).
    // O clique continua registrando o contato, como antes — mas em PARALELO
    // (keepalive sobrevive à troca de página): antes a navegação esperava essa
    // chamada (~2 s) sem nenhum aviso na tela e o clique parecia não ter feito
    // nada. A navegação roda em transição e o card fica "ocupado" até a página
    // do Chat chegar (retorno visual imediato, sem permitir clique repetido).
    const registrationId = client.registration.id;
    // REGRA OFICIAL (dono, 2026-10-02): destino pelo estado REAL do WhatsApp do corretor
    // (lib/client-card-whatsapp-core.mjs) — conectado: Chat; desconectado/restrição:
    // WhatsApp Web (desktop) ou app (celular/PWA). Nunca decidido "por ser mobile".
    const decision = decideCardWhatsapp({
      stateKnown: Boolean(waState),
      sessionStatus: waState?.sessionStatus ?? null,
      restricted: waState?.restricted === true,
      chatDisabled: waState?.chatDisabled === true,
      device: readCardDevice(),
      clientStatus: client.status,
      isOwnClient: Boolean(waState?.userId) && client.registration.responsibleUserId === waState.userId,
      phone: value
    });
    // Falha no registro NUNCA bloqueia a navegação: só deixa um aviso discreto no Chat
    // ("aberto, mas o contato não pôde ser salvo/sincronizado" — lib/whatsapp-contact-warning.mjs).
    fetch(`/api/simulation-registrations/${registrationId}/whatsapp-contact`, { method: "POST", keepalive: true })
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); })
      .catch(() => flagContactNotSaved(client.name || client.registration?.fullName || ""));
    if (decision.action === CARD_WA_EXTERNAL) {
      window.open(decision.url, "_blank", "noopener,noreferrer");
      return;
    }
    setOpeningChatClientId(client.id);
    startChatNavigation(() => {
      router.push(`/admin/chat?client=${encodeURIComponent(registrationId)}`);
    });
  }

  // Destino do WhatsApp do card (mesma decisão do botão "WhatsApp"): Chat se a sessão do corretor está conectada; senão link externo.
  // `chatReady` vem do SERVIDOR (lista-documentos → getChatReplyReadiness): o Chat só responde, nunca inicia conversa (proteção
  // do número, 2026-10-05). Sem conversa do cliente no Chat (ou limite/hora): sempre o WhatsApp externo (ação humana do corretor).
  function decideClientWhatsapp(client, phone, { chatReady = false, chatReason = "no_conversation" } = {}) {
    const decision = decideCardWhatsapp({
      stateKnown: Boolean(waState),
      sessionStatus: waState?.sessionStatus ?? null,
      restricted: waState?.restricted === true,
      chatDisabled: waState?.chatDisabled === true,
      device: readCardDevice(),
      clientStatus: client.status,
      isOwnClient: Boolean(waState?.userId) && client.registration.responsibleUserId === waState.userId,
      phone
    });
    if (decision.action !== CARD_WA_EXTERNAL && !chatReady) {
      const url = buildExternalWhatsappUrl(phone, readCardDevice());
      if (url) return { action: CARD_WA_EXTERNAL, url, reason: chatReason };
    }
    return decision;
  }

  // "Enviar lista de documentos" (round 4): o servidor monta texto + link da lista PERSONALIZADA; a mensagem só sai depois que o
  // corretor confirma a prévia (nunca sozinha). Não muda o status do cliente.
  async function prepareDocumentsList(client) {
    const registrationId = client.registration?.id;
    const value = client.registration?.phoneNormalized || client.registration?.phone;
    if (!registrationId) return;
    if (!toWhatsAppDigits(value)) {
      notify("Este cliente não tem um WhatsApp válido. Corrija o telefone no cadastro.", "danger");
      return;
    }
    await withBusy(client, async () => {
      const response = await fetch(`/api/admin/clients/${registrationId}/lista-documentos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preparar" })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(data.error || "Não foi possível preparar a lista de documentos.", "danger");
        return;
      }
      setDocsListTarget({ client, message: data.message, link: data.link, imageUrl: data.imageUrl, decision: decideClientWhatsapp(client, value, { chatReady: data.chatReady === true, chatReason: data.chatReason }) });
    });
  }

  async function confirmDocumentsList() {
    const target = docsListTarget;
    if (!target) return;
    setDocsListTarget(null);
    const { client, message, imageUrl, decision } = target;
    const registrationId = client.registration.id;
    await withBusy(client, async () => {
      if (decision.action === CARD_WA_EXTERNAL) {
        // sem nenhum await antes: o navegador só deixa abrir a janela dentro do clique do corretor
        window.open(withWhatsappText(decision.url, message), "_blank", "noopener,noreferrer");
        fetch(`/api/simulation-registrations/${registrationId}/whatsapp-contact`, { method: "POST", keepalive: true })
          .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); })
          .catch(() => flagContactNotSaved(client.name || client.registration?.fullName || ""));
      } else {
        const opened = await fetch("/api/admin/whatsapp-chat/open-client", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: registrationId })
        });
        const conversation = await opened.json().catch(() => ({}));
        if (!opened.ok || !conversation.conversationId) {
          notify(conversation.error || "Não foi possível abrir a conversa no Chat.", "danger");
          return;
        }
        // A lista vai como IMAGEM (PNG personalizada, a mesma da apresentação) com a legenda curta. O navegador busca a imagem
        // pública (mesma origem) e a entrega ao envio de mídia do Chat, que a guarda no storage e manda pelo WhatsApp do corretor.
        let imageBlob = null;
        try {
          const imageResponse = await fetch(new URL(imageUrl, window.location.origin).pathname, { cache: "no-store" });
          if (imageResponse.ok) imageBlob = await imageResponse.blob();
        } catch {
          imageBlob = null;
        }
        if (!imageBlob || !imageBlob.size) {
          notify("Não foi possível gerar a imagem da lista de documentos. Tente novamente.", "danger");
          return;
        }
        const form = new FormData();
        form.append("file", new File([imageBlob], "lista-de-documentos.png", { type: "image/png" }));
        form.append("caption", message);
        const sent = await fetch(`/api/admin/whatsapp-chat/conversations/${conversation.conversationId}/media`, { method: "POST", body: form });
        const sentData = await sent.json().catch(() => ({}));
        if (!sent.ok) {
          notify(sentData.error || "Não foi possível enviar a imagem pelo Chat.", "danger");
          return;
        }
      }
      const logged = await fetch(`/api/admin/clients/${registrationId}/lista-documentos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "registrar" })
      }).catch(() => null);
      if (!logged?.ok) notify("A mensagem foi encaminhada, mas o registro na jornada do cliente falhou.", "danger");
      else notify(decision.action === CARD_WA_EXTERNAL ? "WhatsApp aberto. Baixe a imagem da lista, anexe e envie por lá." : "Imagem da lista de documentos enviada pelo Chat.");
    });
  }

  async function copyBrokerSimulationLink() {
    try {
      await navigator.clipboard.writeText(brokerSimulationLink);
      notify("Link de simulação copiado.");
    } catch {
      notify("Não foi possível copiar. Seu link: " + brokerSimulationLink, "danger");
    }
  }

  return {
    // estado
    filters, searchInput, page, pageSize, items, total, totalPages, counters, pendingClientsCount,
    loading, loadError, localTags, busyClientId: busyClientId || (chatNavPending ? openingChatClientId : ""), dncTarget, receivedDateTarget, docsListTarget, responsibleProfiles, responsibleProfileMap,
    // filtros e paginação
    setSearchInput, updateFilters, resetFilters, goToPage, changePageSize, fetchClients,
    // ações
    activitiesFor, openSimulation, openValues, removeClient, updateClientStatus, updateClientResponsibleUser,
    handleProspectingAction, confirmDoNotContact, cancelDoNotContact: () => setDncTarget(null),
    confirmReceivedDate, cancelReceivedDate: () => setReceivedDateTarget(null),
    saveClientSchedule, clearClientSchedule, completeClientSchedule, createClientActivity, completeClientActivity, cancelClientActivity,
    saveClientTags, createTagForClient, deleteTagFromSystem, openWhatsApp, prepareDocumentsList, confirmDocumentsList, cancelDocumentsList: () => setDocsListTarget(null), copyBrokerSimulationLink, getScheduleDraft
  };
}

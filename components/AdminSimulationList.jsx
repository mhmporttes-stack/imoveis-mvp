"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
  MessageCircle,
  Plus,
  Search,
  Tag,
  Trash2,
  UserRound,
  X
} from "lucide-react";
import { CLIENT_STATUS, CLIENT_STATUS_META, CLIENT_STATUS_OPTIONS, normalizeClientStatus } from "@/lib/client-status";
import { buildWhatsAppUrl, formatBrazilianPhone, toWhatsAppDigits } from "@/lib/phone-utils";
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
import {
  extractSimulationPhone,
  formatMoneyBR,
  getSimulationListSummary,
  normalizeMoneyValue,
  normalizePhone
} from "@/lib/simulation-list-utils";

const PAGE_SIZE_OPTIONS = [5, 10, 20];
const TAG_COLORS = ["#0D4F8B", "#1D4ED8", "#047857", "#B91C1C", "#7C3AED", "#334155", "#0F766E", "#BE123C"];

export default function AdminSimulationList({ registrations = [], simulations = [], tags = [] }) {
  const router = useRouter();
  const listTopRef = useRef(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [pageSize, setPageSize] = useState(5);
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedClientId, setExpandedClientId] = useState("");
  const [editingTagsClientId, setEditingTagsClientId] = useState("");
  const [localRegistrations, setLocalRegistrations] = useState(() => ensureArray(registrations));
  const [localTags, setLocalTags] = useState(() => ensureArray(tags));
  const [tagDraft, setTagDraft] = useState("");
  const [tagColor, setTagColor] = useState(TAG_COLORS[0]);
  const [busyClientId, setBusyClientId] = useState("");

  useEffect(() => {
    setLocalRegistrations(ensureArray(registrations));
  }, [registrations]);

  useEffect(() => {
    setLocalTags(ensureArray(tags));
  }, [tags]);

  const clientsResult = useMemo(() => {
    try {
      const safeSimulations = ensureArray(simulations);
      const safeRegistrations = ensureArray(localRegistrations);
      const usedRegistrationIds = new Set();
      const simulationClients = safeSimulations.map((simulation) => {
        const summary = getSimulationListSummary(simulation);
        const registration = findRegistrationForSimulation(simulation, safeRegistrations);
        if (registration?.id) usedRegistrationIds.add(registration.id);

        return buildClientItem({
          registration,
          simulation,
          summary
        });
      });

      const registrationOnlyClients = safeRegistrations
        .filter((registration) => !usedRegistrationIds.has(registration.id))
        .map((registration) => buildClientItem({ registration }));

      const items = [...simulationClients, ...registrationOnlyClients].sort((a, b) => {
        const dateA = safeTimestamp(a.sortDate);
        const dateB = safeTimestamp(b.sortDate);
        return dateB - dateA;
      });

      return { error: "", items };
    } catch (error) {
      console.error("Erro ao montar a lista de clientes:", error);
      return {
        error: error?.message || "Nao foi possivel montar a lista de clientes.",
        items: []
      };
    }
  }, [localRegistrations, simulations]);
  const clients = clientsResult.items;

  const counters = useMemo(() => {
    const base = {
      all: clients.length,
      [CLIENT_STATUS.PENDING]: 0,
      [CLIENT_STATUS.COMPLETED]: 0,
      [CLIENT_STATUS.APPROVED]: 0
    };

    for (const client of clients) {
      base[client.status] = (base[client.status] || 0) + 1;
    }

    return base;
  }, [clients]);

  const filteredClients = useMemo(() => {
    const textQuery = normalizeText(query);
    const phoneQuery = normalizePhone(query);

    return clients.filter((client) => {
      if (statusFilter !== "all" && client.status !== statusFilter) return false;
      if (tagFilter !== "all" && !ensureArray(client.tags).some((tagItem) => tagItem.id === tagFilter)) return false;
      if (!textQuery && !phoneQuery) return true;

      return (
        client.searchText.text.includes(textQuery) ||
        (phoneQuery ? client.searchText.phone.includes(phoneQuery) : false)
      );
    });
  }, [clients, query, statusFilter, tagFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredClients.length / pageSize));
  const pageStart = filteredClients.length ? (currentPage - 1) * pageSize : 0;
  const pageEnd = Math.min(pageStart + pageSize, filteredClients.length);
  const currentClients = filteredClients.slice(pageStart, pageEnd);
  const pageNumbers = getPageNumbers(currentPage, totalPages);

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, query, statusFilter, tagFilter]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  function goToPage(page) {
    const nextPage = Math.min(Math.max(page, 1), totalPages);
    setCurrentPage(nextPage);
    listTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function openSimulation(client) {
    if (client.simulation?.id) {
      router.push(`/admin/simulacoes/${client.simulation.id}`);
      return;
    }

    if (!client.registration?.id) return;

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
        return;
      }

      router.push(`/admin/simulacoes/${data.id}`);
    } finally {
      setBusyClientId("");
    }
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

      if (client.registration?.id) {
        const registrationResponse = await fetch(`/api/simulation-registrations/${client.registration.id}`, { method: "DELETE" });
        if (!registrationResponse.ok) {
          const data = await registrationResponse.json().catch(() => ({}));
          alert(data.error || "Não foi possível excluir o cadastro.");
          return;
        }
      }

      setLocalRegistrations((current) => current.filter((registration) => registration.id !== client.registration?.id));
      router.refresh();
    } finally {
      setBusyClientId("");
    }
  }

  async function updateClientStatus(client, status) {
    if (!client.registration?.id) {
      alert("Este cliente ainda não possui cadastro vinculado para alterar o status.");
      return;
    }

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

      setLocalRegistrations((current) => current.map((registration) => (
        registration.id === client.registration.id
          ? { ...registration, status: nextStatus, approvedAt: data.approvedAt || registration.approvedAt }
          : registration
      )));
    } finally {
      setBusyClientId("");
    }
  }

  async function saveClientTags(client, nextTagIds) {
    if (!client.registration?.id) {
      alert("Este cliente ainda não possui cadastro vinculado para receber tags.");
      return;
    }

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
      setLocalRegistrations((current) => current.map((registration) => (
        registration.id === client.registration.id ? { ...registration, tags: nextTags } : registration
      )));
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
      await saveClientTags(client, [...ensureArray(client.tags).map((item) => item.id), tag.id]);
    } finally {
      setBusyClientId("");
    }
  }

  async function deleteTagFromSystem(tagItem) {
    const linkedCount = localRegistrations.filter((registration) => (
      (registration.tags || []).some((item) => item.id === tagItem.id)
    )).length;

    if (!confirm(`Excluir a tag "${tagItem.name}"? Ela será removida de ${linkedCount} cliente(s).`)) return;

    const response = await fetch(`/api/client-tags/${tagItem.id}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      alert(data.error || "Não foi possível excluir a tag.");
      return;
    }

    setLocalTags((current) => current.filter((item) => item.id !== tagItem.id));
    setLocalRegistrations((current) => current.map((registration) => ({
      ...registration,
      tags: (registration.tags || []).filter((item) => item.id !== tagItem.id)
    })));
  }

  function openWhatsApp(client) {
    const value = client.registration?.phoneNormalized || client.registration?.phone || extractSimulationPhone(client.simulation);
    const whatsapp = buildWhatsAppUrl(value);
    if (!whatsapp || !toWhatsAppDigits(value)) {
      alert("Este cliente não possui um WhatsApp válido.");
      return;
    }

    window.open(whatsapp, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="container-page max-w-full overflow-hidden" ref={listTopRef}>
      <div className="overflow-hidden rounded-[28px] border border-line bg-white p-4 shadow-soft sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block w-full lg:max-w-xl">
            <span className="sr-only">Buscar cliente</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-brand" aria-hidden="true" />
            <input
              className="h-12 w-full rounded-2xl border border-line bg-white pl-12 pr-4 text-base font-bold text-navy outline-none transition duration-300 placeholder:text-muted/70 focus:border-brand focus:ring-4 focus:ring-brand/10"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar cliente..."
              type="search"
              value={query}
            />
          </label>

          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative block">
              <span className="sr-only">Filtrar por tag</span>
              <Tag className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-brand" aria-hidden="true" />
              <select
                className="h-12 min-w-[210px] rounded-2xl border border-brand/25 bg-white pl-11 pr-4 text-sm font-extrabold text-navy outline-none transition duration-300 focus:border-brand focus:ring-4 focus:ring-brand/10"
                onChange={(event) => setTagFilter(event.target.value)}
                value={tagFilter}
              >
                <option value="all">Todas as tags</option>
                {localTags.map((tagItem) => (
                  <option key={tagItem.id} value={tagItem.id}>{tagItem.name}</option>
                ))}
              </select>
            </label>
            <button
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-brand/30 bg-white px-5 text-sm font-extrabold text-brand transition duration-300 hover:-translate-y-0.5 hover:border-brand hover:bg-[#EEF6FF] focus:outline-none focus:ring-4 focus:ring-brand/15"
              onClick={() => listTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              type="button"
            >
              <Filter className="h-4 w-4" aria-hidden="true" />
              Filtros
            </button>
          </div>
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {CLIENT_STATUS_OPTIONS.map((filter) => {
            const active = statusFilter === filter.value;
            const meta = filter.value === "all" ? null : CLIENT_STATUS_META[filter.value];
            const counterClass = filter.value === CLIENT_STATUS.PENDING
              ? "bg-red-50 text-red-700"
              : filter.value === CLIENT_STATUS.APPROVED
                ? "bg-emerald-50 text-emerald-700"
                : active
                  ? "bg-brand text-white"
                  : "bg-[#EEF4FB] text-navy";

            return (
              <button
                className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-full border px-4 text-center text-sm font-extrabold transition duration-300 ${
                  active
                    ? (meta?.activeClass || "border-brand bg-[#EAF3FF] text-brand")
                    : "border-line bg-white text-navy hover:border-brand/40 hover:bg-[#F5FAFF]"
                }`}
                key={filter.value}
                onClick={() => setStatusFilter(filter.value)}
                type="button"
              >
                {filter.label}
                <span className={`rounded-full px-2 py-0.5 text-xs ${counterClass}`}>
                  {counters[filter.value] || 0}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 text-sm font-bold text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>{getPaginationLabel(pageStart, pageEnd, filteredClients.length)}</p>
        <label className="inline-flex items-center gap-2">
          <span className="sr-only">Clientes por página</span>
          <select
            className="h-10 rounded-2xl border border-line bg-white px-4 font-extrabold text-navy outline-none transition duration-300 focus:border-brand focus:ring-4 focus:ring-brand/10"
            onChange={(event) => setPageSize(Number(event.target.value))}
            value={pageSize}
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>{option} por página</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 grid gap-3">
        {clientsResult.error ? (
          <div className="rounded-[18px] border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-800">
            {clientsResult.error}
          </div>
        ) : null}
        {currentClients.length ? currentClients.map((client) => (
          <ClientCard
            busy={busyClientId === client.id}
            client={client}
            deleteTagFromSystem={deleteTagFromSystem}
            editingTagsClientId={editingTagsClientId}
            expanded={expandedClientId === client.id}
            key={client.id}
            localTags={localTags}
            onCreateTag={createTagForClient}
            onOpenSimulation={openSimulation}
            onOpenWhatsApp={openWhatsApp}
            onRemoveClient={removeClient}
            onSaveTags={saveClientTags}
            onToggleDetails={() => setExpandedClientId((current) => current === client.id ? "" : client.id)}
            onToggleTagEditor={() => setEditingTagsClientId((current) => current === client.id ? "" : client.id)}
            onUpdateStatus={updateClientStatus}
            setTagColor={setTagColor}
            setTagDraft={setTagDraft}
            tagColor={tagColor}
            tagDraft={tagDraft}
          />
        )) : (
          <EmptyState hasClients={clients.length > 0} hasQuery={query.trim().length > 0} statusFilter={statusFilter} tagFilter={tagFilter} />
        )}
      </div>

      {filteredClients.length > 0 ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <PaginationButton disabled={currentPage === 1} onClick={() => goToPage(currentPage - 1)}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Anterior
          </PaginationButton>

          {pageNumbers.map((page) => (
            <button
              aria-current={page === currentPage ? "page" : undefined}
              className={`h-10 min-w-10 rounded-full border px-3 text-sm font-extrabold transition duration-300 ${
                page === currentPage
                  ? "border-brand bg-brand text-white"
                  : "border-line bg-white text-navy hover:border-brand hover:bg-[#F5FAFF]"
              }`}
              key={page}
              onClick={() => goToPage(page)}
              type="button"
            >
              {page}
            </button>
          ))}

          <PaginationButton disabled={currentPage === totalPages} onClick={() => goToPage(currentPage + 1)}>
            Próxima
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </PaginationButton>
        </div>
      ) : null}
    </section>
  );
}

function ClientCard({
  busy,
  client,
  deleteTagFromSystem,
  editingTagsClientId,
  expanded,
  localTags,
  onCreateTag,
  onOpenSimulation,
  onOpenWhatsApp,
  onRemoveClient,
  onSaveTags,
  onToggleDetails,
  onToggleTagEditor,
  onUpdateStatus,
  setTagColor,
  setTagDraft,
  tagColor,
  tagDraft
}) {
  const hasRegistration = Boolean(client.registration?.id);
  const clientTags = ensureArray(client.tags);
  const currentTagIds = clientTags.map((tagItem) => tagItem.id).filter(Boolean);

  return (
    <article className="max-w-full overflow-hidden rounded-[18px] border border-line bg-white p-4 shadow-[0_12px_30px_rgba(13,59,102,0.06)] transition duration-300 hover:-translate-y-0.5 hover:shadow-soft sm:p-[18px]">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-black text-navy sm:text-xl" title={client.name}>
            {client.name || "Cliente sem nome"}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {hasRegistration ? (
              <select
                aria-label={`Alterar status de ${client.name}`}
                className={`rounded-full border-0 px-3 py-1 text-[11px] font-black outline-none transition focus:ring-4 focus:ring-brand/15 ${CLIENT_STATUS_META[client.status]?.badgeClass || CLIENT_STATUS_META.pending.badgeClass}`}
                disabled={busy}
                onChange={(event) => onUpdateStatus(client, event.target.value)}
                value={client.status}
              >
                {CLIENT_STATUS_OPTIONS.filter((option) => option.value !== "all").map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            ) : (
              <StatusBadge status={client.status} />
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-start justify-start gap-1.5 sm:max-w-xs sm:justify-end">
          {clientTags.slice(0, 4).map((tagItem) => (
            <TagPill key={tagItem.id} tag={tagItem} />
          ))}
          {clientTags.length > 4 ? (
            <span className="rounded-full bg-[#EEF4FB] px-2 py-1 text-[11px] font-black text-navy">+{clientTags.length - 4}</span>
          ) : null}
          {hasRegistration ? (
            <button
              className="inline-flex h-8 items-center gap-1 rounded-full border border-brand/25 bg-white px-3 text-[11px] font-black text-brand transition hover:border-brand hover:bg-[#EEF6FF]"
              onClick={onToggleTagEditor}
              type="button"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Tags
            </button>
          ) : null}
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

      <p className="mt-2 text-sm font-bold text-muted">Data: {client.dateLabel}</p>

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
        <PendingClientInfo registration={client.registration} />
      )}

      {expanded ? <InlineRegistrationDetails registration={client.registration} simulation={client.simulation} /> : null}

      <div className="mt-4 grid grid-cols-4 gap-2">
        <button
          aria-label={`Abrir simulação de ${client.name || "cliente"}`}
          className="client-action-button"
          disabled={busy}
          onClick={() => onOpenSimulation(client)}
          type="button"
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          Abrir
        </button>
        <button
          aria-label={`Ver cadastro de ${client.name || "cliente"}`}
          className="client-action-button"
          onClick={onToggleDetails}
          type="button"
        >
          <UserRound className="h-4 w-4" aria-hidden="true" />
          Cadastro
        </button>
        <button
          aria-label={`Abrir WhatsApp de ${client.name || "cliente"}`}
          className="client-action-button"
          onClick={() => onOpenWhatsApp(client)}
          type="button"
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          Whats
        </button>
        <button
          aria-label={`Excluir cliente ${client.name || ""}`.trim()}
          className="client-action-button"
          disabled={busy}
          onClick={() => onRemoveClient(client)}
          type="button"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Excluir
        </button>
      </div>
    </article>
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
                {active ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                {tagItem.name}
              </button>
              <button
                aria-label={`Excluir tag ${tagItem.name}`}
                className="inline-flex h-9 w-8 items-center justify-center border-l border-line text-muted transition hover:bg-red-50 hover:text-red-700"
                onClick={() => onDeleteTag(tagItem)}
                type="button"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </span>
          );
        })}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input
          className="h-10 rounded-2xl border border-line bg-white px-4 text-sm font-bold text-navy outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
          onChange={(event) => setTagDraft(event.target.value)}
          placeholder="Nova tag"
          value={tagDraft}
        />
        <select
          className="h-10 rounded-2xl border border-line bg-white px-3 text-sm font-bold text-navy outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
          onChange={(event) => setTagColor(event.target.value)}
          value={tagColor}
        >
          {TAG_COLORS.map((color) => (
            <option key={color} value={color}>{color}</option>
          ))}
        </select>
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

function PendingClientInfo({ registration }) {
  if (!registration) {
    return <p className="mt-2 text-sm font-extrabold text-red-700">Cliente aguardando simulação</p>;
  }

  const lines = [
    normalizeMoneyValue(registration.primaryMonthlyIncome) > 0 ? `Renda: ${formatCurrency(registration.primaryMonthlyIncome)}` : "",
    registration.primaryIncomeType ? `Regime de trabalho: ${incomeTypeLabel(registration.primaryIncomeType)}` : "",
    normalizeMoneyValue(registration.availablePurchaseResource) > 0 ? `Recurso próprio: ${formatCurrency(registration.availablePurchaseResource)}` : ""
  ].filter(Boolean);

  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-sm font-extrabold text-red-700">Cliente aguardando simulação</p>
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
      </div>
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

function StatusBadge({ status }) {
  const meta = CLIENT_STATUS_META[normalizeClientStatus(status)] || CLIENT_STATUS_META.pending;
  return <span className={`w-fit rounded-full px-3 py-1 text-[11px] font-black ${meta.badgeClass}`}>{meta.label}</span>;
}

function EmptyState({ hasClients, hasQuery, statusFilter, tagFilter }) {
  let message = "Nenhum cliente cadastrado.";

  if (hasClients && hasQuery) {
    message = "Nenhum cliente encontrado para esta busca.";
  } else if (hasClients && (statusFilter !== "all" || tagFilter !== "all")) {
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

function buildClientItem({ registration = null, simulation = null, summary = null }) {
  const safeSummary = summary || {
    completed: false,
    financing: 0,
    ownResource: 0,
    subsidy: 0,
    purchasePower: 0,
    components: []
  };
  const status = resolveClientStatus(registration, safeSummary);
  const name = registration?.fullName || simulation?.clientName || "Cliente sem nome";
  const sortDate = registration?.createdAt || simulation?.simulationDate || simulation?.updatedAt || simulation?.createdAt || "";

  return {
    id: registration?.id || `simulation-${simulation?.id || name}`,
    completed: status === CLIENT_STATUS.COMPLETED || status === CLIENT_STATUS.APPROVED,
    dateLabel: safeFormatDateLabel(registration, simulation),
    name,
    registration,
    searchText: buildSearchText(simulation, registration),
    simulation,
    sortDate,
    status,
    summary: safeSummary,
    tags: ensureArray(registration?.tags)
  };
}

function resolveClientStatus(registration, summary) {
  const storedStatus = normalizeClientStatus(registration?.status);
  if (storedStatus === CLIENT_STATUS.APPROVED) return CLIENT_STATUS.APPROVED;
  if (storedStatus === CLIENT_STATUS.COMPLETED) return CLIENT_STATUS.COMPLETED;
  return summary?.completed ? CLIENT_STATUS.COMPLETED : CLIENT_STATUS.PENDING;
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
      "Simulação não realizada"
    ].filter(Boolean).join("\n"),
    outputMode: "individual",
    properties: []
  };
}

function findRegistrationForSimulation(simulation = {}, registrations = []) {
  if (simulation.registrationId) {
    const byId = registrations.find((registration) => registration.id === simulation.registrationId);
    if (byId) return byId;
  }

  const phone = extractSimulationPhone(simulation);
  const name = normalizeText(simulation.clientName);

  if (phone) {
    const byPhone = registrations.find((registration) => {
      const registrationPhone = normalizePhone(registration.phoneNormalized || registration.phone);
      return registrationPhone && (registrationPhone.endsWith(phone) || phone.endsWith(registrationPhone));
    });
    if (byPhone) return byPhone;
  }

  if (!name) return null;

  return registrations.find((registration) => normalizeText(registration.fullName) === name) || null;
}

function buildSearchText(simulation = {}, registration = null) {
  const phone = [
    extractSimulationPhone(simulation),
    registration?.phone,
    registration?.phoneNormalized
  ].map(normalizePhone).join(" ");

  const tags = ensureArray(registration?.tags).map((tagItem) => tagItem.name).join(" ");
  const text = normalizeText([
    simulation?.clientName,
    registration?.fullName,
    registration?.primaryIncomeType,
    tags,
    simulation?.createdBy,
    simulation?.internalNote
  ].filter(Boolean).join(" "));

  return { phone, text };
}

function formatDateLabel(registration, simulation) {
  const value = simulation?.simulationDate || registration?.createdAt || simulation?.updatedAt || simulation?.createdAt;
  if (!value) return "Sem data";
  if (String(value).includes("T")) return formatDateTimeBR(value).split(" às ")[0] || formatDateBR(value);
  return formatDateBR(value);
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

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function ensureArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function safeTimestamp(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function safeFormatDateLabel(registration, simulation) {
  try {
    return formatDateLabel(registration, simulation);
  } catch {
    const value = simulation?.simulationDate || registration?.createdAt || simulation?.updatedAt || simulation?.createdAt;
    return value ? String(value).slice(0, 10) : "Sem data";
  }
}

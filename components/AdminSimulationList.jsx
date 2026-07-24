"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
  Search,
  Trash2,
  UserRound
} from "lucide-react";
import {
  extractSimulationPhone,
  formatMoneyBR,
  getSimulationListSummary,
  normalizePhone
} from "@/lib/simulation-list-utils";

const PAGE_SIZE_OPTIONS = [5, 10, 20];
const STATUS_FILTERS = [
  { key: "all", label: "Todos" },
  { key: "completed", label: "Simulação realizada" },
  { key: "pending", label: "Simulação não realizada" }
];

export default function AdminSimulationList({ registrations = [], simulations = [] }) {
  const router = useRouter();
  const listTopRef = useRef(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [pageSize, setPageSize] = useState(5);
  const [currentPage, setCurrentPage] = useState(1);

  const clients = useMemo(() => {
    return simulations.map((simulation) => {
      const summary = getSimulationListSummary(simulation);
      const registration = findRegistrationForSimulation(simulation, registrations);

      return {
        completed: summary.completed,
        registration,
        searchText: buildSearchText(simulation, registration),
        simulation,
        summary
      };
    });
  }, [registrations, simulations]);

  const counters = useMemo(() => {
    const completed = clients.filter((client) => client.completed).length;

    return {
      all: clients.length,
      completed,
      pending: clients.length - completed
    };
  }, [clients]);

  const filteredClients = useMemo(() => {
    const textQuery = normalizeText(query);
    const phoneQuery = normalizePhone(query);

    return clients.filter((client) => {
      if (statusFilter === "completed" && !client.completed) return false;
      if (statusFilter === "pending" && client.completed) return false;

      if (!textQuery && !phoneQuery) return true;

      return (
        client.searchText.text.includes(textQuery) ||
        (phoneQuery ? client.searchText.phone.includes(phoneQuery) : false)
      );
    });
  }, [clients, query, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredClients.length / pageSize));
  const pageStart = filteredClients.length ? (currentPage - 1) * pageSize : 0;
  const pageEnd = Math.min(pageStart + pageSize, filteredClients.length);
  const currentClients = filteredClients.slice(pageStart, pageEnd);
  const pageNumbers = getPageNumbers(currentPage, totalPages);

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, query, statusFilter]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  async function removeSimulation(simulation) {
    const clientName = simulation.clientName || "este cliente";
    if (!confirm(`Excluir o cadastro de "${clientName}"?`)) return;

    const response = await fetch(`/api/simulations/${simulation.id}`, { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      alert(data.error || "Não foi possível excluir o cliente.");
      return;
    }

    router.refresh();
  }

  function goToPage(page) {
    const nextPage = Math.min(Math.max(page, 1), totalPages);
    setCurrentPage(nextPage);
    listTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section className="container-page" ref={listTopRef}>
      <div className="rounded-[28px] border border-line bg-white p-4 shadow-soft sm:p-5">
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

          <button
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-brand/30 bg-white px-5 text-sm font-extrabold text-brand transition duration-300 hover:-translate-y-0.5 hover:border-brand hover:bg-[#EEF6FF] focus:outline-none focus:ring-4 focus:ring-brand/15"
            onClick={() => listTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            type="button"
          >
            <Filter className="h-4 w-4" aria-hidden="true" />
            Filtros
          </button>
        </div>

        <div id="simulation-status-filters" className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {STATUS_FILTERS.map((filter) => {
            const active = statusFilter === filter.key;
            const pending = filter.key === "pending";

            return (
              <button
                className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-extrabold transition duration-300 ${
                  active
                    ? "border-brand bg-[#EAF3FF] text-brand"
                    : "border-line bg-white text-navy hover:border-brand/40 hover:bg-[#F5FAFF]"
                }`}
                key={filter.key}
                onClick={() => setStatusFilter(filter.key)}
                type="button"
              >
                {filter.label}
                <span className={`rounded-full px-2 py-0.5 text-xs ${pending ? "bg-red-50 text-red-700" : active ? "bg-brand text-white" : "bg-[#EEF4FB] text-navy"}`}>
                  {counters[filter.key]}
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
        {currentClients.length ? currentClients.map((client) => (
          <ClientCard
            client={client}
            key={client.simulation.id}
            removeSimulation={removeSimulation}
          />
        )) : (
          <EmptyState hasClients={clients.length > 0} hasQuery={query.trim().length > 0} statusFilter={statusFilter} />
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

function ClientCard({ client, removeSimulation }) {
  const { completed, registration, simulation, summary } = client;
  const date = formatDateBR(simulation.simulationDate || simulation.updatedAt || simulation.createdAt);

  return (
    <article className="rounded-[18px] border border-line bg-white p-4 shadow-[0_12px_30px_rgba(13,59,102,0.06)] transition duration-300 hover:-translate-y-0.5 hover:shadow-soft sm:p-[18px]">
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 flex-1 truncate text-lg font-black text-navy sm:text-xl" title={simulation.clientName}>
          {simulation.clientName || "Cliente sem nome"}
        </h2>
        <StatusBadge completed={completed} />
      </div>

      <p className="mt-1 text-sm font-bold text-muted">Data: {date}</p>

      {completed ? (
        <div className="mt-2 space-y-1.5">
          <p className="text-sm leading-6 text-muted">
            Poder total de compra: <strong className="text-navy">{formatMoneyBR(summary.purchasePower)}</strong>
          </p>
          {summary.components.length ? (
            <p className="text-sm leading-6 text-muted">{summary.components.join(" · ")}</p>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-sm font-extrabold text-red-700">Cliente aguardando simulação</p>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Link
          aria-label={`Abrir simulação de ${simulation.clientName || "cliente"}`}
          className="client-action-button"
          href={`/admin/simulacoes/${simulation.id}`}
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          Abrir
        </Link>
        <Link
          aria-label={`Abrir cadastro de ${simulation.clientName || "cliente"}`}
          className="client-action-button"
          href={registration ? `/admin/cadastros/${registration.id}` : "/admin/cadastros"}
        >
          <UserRound className="h-4 w-4" aria-hidden="true" />
          Cadastro
        </Link>
        <button
          aria-label={`Excluir cliente ${simulation.clientName || ""}`.trim()}
          className="client-action-button"
          onClick={() => removeSimulation(simulation)}
          type="button"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Excluir
        </button>
      </div>
    </article>
  );
}

function StatusBadge({ completed }) {
  return (
    <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-black ${
      completed
        ? "bg-[#EAF3FF] text-brand"
        : "bg-red-50 text-red-700"
    }`}>
      {completed ? "Simulação realizada" : "Simulação não realizada"}
    </span>
  );
}

function EmptyState({ hasClients, hasQuery, statusFilter }) {
  let message = "Nenhum cliente cadastrado.";

  if (hasClients && hasQuery) {
    message = "Nenhum cliente encontrado para esta busca.";
  } else if (hasClients && statusFilter !== "all") {
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

function findRegistrationForSimulation(simulation = {}, registrations = []) {
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

  const text = normalizeText([
    simulation.clientName,
    registration?.fullName,
    simulation.createdBy,
    simulation.internalNote
  ].filter(Boolean).join(" "));

  return { phone, text };
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

function formatDateBR(value) {
  if (!value) return "Sem data";

  const date = String(value).includes("T")
    ? new Date(value)
    : new Date(`${value}T12:00:00`);

  if (Number.isNaN(date.getTime())) return "Sem data";
  return date.toLocaleDateString("pt-BR");
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

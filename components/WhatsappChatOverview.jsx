"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";
import Avatar from "@/components/Avatar";
import { BrokerChip, WaitingBadge } from "@/components/WhatsappChatBadges";
import { useWhatsappChatSummary } from "@/components/useWhatsappChatSummary";

const SITUATIONS = [
  { key: "", label: "Todas" },
  { key: "awaiting_us", label: "Sem resposta nossa" },
  { key: "contact_silent", label: "Cliente sem responder" },
  { key: "no_broker", label: "Sem corretor" },
  { key: "in_service", label: "Em atendimento" },
  { key: "finished", label: "Finalizadas" }
];

const STATUS_LABELS = { open: "Nova", in_service: "Em atendimento", finished: "Finalizada" };
const DATE_TIME = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function formatPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  const national = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  if (national.length === 11) return `(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  if (national.length === 10) return `(${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  return phone || "";
}

// Visão geral do Chat: uma linha por conversa com cliente, corretor
// responsável, etapa, última mensagem e a situação de resposta (no vácuo).
export default function WhatsappChatOverview({ canManage, onOpen }) {
  const [data, setData] = useState(null);
  const [brokers, setBrokers] = useState([]);
  const [broker, setBroker] = useState("");
  const [situation, setSituation] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const filtersRef = useRef({ broker, situation, search });
  filtersRef.current = { broker, situation, search };

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const { broker: brokerValue, situation: situationValue, search: searchValue } = filtersRef.current;
      const params = new URLSearchParams();
      if (brokerValue) params.set("broker", brokerValue);
      if (situationValue) params.set("situation", situationValue);
      if (searchValue) params.set("q", searchValue);
      const response = await fetch(`/api/admin/whatsapp-chat/overview?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar a visão geral.");
      setData(payload);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [broker, situation, search, load]);

  useEffect(() => {
    if (!canManage) return;
    fetch("/api/admin/whatsapp-chat/brokers", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => setBrokers(payload.brokers || []))
      .catch(() => {});
  }, [canManage]);

  // Tempo real + relógio: os "há X min" precisam andar sozinhos.
  useWhatsappChatSummary(useCallback(() => load({ silent: true }), [load]));
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === "visible") load({ silent: true }); }, 60000);
    return () => clearInterval(id);
  }, [load]);

  const counts = data?.counts;
  const rows = data?.rows || [];

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="Sem resposta (atrasadas)" value={counts?.awaitingLate} tone="red" onClick={() => setSituation("awaiting_us")} />
        <Stat label="Aguardando resposta" value={counts?.awaitingWarn} tone="amber" onClick={() => setSituation("awaiting_us")} />
        <Stat label="Cliente sem responder" value={counts?.silent} tone="slate" onClick={() => setSituation("contact_silent")} />
        <Stat label="Sem corretor" value={counts?.noBroker} tone="amber" onClick={() => setSituation("no_broker")} />
        <Stat label="Em atendimento" value={counts?.inService} tone="blue" onClick={() => setSituation("in_service")} />
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <label className="relative block flex-1">
          <span className="sr-only">Buscar</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand" aria-hidden="true" />
          <input
            className="h-11 w-full rounded-2xl border border-line bg-white pl-10 pr-3 text-sm font-bold text-navy outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Buscar por cliente, telefone ou corretor"
            type="search"
            value={searchInput}
          />
        </label>
        {canManage ? (
          <select value={broker} onChange={(event) => setBroker(event.target.value)} className="h-11 rounded-2xl border border-line bg-white px-3 text-sm font-bold text-navy outline-none focus:border-brand">
            <option value="">Todos os corretores</option>
            <option value="none">Sem corretor</option>
            {brokers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        ) : null}
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {SITUATIONS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setSituation(item.key)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-extrabold transition ${situation === item.key ? "border-brand bg-blue-50 text-brand" : "border-line bg-white text-navy hover:border-brand/40"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? <p className="rounded-2xl border border-red-100 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p> : null}
      {loading && !data ? <p className="flex items-center justify-center gap-2 p-8 text-sm font-bold text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</p> : null}
      {!loading && !error && !rows.length ? <p className="p-8 text-center text-sm font-bold text-muted">Nenhuma conversa neste filtro.</p> : null}

      {/* Computador: tabela */}
      {rows.length ? (
        <div className="hidden overflow-hidden rounded-2xl border border-line md:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-mist/60 text-[11px] font-extrabold uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2.5">Cliente</th>
                <th className="px-3 py-2.5">Corretor</th>
                <th className="px-3 py-2.5">Etapa</th>
                <th className="px-3 py-2.5">Última mensagem</th>
                <th className="px-3 py-2.5">Situação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} onClick={() => onOpen(row.id)} className="cursor-pointer border-t border-line/70 transition hover:bg-mist/50">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <Avatar name={row.client?.name || row.name || row.phone} photoUrl={row.photoUrl} size={36} />
                      <div className="min-w-0">
                        <p className={`truncate text-sm text-navy ${row.unreadCount ? "font-black" : "font-extrabold"}`}>{row.client?.name || row.name || formatPhone(row.phone)}</p>
                        <p className="truncate text-[11px] font-bold text-muted">{formatPhone(row.phone)}{!row.client ? " · não cadastrado" : ""}</p>
                      </div>
                      {row.unreadCount ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-black text-white">{row.unreadCount}</span> : null}
                    </div>
                  </td>
                  <td className="px-3 py-2.5"><BrokerChip broker={row.broker} /></td>
                  <td className="px-3 py-2.5 text-xs font-bold text-slate-600">
                    {row.client?.funnelStage || row.client?.statusLabel || "—"}
                    <span className="block text-[10px] font-extrabold text-muted">{STATUS_LABELS[row.status] || row.status}</span>
                  </td>
                  <td className="max-w-[260px] px-3 py-2.5">
                    <p className="flex items-center gap-1 truncate text-xs font-semibold text-slate-600">
                      {row.lastMessageDirection === "outbound" ? <Check className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-label="Enviada" /> : null}
                      <span className="truncate">{row.lastMessagePreview || "—"}</span>
                    </p>
                    <p className="text-[10px] font-bold text-muted">{row.lastMessageAt ? DATE_TIME.format(new Date(row.lastMessageAt)) : ""}</p>
                  </td>
                  <td className="px-3 py-2.5"><WaitingBadge waiting={row.waiting} />{!row.waiting ? <span className="text-[11px] font-bold text-emerald-600">Em dia</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Celular: cartões */}
      {rows.length ? (
        <div className="space-y-2 md:hidden">
          {rows.map((row) => (
            <button key={row.id} type="button" onClick={() => onOpen(row.id)} className="block w-full rounded-2xl border border-line bg-white p-3 text-left shadow-sm">
              <div className="flex items-center gap-3">
                <Avatar name={row.client?.name || row.name || row.phone} photoUrl={row.photoUrl} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-navy">{row.client?.name || row.name || formatPhone(row.phone)}</p>
                  <p className="truncate text-[11px] font-bold text-muted">{formatPhone(row.phone)}</p>
                </div>
                {row.unreadCount ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-black text-white">{row.unreadCount}</span> : null}
              </div>
              <p className="mt-2 truncate text-xs font-semibold text-slate-600">{row.lastMessagePreview || "—"}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <BrokerChip broker={row.broker} />
                <WaitingBadge waiting={row.waiting} />
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold text-slate-600">{STATUS_LABELS[row.status] || row.status}</span>
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone, onClick }) {
  const tones = {
    red: "border-red-200 bg-red-50 text-red-700",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    slate: "border-line bg-slate-50 text-slate-700",
    blue: "border-blue-200 bg-blue-50 text-brand"
  };
  return (
    <button type="button" onClick={onClick} className={`rounded-2xl border px-3 py-2.5 text-left transition hover:shadow-sm ${tones[tone]}`}>
      <span className="block text-2xl font-black leading-none">{value ?? "–"}</span>
      <span className="mt-1 block text-[11px] font-extrabold leading-tight">{label}</span>
    </button>
  );
}

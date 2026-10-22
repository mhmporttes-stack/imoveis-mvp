"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Disc3, History, Laptop, Smartphone } from "lucide-react";
import { tabClasses } from "@/components/ui/Tabs";
import Avatar from "@/components/Avatar";
import { useRevalidateOnReuse } from "@/components/useRevalidateOnReuse";
import { formatRelativeActivityText } from "@/lib/admin-presence-core.mjs";
import { nextSundayKey } from "@/lib/office-presence-core.mjs";

// Mesmo espírito de NewClientSoundListener: intervalo fixo e moderado, só
// enquanto a aba está visível — nunca polling agressivo nem uma requisição
// por segundo. A tela também nunca fica presa num "Online" desatualizado:
// cada leitura recalcula o status a partir da idade real do último
// heartbeat (lib/admin-presence.js), não de um valor armazenado.
const POLL_INTERVAL_MS = 20000;

const STATUS_META = {
  online: { label: "Online", dot: "bg-success-strong", chip: "bg-success-soft text-success" },
  away: { label: "Ausente", dot: "bg-warning-strong", chip: "bg-warning-soft text-warning" },
  offline: { label: "Offline", dot: "bg-faint", chip: "bg-neutral-soft text-muted" },
  // Visual novo (dono, 2026-10-22): o vermelho chama "Desconectado" (on-line, mas sem WhatsApp conectado).
  disconnected: { label: "Desconectado", dot: "bg-danger-strong", chip: "bg-danger-soft text-danger" }
};

export default function OnlinePresenceBoard({ initialPresence, initialError = "", renderId = "" }) {
  const [presence, setPresence] = useState(initialPresence);
  const [error, setError] = useState(initialError);
  const [, setTick] = useState(0);
  const reloadRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/admin/presence");
        const data = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok) {
          setError(data?.error || "Não foi possível carregar a presença da equipe.");
          return;
        }
        setPresence(data);
        setError("");
      } catch {
        // Falha de rede pontual — tenta de novo no próximo ciclo.
      }
    }

    reloadRef.current = load;
    const intervalId = setInterval(load, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", load);
    // Recalcula só os textos relativos ("há X min") a cada minuto, sem
    // depender de uma nova requisição — o status/contagem em si só muda
    // quando um novo heartbeat chega (próximo poll).
    const tickId = setInterval(() => setTick((value) => value + 1), 60000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      clearInterval(tickId);
      document.removeEventListener("visibilitychange", load);
    };
  }, []);
  // Tela pré-carregada ou reaproveitada (dono, 2026-10-19): mostra na hora e busca a presença atual em segundo plano.
  useRevalidateOnReuse(renderId, () => reloadRef.current?.());

  const members = presence?.members || [];

  // Percentual da Meta Diária de hoje por corretor (mesmo painel da Meta Diária da equipe), para o anel em volta da foto.
  const [goalByUser, setGoalByUser] = useState(() => new Map());
  useEffect(() => {
    let cancelled = false;
    async function loadGoals() {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/daily-goal/team-overview?period=today");
        if (!response.ok) return;
        const payload = await response.json().catch(() => null);
        if (cancelled || !payload) return;
        setGoalByUser(new Map((payload.brokers || []).map((broker) => [broker.brokerId, broker.meta?.percent ?? null])));
      } catch {
        // Sem a meta, o painel continua só com a presença.
      }
    }
    loadGoals();
    const goalTimer = setInterval(loadGoals, 120000);
    return () => {
      cancelled = true;
      clearInterval(goalTimer);
    };
  }, []);

  return (
    <div className="container-page grid gap-5">
      {error ? (
        <div className="rounded-card border border-danger-line bg-danger-soft p-5 text-sm font-bold text-danger">{error}</div>
      ) : null}

      {members.length ? <PresenceKpis members={members} /> : null}

      <section aria-labelledby="online-equipe" className="rounded-panel border border-line bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="online-equipe" className="text-[15px] font-extrabold text-ink">Presença no CRM</h3>
          <span className="text-xs text-muted">toque nos ícones para ver o histórico</span>
        </div>

        <div className="mt-4 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
          {!members.length ? (
            <p className="rounded-control bg-surface-2 p-4 text-sm font-semibold text-muted">Nenhum corretor na sua equipe.</p>
          ) : (
            members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                goalPercent={goalByUser.has(member.id) ? goalByUser.get(member.id) : null}
                onOfficeReleased={(validUntil, releasedSource = "manual") =>
                  setPresence((current) => ({
                    ...current,
                    members: (current?.members || []).map((item) =>
                      item.id === member.id ? { ...item, office: { ...(item.office || {}), active: true, eligible: true, validUntil, source: item.office?.active ? item.office.source : releasedSource, firstSeenAt: item.office?.active ? item.office.firstSeenAt : new Date().toISOString() } } : item
                    )
                  }))
                }
                onOfficeChanged={() => reloadRef.current?.()}
              />
            ))
          )}
        </div>
      </section>

      <HoursReport />

      {/* Configuração da presença na imobiliária: no fim da página (dono, 2026-10-14). */}
      <OfficeNetworkPanel />
    </div>
  );
}

// Indicadores do topo (visual novo): contagem dos cards abaixo, pelo mesmo status do card.
function PresenceKpis({ members }) {
  const counts = { online: 0, disconnected: 0, away: 0, offline: 0 };
  for (const member of members) {
    const meta = cardStatus(member);
    const key = Object.keys(STATUS_META).find((name) => STATUS_META[name] === meta) || "offline";
    counts[key] += 1;
  }
  const items = [
    { key: "online", label: "Online", tone: "text-success" },
    { key: "disconnected", label: "Desconectado", tone: "text-danger" },
    { key: "away", label: "Ausente", tone: "text-warning" },
    { key: "offline", label: "Offline", tone: "text-muted" }
  ];
  return (
    <section aria-label="Indicadores da equipe" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((item) => (
        <div key={item.key} className="rounded-card border border-line bg-white p-4">
          <p className="text-xs font-semibold text-muted">{item.label}</p>
          <p className={`mt-1 text-2xl font-extrabold tabular-nums ${item.tone}`}>{counts[item.key]}</p>
        </div>
      ))}
    </section>
  );
}

const REPORT_PERIODS = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "last_week", label: "Semana passada" },
  { value: "month", label: "Este mês" },
  { value: "custom", label: "Personalizado" }
];

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" });

function formatMinutes(total) {
  const minutes = Math.max(0, Math.round(total || 0));
  if (!minutes) return "0min";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}min`;
  return rest ? `${hours}h ${String(rest).padStart(2, "0")}min` : `${hours}h`;
}

function formatShortDate(plainDate) {
  const [, month, day] = String(plainDate || "").split("-");
  return day && month ? `${day}/${month}` : "";
}

// "Semana passada · 05/10 a 11/10" — o intervalo vem da resposta do servidor
// (o que de fato foi somado), nunca recalculado na tela.
function formatRangeLabel(range) {
  if (!range?.startDate) return "";
  const label = REPORT_PERIODS.find((option) => option.value === range.period)?.label || "";
  const dates = range.startDate === range.endDate
    ? formatShortDate(range.startDate)
    : `${formatShortDate(range.startDate)} a ${formatShortDate(range.endDate)}`;
  return label ? `${label} · ${dates}` : dates;
}

// "12 contatos · 8 manuais · 4 automáticos" (regra do dono, 2026-10-12).
function formatContacts(total, manual, auto) {
  const head = `${total} ${total === 1 ? "contato" : "contatos"}`;
  if (!total) return head;
  return `${head} · ${manual} ${manual === 1 ? "manual" : "manuais"} · ${auto} ${auto === 1 ? "automático" : "automáticos"}`;
}

function formatDayLabel(plainDate) {
  const [year, month, day] = plainDate.split("-").map(Number);
  const weekday = WEEKDAY_FORMATTER.format(new Date(Date.UTC(year, month - 1, day))).replace(".", "");
  return `${weekday} ${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
}

// Horas no CRM por corretor: tempo online (com interação real) e ausente,
// a partir do histórico de atividade gravado pelo heartbeat. Cruza com os
// contatos da Meta Diária para separar "online e produzindo" de "online sem
// produzir".
function HoursReport() {
  const [period, setPeriod] = useState("today");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState("");

  useEffect(() => {
    if (period === "custom" && (!startDate || !endDate)) {
      // Sem as duas datas não há período: não deixa o resultado do filtro
      // anterior na tela como se fosse do "Personalizado".
      setReport(null);
      setError("");
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");

    const params = new URLSearchParams({ period });
    if (period === "custom") {
      params.set("startDate", startDate);
      params.set("endDate", endDate);
    }

    fetch(`/api/admin/presence/report?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || "Não foi possível carregar as horas.");
        setReport(data);
      })
      .catch((requestError) => {
        if (requestError.name !== "AbortError") setError(requestError.message || "Não foi possível carregar as horas.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [period, startDate, endDate]);

  const members = report?.members || [];
  const teamActive = members.reduce((sum, member) => sum + member.activeMinutes, 0);
  const teamAway = members.reduce((sum, member) => sum + member.awayMinutes, 0);
  const multiDay = report?.range && report.range.startDate !== report.range.endDate;
  // Falha ao buscar os contatos nunca aparece como "0 contatos".
  const contactsAvailable = report?.contactsAvailable !== false;

  return (
    <article className="rounded-panel border border-line bg-white p-4 sm:p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">Horas no CRM</p>
      <h3 className="mt-1 text-[15px] font-extrabold text-ink">Quanto tempo cada corretor trabalhou</h3>
      <p className="mt-2 text-sm font-bold text-muted">
        Conta só o tempo com interação real no CRM (clique, digitação, rolagem, toque). Sem interagir por 5 minutos o tempo online pausa e vira ausente.
      </p>

      <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="Período das horas">
        {REPORT_PERIODS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setPeriod(option.value)}
            role="tab"
            aria-selected={period === option.value}
            className={tabClasses(period === option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {period === "custom" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-extrabold text-ink">
            Início
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1 min-h-11 w-full rounded-control border border-line px-4 text-sm text-ink outline-none focus:border-brand" />
          </label>
          <label className="text-sm font-extrabold text-ink">
            Final
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1 min-h-11 w-full rounded-control border border-line px-4 text-sm text-ink outline-none focus:border-brand" />
          </label>
        </div>
      ) : null}

      {error ? <p className="mt-4 rounded-control border border-danger-line bg-danger-soft p-4 text-sm font-bold text-danger">{error}</p> : null}

      {report && !report.ready ? (
        <p className="mt-4 rounded-control bg-warning-soft p-4 text-sm font-bold text-warning">
          O histórico de horas ainda não foi ativado no banco de dados (falta criar a tabela de atividade). Assim que for criada, os números começam a aparecer aqui conforme a equipe usa o CRM.
        </p>
      ) : null}

      {period === "custom" && (!startDate || !endDate) ? (
        <p className="mt-4 rounded-control bg-accent-soft p-4 text-sm font-bold text-ink-2">Escolha a data de início e a final para ver as horas.</p>
      ) : null}

      {report?.ready ? (
        <>
          <p className="mt-5 text-sm font-extrabold text-ink">{formatRangeLabel(report.range)}</p>
          {!contactsAvailable ? (
            <p className="mt-2 text-xs font-bold text-warning">Não foi possível carregar os contatos agora.</p>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-control border border-success-line bg-success-soft px-4 py-3 text-success">
              <p className="text-xl font-black sm:text-2xl">{formatMinutes(teamActive)}</p>
              <p className="text-[11px] font-bold uppercase tracking-wide">Online (equipe)</p>
            </div>
            <div className="rounded-control border border-warning-line bg-warning-soft px-4 py-3 text-warning">
              <p className="text-xl font-black sm:text-2xl">{formatMinutes(teamAway)}</p>
              <p className="text-[11px] font-bold uppercase tracking-wide">Ausente (equipe)</p>
            </div>
          </div>

          <div className={`mt-5 space-y-3 transition-opacity ${loading ? "opacity-60" : ""}`}>
            {members.map((member) => (
              <div key={member.id} className="rounded-control border border-line">
                <button
                  type="button"
                  onClick={() => setExpandedId((current) => (current === member.id ? "" : member.id))}
                  className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left"
                  aria-expanded={expandedId === member.id}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <Avatar name={member.name} photoUrl={member.photoUrl} size={40} />
                    <span className="min-w-0">
                      <span className="block truncate font-extrabold text-ink">{member.name}</span>
                      <span className="block text-xs font-bold text-muted">
                        {member.daysWithPresence} {member.daysWithPresence === 1 ? "dia" : "dias"} com atividade
                        {multiDay ? ` · média ${formatMinutes(member.averageActiveMinutesPerDay)}/dia` : ""}
                      </span>
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-sm font-black">
                    <span className="rounded-full border border-success-line bg-success-soft px-3 py-1 text-success">Online {formatMinutes(member.activeMinutes)}</span>
                    <span className="rounded-full border border-warning-line bg-warning-soft px-3 py-1 text-warning">Ausente {formatMinutes(member.awayMinutes)}</span>
                    {contactsAvailable ? (
                      <span className="rounded-full border border-accent-line bg-accent-soft px-3 py-1 text-accent-text">{formatContacts(member.contacts, member.manualContacts, member.autoContacts)}</span>
                    ) : null}
                  </span>
                </button>

                {expandedId === member.id ? (
                  <div className="border-t border-line bg-surface-2 p-4">
                    {member.days.length ? (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[640px] text-left text-sm">
                          <thead className="text-[11px] font-extrabold uppercase tracking-wide text-muted">
                            <tr>
                              <th className="pb-2">Dia</th>
                              <th className="pb-2">Primeiro</th>
                              <th className="pb-2">Último</th>
                              <th className="pb-2">Online</th>
                              <th className="pb-2">Ausente</th>
                              <th className="pb-2">Contatos</th>
                              <th className="pb-2">Manuais</th>
                              <th className="pb-2">Automáticos</th>
                            </tr>
                          </thead>
                          <tbody className="font-bold text-ink">
                            {member.days.map((day) => (
                              <tr key={day.date} className="border-t border-line">
                                <td className="py-2">{formatDayLabel(day.date)}</td>
                                <td className="py-2">{day.firstAt ? TIME_FORMATTER.format(new Date(day.firstAt)) : "—"}</td>
                                <td className="py-2">{day.lastAt ? TIME_FORMATTER.format(new Date(day.lastAt)) : "—"}</td>
                                <td className="py-2 text-success">{formatMinutes(day.activeMinutes)}</td>
                                <td className="py-2 text-warning">{formatMinutes(day.awayMinutes)}</td>
                                <td className="py-2">{contactsAvailable ? day.contacts : "—"}</td>
                                <td className="py-2">{contactsAvailable ? day.manualContacts : "—"}</td>
                                <td className="py-2">{contactsAvailable ? day.autoContacts : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm font-bold text-muted">Sem atividade registrada neste período.</p>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
            {!members.length ? <p className="rounded-control bg-accent-soft p-4 text-sm font-bold text-ink-2">Nenhum corretor na sua equipe.</p> : null}
          </div>
        </>
      ) : null}
    </article>
  );
}

// Status do card (visual novo, dono, 2026-10-22): vermelho chama "Desconectado" — on-line no CRM, mas sem nenhum
// número do WhatsApp conectado. Os demais seguem a presença (Online · Ausente · Offline).
function cardStatus(member) {
  const numbers = member.whatsapp || [];
  if (member.status === "online" && numbers.length && !numbers.some((icon) => icon.connected)) return STATUS_META.disconnected;
  return STATUS_META[member.status] || STATUS_META.offline;
}

// Ícone da roleta: só lê o que a tela já recebe (presença, WhatsApp ativo, presença na imobiliária); quem decide de
// verdade quem recebe lead é o banco (ROL-2, ROL-2d/2e/2f). Por isso o rótulo fala em "condições", não em "na roleta".
function rouletteConditions(member) {
  const office = member.office || null;
  const numbers = member.whatsapp || [];
  const lines = [
    { ok: member.status === "online", text: member.status === "online" ? "On-line no CRM agora" : "Não está on-line no CRM agora" },
    { ok: numbers.some((icon) => icon.connected && icon.state !== "idle"), text: numbers.some((icon) => icon.connected && icon.state !== "idle") ? "WhatsApp conectado e ativo" : numbers.some((icon) => icon.connected) ? "WhatsApp sem mensagens há 4 h (ocioso)" : "WhatsApp desconectado" }
  ];
  if (office?.ruleEnabled) {
    const here = office.active && !office.absence;
    lines.push({ ok: here, text: office.absence ? "Marcado como ausente" : here ? "Veio à imobiliária (vale até 9h do dia seguinte)" : "Não veio à imobiliária" });
  }
  return { ok: lines.every((line) => line.ok), lines };
}

const ICON_BUTTON = "relative grid h-[38px] w-[38px] place-items-center rounded-[11px] border bg-surface-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const iconTone = (open) => (open ? "border-accent shadow-[0_0_0_3px_rgb(var(--mm-accent,27_127_176)/0.15)]" : "border-line hover:border-accent-line");

function MemberRow({ member, goalPercent = null, onOfficeReleased, onOfficeChanged }) {
  const meta = cardStatus(member);
  // Qual histórico está aberto: "office", "presence" (entrou/saiu), "whatsapp" (conectou/desconectou) ou "roulette".
  const [historyOpen, setHistoryOpen] = useState("");
  const toggle = (kind) => setHistoryOpen((value) => (value === kind ? "" : kind));
  const roulette = rouletteConditions(member);
  return (
    <article className={`rounded-card border bg-white p-3.5 transition-colors sm:p-4 ${historyOpen ? "border-accent" : "border-line"}`}>
      <div className="flex items-center gap-3">
        <span className="relative shrink-0">
          <GoalRing percent={goalPercent}>
            <Avatar name={member.name} photoUrl={member.photoUrl} size={44} />
          </GoalRing>
          <span className={`absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full border-[3px] border-white ${meta.dot}`} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-extrabold text-ink">{firstName(member.name)}</p>
          <p className="truncate text-xs text-muted">{formatRelativeActivityText(member.status, member.lastActivityAt)}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold ${meta.chip}`}>{meta.label}</span>
      </div>
      {/* Só ícones (dono, 2026-10-22): prédio, aparelho, WhatsApp Nº 1/Nº 2 e roleta. Tocar abre o histórico/ações. */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {member.office ? <OfficeButton office={member.office} open={historyOpen === "office"} onClick={() => toggle("office")} /> : null}
        <DeviceButton device={member.device} online={member.status === "online"} open={historyOpen === "presence"} onClick={() => toggle("presence")} />
        {(member.whatsapp || []).map((icon, index) => (
          <WhatsappStatusButton key={`${icon.slot ?? "off"}-${index}`} icon={icon} open={historyOpen === "whatsapp"} onClick={() => toggle("whatsapp")} />
        ))}
        <button
          type="button"
          onClick={() => toggle("roulette")}
          aria-expanded={historyOpen === "roulette"}
          title={roulette.ok ? "Condições da roleta atendidas agora" : "Condições da roleta não atendidas agora"}
          aria-label={`${roulette.ok ? "Condições da roleta atendidas agora" : "Condições da roleta não atendidas agora"}. Ver detalhes`}
          className={`${ICON_BUTTON} ${iconTone(historyOpen === "roulette")} ${roulette.ok ? "text-success" : "text-faint"}`}
        >
          <Disc3 size={19} strokeWidth={1.9} aria-hidden="true" />
        </button>
        <span className="ml-auto min-w-0 truncate text-right text-[11px] font-semibold text-faint">{formatLastAccess(member.lastActivityAt)}</span>
      </div>
      {historyOpen === "presence" ? <PresenceHistory userId={member.id} /> : null}
      {historyOpen === "whatsapp" ? <WhatsappHistory userId={member.id} /> : null}
      {historyOpen === "office" ? <OfficeDetail member={member} onReleased={onOfficeReleased} onChanged={onOfficeChanged} /> : null}
      {historyOpen === "roulette" ? (
        <div className="mt-3 rounded-control border border-line bg-surface-2 px-3 py-2.5 text-sm">
          <p className="flex items-baseline justify-between gap-2"><b className="text-[13px] text-ink">Roleta</b><span className="text-[11px] text-muted">condições de agora</span></p>
          <ul className="mt-1">
            {roulette.lines.map((line) => (
              <li key={line.text} className="flex items-center gap-2.5 border-t border-line py-1.5 text-xs text-ink first:border-t-0">
                <span className={`h-2 w-2 shrink-0 rounded-full ${line.ok ? "bg-success-strong" : "bg-danger-strong"}`} aria-hidden="true" />
                {line.text}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-muted">Quem recebe o lead é decidido pela roleta (distribuição ligada para o corretor e intervalo entre recebimentos).</p>
        </div>
      ) : null}
    </article>
  );
}

// ROL-2f (dono, 2026-10-13): veio à imobiliária hoje? Verde = apto na roleta até 9h do dia seguinte (sábado -> segunda).
const OFFICE_TIME = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const OFFICE_UNTIL = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", hour: "2-digit", minute: "2-digit" });

// Dia da chegada em linguagem simples (2026-10-16): a chegada de ontem continua valendo até as 9h de hoje e NÃO pode parecer
// "chegou hoje" só por mostrar a hora (foi o que confundiu o dono).
const OFFICE_DAY_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
const OFFICE_WEEKDAY = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long" });
function officeDayLabel(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  const key = OFFICE_DAY_KEY.format(date);
  if (key === OFFICE_DAY_KEY.format(now)) return "hoje";
  if (key === OFFICE_DAY_KEY.format(new Date(now.getTime() - 24 * 3600 * 1000))) return "ontem";
  return OFFICE_WEEKDAY.format(date);
}

function OfficeButton({ office, open, onClick }) {
  // Três estados (dono, 2026-10-15): VERDE só para quem está no Wi-Fi da imobiliária agora. Veio hoje (ou foi liberado)
  // e saiu = prédio cinza com um pontinho verde (segue na roleta até 9h); não veio = cinza. Só visual: a roleta usa office.active.
  // "Marcar ausente" (dono, 2026-10-17): cinza, sem pontinho, mesmo com o Wi-Fi detectando.
  const label = office.absence ? `Ausente${office.absence.markedByName ? ` (marcado por ${firstName(office.absence.markedByName)})` : ""}` : office.here ? "Na imobiliária agora" : office.active ? "Não está na imobiliária agora (segue na roleta até 9h)" : "Não veio à imobiliária";
  // Visual novo (dono, 2026-10-22): só o ícone — prédio VERDE = no Wi-Fi agora; CINZA com bolinha verde = veio hoje; CINZA = não veio/ausente.
  const tone = office.here && !office.absence ? "text-success" : "text-faint";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      title={label}
      aria-label={`${label}. Ver detalhes`}
      className={`${ICON_BUTTON} ${iconTone(open)} ${tone}`}
    >
      <Building2 size={19} strokeWidth={1.9} aria-hidden="true" />
      {office.active && !office.here && !office.absence ? <span aria-hidden="true" className="absolute right-[3px] top-[3px] h-2 w-2 rounded-full bg-success-strong ring-2 ring-white" /> : null}
    </button>
  );
}

const ABSENT_UNTIL = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit" });

function OfficeDetail({ member, onReleased, onChanged }) {
  const office = member.office || {};
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const todayKey = OFFICE_DAY_KEY.format(new Date());
  const sundayKey = nextSundayKey();
  const [absentDate, setAbsentDate] = useState("");
  // "Marcar ausente" / "Desfazer" (dono, 2026-10-17): o servidor confere perfil e equipe; a tela só recarrega a presença.
  async function absenceAction(action, untilDate = "") {
    setBusy(action === "clear-absent" ? "clear" : untilDate);
    setError("");
    try {
      const response = await fetch("/api/admin/office-presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, userId: member.id, untilDate })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
      await onChanged?.();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy("");
    }
  }
  if (office.absence) {
    return (
      <div className="mt-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-ink-2">
            Ausente até {ABSENT_UNTIL.format(new Date(Date.parse(office.absence.absentUntil) - 1))}
            {office.absence.markedByName ? ` (marcado por ${firstName(office.absence.markedByName)})` : ""}{office.ruleEnabled ? ": fora da roleta." : "."}
            {office.wifiDetectedWhileAbsent ? <span className="mt-0.5 block text-xs text-muted">O Wi-Fi da imobiliária está detectando o aparelho, mas não conta como presença.</span> : null}
          </p>
          <button type="button" onClick={() => absenceAction("clear-absent")} disabled={Boolean(busy)} className="rounded-full border border-line bg-white px-3 py-1.5 text-xs font-bold text-ink disabled:opacity-60">
            {busy === "clear" ? "Desfazendo…" : "Desfazer"}
          </button>
        </div>
        {error ? <p className="mt-1 text-xs font-semibold text-danger">{error}</p> : null}
      </div>
    );
  }
  const absentButtons = (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
      <p className="w-full text-xs font-semibold text-ink-2">Marcar ausente (não conta presença mesmo com o Wi-Fi):</p>
      <button type="button" onClick={() => absenceAction("mark-absent", todayKey)} disabled={Boolean(busy)} className="rounded-full border border-line bg-white px-3 py-1.5 text-xs font-bold text-ink disabled:opacity-60">
        {busy === todayKey ? "Salvando…" : "Hoje"}
      </button>
      {sundayKey !== todayKey ? (
        <button type="button" onClick={() => absenceAction("mark-absent", sundayKey)} disabled={Boolean(busy)} className="rounded-full border border-line bg-white px-3 py-1.5 text-xs font-bold text-ink disabled:opacity-60">
          {busy === sundayKey ? "Salvando…" : "Até domingo"}
        </button>
      ) : null}
      <input type="date" value={absentDate} min={todayKey} onChange={(event) => setAbsentDate(event.target.value)} aria-label="Ausente até a data" className="rounded-full border border-line bg-white px-3 py-1 text-xs font-bold text-ink" />
      <button type="button" onClick={() => absenceAction("mark-absent", absentDate)} disabled={Boolean(busy) || !absentDate} className="rounded-full border border-line bg-white px-3 py-1.5 text-xs font-bold text-ink disabled:opacity-60">
        {busy && busy === absentDate ? "Salvando…" : "Até a data"}
      </button>
    </div>
  );
  // Duas liberações manuais (dono, 2026-10-14): trabalho externo ou chegou e não conectou ao Wi-Fi.
  async function release(reason) {
    setBusy(reason);
    setError("");
    try {
      const response = await fetch("/api/admin/office-presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release", userId: member.id, reason })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível liberar.");
      onReleased?.(data.validUntil || null, reason === "arrived" ? "arrived" : "manual");
    } catch (releaseError) {
      setError(releaseError.message);
    } finally {
      setBusy("");
    }
  }
  const how = office.source === "arrived" ? "marcado como chegou (sem Wi-Fi)" : office.source === "manual" ? "liberado manualmente" : "pelo Wi-Fi da imobiliária";
  const arrivalDay = officeDayLabel(office.firstSeenAt);
  const arrivedToday = arrivalDay === "hoje";
  const lastWifiDay = officeDayLabel(office.lastWifiSeenAt);
  // As duas liberações manuais também aparecem quando a chegada que ainda vale é de OUTRO dia (ex.: ontem, válida até 9h de
  // hoje) e a pessoa ainda não registrou a de hoje: dono/gestora marcam sem esperar a chegada anterior vencer.
  const manualButtons = (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => release("arrived")} disabled={Boolean(busy)} className="rounded-full border border-line bg-white px-3 py-1.5 text-xs font-bold text-ink disabled:opacity-60">
        {busy === "arrived" ? "Salvando…" : "Chegou e não conectou"}
      </button>
      <button type="button" onClick={() => release("external")} disabled={Boolean(busy)} className="rounded-full bg-accent px-3 py-1.5 text-xs font-bold text-on-accent disabled:opacity-60">
        {busy === "external" ? "Liberando…" : "Liberar hoje"}
      </button>
    </div>
  );
  return (
    <div className="mt-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm">
      {office.active ? (
        <>
          <p className="font-semibold text-ink">
            {office.firstSeenAt ? `Chegou ${arrivedToday ? "" : `${arrivalDay} `}às ${OFFICE_TIME.format(new Date(office.firstSeenAt))}, ${how}. ` : ""}
            Na roleta até {OFFICE_UNTIL.format(new Date(office.validUntil))}.
            <span className={`mt-0.5 block text-xs ${office.here ? "text-success" : "text-muted"}`}>
              {office.here ? "Está no Wi-Fi da imobiliária agora." : office.lastWifiSeenAt ? `Não está na imobiliária agora (último sinal no Wi-Fi ${lastWifiDay === "hoje" ? "" : `${lastWifiDay} `}às ${OFFICE_TIME.format(new Date(office.lastWifiSeenAt))}).` : "Não está no Wi-Fi da imobiliária agora."}
            </span>
          </p>
          {!arrivedToday && !office.here ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
              <p className="text-xs font-semibold text-ink-2">Hoje ainda não registrou a chegada.</p>
              {manualButtons}
            </div>
          ) : null}
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-ink-2">{office.ruleEnabled ? "Não veio à imobiliária: fora da roleta." : "Ainda não veio à imobiliária hoje."}</p>
          {manualButtons}
        </div>
      )}
      {absentButtons}
      {error ? <p className="mt-1 text-xs font-semibold text-danger">{error}</p> : null}
    </div>
  );
}

// Configuração da ROL-2f: rede da imobiliária (dono e gestora marcam) e liga/desliga da regra (só o dono).
function OfficeNetworkPanel() {
  const [panel, setPanel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/office-presence", { cache: "no-store" })
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!cancelled && ok) setPanel(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function act(body) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/office-presence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
      setPanel(data);
    } catch (actError) {
      setError(actError.message);
    } finally {
      setBusy(false);
    }
  }

  if (!panel) return null;
  return (
    <article className="rounded-panel border border-line bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">Roleta</p>
          <h3 className="mt-1 text-[15px] font-extrabold text-ink">Presença na imobiliária</h3>
          <p className="mt-1 text-sm text-ink-2">
            {panel.enabled
              ? "Ligada: só recebe lead quem veio à imobiliária (até 9h do dia seguinte; sábado vale até segunda)."
              : "Desligada: a roleta segue as regras de sempre."}
          </p>
        </div>
        {panel.canToggle ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => act({ action: "set-enabled", enabled: !panel.enabled })}
            className={`rounded-full px-4 py-2 text-sm font-bold disabled:opacity-60 ${panel.enabled ? "border border-line bg-white text-ink" : "bg-accent text-on-accent"}`}
          >
            {panel.enabled ? "Desligar regra" : "Ligar regra"}
          </button>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-control bg-surface-2 px-4 py-3 text-sm">
        <p className="font-semibold text-ink">
          {panel.networks.length ? `${panel.networks.length} ${panel.networks.length === 1 ? "rede cadastrada" : "redes cadastradas"}` : "Nenhuma rede cadastrada"}
          {" · "}
          {panel.currentMatches ? "este aparelho está na rede da imobiliária" : "este aparelho não está numa rede cadastrada"}
        </p>
        {!panel.currentMatches ? (
          <button type="button" disabled={busy} onClick={() => act({ action: "mark-network" })} className="rounded-full bg-accent px-3 py-1.5 text-xs font-bold text-on-accent disabled:opacity-60">
            Esta é a rede da imobiliária
          </button>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-muted">Toque em “Esta é a rede da imobiliária” só quando estiver conectado ao Wi-Fi de lá. Se a operadora trocar a internet, marque de novo.</p>
      {panel.canToggle && panel.networks.length ? (
        <ul className="mt-2 space-y-1 text-xs text-muted">
          {panel.networks.map((network) => (
            <li key={network.key} className="flex items-center justify-between gap-2">
              <span className="truncate">{network.key}</span>
              <button type="button" disabled={busy} onClick={() => act({ action: "remove-network", key: network.key })} className="font-semibold text-danger disabled:opacity-60">
                Remover
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="mt-2 text-sm font-semibold text-danger">{error}</p> : null}
    </article>
  );
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "Usuário";
}

// Círculo da Meta Diária de hoje em volta da foto (dono, 2026-10-13): enche conforme a meta é concluída; verde em 100%.
// Sem meta (dono, gestor sem carteira): só a foto, sem anel.
function GoalRing({ percent, children }) {
  if (percent === null || percent === undefined || !Number.isFinite(Number(percent))) {
    return <span className="grid h-12 w-12 place-items-center">{children}</span>;
  }
  const value = Math.max(0, Math.min(100, Number(percent)));
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const done = value >= 100;
  return (
    <span className="relative grid h-12 w-12 place-items-center" title={`Meta Diária: ${Math.round(Number(percent))}%`} aria-label={`Meta Diária ${Math.round(Number(percent))}%`}>
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r={radius} fill="none" stroke="currentColor" strokeWidth="3" className="text-ink/10" />
        <circle cx="24" cy="24" r={radius} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value / 100)} className={done ? "text-success-strong" : "text-accent"} style={{ transition: "stroke-dashoffset 600ms ease" }} />
      </svg>
      {children}
    </span>
  );
}

// Aparelho do último acesso (celular = app/navegador do celular; notebook = computador). Clique abre o histórico do
// dia (entrou/saiu e aparelho). Sem aparelho conhecido ainda: ícone de histórico.
// On-line: o ícone do aparelho acende em verde (dono, 2026-10-14).
function DeviceButton({ device, online = false, open, onClick }) {
  const label = device === "mobile" ? "Pelo celular" : device === "desktop" ? "Pelo computador" : "Histórico de hoje";
  const Icon = device === "mobile" ? Smartphone : device === "desktop" ? Laptop : History;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      title={`${label} — ver entradas e saídas de hoje`}
      aria-label={`${label}. Ver entradas e saídas de hoje`}
      className={`${ICON_BUTTON} ${iconTone(open)} ${online ? "text-success" : "text-ink-2"}`}
    >
      <Icon size={19} strokeWidth={1.9} aria-hidden="true" />
    </button>
  );
}

// WhatsApp do corretor: verde = número conectado (um ícone por número, com o Nº embaixo); laranja = ocioso (ROL-2e);
// vermelho = desconectado (visual novo, dono, 2026-10-22).
function WhatsappStatusButton({ icon, open, onClick }) {
  const idle = icon.connected && icon.state === "idle";
  const name = icon.slot === 2 ? "Número 2" : "Número 1";
  const label = !icon.connected ? "WhatsApp desconectado" : idle ? `WhatsApp ${name} sem mensagens há 4 h (fora da roleta, reconectar)` : `WhatsApp ${name} conectado`;
  const tone = !icon.connected ? "text-danger" : idle ? "text-orange-500" : "text-success";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      title={`${label} — ver conexões`}
      aria-label={`${label}. Ver histórico de conexão`}
      className={`${ICON_BUTTON} ${iconTone(open)} ${tone}`}
    >
      <WhatsappGlyph className="h-[19px] w-[19px]" />
      {icon.slot ? <span aria-hidden="true" className="absolute bottom-[2px] right-[4px] text-[9px] font-extrabold leading-none">{icon.slot}</span> : null}
    </button>
  );
}

function WhatsappGlyph({ className }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className} fill="currentColor">
      <path d="M16.04 3.2A12.74 12.74 0 0 0 5.2 22.65L3.72 28l5.48-1.43A12.75 12.75 0 1 0 16.04 3.2Zm0 2.27a10.47 10.47 0 0 1 8.86 16.04 10.47 10.47 0 0 1-14.96 2.74l-.39-.24-3.25.85.87-3.16-.26-.41A10.46 10.46 0 0 1 16.04 5.47Zm-4.45 5.62c-.22 0-.58.08-.88.42-.3.34-1.15 1.12-1.15 2.74s1.18 3.18 1.34 3.4c.16.22 2.27 3.64 5.63 4.96 2.79 1.1 3.36.88 3.96.82.6-.05 1.94-.79 2.21-1.55.27-.76.27-1.42.19-1.55-.08-.14-.3-.22-.63-.38-.33-.16-1.94-.96-2.24-1.07-.3-.11-.52-.16-.74.16-.22.33-.85 1.07-1.04 1.29-.19.22-.38.25-.71.08-.33-.16-1.38-.51-2.63-1.62-.97-.86-1.63-1.93-1.82-2.26-.19-.33-.02-.5.14-.67.15-.15.33-.38.49-.57.16-.19.22-.33.33-.55.11-.22.05-.41-.03-.57-.08-.16-.74-1.79-1.01-2.45-.27-.64-.54-.55-.74-.56h-.63Z" />
    </svg>
  );
}

// Histórico de conexão do WhatsApp por número (mesmos dias do histórico de presença).
function WhatsappHistory({ userId }) {
  const days = useMemo(() => buildHistoryDays(HISTORY_DAYS), []);
  const [day, setDay] = useState(days[0].key);
  const [state, setState] = useState({ loading: true, error: "", periods: [], labels: {} });
  useEffect(() => {
    let ignore = false;
    setState({ loading: true, error: "", periods: [], labels: {} });
    fetch(`/api/admin/presence/whatsapp-history?userId=${encodeURIComponent(userId)}&date=${day}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar o histórico do WhatsApp.");
        if (!ignore) setState({ loading: false, error: "", periods: payload.periods || [], labels: payload.labels || {} });
      })
      .catch((error) => {
        if (!ignore) setState({ loading: false, error: error.message || "Não foi possível carregar o histórico do WhatsApp.", periods: [], labels: {} });
      });
    return () => {
      ignore = true;
    };
  }, [userId, day]);

  const totalMinutes = state.periods.reduce((sum, period) => sum + (period.minutes || 0), 0);
  const slotName = (slot) => state.labels?.[slot] || (slot === 2 ? "Número 2" : "Número 1");

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-success"><WhatsappGlyph className="h-3.5 w-3.5" /> Conexões do WhatsApp</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dia do histórico do WhatsApp">
        {days.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={day === option.key}
            onClick={() => setDay(option.key)}
            className={tabClasses(day === option.key, "sm")}
          >
            {option.label}
          </button>
        ))}
      </div>
      {state.loading ? <p className="mt-2 text-sm font-bold text-muted">Carregando…</p> : null}
      {state.error ? <p className="mt-2 text-sm font-bold text-danger">{state.error}</p> : null}
      {!state.loading && !state.error && !state.periods.length ? <p className="mt-2 text-sm font-bold text-muted">WhatsApp desconectado o dia todo.</p> : null}
      {!state.loading && state.periods.length ? (
        <>
          <p className="mt-2 text-xs font-bold text-muted">{formatSessionMinutes(totalMinutes)} conectado no total</p>
          <ul className="mt-1.5 space-y-1.5">
            {[...state.periods].reverse().map((period) => (
              <li key={`${period.slot}-${period.start}`} className="flex items-center gap-2 text-sm font-bold text-ink">
                <WhatsappGlyph className={`h-4 w-4 shrink-0 ${period.end ? "text-faint" : "text-success"}`} />
                <span className="tabular-nums">{TIME_FORMATTER.format(new Date(period.start))} – {period.end ? TIME_FORMATTER.format(new Date(period.end)) : "agora"}</span>
                <span className="text-muted">· {slotName(period.slot)} · {formatSessionMinutes(period.minutes)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

// Hoje + os 3 dias anteriores (pedido do dono, 2026-10-12). Dias antes da coluna de aparelho existir mostram os
// horários com "Aparelho não identificado".
const HISTORY_DAYS = 4;

function PresenceHistory({ userId }) {
  const days = useMemo(() => buildHistoryDays(HISTORY_DAYS), []);
  const [day, setDay] = useState(days[0].key);
  const [state, setState] = useState({ loading: true, error: "", sessions: [] });
  useEffect(() => {
    let ignore = false;
    setState({ loading: true, error: "", sessions: [] });
    fetch(`/api/admin/presence/history?userId=${encodeURIComponent(userId)}&date=${day}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar o histórico.");
        if (!ignore) setState({ loading: false, error: "", sessions: payload.sessions || [] });
      })
      .catch((error) => {
        if (!ignore) setState({ loading: false, error: error.message || "Não foi possível carregar o histórico.", sessions: [] });
      });
    return () => {
      ignore = true;
    };
  }, [userId, day]);

  const totalMinutes = state.sessions.reduce((sum, session) => sum + (session.minutes || 0), 0);

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dia do histórico">
        {days.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={day === option.key}
            onClick={() => setDay(option.key)}
            className={tabClasses(day === option.key, "sm")}
          >
            {option.label}
          </button>
        ))}
      </div>
      {state.loading ? <p className="mt-2 text-sm font-bold text-muted">Carregando…</p> : null}
      {state.error ? <p className="mt-2 text-sm font-bold text-danger">{state.error}</p> : null}
      {!state.loading && !state.error && !state.sessions.length ? <p className="mt-2 text-sm font-bold text-muted">Sem acesso neste dia.</p> : null}
      {!state.loading && state.sessions.length ? (
        <>
          <p className="mt-2 text-xs font-bold text-muted">{state.sessions.length} acesso{state.sessions.length === 1 ? "" : "s"} · {formatSessionMinutes(totalMinutes)} no total</p>
          <ul className="mt-1.5 space-y-1.5">
            {[...state.sessions].reverse().map((session) => {
              const Icon = session.device === "mobile" ? Smartphone : session.device === "desktop" ? Laptop : History;
              const deviceLabel = session.device === "mobile" ? "Celular" : session.device === "desktop" ? "Computador" : "Aparelho não identificado";
              return (
                <li key={session.start} className="flex items-center gap-2 text-sm font-bold text-ink">
                  <Icon size={15} strokeWidth={2.4} className="shrink-0 text-accent-text" aria-hidden="true" />
                  <span className="tabular-nums">{TIME_FORMATTER.format(new Date(session.start))} – {TIME_FORMATTER.format(new Date(session.end))}</span>
                  <span className="text-muted">· {deviceLabel} · {formatSessionMinutes(session.minutes)}</span>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}

const HISTORY_DAY_FORMATTER = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit" });

function buildHistoryDays(count) {
  const now = Date.now();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now - index * 24 * 60 * 60 * 1000);
    const key = DAY_KEY_FORMATTER.format(date);
    const label = index === 0 ? "Hoje" : index === 1 ? "Ontem" : HISTORY_DAY_FORMATTER.format(date).replace(".", "");
    return { key, label };
  });
}

function formatSessionMinutes(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h${String(rest).padStart(2, "0")}` : `${hours}h`;
}

const DAY_KEY_FORMATTER = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
const TIME_FORMATTER = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });

function formatLastAccess(lastActivityAt) {
  if (!lastActivityAt) return "";
  const date = new Date(lastActivityAt);
  const time = TIME_FORMATTER.format(date);
  const dayKey = DAY_KEY_FORMATTER.format(date);
  const todayKey = DAY_KEY_FORMATTER.format(new Date());
  const yesterdayKey = DAY_KEY_FORMATTER.format(new Date(Date.now() - 24 * 60 * 60 * 1000));

  if (dayKey === todayKey) return `Hoje às ${time}`;
  if (dayKey === yesterdayKey) return `Ontem às ${time}`;
  return `${DATE_FORMATTER.format(date)} às ${time}`;
}

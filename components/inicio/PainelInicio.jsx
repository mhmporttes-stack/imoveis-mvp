import Link from "next/link";
import { AlertTriangle, CalendarDays, ChevronRight, ClipboardCheck, FileClock, MessageCircle, Timer, TrendingUp, UserRoundPlus, Users } from "lucide-react";
import Card from "@/components/ui/Card";
import Kpi, { KpiGrid } from "@/components/ui/Kpi";
import Skeleton from "@/components/ui/Skeleton";
import Badge from "@/components/ui/Badge";
import { CountBadge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { crmPendingItems } from "@/components/crm-pending-items";
import { formatDurationSeconds, formatWaitMinutes, leadOriginHint } from "@/lib/painel-inicio-core.mjs";

// Tela "Início" (dono, 2026-10-22 — INI-1): só apresentação. Os números chegam prontos de lib/painel-inicio.js
// (servidor, no escopo do perfil); nada é calculado aqui. Componentes sem estado: servem à página real
// (app/admin/inicio/page.jsx) e à vitrine de desenvolvimento.

const UNAVAILABLE = "—";

function count(value) {
  return value === null || value === undefined ? UNAVAILABLE : String(value);
}

// showActions = false no admin geral (dono, 2026-10-22, INI-5): sem "Abrir conversas" e "Agenda" no resumo (os atalhos do
// cabeçalho continuam). `text` substitui a frase (resumo do dono, que chega por streaming).
export function InicioAssistente({ assistant, chatAvailable = true, showActions = true, text = null }) {
  const chatHref = assistant?.urgent?.clientId ? `/admin/chat?client=${encodeURIComponent(assistant.urgent.clientId)}` : "/admin/chat";
  return (
    <section
      data-reveal=""
      aria-label="Resumo do dia"
      className="relative overflow-hidden rounded-card border border-accent-line bg-white p-4 sm:p-5 bg-[radial-gradient(120%_140%_at_0%_0%,rgb(var(--mm-accent-soft,221_238_248))_0%,transparent_65%)]"
    >
      <div className="flex flex-wrap items-center gap-4 sm:gap-5">
        <span aria-hidden="true" className="relative flex h-14 w-14 shrink-0 items-center justify-center max-sm:hidden">
          <span className="absolute inset-0 rounded-full border-2 border-dashed border-accent opacity-50" />
          <span className="absolute inset-[7px] rounded-full border-2 border-accent" />
          <span className="h-4 w-4 rounded-full bg-accent animate-pulse motion-reduce:animate-none" />
        </span>
        <div className="min-w-0 flex-[1_1_280px]">
          <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-accent-text">Resumo do dia</p>
          <p className="mt-1 text-pretty text-[15px] leading-relaxed text-ink sm:text-base">{text ?? assistant?.text}</p>
        </div>
        {showActions ? <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {chatAvailable ? (
            <Link href={chatHref} className={buttonClasses({ variant: "primary", className: "max-sm:flex-1" })}>
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              Abrir conversas
            </Link>
          ) : null}
          <Link href="/admin/calendario?pending=1" className={buttonClasses({ variant: "secondary", className: "max-sm:flex-1" })}>
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            Agenda
          </Link>
        </div> : null}
      </div>
    </section>
  );
}

export function InicioIndicadores({ kpis = {}, month = null }) {
  const leads = kpis.leadsToday;
  const response = kpis.response;
  const docs = kpis.docs;
  return (
    <KpiGrid label="Indicadores de hoje">
      <Kpi label="Leads hoje" icon={UserRoundPlus} value={leads ? String(leads.total) : UNAVAILABLE} hint={leads ? leadOriginHint(leads) : "indisponível agora"} />
      {response !== undefined ? (
        <Kpi
          label="Tempo de resposta (mediana)"
          icon={Timer}
          value={response?.count ? formatDurationSeconds(response.medianSeconds) : UNAVAILABLE}
          hint={response ? (response.count ? `${response.count} ${response.count === 1 ? "resposta" : "respostas"} hoje no Chat` : "nenhuma resposta hoje no Chat") : "indisponível agora"}
        />
      ) : null}
      <Kpi label="Simulações a conferir" icon={ClipboardCheck} value={count(kpis.toReview)} tone={kpis.toReview ? "warning" : "default"} hint="simulação automática aguardando conferência">
        {kpis.toReview ? <Link href="/admin/simulacoes?status=auto_simulation" className="mt-1 inline-flex min-h-touch items-center text-xs font-semibold text-accent-text">Conferir<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></Link> : null}
      </Kpi>
      <Kpi
        label="Aguardando documentos"
        icon={FileClock}
        value={docs ? String(docs.total) : UNAVAILABLE}
        tone={docs?.stale ? "warning" : "default"}
        hint={docs ? (docs.stale === null ? "" : `${docs.stale} há mais de ${docs.staleDays} dias nesta etapa`) : "indisponível agora"}
      >
        {docs?.total ? <Link href="/admin/simulacoes?statusGroup=documentation" className="mt-1 inline-flex min-h-touch items-center text-xs font-semibold text-accent-text">Ver clientes<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></Link> : null}
      </Kpi>
      {month}
    </KpiGrid>
  );
}

// Aprovados e vendas do mês (mesma conta do Desempenho) — vêm com o funil, que carrega em seguida.
export function InicioKpisMes({ month }) {
  if (!month) return null;
  return (
    <>
      <Kpi label="Aprovados no mês" icon={TrendingUp} value={String(month.approved)} tone={month.approved ? "success" : "default"} hint="clientes que chegaram a Cliente aprovado" />
      <Kpi label="Vendas no mês" icon={Users} value={String(month.sales)} tone={month.sales ? "success" : "default"} hint="primeira entrada em Venda no mês" />
    </>
  );
}

export function InicioKpisMesCarregando() {
  return (
    <>
      {["Aprovados no mês", "Vendas no mês"].map((label) => (
        <div key={label} role="status" aria-live="polite" className="min-w-0 rounded-card border border-line bg-white p-3 sm:p-4">
          <p className="text-xs font-semibold text-muted">{label}</p>
          <Skeleton className="mt-2 h-7 w-12" />
          <span className="sr-only">Carregando…</span>
        </div>
      ))}
    </>
  );
}

export function InicioPendencias({ pending, chatAvailable = true }) {
  if (!pending) {
    return (
      <Card title="Pendências" note="indisponível agora">
        <p className="text-sm text-muted">Não foi possível carregar as pendências agora. Tente recarregar a página.</p>
      </Card>
    );
  }
  const items = crmPendingItems(pending, { hideChat: !chatAvailable });
  return (
    <Card title="Pendências" note={items.length ? "o que espera por você" : "tudo em dia"}>
      {items.length ? (
        <ul className="-mx-2">
          {items.map(({ label, count: total, href, Icon }) => (
            <li key={label}>
              <Link href={href} className="flex min-h-touch items-center gap-3 rounded-control px-2 text-sm font-semibold text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                <Icon size={18} className="shrink-0 text-accent" aria-hidden="true" />
                <span className="min-w-0 flex-1">{label}</span>
                <CountBadge count={total} label={`${total} ${label}`} />
                <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nenhuma pendência no momento.</p>
      )}
    </Card>
  );
}

export function InicioFunil({ month }) {
  if (!month) return null;
  return (
    <Card title="Funil do mês" note={month.scopeLabel || month.rangeLabel}>
      <ul className="space-y-2.5">
        {month.bars.map((bar) => (
          <li key={bar.key} className="flex items-center gap-3">
            <span className="w-[42%] max-w-[180px] shrink-0 truncate text-[13px] text-ink-2 sm:w-[180px]">{bar.label}</span>
            <span className="h-5 flex-1 overflow-hidden rounded-[7px] bg-surface-2" aria-hidden="true">
              <span className="block h-full rounded-[7px] bg-accent" style={{ width: `${Math.max(bar.value ? 3 : 0, bar.width)}%` }} />
            </span>
            <span className="w-10 shrink-0 text-right text-sm font-extrabold tabular-nums text-ink">{bar.value}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] leading-4 text-faint">Mesma conta do Desempenho: cada etapa conta quem chegou até ela.</p>
    </Card>
  );
}

export function InicioFunilCarregando() {
  return (
    <Card title="Funil do mês" note="carregando…">
      <div role="status" aria-live="polite" className="space-y-3">
        <span className="sr-only">Carregando o funil do mês…</span>
        {Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-5 w-full" />)}
      </div>
    </Card>
  );
}

export function InicioFunilErro() {
  return (
    <Card title="Funil do mês" note="indisponível agora">
      <p className="text-sm text-muted">Não foi possível carregar o funil agora. Ele continua no Desempenho.</p>
    </Card>
  );
}

// --- Início do DONO (INI-5, 2026-10-22): atenções e equipe. Números prontos de lib/painel-inicio-dono.js. ------------
const ATTENTION_TONE = { danger: "text-danger", warning: "text-warning", muted: "text-faint" };

export function InicioAtencoes({ attentions = [] }) {
  return (
    <Card title="Atenções" note={attentions.some((item) => item.tone !== "muted") ? "o que pede a sua decisão" : "tudo em ordem"}>
      {attentions.length ? (
        <ul className="-mx-2">
          {attentions.map((item) => {
            const body = (
              <>
                <AlertTriangle size={18} className={`mt-0.5 shrink-0 ${ATTENTION_TONE[item.tone] || "text-muted"}`} aria-hidden="true" />
                <span className="min-w-0 flex-1 text-pretty">{item.text}</span>
                {item.href ? <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-hidden="true" /> : null}
              </>
            );
            return (
              <li key={item.key}>
                {item.href ? (
                  <Link href={item.href} className="flex min-h-touch items-start gap-3 rounded-control px-2 py-2 text-sm font-semibold text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{body}</Link>
                ) : (
                  <div className="flex min-h-touch items-start gap-3 px-2 py-2 text-sm text-muted">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nenhuma atenção pendente agora.</p>
      )}
    </Card>
  );
}

const PRESENCE_BADGE = { online: ["success", "On-line"], away: ["warning", "Ausente"], offline: ["neutral", "Off-line"] };
const WHATSAPP_BADGE = { active: ["success", "WhatsApp ativo"], idle: ["warning", "WhatsApp ocioso"], off: ["danger", "WhatsApp desconectado"] };

function show(value, render) {
  return value === null || value === undefined ? UNAVAILABLE : render(value);
}

export function InicioEquipe({ rows = [], metaAvailable = true }) {
  return (
    <Card title="Equipe agora" note={metaAvailable ? "meta, presença, WhatsApp e o que está parado" : "meta do dia indisponível agora"}>
      {rows.length ? (
        <ul className="divide-y divide-line">
          {rows.map((row) => {
            const [presenceTone, presenceLabel] = PRESENCE_BADGE[row.presence] || [];
            const [whatsappTone, whatsappLabel] = WHATSAPP_BADGE[row.whatsapp] || [];
            const wait = row.oldest ? formatWaitMinutes(row.oldest.waitingMinutes) : "";
            return (
              <li key={row.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/admin/desempenho/corretor/${encodeURIComponent(row.id)}`} className="min-w-0 truncate text-sm font-extrabold text-ink hover:text-accent-text">{row.name}</Link>
                  {presenceLabel ? <Badge tone={presenceTone} dot>{presenceLabel}</Badge> : null}
                  {whatsappLabel ? <Badge tone={whatsappTone} dot>{whatsappLabel}</Badge> : null}
                  {row.inRoulette ? <Badge tone="info">Na roleta</Badge> : null}
                </div>
                <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted sm:grid-cols-4">
                  <div><dt className="inline">Meta hoje: </dt><dd className="inline font-bold tabular-nums text-ink">{show(row.metaPercent, (value) => `${value}%`)}</dd></div>
                  <div><dt className="inline">Pendentes: </dt><dd className="inline font-bold tabular-nums text-ink">{row.pending ? `${row.pending.done}/${row.pending.total}` : UNAVAILABLE}</dd></div>
                  <div><dt className="inline">Aguardando resposta: </dt><dd className="inline font-bold tabular-nums text-ink">{show(row.awaiting, String)}</dd></div>
                  <div><dt className="inline">Atrasadas: </dt><dd className="inline font-bold tabular-nums text-ink">{show(row.overdue, String)}</dd></div>
                </dl>
                {row.oldest?.name ? (
                  <p className="mt-1 text-xs text-muted">
                    Mais antigo:{" "}
                    {row.oldest.clientId ? (
                      <Link href={`/admin/chat?client=${encodeURIComponent(row.oldest.clientId)}`} className="font-semibold text-accent-text">{row.oldest.name}</Link>
                    ) : <span className="font-semibold text-ink">{row.oldest.name}</span>}
                    {wait ? ` · espera há ${wait}` : ""}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nenhuma pessoa ativa na equipe.</p>
      )}
      <p className="mt-3 text-[11px] leading-4 text-faint">Meta e pendentes = Meta Diária da equipe; presença e WhatsApp = Desempenho › Online.</p>
    </Card>
  );
}

export function InicioDonoCarregando() {
  return (
    <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      {["Atenções", "Equipe agora"].map((title) => (
        <Card key={title} title={title} note="carregando…">
          <div role="status" aria-live="polite" className="space-y-3">
            <span className="sr-only">Carregando…</span>
            {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-5 w-full" />)}
          </div>
        </Card>
      ))}
    </div>
  );
}

export function InicioDono({ owner }) {
  if (!owner) {
    return (
      <Card title="Atenções e equipe" note="indisponível agora">
        <p className="text-sm text-muted">Não foi possível carregar a visão da equipe agora. Tente recarregar a página.</p>
      </Card>
    );
  }
  return (
    <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <InicioAtencoes attentions={owner.attentions} />
      <InicioEquipe rows={owner.rows} metaAvailable={owner.metaAvailable} />
    </div>
  );
}

// Composição da tela — a mesma na página real (app/admin/inicio/page.jsx, com o mês chegando por streaming) e na
// vitrine. `monthKpis` e `funnel` são os blocos do mês já prontos (ou o carregando).
// Admin geral (INI-5): `ownerSummary` substitui o resumo (sem botões) e `ownerDetail` (Atenções + Equipe) entra logo abaixo
// dos indicadores — os dois chegam por streaming na página real.
export default function PainelInicio({ data, monthKpis = null, funnel = null, ownerSummary = null, ownerDetail = null }) {
  return (
    <div className="container-page space-y-4 sm:space-y-5">
      <h1 className="sr-only">Início</h1>
      {ownerSummary || <InicioAssistente assistant={data.assistant} chatAvailable={data.chatAvailable} />}
      <InicioIndicadores kpis={data.kpis} month={monthKpis} />
      {ownerDetail}
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {funnel}
        <InicioPendencias pending={data.pending} chatAvailable={data.chatAvailable} />
      </div>
    </div>
  );
}

"use client";

import { CalendarClock, MessageCircle, TriangleAlert } from "lucide-react";
import StatusBadge from "@/components/ui/StatusBadge";
import { cx } from "@/components/ui/cx";
import { clientPhone, formatAgo, formatWhen, getNextActivity, getUrgencySignal, initialsOf } from "./client-format";

// Uma linha da lista. Desktop (≥ lg): colunas escaneáveis. Celular: cartão
// compacto com a próxima ação em destaque. A linha inteira abre a ficha; o
// botão de WhatsApp é independente (ação mais frequente do dia).
export const ROW_GRID = "lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1fr)_var(--resp-col)_56px]";

export default function ClientRow({ client, activities, responsibleName, showResponsible, busy, selected, onOpen, onWhatsApp }) {
  const urgency = getUrgencySignal(client, activities);
  const next = getNextActivity(client, activities);
  const tags = Array.isArray(client.tags) ? client.tags : [];
  const lastContact = client.lastWhatsappContactAt ? formatAgo(client.lastWhatsappContactAt) : "";
  const name = client.name || "Cliente sem nome";

  return (
    <li
      className={cx(
        "group relative grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors duration-150 lg:items-center lg:gap-x-4 lg:px-5",
        ROW_GRID,
        selected ? "bg-info-soft" : "hover:bg-navy/[0.025]",
        busy && "opacity-60"
      )}
      style={{ "--resp-col": showResponsible ? "minmax(0,1.1fr)" : "0px" }}
    >
      {/* Cliente */}
      <span className="row-span-2 inline-flex h-10 w-10 items-center justify-center self-start rounded-full bg-navy/[0.06] text-[13px] font-semibold text-navy lg:hidden" aria-hidden="true">
        {initialsOf(name)}
      </span>
      <div className="min-w-0 lg:flex lg:items-center lg:gap-3">
        <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy/[0.06] text-xs font-semibold text-navy lg:inline-flex" aria-hidden="true">
          {initialsOf(name)}
        </span>
        <div className="min-w-0">
          <button
            type="button"
            onClick={onOpen}
            className="block max-w-full truncate text-left text-[15px] font-semibold text-ink after:absolute after:inset-0 after:content-[''] focus-visible:outline-none lg:text-sm"
            aria-label={`Abrir ficha de ${name}`}
          >
            {name}
          </button>
          <p className="hidden min-w-0 items-center gap-1.5 text-xs text-muted lg:flex">
            <span className="shrink-0 whitespace-nowrap tabular-nums">{clientPhone(client) || "Sem telefone"}</span>
            {client.registration?.clientCode ? <span className="shrink-0 whitespace-nowrap">· {client.registration.clientCode}</span> : null}
            {tags.length ? <TagDots tags={tags} /> : null}
          </p>
        </div>
      </div>

      {/* WhatsApp (celular: à direita do nome) */}
      <WhatsAppButton className="lg:hidden" name={name} disabled={busy} onClick={onWhatsApp} />

      {/* Etapa */}
      <div className="col-start-2 col-end-4 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 lg:col-auto">
        <StatusBadge status={client.status} />
        <span className="min-w-0 lg:hidden">
          <NextAction urgency={urgency} next={next} lastContact={lastContact} compact />
        </span>
        {client.registration?.lastFormSubmittedAt ? (
          <span className="w-full text-xs font-medium text-brand lg:hidden">Novo formulário {formatAgo(client.registration.lastFormSubmittedAt)}</span>
        ) : null}
      </div>

      {/* Próxima ação (desktop) */}
      <div className="hidden min-w-0 lg:block">
        <NextAction urgency={urgency} next={next} lastContact={lastContact} />
      </div>

      {/* Último contato (desktop) */}
      <div className="hidden min-w-0 lg:block">
        <p className={cx("text-[13px]", lastContact ? "text-ink-2" : "font-medium text-warning")}>{lastContact || "Nunca contatado"}</p>
        {client.registration?.lastFormSubmittedAt ? <p className="truncate text-xs font-medium text-brand">Novo formulário {formatAgo(client.registration.lastFormSubmittedAt)}</p> : null}
      </div>

      {/* Responsável (admin/gestor) */}
      {showResponsible ? (
        <p className="hidden min-w-0 truncate text-[13px] text-ink-2 lg:block" title={responsibleName}>{responsibleName}</p>
      ) : <span className="hidden lg:block" aria-hidden="true" />}

      <div className="hidden justify-end lg:flex">
        <WhatsAppButton name={name} disabled={busy} onClick={onWhatsApp} />
      </div>
    </li>
  );
}

function NextAction({ urgency, next, lastContact, compact = false }) {
  if (urgency?.key === "overdue") {
    return (
      <span className="inline-flex min-w-0 items-center gap-1 text-[13px] font-medium text-danger">
        <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{next ? `Atrasada · ${formatWhen(next.at)}` : "Atividade atrasada"}</span>
      </span>
    );
  }
  if (next) {
    return (
      <span className="inline-flex min-w-0 max-w-full items-center gap-1 text-[13px] text-ink">
        <CalendarClock className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden="true" />
        <span className="truncate"><span className="font-medium tabular-nums">{formatWhen(next.at)}</span>{next.note && !compact ? <span className="text-ink-2"> · {next.note}</span> : null}</span>
      </span>
    );
  }
  if (urgency) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1 text-[13px] font-medium text-warning">
        <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{urgency.label}</span>
      </span>
    );
  }
  if (compact) {
    return lastContact
      ? <span className="text-[13px] text-muted">Contato {lastContact}</span>
      : <span className="text-[13px] font-medium text-warning">Nunca contatado</span>;
  }
  return <span className="text-[13px] text-faint"><span aria-hidden="true">—</span><span className="sr-only">Sem atividade agendada</span></span>;
}

function TagDots({ tags }) {
  const visible = tags.slice(0, 2);
  return (
    <span className="hidden min-w-0 items-center gap-1 lg:flex">
      <span aria-hidden="true">·</span>
      {visible.map((tag) => (
        <span key={tag.id} className="inline-flex min-w-0 items-center gap-1">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color || "#0D4F8B" }} aria-hidden="true" />
          <span className="truncate">{tag.name}</span>
        </span>
      ))}
      {tags.length > 2 ? <span className="shrink-0">+{tags.length - 2}</span> : null}
    </span>
  );
}

function WhatsAppButton({ name, disabled, onClick, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`WhatsApp de ${name}`}
      title="Abrir WhatsApp"
      className={cx(
        "relative z-10 inline-flex h-touch w-touch shrink-0 items-center justify-center rounded-full border border-success-line bg-success-soft text-success",
        "transition-[background-color,transform] duration-150 ease-out-ui hover:bg-[#DCFAE6] active:scale-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50 lg:h-10 lg:w-10 lg:min-h-0 lg:min-w-0",
        className
      )}
    >
      <MessageCircle className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}

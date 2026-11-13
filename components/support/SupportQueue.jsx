"use client";

import { useCallback, useState } from "react";
import { ClipboardCopy, ImageIcon, Send } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Tabs, { tabClasses } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import Field, { inputClasses } from "@/components/ui/Field";
import { copyImageToClipboard, copyTextToClipboard } from "@/components/support/copy-image";
import { TICKET_KINDS, TICKET_KIND_LABELS, TICKET_REPLY_MAX, TICKET_STATUS_LABELS, formatSupportTime, formatTicketText } from "@/lib/support-tickets-core.mjs";

// Fila de chamados da Ajuda — SÓ o dono (a página e a API já barram os demais). Lista com filtro por status e ficha com
// descrição, contexto, imagens (URLs assinadas curtas), "Copiar imagem", "Copiar texto", tipo e resposta ao corretor.
const STATUS_TONE = { open: "warning", answered: "success", closed: "neutral" };
const FILTERS = [{ value: "", label: "Todos" }, { value: "open", label: "Abertos" }, { value: "answered", label: "Respondidos" }];

async function readJson(response, fallback) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || fallback);
  return data;
}

export default function SupportQueue({ initialTickets = [], initialError = "" }) {
  const [tickets, setTickets] = useState(initialTickets);
  const [error, setError] = useState(initialError);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [ticket, setTicket] = useState(null);
  const [reply, setReply] = useState("");
  const [saving, setSaving] = useState(false);
  const [fallbackImage, setFallbackImage] = useState("");
  const [fallbackText, setFallbackText] = useState("");
  const [notify, toast] = useToast();

  const load = useCallback(async (nextStatus) => {
    setLoading(true);
    setError("");
    try {
      const data = await readJson(await fetch(`/api/admin/support/queue${nextStatus ? `?status=${nextStatus}` : ""}`, { cache: "no-store" }), "Não consegui carregar a fila.");
      setTickets(data.tickets || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  function changeFilter(value) {
    setStatus(value);
    load(value);
  }

  async function openTicket(id) {
    setFallbackImage("");
    setFallbackText("");
    try {
      const data = await readJson(await fetch(`/api/admin/support/tickets/${id}`, { cache: "no-store" }), "Não consegui abrir o chamado.");
      setTicket(data.ticket);
      setReply(data.ticket.reply_text || "");
    } catch (openError) {
      notify(openError.message, "danger");
    }
  }

  async function patch(body, okMessage) {
    setSaving(true);
    try {
      await readJson(await fetch(`/api/admin/support/tickets/${ticket.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), "Não consegui salvar.");
      notify(okMessage);
      await Promise.all([openTicket(ticket.id), load(status)]);
    } catch (patchError) {
      notify(patchError.message, "danger");
    } finally {
      setSaving(false);
    }
  }

  async function copyImage() {
    const first = ticket?.attachments?.[0];
    if (!first) return;
    if (await copyImageToClipboard(first.url)) notify("Imagem copiada.");
    else {
      setFallbackImage(first.url); // sem permissão da área de transferência: segure a imagem e copie
      notify("Não consegui copiar sozinho. Segure a imagem abaixo e copie.", "danger");
    }
  }

  async function copyText() {
    const text = formatTicketText(ticket);
    if (await copyTextToClipboard(text)) notify("Texto copiado.");
    else {
      setFallbackText(text);
      notify("Não consegui copiar sozinho. Selecione o texto abaixo.", "danger");
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <Tabs label="Filtrar por status" value={status} onChange={changeFilter} options={FILTERS} />
      {error ? <EmptyState tone="danger" title="Não consegui carregar" description={error} action={<Button variant="secondary" onClick={() => load(status)}>Tentar de novo</Button>} /> : null}
      {!error && !tickets.length ? <EmptyState title={loading ? "Carregando…" : "Nenhum chamado"} description={loading ? "" : "Quando alguém enviar pelo botão \"?\", aparece aqui."} /> : null}
      <ul className="space-y-2">
        {tickets.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => openTicket(item.id)} className="block w-full text-left">
              <Card padding="sm" className="transition-colors hover:border-accent-line">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-navy">{item.author_name || "Usuário"}</span>
                  <span className="text-xs text-muted">{formatSupportTime(item.created_at)}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-ink">{item.description}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge tone={STATUS_TONE[item.status] || "neutral"}>{TICKET_STATUS_LABELS[item.status] || item.status}</Badge>
                  {item.kind ? <Badge tone="info">{TICKET_KIND_LABELS[item.kind]}</Badge> : null}
                  {item.attachment_count ? <Badge icon={ImageIcon}>{item.attachment_count}</Badge> : null}
                  <span className="truncate text-xs text-muted">{item.screen_title || item.screen_path}</span>
                </div>
              </Card>
            </button>
          </li>
        ))}
      </ul>

      <Sheet open={Boolean(ticket)} onClose={() => setTicket(null)} title="Chamado" description={ticket ? `${ticket.author_name || "Usuário"} · ${formatSupportTime(ticket.created_at)}` : ""} side="auto" className="ui-sheet-full">
        {ticket ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={copyText}><ClipboardCopy className="h-4 w-4" aria-hidden="true" /> Copiar texto</Button>
              <Button size="sm" variant="secondary" onClick={copyImage} disabled={!ticket.attachments?.length}><ImageIcon className="h-4 w-4" aria-hidden="true" /> Copiar imagem</Button>
            </div>
            {fallbackText ? <textarea readOnly className={`${inputClasses} min-h-[160px] py-2 text-xs`} value={fallbackText} onFocus={(event) => event.target.select()} /> : null}
            <p className="whitespace-pre-wrap text-sm text-ink">{ticket.description}</p>
            <dl className="grid gap-1 text-xs text-ink-2">
              <div><dt className="inline font-semibold">Perfil: </dt><dd className="inline">{ticket.context?.user?.roleLabel}{ticket.context?.user?.viaAccountSwitch ? ` (em "Alterar conta" por ${ticket.context.user.realName || "administrador"})` : ""}</dd></div>
              <div><dt className="inline font-semibold">Tela: </dt><dd className="inline">{ticket.context?.screen?.title ? `${ticket.context.screen.title} — ` : ""}{ticket.context?.screen?.path || ticket.screen_path}</dd></div>
              <div><dt className="inline font-semibold">Aparelho: </dt><dd className="inline">{ticket.context?.device?.summary}{ticket.context?.device?.viewport ? ` (${ticket.context.device.viewport})` : ""}</dd></div>
              <div>
                <dt className="font-semibold">Erros recentes da tela:</dt>
                <dd>{ticket.context?.errors?.length ? <ul className="list-disc pl-4">{ticket.context.errors.map((entry, index) => <li key={index}>{entry.kind === "promise" ? "[promessa rejeitada] " : ""}{entry.message}</li>)}</ul> : "nenhum registrado"}</dd>
              </div>
            </dl>
            {ticket.attachments?.length ? (
              <ul className="flex flex-wrap gap-2">
                {ticket.attachments.map((image, index) => (
                  <li key={index}>
                    <a href={image.url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image.url} alt={`Print ${index + 1}`} className="max-h-48 rounded-control border border-line object-contain" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            {fallbackImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fallbackImage} alt="Segure para copiar" className="w-full rounded-control border border-line" />
            ) : null}
            <div>
              <p className="mb-1.5 text-sm font-semibold text-ink">Tipo</p>
              <div className="flex flex-wrap gap-1.5">
                {TICKET_KINDS.map((kind) => (
                  <button key={kind} type="button" disabled={saving} aria-pressed={ticket.kind === kind} className={tabClasses(ticket.kind === kind, "md")} onClick={() => patch({ kind: ticket.kind === kind ? null : kind }, "Tipo salvo.")}>
                    {TICKET_KIND_LABELS[kind]}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Resposta" hint={`${reply.length}/${TICKET_REPLY_MAX}`}>
              <textarea className={`${inputClasses} min-h-[120px] py-2`} value={reply} maxLength={TICKET_REPLY_MAX} onChange={(event) => setReply(event.target.value)} placeholder="Resposta curta, em linguagem simples, pronta para o corretor ler." />
            </Field>
            <Button block loading={saving} disabled={!reply.trim()} onClick={() => patch({ reply }, "Resposta enviada ao corretor.")}><Send className="h-4 w-4" aria-hidden="true" /> Enviar ao corretor</Button>
            {ticket.status === "answered" ? <p className="text-xs text-muted">Já respondido em {formatSupportTime(ticket.replied_at)}. Enviar de novo substitui a resposta e avisa o corretor outra vez.</p> : null}
          </div>
        ) : null}
      </Sheet>
      {toast}
    </div>
  );
}

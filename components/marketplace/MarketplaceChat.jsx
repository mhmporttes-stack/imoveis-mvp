"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Send } from "lucide-react";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import { inputClasses } from "@/components/ui/Field";
import MessengerBadge from "@/components/marketplace/MessengerBadge";

// Chat do Marketplace (MKT-2). A tela só mostra e chama /api/admin/marketplace-chat/**; regra, escopo e roleta ficam
// no servidor (lib/marketplace-chat.js). As mensagens chegam e saem pela extensão no PC do escritório (~1–2 min).

const LIST_REFRESH_MS = 20000;
const THREAD_REFRESH_MS = 10000;
const time = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const STATUS_TEXT = { queued: "Na fila de envio", sending: "Enviando…", sent: "Enviada", failed: "Falhou" };

async function callApi(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json" }, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir a ação.");
  return data;
}

function Avatar({ name, photo }) {
  return (
    <span className="relative inline-flex h-11 w-11 shrink-0">
      {photo ? (
        <img src={photo} alt="" className="h-11 w-11 rounded-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-info-soft text-sm font-semibold text-navy">{(name || "?").slice(0, 1).toUpperCase()}</span>
      )}
      <MessengerBadge />
    </span>
  );
}

function SettingsCard() {
  const [settings, setSettings] = useState(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    callApi("/api/admin/marketplace-chat/settings").then((data) => setSettings(data.settings)).catch((error) => setMessage(error.message));
  }, []);
  if (!settings) return message ? <p className="text-sm text-danger">{message}</p> : null;
  const save = (next) => {
    setSettings(next);
    callApi("/api/admin/marketplace-chat/settings", { method: "PUT", body: JSON.stringify(next) })
      .then((data) => { setSettings(data.settings); setMessage("Salvo."); })
      .catch((error) => setMessage(error.message));
  };
  return (
    <Card padding="sm" className="flex flex-wrap items-center gap-3 text-sm">
      <label className="inline-flex items-center gap-2 font-medium text-ink">
        <input type="checkbox" checked={settings.syncEnabled} onChange={(event) => save({ ...settings, syncEnabled: event.target.checked })} />
        Sincronizar conversas do Marketplace
      </label>
      <label className="inline-flex items-center gap-1 text-muted">das
        <input type="number" min={0} max={23} className="w-16 rounded-control border border-line px-2 py-1" value={settings.startHour} onChange={(event) => save({ ...settings, startHour: Number(event.target.value) })} />h às
        <input type="number" min={1} max={24} className="w-16 rounded-control border border-line px-2 py-1" value={settings.endHour} onChange={(event) => save({ ...settings, endHour: Number(event.target.value) })} />h
      </label>
      <label className="inline-flex items-center gap-1 text-muted">até
        <input type="number" min={1} max={60} className="w-16 rounded-control border border-line px-2 py-1" value={settings.maxSendsPerHour} onChange={(event) => save({ ...settings, maxSendsPerHour: Number(event.target.value) })} /> envios por hora
      </label>
      {message ? <span className="text-muted">{message}</span> : null}
    </Card>
  );
}

export default function MarketplaceChat({ canEditSettings = false, canAssign = false, team = [] }) {
  const [list, setList] = useState({ ready: true, conversations: [] });
  const [selectedId, setSelectedId] = useState("");
  const [thread, setThread] = useState(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  const loadList = useCallback(() => {
    callApi("/api/admin/marketplace-chat/conversations").then(setList).catch((loadError) => setError(loadError.message));
  }, []);
  const loadThread = useCallback((id) => {
    if (!id) return;
    callApi(`/api/admin/marketplace-chat/conversations/${id}`).then(setThread).catch((loadError) => setError(loadError.message));
  }, []);

  useEffect(() => {
    loadList();
    const timer = setInterval(() => document.visibilityState === "visible" && loadList(), LIST_REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) return undefined;
    loadThread(selectedId);
    const timer = setInterval(() => document.visibilityState === "visible" && loadThread(selectedId), THREAD_REFRESH_MS);
    return () => clearInterval(timer);
  }, [selectedId, loadThread]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages?.length]);

  async function send(event) {
    event.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await callApi(`/api/admin/marketplace-chat/conversations/${selectedId}/messages`, { method: "POST", body: JSON.stringify({ text }) });
      setText("");
      loadThread(selectedId);
      loadList();
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setBusy(false);
    }
  }

  async function addToCrm() {
    const name = window.prompt("Nome do cliente:", thread?.conversation?.contactName || "");
    if (!name) return;
    const phone = window.prompt("WhatsApp do cliente (com DDD) — o Facebook não informa o telefone:");
    if (!phone) return;
    try {
      const result = await callApi(`/api/admin/marketplace-chat/conversations/${selectedId}/crm`, { method: "POST", body: JSON.stringify({ name, phone }) });
      loadThread(selectedId);
      window.alert(`Cliente adicionado ao CRM (${result.clientId.slice(0, 8)}).`);
    } catch (crmError) {
      setError(crmError.message);
    }
  }

  async function assign(userId) {
    try {
      await callApi(`/api/admin/marketplace-chat/conversations/${selectedId}`, { method: "PATCH", body: JSON.stringify({ assignedUserId: userId || null }) });
      loadThread(selectedId);
      loadList();
    } catch (assignError) {
      setError(assignError.message);
    }
  }

  const conversation = thread?.conversation;
  return (
    <section className="container-page space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[22px] font-semibold text-navy">Chat do Marketplace</h1>
          <p className="text-sm text-muted">Conversas do Facebook Marketplace. Sincroniza com o PC do escritório ligado (Chrome aberto); atraso de ~1–2 min para chegar e para sair. As respostas saem pelo perfil do Facebook do Matheus.</p>
        </div>
        <Button variant="secondary" size="sm" href="/admin/chat">Chat do WhatsApp</Button>
      </header>
      {canEditSettings ? <SettingsCard /> : null}
      {!list.ready ? <Card className="bg-warning-soft text-sm text-warning">O Chat do Marketplace ainda não foi criado no banco (migration 20261020180000).</Card> : null}
      {error ? <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}

      <div className="grid gap-3 md:grid-cols-[320px,1fr]">
        <Card padding="none" className={`overflow-hidden ${selectedId ? "hidden md:block" : ""}`}>
          {!list.conversations.length ? <p className="p-4 text-sm text-muted">Nenhuma conversa do Marketplace ainda.</p> : null}
          <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto">
            {list.conversations.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => setSelectedId(item.id)} className={`flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-info-soft ${item.id === selectedId ? "bg-info-soft" : ""}`}>
                  <Avatar name={item.contactName} photo={item.contactPhotoUrl} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold text-navy">{item.contactName}</span>
                      <Badge tone="info">Marketplace</Badge>
                    </span>
                    <span className="block truncate text-xs text-muted">{item.listingTitle || "Anúncio não identificado"}</span>
                    <span className="block truncate text-sm text-ink">{item.lastMessagePreview}</span>
                    <span className="block text-xs text-muted">{item.waiting ? "Aguardando corretor on-line" : item.assignedName || "Sem atendente"}{item.lastMessageAt ? ` · ${time.format(new Date(item.lastMessageAt))}` : ""}</span>
                  </span>
                  {item.unreadCount ? <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-success-strong px-1.5 text-2xs font-semibold text-white">{item.unreadCount}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </Card>

        {selectedId && conversation ? (
          <Card padding="none" className="flex min-h-[60vh] flex-col overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
              <Button size="icon" variant="ghost" className="md:hidden" aria-label="Voltar" onClick={() => { setSelectedId(""); setThread(null); }}><ArrowLeft className="h-5 w-5" /></Button>
              <Avatar name={conversation.contactName} photo={conversation.contactPhotoUrl} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-semibold text-navy">{conversation.contactName} <Badge tone="info">Marketplace</Badge></p>
                <p className="truncate text-xs text-muted">
                  {conversation.listingUrl ? <a className="text-brand underline" href={conversation.listingUrl} target="_blank" rel="noreferrer">{conversation.listingTitle || "Ver anúncio"}</a> : conversation.listingTitle || "Anúncio não identificado"}
                  {conversation.assignedName ? ` · ${conversation.assignedName}` : ""}
                </p>
              </div>
              {canAssign ? (
                <select className="rounded-control border border-line px-2 py-1 text-sm" value={conversation.assignedUserId || ""} onChange={(event) => assign(event.target.value)} aria-label="Atribuir conversa a">
                  <option value="">Sem atendente</option>
                  {team.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                </select>
              ) : null}
              {conversation.clientId ? (
                <Button size="sm" variant="secondary" href={`/admin/simulacoes?query=${encodeURIComponent(conversation.contactName || "")}`}>Ver cliente</Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={addToCrm}>Adicionar ao CRM</Button>
              )}
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto bg-mist p-3">
              {(thread.messages || []).map((message) => (
                <div key={message.id} className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-card px-3 py-2 text-sm ${message.direction === "outbound" ? "bg-info-soft text-ink" : "bg-white text-ink"}`}>
                    {message.direction === "outbound" ? <p className="text-2xs font-medium text-muted">{message.senderName}</p> : null}
                    {message.body ? <p className="whitespace-pre-wrap break-words">{message.body}</p> : null}
                    {(message.attachments || []).map((attachment) => (
                      attachment.type === "image"
                        ? <a key={attachment.url} href={attachment.url} target="_blank" rel="noreferrer"><img src={attachment.url} alt="Anexo" className="mt-1 max-h-48 rounded" referrerPolicy="no-referrer" /></a>
                        : <a key={attachment.url} href={attachment.url} target="_blank" rel="noreferrer" className="block text-brand underline">{attachment.name || "Anexo"}</a>
                    ))}
                    <p className="mt-1 text-2xs text-muted">
                      {time.format(new Date(message.at))}
                      {message.direction === "outbound" && STATUS_TEXT[message.status] ? ` · ${STATUS_TEXT[message.status]}` : ""}
                      {message.status === "failed" && message.error ? ` — ${message.error}` : ""}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
            <form onSubmit={send} className="flex gap-2 border-t border-line p-3">
              <textarea className={`${inputClasses} min-h-touch py-2`} rows={2} maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} placeholder="Escreva a resposta (sai pelo Facebook em ~1–2 min)" />
              <Button type="submit" loading={busy} disabled={!text.trim()} aria-label="Enviar"><Send className="h-4 w-4" /></Button>
            </form>
          </Card>
        ) : (
          <Card className="hidden items-center justify-center text-sm text-muted md:flex">Escolha uma conversa.</Card>
        )}
      </div>
    </section>
  );
}

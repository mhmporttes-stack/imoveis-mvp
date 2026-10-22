"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Send } from "lucide-react";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import { inputClasses } from "@/components/ui/Field";
import MessengerBadge from "@/components/marketplace/MessengerBadge";
import { useChatAppMode } from "@/components/useChatAppMode";
import { readViewerData, saveViewerData } from "@/components/chat-view-cache";
import { MARKETPLACE_LIST_CACHE_PREFIX, MARKETPLACE_THREADS_CACHE_NAME } from "@/components/panel-cache-names";

// Chat do Marketplace (MKT-2). A tela só mostra e chama /api/admin/marketplace-chat/**; regra, escopo e roleta ficam
// no servidor (lib/marketplace-chat.js). As mensagens chegam e saem pela extensão no PC do escritório (~1–2 min).

const LIST_REFRESH_MS = 20000;
const THREAD_REFRESH_MS = 10000;
const time = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
// Seletor da lista (dono, 2026-10-21): Todos / um corretor / Roleta. O servidor decide o que existe para cada perfil
// (`filters`) e aplica o escopo. Na lista, o nome do corretor (1º nome) no lugar da etiqueta; sem corretor = "Roleta".
const ROULETTE = "__roleta";
const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";
// Abre na hora (dono, 2026-10-22): lista e últimas conversas abertas vêm do cache por conta (components/chat-view-cache.js,
// também pré-carregado pelo AdminWarmup) e atualizam em seguida pelas mesmas APIs. Lista buscada há menos de
// FRESH_MS (ex.: pelo pré-carregamento) não é buscada de novo ao entrar — a próxima volta do polling atualiza.
const FRESH_MS = 15000;
const MAX_CACHED_THREADS = 6;
const listQuery = (view, brokerId) => {
  const params = new URLSearchParams({ view });
  if (brokerId) params.set("brokerId", brokerId);
  return params.toString();
};
const readCachedThread = (viewerKey, id) => (id && readViewerData(viewerKey, MARKETPLACE_THREADS_CACHE_NAME)?.[id]) || null;
function saveCachedThread(viewerKey, id, thread) {
  if (!viewerKey || !id || !thread) return;
  const current = { ...(readViewerData(viewerKey, MARKETPLACE_THREADS_CACHE_NAME) || {}) };
  delete current[id];
  current[id] = thread;
  const ids = Object.keys(current);
  for (const old of ids.slice(0, Math.max(0, ids.length - MAX_CACHED_THREADS))) delete current[old];
  saveViewerData(viewerKey, MARKETPLACE_THREADS_CACHE_NAME, current);
}
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

// Exportado para a tela de configuração do Marketplace (/admin/marketplace) — dono, 2026-10-22: "deixe essa configuração
// de sincronização na aba de configuração, deixando mais espaço ali" (no Chat).
export function SettingsCard() {
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
      {/* 1ª carga (dono, 2026-10-21): pares dia → pessoa e "não importar anteriores a" continuam valendo pelo que está
          salvo em crm_settings (lib/marketplace-chat.js), mas não aparecem na tela — dono: "isso não precisa ficar visível". */}
      {message ? <span className="text-muted">{message}</span> : null}
    </Card>
  );
}

export default function MarketplaceChat({ canEditSettings = false, canAssign = false, team = [], viewerKey = "" }) {
  const [list, setList] = useState(() => readViewerData(viewerKey, `${MARKETPLACE_LIST_CACHE_PREFIX}${listQuery("all", "")}`)?.data || { ready: true, conversations: [], filters: [] });
  const [view, setView] = useState("all");
  const [brokerId, setBrokerId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [thread, setThread] = useState(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const selectedRef = useRef("");
  const sectionRef = useRef(null);
  // Tela cheia como o Chat do WhatsApp (dono, 2026-10-22: "Remova a opção Sair embaixo, deixe como o Chat: a rolagem
  // deve rolar apenas as conversas"): sem rodapé, altura da janela e só a lista / as mensagens rolam.
  useChatAppMode(true, sectionRef);
  selectedRef.current = selectedId;

  const loadList = useCallback(() => {
    const query = listQuery(view, brokerId);
    callApi(`/api/admin/marketplace-chat/conversations?${query}`)
      .then((data) => {
        setList(data);
        saveViewerData(viewerKey, `${MARKETPLACE_LIST_CACHE_PREFIX}${query}`, { at: Date.now(), data });
      })
      .catch((loadError) => setError(loadError.message));
  }, [view, brokerId, viewerKey]);
  const loadThread = useCallback((id) => {
    if (!id) return;
    callApi(`/api/admin/marketplace-chat/conversations/${id}`)
      .then((data) => {
        saveCachedThread(viewerKey, id, data);
        // Só mostra se a pessoa ainda está nesta conversa (trocou no meio do caminho: guarda e não troca a tela).
        if (selectedRef.current === id) setThread(data);
      })
      .catch((loadError) => setError(loadError.message));
  }, [viewerKey]);

  useEffect(() => {
    // Ao trocar o filtro: mostra o que já estava guardado para ele e atualiza; recém-buscada não repete a busca.
    const cached = readViewerData(viewerKey, `${MARKETPLACE_LIST_CACHE_PREFIX}${listQuery(view, brokerId)}`);
    if (cached?.data) setList(cached.data);
    if (!cached || Date.now() - cached.at > FRESH_MS) loadList();
    const timer = setInterval(() => document.visibilityState === "visible" && loadList(), LIST_REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) return undefined;
    setThread(readCachedThread(viewerKey, selectedId));
    loadThread(selectedId);
    const timer = setInterval(() => document.visibilityState === "visible" && loadThread(selectedId), THREAD_REFRESH_MS);
    return () => clearInterval(timer);
  }, [selectedId, loadThread]);

  useEffect(() => {
    // Rola só a caixa das mensagens (scrollIntoView mexeria também na moldura fixa da tela cheia).
    const box = endRef.current?.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
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
    try {
      const result = await callApi(`/api/admin/marketplace-chat/conversations/${selectedId}/crm`, { method: "POST", body: JSON.stringify({ name }) });
      loadThread(selectedId);
      window.alert(`Cliente adicionado ao CRM (${result.clientId.slice(0, 8)}). Preencha o WhatsApp no card do cliente quando conseguir.`);
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
    <>
    <h1 id="marketplace-chat-title" className="sr-only">Chat do Marketplace</h1>
    <section ref={sectionRef} className="chat-app-root container-page space-y-3" aria-labelledby="marketplace-chat-title">
      {/* Sem título, explicação nem botão "Chat do WhatsApp" no topo (dono, 2026-10-22: "remova todos esses textos").
          O título só para leitores de tela fica FORA do space-y (senão o primeiro bloco ganha margem e sobra espaço). */}
      {!list.ready ? <Card className="shrink-0 bg-warning-soft text-sm text-warning">O Chat do Marketplace ainda não foi criado no banco (migration 20261020180000).</Card> : null}
      {error ? <p role="alert" className="shrink-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-3 md:mb-4 md:grid-cols-[320px,1fr]">
        <Card padding="none" className={`min-h-0 flex-col overflow-hidden max-md:rounded-none max-md:border-x-0 ${selectedId ? "hidden md:flex" : "flex"}`}>
          {list.filters?.length ? (
            <div className="shrink-0 border-b border-line p-2">
              <select className="w-full rounded-control border border-line px-2 py-1.5 text-sm" aria-label="Mostrar conversas de"
                value={brokerId || (view === "unassigned" ? ROULETTE : "")}
                onChange={(event) => {
                  const value = event.target.value;
                  setView(value === ROULETTE ? "unassigned" : "all");
                  setBrokerId(value && value !== ROULETTE ? value : "");
                }}>
                <option value="">Todos</option>
                {list.filters.includes("unassigned") ? <option value={ROULETTE}>Roleta (aguardando atendimento)</option> : null}
                {team.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            </div>
          ) : null}
          {!list.conversations.length ? <p className="shrink-0 p-4 text-sm text-muted">Nenhuma conversa do Marketplace ainda.</p> : null}
          <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto overscroll-contain">
            {list.conversations.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => setSelectedId(item.id)} className={`flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-info-soft ${item.id === selectedId ? "bg-info-soft" : ""}`}>
                  <Avatar name={item.contactName} photo={item.contactPhotoUrl} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold text-navy">{item.contactName}</span>
                      <Badge tone={item.assignedName ? "info" : "warning"}>{firstName(item.assignedName) || "Roleta"}</Badge>
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
          <Card padding="none" className="flex min-h-0 flex-col overflow-hidden max-md:rounded-none max-md:border-x-0">
            {/* Cabeçalho em duas linhas (dono, 2026-10-22: "organize" — o seletor cobria o selo no celular): 1) voltar, foto,
                nome + corretor (ou "Roleta") e anúncio; 2) atribuir + cliente, ocupando a largura toda. */}
            <div className="shrink-0 space-y-2 border-b border-line p-3">
              <div className="flex items-center gap-3">
                <Button size="icon" variant="ghost" className="shrink-0 md:hidden" aria-label="Voltar" onClick={() => { setSelectedId(""); setThread(null); }}><ArrowLeft className="h-5 w-5" /></Button>
                <Avatar name={conversation.contactName} photo={conversation.contactPhotoUrl} />
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-2 font-semibold text-navy">
                    <span className="truncate">{conversation.contactName}</span>
                    <Badge tone="info" className="shrink-0">{conversation.assignedName ? String(conversation.assignedName).split(" ")[0] : "Roleta"}</Badge>
                  </p>
                  <p className="truncate text-xs text-muted">
                    {conversation.listingUrl ? <a className="text-brand underline" href={conversation.listingUrl} target="_blank" rel="noreferrer">{conversation.listingTitle || "Ver anúncio"}</a> : conversation.listingTitle || "Anúncio não identificado"}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canAssign ? (
                  <select className="min-w-0 flex-1 rounded-control border border-line px-2 py-1.5 text-sm" value={conversation.assignedUserId || ""} onChange={(event) => assign(event.target.value)} aria-label="Atribuir conversa a">
                    <option value="">Sem atendente</option>
                    {team.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                  </select>
                ) : null}
                {conversation.clientId ? (
                  <Button size="sm" variant="secondary" className="shrink-0" href={`/admin/simulacoes?query=${encodeURIComponent(conversation.contactName || "")}`}>Ver cliente</Button>
                ) : (
                  <Button size="sm" variant="secondary" className="shrink-0" onClick={addToCrm}>Adicionar ao CRM</Button>
                )}
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain bg-mist p-3">
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
            <form onSubmit={send} className="chat-composer-safe flex shrink-0 gap-2 border-t border-line p-3">
              <textarea className={`${inputClasses} min-h-touch py-2`} rows={2} maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} placeholder="Escreva a resposta (sai pelo Facebook em ~1–2 min)" />
              <Button type="submit" loading={busy} disabled={!text.trim()} aria-label="Enviar"><Send className="h-4 w-4" /></Button>
            </form>
          </Card>
        ) : (
          <Card className="hidden items-center justify-center text-sm text-muted md:flex">Escolha uma conversa.</Card>
        )}
      </div>
    </section>
    </>
  );
}

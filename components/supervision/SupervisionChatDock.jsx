"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, CheckCheck, ChevronUp, MessageCircle, Minus, SendHorizontal, X } from "lucide-react";
import Avatar from "@/components/Avatar";
import Button from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { usePrefersReducedMotion } from "@/components/motion/usePrefersReducedMotion";
import { formatSupervisionTime, useSupervisionRealtime } from "./useSupervisionRealtime";

const EASE = [0.2, 0, 0, 1];
const API = "/api/admin/supervision-messages";

// Caixa de entrada do gestor/admin: contagem de mensagens recebidas e não
// vistas por remetente (badge no card do corretor) + um contador `version`
// que sobe a cada aviso de tempo real (a conversa aberta relê quando muda).
export function useSupervisionInbox() {
  const [counts, setCounts] = useState({});
  const [topic, setTopic] = useState("");
  const [version, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${API}/unread`, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json().catch(() => null);
      if (!data) return;
      setCounts(data.counts || {});
      setTopic(data.topic || "");
    } catch {
      // Falha pontual — tenta de novo no próximo aviso/foco.
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useSupervisionRealtime(topic, () => {
    setVersion((value) => value + 1);
    refresh();
  });

  const clearFor = useCallback((userId) => {
    setCounts((current) => (current[userId] ? { ...current, [userId]: 0 } : current));
  }, []);

  return { counts, version, refresh, clearFor };
}

// Ícone discreto no card do corretor (Supervisão › Meta Diária). Não muda
// a altura do card: fica na linha do nome, do mesmo tamanho do avatar.
export function SupervisionChatButton({ count = 0, name = "", onClick }) {
  const reduced = usePrefersReducedMotion();
  return (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); onClick?.(); }}
      onKeyDown={(event) => event.stopPropagation()}
      aria-label={count ? `Conversar com ${name} — ${count} nova${count > 1 ? "s" : ""}` : `Conversar com ${name}`}
      title="Mensagem da supervisão"
      className="relative ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition-[background-color,color,transform] duration-150 ease-out-ui before:absolute before:-inset-1 before:content-[''] hover:bg-info-soft hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.94] motion-reduce:transition-none"
    >
      <MessageCircle className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden="true" />
      <AnimatePresence>
        {count > 0 ? (
          <motion.span
            key="badge"
            className="absolute -right-0.5 -top-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold tabular-nums leading-none text-white ring-2 ring-white"
            initial={reduced ? false : { scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.34, 1.56, 0.64, 1] }}
            aria-hidden="true"
          >
            {count > 9 ? "9+" : count}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </button>
  );
}

const STATE_LABEL = {
  sending: "Enviando…",
  sent: "Enviada",
  delivered: "Entregue",
  seen: "Vista",
  acknowledged: "Confirmada",
  replied: "Respondida",
  failed: "Não enviada"
};

function MessageState({ state }) {
  const Icon = state === "seen" || state === "acknowledged" || state === "replied" ? CheckCheck : Check;
  const tone = state === "acknowledged" || state === "replied" ? "text-success" : state === "failed" ? "text-danger" : "text-faint";
  return (
    <span className={cx("inline-flex items-center gap-0.5", tone)}>
      {state !== "sending" && state !== "failed" ? <Icon className="h-3 w-3" aria-hidden="true" /> : null}
      {STATE_LABEL[state] || ""}
    </span>
  );
}

function mergeMessages(current, incoming) {
  const byId = new Map(current.filter((message) => !message.pending).map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  const pending = current.filter((message) => message.pending);
  return [...byId.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).concat(pending);
}

// Mini-chat flutuante (canto inferior direito; no celular quase largura
// total, acima da barra inferior). Uma conversa por vez.
export default function SupervisionChatDock({ partner, inboxVersion = 0, onClose, onSeen }) {
  const reduced = usePrefersReducedMotion();
  const [minimized, setMinimized] = useState(false);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [unreadWhileMinimized, setUnreadWhileMinimized] = useState(0);
  const listRef = useRef(null);
  const textareaRef = useRef(null);
  const topSentinelRef = useRef(null);
  const animateFromRef = useRef(new Set());
  const stickToBottomRef = useRef(true);
  const prependAnchorRef = useRef(null);
  const partnerId = partner?.id;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const markRead = useCallback(() => {
    if (!partnerId) return;
    onSeen?.(partnerId);
    fetch(`${API}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: partnerId })
    }).catch(() => {});
  }, [partnerId, onSeen]);

  const loadLatest = useCallback(async ({ initial = false } = {}) => {
    if (!partnerId) return;
    try {
      const response = await fetch(`${API}?userId=${encodeURIComponent(partnerId)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar a conversa.");
      setError("");
      if (initial) {
        setMessages(data.messages || []);
      } else {
        const known = new Set(messagesRef.current.map((message) => message.id));
        const fresh = (data.messages || []).filter((message) => !known.has(message.id));
        for (const message of fresh) animateFromRef.current.add(message.id);
        const freshIncoming = fresh.filter((message) => !message.mine).length;
        if (freshIncoming) setUnreadWhileMinimized((value) => value + freshIncoming);
        setMessages((current) => mergeMessages(current, data.messages || []));
      }
      if (initial) setHasMore(Boolean(data.hasMore));
    } catch (loadError) {
      if (initial) setError(loadError.message);
    } finally {
      if (initial) setLoading(false);
    }
  }, [partnerId]);

  // Troca de corretor = conversa nova.
  useEffect(() => {
    setMessages([]);
    setHasMore(false);
    setLoading(true);
    setDraft("");
    setMinimized(false);
    setUnreadWhileMinimized(0);
    stickToBottomRef.current = true;
    loadLatest({ initial: true }).then(markRead);
  }, [partnerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Aviso de tempo real (resposta, visto, confirmação).
  useEffect(() => {
    if (!inboxVersion || !partnerId) return;
    loadLatest();
  }, [inboxVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Conversa aberta e visível = mensagens recebidas ficam vistas.
  useEffect(() => {
    if (minimized) return;
    setUnreadWhileMinimized(0);
    if (messages.some((message) => !message.mine && !message.seenAt)) markRead();
  }, [messages, minimized, markRead]);

  // Rolagem: novas mensagens descem para o fim; "anteriores" preservam a
  // posição de leitura.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (prependAnchorRef.current != null) {
      list.scrollTop = list.scrollHeight - prependAnchorRef.current;
      prependAnchorRef.current = null;
      return;
    }
    if (stickToBottomRef.current) list.scrollTop = list.scrollHeight;
  }, [messages, minimized]);

  const loadOlder = useCallback(async () => {
    if (loadingMore || !hasMore || !messages.length || !partnerId) return;
    setLoadingMore(true);
    try {
      const oldest = messages.find((message) => !message.pending);
      const response = await fetch(`${API}?userId=${encodeURIComponent(partnerId)}&before=${encodeURIComponent(oldest.createdAt)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error);
      if (listRef.current) prependAnchorRef.current = listRef.current.scrollHeight - listRef.current.scrollTop;
      setMessages((current) => mergeMessages(current, data.messages || []));
      setHasMore(Boolean(data.hasMore));
    } catch {
      // Mantém o botão para tentar de novo.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, messages, partnerId]);

  // Lazy loading: chegou ao topo, busca a página anterior.
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const list = listRef.current;
    if (!sentinel || !list || !hasMore || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadOlder();
    }, { root: list, rootMargin: "80px 0px 0px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadOlder, minimized]);

  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 104)}px`;
  }, [draft, minimized]);

  async function send() {
    const body = draft.trim();
    if (!body || sending || !partnerId) return;
    const tempId = `tmp-${Date.now()}`;
    const optimistic = { id: tempId, pending: true, mine: true, body, kind: "message", state: "sending", createdAt: new Date().toISOString() };
    animateFromRef.current.add(tempId);
    stickToBottomRef.current = true;
    setMessages((current) => [...current, optimistic]);
    setDraft("");
    setSending(true);
    try {
      const response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId: partnerId, body })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível enviar.");
      animateFromRef.current.add(data.message.id);
      setMessages((current) => mergeMessages(current.filter((message) => message.id !== tempId), [data.message]));
    } catch (sendError) {
      setMessages((current) => current.map((message) => (message.id === tempId ? { ...message, state: "failed", error: sendError.message } : message)));
      setDraft(body);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  if (!partner) return null;

  const panelMotion = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.12 } }
    : {
        initial: { opacity: 0, y: 16, scale: 0.98 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: 12, scale: 0.98 },
        transition: { duration: 0.22, ease: EASE }
      };

  return (
    <div
      className="pointer-events-none fixed inset-x-3 z-[55] flex justify-end sm:inset-x-auto sm:right-5"
      style={{ bottom: "calc(0.75rem + max(env(safe-area-inset-bottom), var(--admin-bottom-nav-space, 0px)))" }}
    >
      <AnimatePresence mode="wait" initial>
        {minimized ? (
          <motion.button
            key="minimized"
            type="button"
            onClick={() => setMinimized(false)}
            className="pointer-events-auto flex min-h-touch items-center gap-2.5 rounded-full border border-line bg-white py-1.5 pl-1.5 pr-4 shadow-float transition-colors duration-150 hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            aria-label={`Abrir conversa com ${partner.name}`}
            {...panelMotion}
          >
            <Avatar name={partner.name} photoUrl={partner.photoUrl} size={32} />
            <span className="max-w-[160px] truncate text-sm font-semibold text-ink">{partner.name}</span>
            {unreadWhileMinimized ? (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-2xs font-semibold tabular-nums text-white">{unreadWhileMinimized}</span>
            ) : null}
            <ChevronUp className="h-4 w-4 text-muted" aria-hidden="true" />
          </motion.button>
        ) : (
          <motion.section
            key="open"
            role="dialog"
            aria-label={`Conversa de supervisão com ${partner.name}`}
            className="pointer-events-auto flex h-[min(520px,calc(100dvh-7rem))] w-full flex-col overflow-hidden rounded-panel border border-line bg-white shadow-float sm:w-[360px]"
            style={{ transformOrigin: "bottom right" }}
            onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setMinimized(true); } }}
            {...panelMotion}
          >
            <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-3 py-2">
              <Avatar name={partner.name} photoUrl={partner.photoUrl} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{partner.name}</p>
                <p className="text-2xs text-muted">Mensagens da supervisão</p>
              </div>
              <button
                type="button"
                onClick={() => setMinimized(true)}
                aria-label="Minimizar conversa"
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-navy/[0.06] hover:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <Minus className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar conversa"
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-navy/[0.06] hover:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </header>

            <div
              ref={listRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-mist/40 px-3 py-3"
              onScroll={(event) => {
                const list = event.currentTarget;
                stickToBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
              }}
              aria-live="polite"
            >
              {hasMore ? (
                <div ref={topSentinelRef} className="flex justify-center pb-2">
                  <button type="button" onClick={loadOlder} disabled={loadingMore} className="rounded-full px-3 py-1 text-xs font-medium text-brand hover:bg-info-soft disabled:text-faint">
                    {loadingMore ? "Carregando…" : "Mensagens anteriores"}
                  </button>
                </div>
              ) : null}

              {loading ? (
                <div className="space-y-2 pt-2" aria-hidden="true">
                  <div className="ml-auto h-10 w-2/3 animate-pulse rounded-card bg-white motion-reduce:animate-none" />
                  <div className="h-8 w-1/2 animate-pulse rounded-card bg-white motion-reduce:animate-none" />
                </div>
              ) : error ? (
                <p className="px-2 pt-6 text-center text-sm text-danger">{error}</p>
              ) : !messages.length ? (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-info-soft text-brand">
                    <MessageCircle className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <p className="text-sm font-semibold text-ink">Nenhuma mensagem ainda</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">A mensagem aparece no centro da tela de {partner.name.split(" ")[0]} e fica lá até a confirmação.</p>
                </div>
              ) : (
                <ol className="space-y-1.5">
                  {messages.map((message, index) => {
                    const previous = messages[index - 1];
                    const grouped = previous && previous.mine === message.mine && new Date(message.createdAt) - new Date(previous.createdAt) < 5 * 60 * 1000;
                    return (
                      <Bubble
                        key={message.id}
                        message={message}
                        grouped={grouped}
                        animate={!reduced && animateFromRef.current.has(message.id)}
                      />
                    );
                  })}
                </ol>
              )}
            </div>

            <form
              className="flex shrink-0 items-end gap-2 border-t border-line bg-white p-2"
              onSubmit={(event) => { event.preventDefault(); send(); }}
            >
              <label htmlFor="supervision-dock-input" className="sr-only">Mensagem</label>
              <textarea
                id="supervision-dock-input"
                ref={textareaRef}
                rows={1}
                value={draft}
                maxLength={2000}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    send();
                  }
                }}
                placeholder="Escreva uma mensagem…"
                className="min-h-10 flex-1 resize-none rounded-control bg-mist/60 px-3 py-2.5 text-base leading-5 text-ink outline-none transition-[box-shadow] duration-150 placeholder:text-faint focus:ring-2 focus:ring-brand/20 sm:text-sm"
              />
              <Button type="submit" size="icon" disabled={!draft.trim() || sending} aria-label="Enviar mensagem" className="!h-10 !min-h-10 !w-10 !min-w-10">
                <SendHorizontal className="h-4 w-4" aria-hidden="true" />
              </Button>
            </form>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}

function Bubble({ message, grouped, animate }) {
  const isAck = message.kind === "ack";
  const mine = message.mine;
  return (
    <motion.li
      className={cx("flex flex-col", mine ? "items-end" : "items-start", !grouped && "pt-1.5")}
      initial={animate ? { opacity: 0, y: 6, scale: 0.98 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.2, ease: EASE }}
    >
      {isAck && !mine ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1.5 text-sm font-semibold text-success">
          <CheckCheck className="h-4 w-4" aria-hidden="true" />
          OK
        </span>
      ) : (
        <p
          className={cx(
            "max-w-[85%] whitespace-pre-wrap break-words rounded-card px-3 py-2 text-sm leading-relaxed",
            mine ? "rounded-br-chip bg-navy text-white" : "rounded-bl-chip border border-line bg-white text-ink",
            message.state === "failed" && "opacity-70"
          )}
        >
          {message.body}
        </p>
      )}
      <span className="mt-0.5 flex items-center gap-1.5 px-1 text-[10px] text-muted">
        <time dateTime={message.createdAt}>{formatSupervisionTime(message.createdAt)}</time>
        {mine && message.kind === "message" ? <><span aria-hidden="true">·</span><MessageState state={message.state} /></> : null}
        {!mine && isAck ? <span>confirmou</span> : null}
      </span>
      {message.state === "failed" && message.error ? <span className="px-1 text-[10px] text-danger">{message.error}</span> : null}
    </motion.li>
  );
}

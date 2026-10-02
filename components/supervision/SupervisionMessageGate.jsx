"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, SendHorizontal } from "lucide-react";
import Avatar from "@/components/Avatar";
import Button from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { usePrefersReducedMotion } from "@/components/motion/usePrefersReducedMotion";
import { isNewClientSoundEnabled, playNewClientSound } from "@/lib/new-client-sound";
import { formatSupervisionTime, useSupervisionRealtime } from "./useSupervisionRealtime";

const EASE = [0.2, 0, 0, 1];
const DONE_HOLD_MS = 750;

// Mensagem do dia e Reconhecimento são experiências de tela cheia com tempo
// próprio: o balão espera elas terminarem em vez de empilhar por cima.
function hasCompetingOverlay() {
  if (typeof document === "undefined") return false;
  // [data-alert-important]: alerta Importante da Central de Alertas aberto — a Supervisão espera ele ser confirmado.
  return Boolean(document.querySelector('[aria-modal="true"][aria-label="Reconhecimento"], [aria-modal="true"][aria-label="Mensagem do dia"], [data-alert-important="true"]'));
}

// Área realmente visível (desconta o teclado virtual no celular) — o balão
// fica centralizado nela, sem o layout pular quando o teclado abre.
function useVisualViewportBox(active) {
  const [box, setBox] = useState(null);
  useLayoutEffect(() => {
    if (!active || typeof window === "undefined" || !window.visualViewport) return undefined;
    const viewport = window.visualViewport;
    const update = () => setBox({ top: viewport.offsetTop, height: viewport.height });
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [active]);
  return box;
}

// Balão central da supervisão (global, montado em app/admin/layout.jsx).
// Mostra UMA mensagem pendente por vez ("1 de 3") e só sai com OK ou com uma
// resposta — sem X, sem fechar clicando fora, ESC não descarta. A fila vem
// sempre do banco (/api/admin/supervision-messages/pending), então a
// pendência volta depois de recarregar, trocar de aba ou entrar de novo.
export default function SupervisionMessageGate({ userId }) {
  const [queue, setQueue] = useState([]);
  const [topic, setTopic] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [done, setDone] = useState(null); // { id, kind: "ack" | "reply" }
  // Quantas desta "rodada" já foram respondidas — para mostrar "2 de 3" em
  // vez de recomeçar em "1 de 2". Zera quando a fila esvazia.
  const [answered, setAnswered] = useState(0);
  const knownIdsRef = useRef(null);
  const doneRef = useRef(null);
  doneRef.current = done;
  const queueRef = useRef(queue);
  queueRef.current = queue;

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await fetch("/api/admin/supervision-messages/pending", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json().catch(() => null);
      if (!data) return;
      setTopic(data.topic || "");
      const incoming = data.messages || [];

      const firstLoad = knownIdsRef.current === null;
      const known = knownIdsRef.current || new Set();
      const hasNew = incoming.some((message) => !known.has(message.id));
      knownIdsRef.current = new Set([...known, ...incoming.map((message) => message.id)]);
      if (!firstLoad && hasNew && isNewClientSoundEnabled(userId)) playNewClientSound();

      setQueue((current) => {
        // Mantém a mensagem que está terminando a animação de confirmação.
        const finishing = doneRef.current ? current.find((message) => message.id === doneRef.current.id) : null;
        const next = incoming.filter((message) => message.id !== finishing?.id);
        return finishing ? [finishing, ...next] : next;
      });
    } catch {
      // Falha pontual de rede — a próxima leitura (tempo real, foco ou
      // intervalo de segurança) tenta de novo.
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);
  useSupervisionRealtime(topic, load);

  const active = queue[0] || null;

  // Espera Mensagem do dia / Reconhecimento saírem da tela.
  useEffect(() => {
    if (!active) return undefined;
    const check = () => setBlocked(hasCompetingOverlay());
    check();
    const intervalId = setInterval(check, 2500);
    return () => clearInterval(intervalId);
  }, [active]);

  const visible = Boolean(active) && !blocked;

  const advance = useCallback((id) => {
    setDone(null);
    const rest = queueRef.current.filter((message) => message.id !== id);
    setAnswered((value) => (rest.length ? value + 1 : 0));
    setQueue((current) => current.filter((message) => message.id !== id));
  }, []);

  return (
    <SupervisionOverlay
      visible={visible}
      message={active}
      position={answered + 1}
      total={answered + queue.length}
      done={done && done.id === active?.id ? done : null}
      onDone={(kind) => setDone({ id: active.id, kind })}
      onAlreadyAnswered={() => advance(active.id)}
      onFinished={() => advance(active.id)}
    />
  );
}

export function SupervisionOverlay({ visible, message, position, total, done, onDone, onAlreadyAnswered, onFinished }) {
  const reduced = usePrefersReducedMotion();
  const box = useVisualViewportBox(visible);
  const cardRef = useRef(null);
  const [nudge, setNudge] = useState(0);

  // Trava a rolagem do fundo enquanto o balão está aberto.
  useEffect(() => {
    if (!visible) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [visible]);

  // ESC não descarta; Tab circula só dentro do balão.
  useEffect(() => {
    if (!visible) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setNudge((value) => value + 1);
        return;
      }
      if (event.key !== "Tab" || !cardRef.current) return;
      const focusable = [...cardRef.current.querySelectorAll("button:not([disabled]), textarea:not([disabled])")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!cardRef.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [visible]);

  const style = box ? { top: box.top, height: box.height } : undefined;

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="supervision-overlay"
          className={cx("fixed inset-x-0 z-[300] flex items-center justify-center px-4 py-4", !box && "inset-y-0")}
          style={style}
          role="dialog"
          aria-modal="true"
          aria-labelledby="supervision-message-title"
          data-supervision-card="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.22, ease: EASE }}
        >
          <div
            className="absolute inset-0 bg-navy/35 backdrop-blur-[3px]"
            aria-hidden="true"
            onPointerDown={(event) => { event.preventDefault(); setNudge((value) => value + 1); }}
          />
          <AnimatePresence mode="wait" initial>
            {message ? (
              <SupervisionCard
                key={message.id}
                ref={cardRef}
                message={message}
                position={position}
                total={total}
                done={done}
                nudge={nudge}
                reduced={reduced}
                onDone={onDone}
                onAlreadyAnswered={onAlreadyAnswered}
                onFinished={onFinished}
              />
            ) : null}
          </AnimatePresence>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// React 19: `ref` chega como prop comum.
function SupervisionCard({ ref, message, position, total, done, nudge, reduced, onDone, onAlreadyAnswered, onFinished }) {
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(""); // "ack" | "reply" | ""
  const [error, setError] = useState("");
  const textareaRef = useRef(null);
  const okRef = useRef(null);
  const seenRef = useRef(false);
  const sender = message.sender || {};

  // Foco inicial no OK (resposta mais comum) sem abrir o teclado no celular.
  useEffect(() => {
    const id = setTimeout(() => okRef.current?.focus({ preventScroll: true, focusVisible: false }), reduced ? 0 : 240);
    return () => clearTimeout(id);
  }, [reduced]);

  // Apareceu na tela = visto.
  useEffect(() => {
    if (seenRef.current || message.seenAt) return;
    seenRef.current = true;
    fetch(`/api/admin/supervision-messages/${message.id}/seen`, { method: "POST" }).catch(() => {});
  }, [message.id, message.seenAt]);

  // Depois da confirmação animada, segue para a próxima.
  useEffect(() => {
    if (!done) return undefined;
    const id = setTimeout(onFinished, reduced ? 250 : DONE_HOLD_MS);
    return () => clearTimeout(id);
  }, [done, onFinished, reduced]);

  // Textarea cresce até 4 linhas.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 112)}px`;
  }, [reply]);

  async function respond(action) {
    if (sending || done) return;
    const body = action === "reply" ? reply.trim() : "";
    if (action === "reply" && !body) {
      textareaRef.current?.focus();
      return;
    }
    setSending(action);
    setError("");
    try {
      const response = await fetch(`/api/admin/supervision-messages/${message.id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, body })
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 409) {
        onAlreadyAnswered();
        return;
      }
      if (!response.ok) throw new Error(data.error || "Não foi possível enviar. Tente de novo.");
      onDone(action);
    } catch (requestError) {
      setError(requestError.message || "Não foi possível enviar. Tente de novo.");
    } finally {
      setSending("");
    }
  }

  const motionProps = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.12 } }
    : {
        initial: { opacity: 0, y: 14, scale: 0.97 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: -10, scale: 0.98 },
        transition: { duration: 0.26, ease: EASE }
      };

  return (
    <motion.div ref={ref} className="relative flex max-h-full w-full max-w-[400px] flex-col" {...motionProps}>
      <motion.div
        key={nudge}
        animate={nudge && !reduced ? { scale: [1, 1.018, 1] } : undefined}
        transition={{ duration: 0.28, ease: EASE }}
        className="relative flex max-h-full min-h-0 flex-col overflow-hidden rounded-panel border border-line bg-white shadow-float"
      >
        <div className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-5">
          <Avatar name={sender.name} photoUrl={sender.photoUrl} size={44} />
          <div className="min-w-0 flex-1">
            <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-brand">Mensagem da supervisão</p>
            <h2 id="supervision-message-title" className="truncate text-[15px] font-semibold text-ink">{sender.name || "Supervisão"}</h2>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
            <span className="text-xs text-muted">{formatSupervisionTime(message.createdAt)}</span>
            {total > 1 ? (
              <span className="rounded-chip bg-info-soft px-1.5 py-0.5 text-2xs font-semibold tabular-nums text-info" aria-label={`Mensagem ${position} de ${total}`}>
                {position} de {total}
              </span>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">
          <p className="whitespace-pre-wrap break-words rounded-card bg-mist/70 px-4 py-3 text-[15px] leading-relaxed text-ink">
            {message.body}
          </p>
        </div>

        <div className="shrink-0 space-y-3 px-5 pb-5 pt-4">
          <Button ref={okRef} block size="lg" onClick={() => respond("ack")} loading={sending === "ack"} disabled={Boolean(sending) || Boolean(done)}>
            OK
          </Button>
          <form
            className="flex items-end gap-2 rounded-control border border-line bg-white p-1.5 pl-3 transition-[border-color,box-shadow] duration-150 ease-out-ui focus-within:border-brand/50 focus-within:ring-2 focus-within:ring-brand/15"
            onSubmit={(event) => { event.preventDefault(); respond("reply"); }}
          >
            <label htmlFor={`supervision-reply-${message.id}`} className="sr-only">Responder</label>
            <textarea
              id={`supervision-reply-${message.id}`}
              ref={textareaRef}
              rows={1}
              value={reply}
              maxLength={2000}
              onChange={(event) => setReply(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  respond("reply");
                }
              }}
              placeholder="Responder..."
              disabled={Boolean(sending) || Boolean(done)}
              className="min-h-9 flex-1 resize-none bg-transparent py-2 text-base leading-5 text-ink outline-none placeholder:text-faint sm:text-sm"
            />
            <Button
              type="submit"
              variant={reply.trim() ? "primary" : "secondary"}
              size="sm"
              loading={sending === "reply"}
              disabled={Boolean(sending) || Boolean(done) || !reply.trim()}
              aria-label="Enviar resposta"
              className="!min-h-9"
            >
              <SendHorizontal className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Enviar</span>
            </Button>
          </form>
          {error ? <p className="text-xs font-medium text-danger" role="alert">{error}</p> : null}
        </div>

        <AnimatePresence>
          {done ? (
            <motion.div
              key="done"
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/95"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: reduced ? 0 : 0.18, ease: EASE }}
              role="status"
            >
              <motion.span
                className="flex h-14 w-14 items-center justify-center rounded-full bg-success-strong text-white"
                initial={reduced ? false : { scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.28, ease: [0.34, 1.56, 0.64, 1] }}
              >
                <Check className="h-7 w-7" strokeWidth={2.5} aria-hidden="true" />
              </motion.span>
              <p className="text-sm font-semibold text-ink">{done.kind === "ack" ? "Confirmado" : "Resposta enviada"}</p>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

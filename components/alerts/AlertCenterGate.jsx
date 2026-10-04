"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Bell, Clock, X } from "lucide-react";
import Button from "@/components/ui/Button";
import { useSupervisionRealtime } from "@/components/supervision/useSupervisionRealtime";
import { INFORMATIVE_MAX_VISIBLE, INFORMATIVE_TIMING, alertLink, enqueueInformative } from "@/lib/crm-alerts-core.mjs";

// Central de Alertas — camada ÚNICA de alertas na tela (pedido do dono,
// 2026-10-02; especificação do designer-crm, arquitetura em lib/crm-alerts.js).
//  - INFORMATIVO: sobe pela lateral (de baixo até ~60% da altura), fica ~5 s e
//    some; não bloqueia; fila (3 no computador, 2 no celular).
//  - IMPORTANTE: <dialog> modal nativo (acima de gavetas/Sheet), fundo
//    bloqueado, Esc não fecha, só sai com "Entendi" (ciência no servidor).
// Convive com Supervisão / Reconhecimento / Mensagem do dia: o Importante
// espera eles fecharem, e a Supervisão espera o Importante
// ([data-alert-important] em SupervisionMessageGate). Nunca dois bloqueantes.

const FALLBACK_MS = 60000;

function hasCompetingBlockingLayer() {
  if (typeof document === "undefined") return false;
  return Boolean(document.querySelector('[data-supervision-card="true"], [aria-modal="true"][aria-label="Reconhecimento"], [aria-modal="true"][aria-label="Mensagem do dia"]'));
}

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}

async function postJson(url, body) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Falha");
  return data;
}

export default function AlertCenterGate({ userId }) {
  const [topic, setTopic] = useState("");
  const [important, setImportant] = useState([]);
  const [queue, setQueue] = useState([]);
  const [blockedByOther, setBlockedByOther] = useState(false);
  const seenInformative = useRef(new Set());
  const shownImportant = useRef(new Set());
  const isMobile = useIsMobile();
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/alerts", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      setTopic(data.topic || "");
      setImportant(data.important || []);
      setQueue((current) => enqueueInformative(current, data.informative || [], seenInformative.current));
    } catch {
      // Sem rede: tenta de novo no próximo ping/intervalo.
    }
  }, []);

  useEffect(() => { if (userId) load(); }, [userId, load]);
  useSupervisionRealtime(userId ? topic : "", load, { fallbackMs: FALLBACK_MS });

  useEffect(() => {
    const check = () => setBlockedByOther(hasCompetingBlockingLayer());
    check();
    const id = setInterval(check, 2500);
    return () => clearInterval(id);
  }, []);

  const currentImportant = !blockedByOther ? important[0] || null : null;
  const pausedInformative = Boolean(currentImportant);
  const maxVisible = isMobile ? INFORMATIVE_MAX_VISIBLE.mobile : INFORMATIVE_MAX_VISIBLE.desktop;
  const visible = queue.slice(0, maxVisible);
  const waiting = Math.max(0, queue.length - visible.length);

  // Registra quando cada alerta APARECEU (uma vez).
  useEffect(() => {
    const ids = visible.filter((item) => !seenInformative.current.has(item.id)).map((item) => item.id);
    if (pausedInformative || !ids.length) return;
    ids.forEach((id) => seenInformative.current.add(id));
    postJson("/api/admin/alerts/shown", { ids }).catch(() => {});
  }, [visible, pausedInformative]);
  useEffect(() => {
    if (!currentImportant || shownImportant.current.has(currentImportant.id) || currentImportant.shown_at) return;
    shownImportant.current.add(currentImportant.id);
    postJson("/api/admin/alerts/shown", { ids: [currentImportant.id] }).catch(() => {});
  }, [currentImportant]);

  const dismissInformative = useCallback((id) => setQueue((current) => current.filter((item) => item.id !== id)), []);

  // openLink: "Entendi e abrir" leva ao destino do alerta (context.link, só rota interna /admin/...) depois da ciência.
  async function acknowledge(alert, openLink = false) {
    await postJson(`/api/admin/alerts/${alert.id}/ack`);
    setImportant((current) => current.filter((item) => item.id !== alert.id));
    const link = openLink ? alertLink(alert.context) : "";
    if (link) router.push(link);
  }

  if (!userId) return null;
  return (
    <>
      <InformativeStack items={visible} waiting={waiting} paused={pausedInformative} isMobile={isMobile} onDone={dismissInformative} />
      {currentImportant ? (
        <ImportantDialog key={currentImportant.id} alert={currentImportant} position={1} total={important.length} onAcknowledge={acknowledge} />
      ) : null}
    </>
  );
}

function InformativeStack({ items, waiting, paused, isMobile, onDone }) {
  const reduce = useReducedMotion();
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="false"
      data-alert-informative-stack="true"
      className={isMobile
        ? "pointer-events-none fixed inset-x-3 bottom-[calc(var(--admin-bottom-nav-space)+18dvh)] z-[70] flex flex-col-reverse gap-2"
        : "pointer-events-none fixed bottom-[40vh] right-6 z-[70] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col-reverse gap-2"}
    >
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <InformativeCard key={item.id} item={item} paused={paused} reduce={reduce} onDone={onDone} isMobile={isMobile} />
        ))}
      </AnimatePresence>
      {waiting > 0 ? (
        <span className="pointer-events-auto self-end rounded-chip bg-white px-2 py-0.5 text-2xs font-semibold text-muted shadow-float">+{waiting} avisos</span>
      ) : null}
    </div>
  );
}

function InformativeCard({ item, paused, reduce, onDone, isMobile }) {
  const [hovered, setHovered] = useState(false);
  const remaining = useRef(INFORMATIVE_TIMING.enterMs + INFORMATIVE_TIMING.visibleMs);
  const startedAt = useRef(0);

  // Tempo de exibição: pausa com o mouse em cima, com foco, aba oculta ou
  // Importante aberto — o aviso nunca some sem ter sido visto.
  useEffect(() => {
    let timer = null;
    const stopped = () => paused || hovered || document.hidden;
    const arm = () => {
      if (timer) clearTimeout(timer);
      if (stopped()) return;
      startedAt.current = Date.now();
      timer = setTimeout(() => onDone(item.id), Math.max(remaining.current, 0));
    };
    const pause = () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      remaining.current = Math.max(remaining.current - (Date.now() - startedAt.current), 2000);
    };
    const onVisibility = () => (document.hidden ? pause() : arm());
    arm();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      pause();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [paused, hovered, item.id, onDone]);

  const link = alertLink(item.context);
  const motionProps = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 0.15 } }, exit: { opacity: 0, transition: { duration: 0.15 } } }
    : {
        initial: { opacity: 0, y: "45vh" },
        animate: { opacity: 1, y: 0, transition: { duration: INFORMATIVE_TIMING.enterMs / 1000, ease: [0.16, 1, 0.3, 1] } },
        exit: { opacity: 0, y: -8, scale: 0.98, transition: { duration: INFORMATIVE_TIMING.exitMs / 1000, ease: "easeOut" } }
      };

  return (
    <motion.div
      layout={!reduce}
      {...motionProps}
      data-alert-informative="true"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      className="group pointer-events-auto flex items-start gap-3 rounded-card border border-line bg-white p-3.5 shadow-float"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-control bg-info-soft text-info" aria-hidden="true"><Bell className="h-[18px] w-[18px]" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-navy line-clamp-1">{item.title}</span>
        <span className="block text-[13px] leading-5 text-ink-2 line-clamp-2">{item.body}</span>
        {link ? <Link href={link} onClick={() => onDone(item.id)} className="mt-1 inline-block text-[13px] font-semibold text-brand hover:underline">Abrir</Link> : null}
      </span>
      <button
        type="button"
        onClick={() => onDone(item.id)}
        aria-label="Fechar aviso"
        className={`grid size-8 shrink-0 place-items-center rounded-chip text-muted hover:bg-mist hover:text-navy ${isMobile ? "" : "opacity-0 focus:opacity-100 group-hover:opacity-100"}`}
      >
        <X className="h-4 w-4" />
      </button>
    </motion.div>
  );
}

function ImportantDialog({ alert, position, total, onAcknowledge }) {
  const dialogRef = useRef(null);
  const cardRef = useRef(null);
  const [state, setState] = useState("idle"); // idle | sending | error
  const reduce = useReducedMotion();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const previous = document.activeElement;
    if (!dialog.open) dialog.showModal();
    document.documentElement.classList.add("ui-sheet-open");
    // Esc não fecha: o alerta só sai com "Entendi" (e se o navegador forçar, reabre).
    const onCancel = (event) => event.preventDefault();
    const onClose = () => { if (dialogRef.current && !dialogRef.current.dataset.ack) dialogRef.current.showModal(); };
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onClose);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onClose);
      document.documentElement.classList.remove("ui-sheet-open");
      if (previous && typeof previous.focus === "function") previous.focus();
    };
  }, []);

  function nudge(event) {
    if (event.target !== dialogRef.current || reduce || !cardRef.current) return;
    cardRef.current.animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }], { duration: 200 });
  }

  const link = alertLink(alert.context);
  async function confirm(openLink = false) {
    if (state === "sending") return;
    setState("sending");
    try {
      if (dialogRef.current) dialogRef.current.dataset.ack = "1";
      await onAcknowledge(alert, openLink);
      dialogRef.current?.close();
    } catch {
      if (dialogRef.current) delete dialogRef.current.dataset.ack;
      setState("error");
    }
  }

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={`alert-title-${alert.id}`}
      aria-describedby={`alert-body-${alert.id}`}
      data-alert-important="true"
      onClick={nudge}
      className="crm-alert-dialog m-auto max-h-[85dvh] w-[calc(100vw-2rem)] max-w-[420px] overflow-visible bg-transparent p-0"
    >
      <motion.div
        ref={cardRef}
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="max-h-[85dvh] overflow-auto rounded-panel bg-white p-6 shadow-float"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-2xs font-semibold uppercase tracking-wide text-warning">Alerta importante</span>
          {total > 1 ? <span className="rounded-chip bg-info-soft px-1.5 py-0.5 text-2xs font-semibold tabular-nums text-info">{position} de {total}</span> : null}
        </div>
        <span className="mt-4 grid size-11 place-items-center rounded-full bg-warning-soft text-warning" aria-hidden="true"><Clock className="h-[22px] w-[22px]" /></span>
        <h2 id={`alert-title-${alert.id}`} className="mt-3 text-lg font-semibold text-navy text-balance">{alert.title}</h2>
        <p id={`alert-body-${alert.id}`} className="mt-2 text-[15px] leading-6 text-ink-2">{alert.body}</p>
        {state === "error" ? <p role="alert" className="mt-3 text-xs text-danger">Não foi possível confirmar. Tente de novo.</p> : null}
        <Button size="lg" block className="mt-5" loading={state === "sending"} onClick={() => confirm(false)} autoFocus data-alert-ack="true">
          {state === "sending" ? "Confirmando…" : state === "error" ? "Tentar de novo" : "Entendi"}
        </Button>
        {link ? (
          <Button size="lg" block variant="secondary" className="mt-2" disabled={state === "sending"} onClick={() => confirm(true)} data-alert-open="true">
            Entendi e abrir
          </Button>
        ) : null}
      </motion.div>
    </dialog>
  );
}

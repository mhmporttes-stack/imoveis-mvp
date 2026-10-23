"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Info, X } from "lucide-react";
import { formatSupervisionTime, useSupervisionRealtime } from "@/components/supervision/useSupervisionRealtime";
import scene from "@/components/scenes/scenes.module.css";
import { INFORMATIVE_MAX_VISIBLE, INFORMATIVE_TIMING, alertLink, enqueueInformative } from "@/lib/crm-alerts-core.mjs";
import CooledClientPhone from "@/components/cooled/CooledClientPhone";
import { COOLED_ALERT_TYPE, COOLED_NO_RESPONSE_REASON, COOLED_REASON_MIN_LENGTH, isValidCooledText } from "@/lib/cooled-clients-core.mjs";
import { HENRY_NOTICE_DONE_EVENT, HENRY_NOTICE_ITEMS_EVENT, HENRY_VOICE_NOTICES_EVENT } from "@/lib/henry-voice-client-alerts-core.mjs";
import { heldWhileHenryOpen } from "@/lib/henry-fullscreen-signal.mjs";
import { useHenryFullscreen } from "@/components/henry/useHenryFullscreen";

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
const HENRY_CLOSE_RECHECK_MS = 400;

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
  // Avisos só por voz (HENRY-1, dono 2026-10-23): com o Henry do DONO ativo nesta página (ele avisa por
  // HENRY_VOICE_NOTICES_EVENT; só o dono tem o Henry), o INFORMATIVO não vira card — vai para o Henry, que chama e conta.
  // O IMPORTANTE (bloqueia o CRM) não muda. Henry desligado/fechado/mudo/fora do horário → os guardados voltam como card.
  // "Visto" continua pelo mesmo caminho da tela (/api/admin/alerts/shown), feito pelo Henry depois de falar.
  const voiceModeRef = useRef(typeof window !== "undefined" && window.__mmHenryVoiceNotices?.active === true);
  const heldRef = useRef(new Map());

  const showHeld = useCallback((ids = null) => {
    const items = [...heldRef.current.values()].filter((item) => !ids || ids.includes(item.id));
    items.forEach((item) => heldRef.current.delete(item.id));
    if (items.length) setQueue((current) => enqueueInformative(current, items, seenInformative.current));
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/alerts", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      setTopic(data.topic || "");
      setImportant(data.important || []);
      const informative = data.informative || [];
      if (voiceModeRef.current) {
        const fresh = informative.filter((item) => item?.id && !seenInformative.current.has(item.id) && !heldRef.current.has(item.id));
        fresh.forEach((item) => heldRef.current.set(item.id, item));
        const held = [...heldRef.current.values()];
        if (held.length) window.dispatchEvent(new CustomEvent(HENRY_NOTICE_ITEMS_EVENT, { detail: { items: held.map((item) => ({ id: item.id, created_at: item.created_at })) } }));
      } else setQueue((current) => enqueueInformative(current, informative, seenInformative.current));
    } catch {
      // Sem rede: tenta de novo no próximo ping/intervalo.
    }
  }, []);

  useEffect(() => {
    const onMode = (event) => {
      const active = event?.detail?.active === true;
      if (active === voiceModeRef.current) return;
      voiceModeRef.current = active;
      if (active) load();
      else showHeld();
    };
    const onDone = (event) => {
      const ids = Array.isArray(event?.detail?.ids) ? event.detail.ids : [];
      if (event?.detail?.release) {
        showHeld(ids);
        return;
      }
      ids.forEach((id) => {
        heldRef.current.delete(id);
        seenInformative.current.add(id);
      });
    };
    window.addEventListener(HENRY_VOICE_NOTICES_EVENT, onMode);
    window.addEventListener(HENRY_NOTICE_DONE_EVENT, onDone);
    return () => {
      window.removeEventListener(HENRY_VOICE_NOTICES_EVENT, onMode);
      window.removeEventListener(HENRY_NOTICE_DONE_EVENT, onDone);
    };
  }, [load, showHeld]);

  useEffect(() => { if (userId) load(); }, [userId, load]);
  useSupervisionRealtime(userId ? topic : "", load, { fallbackMs: FALLBACK_MS });

  useEffect(() => {
    const check = () => setBlockedByOther(hasCompetingBlockingLayer());
    check();
    const id = setInterval(check, 2500);
    return () => clearInterval(id);
  }, []);

  // Tela cheia do Henry aberta (dono, 2026-10-23): o Importante espera na fila (`important`) e aparece quando ela fecha;
  // "apareceu" (/shown) só é registrado quando ele de fato aparece. Ao fechar, segura mais um instante e confere de novo:
  // se o balão da Supervisão voltou junto, ele vai primeiro (os dois se esperam — voltar no mesmo quadro faria piscar).
  const henryOpen = useHenryFullscreen();
  const [henryHold, setHenryHold] = useState(false);
  useEffect(() => {
    if (henryOpen) {
      setHenryHold(true);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setBlockedByOther(hasCompetingBlockingLayer());
      setHenryHold(false);
    }, HENRY_CLOSE_RECHECK_MS);
    return () => window.clearTimeout(timer);
  }, [henryOpen]);
  const currentImportant = !blockedByOther ? heldWhileHenryOpen(important[0], henryOpen || henryHold) : null;
  const pausedInformative = Boolean(currentImportant);
  // Visual novo (2026-10-22): no celular, 1 aviso por vez logo acima da barra inferior (a fila continua igual).
  const maxVisible = isMobile ? 1 : INFORMATIVE_MAX_VISIBLE.desktop;
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
  async function acknowledge(alert, openLink = false, reasonText = "", quickReason = "") {
    // Cliente que esfriou (2026-10-16): a janela só sai com o motivo escrito ou com a opção pronta "Cliente não
    // respondeu mais" (que transfere direto pela roleta) — o servidor dá a ciência.
    if (alert.context?.type === COOLED_ALERT_TYPE) {
      try {
        await postJson(`/api/admin/cooled-clients/${alert.context.case_id}/reason`, quickReason ? { quickReason } : { text: reasonText });
      } catch (error) {
        load(); // caso encerrado no meio (cliente mudou de responsável/situação): a fila atualiza e mostra o próximo
        throw error;
      }
    } else await postJson(`/api/admin/alerts/${alert.id}/ack`);
    setImportant((current) => current.filter((item) => item.id !== alert.id));
    // FUN-15e (dono, 2026-10-16): o servidor manda UM cliente que esfriou por vez; concluído este, busca o próximo da fila.
    if (alert.context?.type === COOLED_ALERT_TYPE) load();
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
        ? "pointer-events-none fixed inset-x-3 bottom-[calc(var(--admin-bottom-nav-space,72px)+12px)] z-[70] flex flex-col-reverse gap-2"
        : "pointer-events-none fixed bottom-[40vh] right-6 z-[70] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col-reverse gap-2"}
    >
      <AnimatePresence initial={false}>
        {items.map((item, index) => (
          <InformativeCard key={item.id} item={item} paused={paused} reduce={reduce} onDone={onDone} isMobile={isMobile} waiting={index === 0 ? waiting : 0} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function InformativeCard({ item, paused, reduce, onDone, isMobile, waiting = 0 }) {
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
        // Visual novo (2026-10-22): entra pela direita; a barra embaixo mostra os ~5 s (para junto com o tempo).
        initial: { opacity: 0, x: 60 },
        animate: { opacity: 1, x: 0, transition: { duration: INFORMATIVE_TIMING.enterMs / 1000, ease: [0.2, 0.8, 0.2, 1] } },
        exit: { opacity: 0, x: 40, transition: { duration: INFORMATIVE_TIMING.exitMs / 1000, ease: "easeOut" } }
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
      className={`${scene.theme} ${scene.toast} group pointer-events-auto`}
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        <span className={scene.toastIcon} aria-hidden="true"><Info className="h-[18px] w-[18px]" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={scene.kicker}>Informativo</span>
            {waiting > 0 ? <span className={`tabular-nums ${scene.counter}`}>+{waiting} {waiting === 1 ? "aviso" : "avisos"}</span> : null}
          </span>
          <span className={`mt-0.5 block text-sm font-extrabold line-clamp-1 ${scene.title}`}>{item.title}</span>
          <span className={`block text-[13px] leading-5 line-clamp-2 ${scene.text2}`}>{item.body}</span>
          {link ? <Link href={link} onClick={() => onDone(item.id)} className={`mt-1 inline-block text-[13px] hover:underline ${scene.link}`}>Abrir</Link> : null}
        </span>
        <button
          type="button"
          onClick={() => onDone(item.id)}
          aria-label="Fechar aviso"
          className={`grid size-8 shrink-0 place-items-center rounded-full ${scene.toastClose} ${isMobile ? "" : "opacity-0 focus:opacity-100 group-hover:opacity-100"}`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <span
        aria-hidden="true"
        className={`${scene.toastBar} ${paused || hovered ? scene.toastBarPaused : ""}`}
        style={{ "--toast-ms": `${INFORMATIVE_TIMING.enterMs + INFORMATIVE_TIMING.visibleMs}ms` }}
      />
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
  const cooled = alert.context?.type === COOLED_ALERT_TYPE;
  const [reason, setReason] = useState("");
  // Opção pronta "Cliente não respondeu mais" (regra do dono, 2026-10-16): 1 clique escolhe; o botão principal confirma.
  const [noResponse, setNoResponse] = useState(false);
  const [errorText, setErrorText] = useState("");
  async function confirm(openLink = false) {
    if (state === "sending") return;
    if (cooled && !noResponse && !isValidCooledText(reason)) {
      setErrorText(`Escreva o motivo com pelo menos ${COOLED_REASON_MIN_LENGTH} letras.`);
      setState("error");
      return;
    }
    setState("sending");
    try {
      if (dialogRef.current) dialogRef.current.dataset.ack = "1";
      await onAcknowledge(alert, openLink, reason, cooled && noResponse ? COOLED_NO_RESPONSE_REASON.key : "");
      dialogRef.current?.close();
    } catch (error) {
      if (dialogRef.current) delete dialogRef.current.dataset.ack;
      setErrorText(cooled ? error?.message || "" : "");
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
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
        transition={reduce ? { duration: 0.15 } : { duration: 0.45, ease: [0.2, 0.9, 0.3, 1.1] }}
        className={`${scene.theme} ${scene.dialogCard} max-h-[85dvh] overflow-auto`}
      >
        {/* Visual novo (2026-10-22): faixa vermelha no topo + selo IMPORTANTE; comportamento de bloqueio igual. */}
        <div className={scene.badRail} aria-hidden="true" />
        <div className="px-6 pb-6 pt-5">
          <div className="flex items-center gap-2.5">
            <span className={scene.importantSeal}>IMPORTANTE</span>
            {alert.created_at ? <span className={scene.note}>{formatSupervisionTime(alert.created_at)}</span> : null}
            {total > 1 ? <span className={`ml-auto tabular-nums ${scene.counter}`} aria-label={`Alerta ${position} de ${total}`}>{position} de {total}</span> : null}
          </div>
          <h2 id={`alert-title-${alert.id}`} className={`mt-3.5 text-[19px] font-extrabold leading-snug text-balance ${scene.title}`}>{alert.title}</h2>
          {cooled ? (
            <CooledReasonFields alert={alert} />
          ) : null}
          <p id={`alert-body-${alert.id}`} className={cooled ? `mt-3 text-[15px] font-semibold leading-6 ${scene.title}` : `mt-2 text-[15px] leading-6 ${scene.text2}`}>{alert.body}</p>
          {cooled ? (
            <button
              type="button"
              aria-pressed={noResponse}
              onClick={() => { setNoResponse((current) => !current); if (state === "error") setState("idle"); }}
              className={`mt-2 w-full px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand ${scene.choice} ${noResponse ? scene.choiceOn : ""}`}
              data-cooled-quick-reason="no_response"
            >
              <span className="block text-[15px] font-semibold">{COOLED_NO_RESPONSE_REASON.label}</span>
              <span className={`block text-xs ${scene.muted}`}>O cliente vai direto para a roleta, sem passar pela aprovação da gestão.</span>
            </button>
          ) : null}
          {cooled && !noResponse ? (
            <textarea
              value={reason}
              onChange={(event) => { setReason(event.target.value); if (state === "error") setState("idle"); }}
              rows={4}
              maxLength={1000}
              autoFocus
              aria-label="Motivo"
              placeholder="Outro motivo? Escreva aqui o que aconteceu com este cliente."
              className={`mt-2 p-3 text-[15px] leading-6 ${scene.field}`}
              data-cooled-reason="true"
            />
          ) : null}
          {!cooled ? <p className={`mt-3.5 ${scene.note}`}>O CRM fica bloqueado até você confirmar. A confirmação fica registrada.</p> : null}
          {state === "error" ? <p role="alert" className="mt-3 text-xs font-semibold" style={{ color: "var(--scene-bad)" }}>{errorText || "Não foi possível confirmar. Tente de novo."}</p> : null}
          <button
            type="button"
            className={`mt-4 w-full ${scene.btn} ${scene.btnPrimary}`}
            disabled={state === "sending"}
            aria-busy={state === "sending" || undefined}
            onClick={() => confirm(false)}
            autoFocus={!cooled}
            data-alert-ack="true"
          >
            {state === "sending" ? <span className={scene.spinner} aria-hidden="true" /> : null}
            {cooled ? (state === "sending" ? "Enviando…" : noResponse ? "Transferir para a roleta" : "Enviar motivo") : state === "sending" ? "Confirmando…" : state === "error" ? "Tentar de novo" : "Entendi"}
          </button>
          {link && !cooled ? (
            <button
              type="button"
              className={`mt-2 w-full ${scene.btn} ${scene.btnSecondary}`}
              disabled={state === "sending"}
              onClick={() => confirm(true)}
              data-alert-open="true"
            >
              Entendi e abrir
            </button>
          ) : null}
        </div>
      </motion.div>
    </dialog>
  );
}

// Cliente que esfriou: nome, telefone (FUN-15d), etapa e — na 2ª vez — o que a gestão pediu a mais (só o texto, sem dados extras).
function CooledReasonFields({ alert }) {
  const context = alert.context || {};
  return (
    <div className={`mt-3 px-3 py-2.5 text-[13px] leading-5 ${scene.panel}`} data-cooled-context="true">
      <p><span className={`font-semibold ${scene.title}`}>{context.client_name || "Cliente"}</span>{context.stage_label ? ` · ${context.stage_label}` : ""}</p>
      {/* Telefone para achar a conversa no celular (FUN-15d); só vem do servidor se quem vê pode acessar o cliente. */}
      {context.client_phone ? <CooledClientPhone phone={context.client_phone} className="mt-0.5" /> : null}
      <p className={scene.muted}>Mais de 3 dias sem contato e sem atividade agendada.</p>
      {context.round === 2 && context.returned_text ? (
        <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--scene-border)" }}>
          {context.first_reason ? <p><span className={`font-semibold ${scene.title}`}>Seu motivo:</span> {context.first_reason}</p> : null}
          <p className="mt-1"><span className={`font-semibold ${scene.title}`}>{context.returned_by_name || "A gestão"} pediu:</span> {context.returned_text}</p>
        </div>
      ) : null}
    </div>
  );
}

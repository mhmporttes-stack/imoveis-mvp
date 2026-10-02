"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Pencil, Reply, Smile, Trash2, X } from "lucide-react";
import { REACTION_EMOJIS } from "@/lib/whatsapp-message-actions.mjs";

// Ações por mensagem do Chat — UM componente para os 3 ambientes (app no
// celular, app no computador e navegador). Só a forma de abrir muda:
//  - toque: pressionar e segurar a mensagem (~0,45 s) abre uma folha inferior;
//  - mouse: clique com o botão direito ou no "⋯" (aparece ao passar o mouse)
//    abre um menu flutuante no ponto do clique.
// O que cada mensagem permite (responder, reagir, editar, apagar) vem pronto
// do servidor (canReply/canReact/canEdit/canDelete) — a tela nunca decide.

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;

// Liga o toque longo e o clique direito a um elemento. `open({ x, y, touch })`.
export function useMessageActionTrigger(open, enabled = true) {
  const timer = useRef(null);
  const start = useRef(null);
  const firedAt = useRef(0);

  function clear() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }

  useEffect(() => clear, []);

  if (!enabled) return {};
  return {
    onPointerDown(event) {
      if (event.pointerType === "mouse") return;
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        firedAt.current = Date.now();
        suppressNextClick();
        navigator.vibrate?.(15);
        open({ x: start.current?.x || 0, y: start.current?.y || 0, touch: true });
        clear();
      }, LONG_PRESS_MS);
    },
    onPointerMove(event) {
      if (!start.current) return;
      if (Math.abs(event.clientX - start.current.x) > MOVE_TOLERANCE_PX || Math.abs(event.clientY - start.current.y) > MOVE_TOLERANCE_PX) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onContextMenu(event) {
      event.preventDefault();
      // No Android o toque longo também dispara "contextmenu": não abre duas vezes.
      if (Date.now() - firedAt.current < 800) return;
      clear();
      open({ x: event.clientX, y: event.clientY, touch: false });
    }
  };
}

// Ao soltar o dedo depois do toque longo alguns navegadores ainda geram um
// "click": sem isto ele cairia no fundo da folha (fechando-a na hora) ou
// abriria a foto/link da mensagem.
function suppressNextClick() {
  const stop = (event) => { event.preventDefault(); event.stopPropagation(); };
  window.addEventListener("click", stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 800);
}

function useIsSheet(touch) {
  const [sheet, setSheet] = useState(true);
  useEffect(() => {
    setSheet(touch || window.matchMedia("(max-width: 767px)").matches);
  }, [touch]);
  return sheet;
}

export function MessageActionsMenu({ target, onClose, onReply, onReact, onEdit, onDelete }) {
  const { message, x, y, touch } = target;
  const sheet = useIsSheet(touch);
  const panelRef = useRef(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState({ left: x, top: y });

  useEffect(() => {
    function onKey(event) { if (event.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Menu flutuante: mantém dentro da tela.
  useEffect(() => {
    if (sheet || !panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))
    });
  }, [sheet, x, y]);

  const teamReaction = message.reactions?.find((entry) => entry.sender === "team")?.emoji || "";

  async function run(action) {
    setBusy(true);
    try { await action(); } finally { setBusy(false); }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(message.body || ""); } catch { /* sem permissão: ignora */ }
    onClose();
  }

  const itemClass = "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-bold text-navy hover:bg-mist disabled:opacity-50 md:py-2";
  const content = (
    <>
      {message.canReact ? (
        <div className="flex items-center justify-between gap-1 border-b border-line px-2 pb-2" role="group" aria-label="Reagir">
          {REACTION_EMOJIS.map((emoji) => (
            <button key={emoji} type="button" disabled={busy} onClick={() => run(async () => { await onReact(message, teamReaction === emoji ? "" : emoji); onClose(); })}
              aria-label={`Reagir com ${emoji}`} aria-pressed={teamReaction === emoji}
              className={`grid h-11 w-11 place-items-center rounded-full text-2xl transition hover:bg-mist disabled:opacity-50 md:h-9 md:w-9 md:text-xl ${teamReaction === emoji ? "bg-blue-100" : ""}`}>{emoji}</button>
          ))}
        </div>
      ) : null}
      <div className="pt-1">
        {message.canReply ? <button type="button" className={itemClass} onClick={() => { onReply(message); onClose(); }}><Reply className="h-4 w-4 text-brand" />Responder</button> : null}
        {message.body ? <button type="button" className={itemClass} onClick={copy}><Copy className="h-4 w-4 text-brand" />Copiar texto</button> : null}
        {teamReaction ? <button type="button" disabled={busy} className={itemClass} onClick={() => run(async () => { await onReact(message, ""); onClose(); })}><Smile className="h-4 w-4 text-brand" />Remover minha reação</button> : null}
        {message.canEdit ? <button type="button" className={itemClass} onClick={() => { onEdit(message); onClose(); }}><Pencil className="h-4 w-4 text-brand" />Editar</button> : null}
        {message.canDelete ? (confirmingDelete ? (
          <div className="rounded-xl bg-red-50 p-3">
            <p className="text-xs font-bold text-red-800">Apagar esta mensagem para todos? O cliente verá “Mensagem apagada”.</p>
            <div className="mt-2 flex gap-2">
              <button type="button" disabled={busy} onClick={() => run(async () => { await onDelete(message); onClose(); })} className="rounded-full bg-red-600 px-4 py-2 text-xs font-extrabold text-white disabled:opacity-50">{busy ? "Apagando…" : "Apagar para todos"}</button>
              <button type="button" disabled={busy} onClick={() => setConfirmingDelete(false)} className="rounded-full px-3 py-2 text-xs font-extrabold text-slate-600">Cancelar</button>
            </div>
          </div>
        ) : <button type="button" className={`${itemClass} text-red-700`} onClick={() => setConfirmingDelete(true)}><Trash2 className="h-4 w-4" />Apagar para todos</button>) : null}
        {!message.canReply && !message.canReact && !message.body && !message.canEdit && !message.canDelete ? <p className="px-3 py-3 text-xs font-bold text-muted">Nenhuma ação disponível para esta mensagem.</p> : null}
      </div>
    </>
  );

  if (sheet) {
    return (
      <div className="fixed inset-0 z-50 flex items-end bg-black/30" onClick={onClose} data-message-actions="sheet">
        <div role="menu" aria-label="Ações da mensagem" className="w-full rounded-t-3xl bg-white p-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl" onClick={(event) => event.stopPropagation()}>
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-300" />
          {message.body ? <p className="mb-2 line-clamp-2 px-2 text-xs font-semibold text-slate-500">{message.body}</p> : null}
          {content}
          <button type="button" onClick={onClose} className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-extrabold text-slate-500 hover:bg-mist"><X className="h-4 w-4" />Fechar</button>
        </div>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-50" onClick={onClose} onContextMenu={(event) => { event.preventDefault(); onClose(); }} data-message-actions="menu">
      <div ref={panelRef} role="menu" aria-label="Ações da mensagem" style={{ left: position.left, top: position.top }}
        className="fixed w-72 rounded-2xl border border-line bg-white p-2 shadow-xl" onClick={(event) => event.stopPropagation()}>
        {content}
      </div>
    </div>
  );
}

// Emojis mais usados no atendimento (app no computador e navegador). Na tela
// estreita do celular o botão some — o teclado do próprio celular já tem
// emojis e a linha de botões espremia o campo de texto (70 px em 360 px).
const EMOJIS = ["😀", "😁", "😂", "😊", "😉", "😍", "🥰", "😘", "🤗", "🤩", "😎", "🙂", "🤔", "😅", "😢", "😭", "😮", "😴", "🙏", "👍", "👏", "👋", "🤝", "💪", "✌️", "👌", "❤️", "💙", "💚", "🔥", "✨", "🎉", "🥳", "🏠", "🏡", "🔑", "📄", "📅", "📞", "✅", "⏰", "💰", "📍", "🚗", "☀️", "🌙"];

export function EmojiPicker({ onPick, disabled = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) { if (ref.current && !ref.current.contains(event.target)) setOpen(false); }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);
  return (
    <div ref={ref} className="relative hidden shrink-0 sm:block">
      <button type="button" disabled={disabled} onClick={() => setOpen((value) => !value)} aria-label="Emojis" aria-expanded={open}
        className="grid h-11 w-11 place-items-center rounded-full text-slate-500 transition hover:bg-mist hover:text-navy disabled:opacity-40">
        <Smile className="h-5 w-5" />
      </button>
      {open ? (
        <div role="dialog" aria-label="Escolher emoji" className="absolute bottom-12 left-0 z-30 grid w-[min(18rem,calc(100vw-2rem))] grid-cols-8 gap-0.5 rounded-2xl border border-line bg-white p-2 shadow-xl">
          {EMOJIS.map((emoji) => (
            <button key={emoji} type="button" onClick={() => onPick(emoji)} aria-label={emoji} className="grid h-9 place-items-center rounded-lg text-xl hover:bg-mist">{emoji}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

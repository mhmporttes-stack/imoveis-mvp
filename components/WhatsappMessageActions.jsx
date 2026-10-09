"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Forward, Lock, Pencil, Plus, Reply, Smile, Trash2 } from "lucide-react";
import { REACTION_EMOJIS } from "@/lib/whatsapp-message-actions.mjs";

// Ações por mensagem do Chat — UM componente para os 3 ambientes (app no
// celular, app no computador e navegador). Só a forma de abrir muda:
//  - toque: pressionar e segurar a mensagem (~0,4 s) abre o foco "estilo WhatsApp
//    do iPhone" (pedido do dono, 2026-10-09): fundo desfocado, a mensagem nítida
//    no lugar, reações em cima e cartão de ações embaixo (MessageFocusOverlay);
//  - mouse: clique com o botão direito ou no "⋯" (aparece ao passar o mouse)
//    abre um menu flutuante no ponto do clique.
// O que cada mensagem permite (responder, reagir, editar, apagar) vem pronto
// do servidor (canReply/canReact/canEdit/canDelete) — a tela nunca decide.

const LONG_PRESS_MS = 400;
const MOVE_TOLERANCE_PX = 10;

// Liga o toque longo e o clique direito a um elemento. `open({ x, y, touch })`.
export function useMessageActionTrigger(open, enabled = true) {
  const timer = useRef(null);
  const start = useRef(null);
  const node = useRef(null);
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
      node.current = event.currentTarget;
      timer.current = setTimeout(() => {
        firedAt.current = Date.now();
        suppressNextClick();
        window.getSelection?.()?.removeAllRanges();
        navigator.vibrate?.(15);
        open({ x: start.current?.x || 0, y: start.current?.y || 0, touch: true, node: node.current });
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
      open({ x: event.clientX, y: event.clientY, touch: false, node: event.currentTarget });
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
  // Só é montado depois de um gesto (no navegador), então já dá para decidir na primeira renderização.
  const [sheet] = useState(() => touch || (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches));
  return sheet;
}

export function MessageActionsMenu(props) {
  const sheet = useIsSheet(props.target.touch);
  // Celular/toque: foco estilo WhatsApp do iPhone. Computador: menu flutuante de sempre.
  // Portal no <body>: fica acima da barra inferior do celular (senão a barra cobria o fim do menu).
  const menu = sheet ? <MessageFocusOverlay {...props} /> : <MessageFloatingMenu {...props} />;
  return typeof document === "undefined" ? menu : createPortal(menu, document.body);
}

// Encaminhar e "Adicionar às notas" (2026-10-09): texto da mensagem, como no WhatsApp.
function canForward(message) {
  return Boolean(message.body) && !message.revoked;
}

function MessageFloatingMenu({ target, onClose, onReply, onReact, onEdit, onDelete, onForward, onAddNote, onReplyInternal }) {
  const { message, x, y } = target;
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
    if (!panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))
    });
  }, [x, y]);

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
        {onReplyInternal ? <button type="button" className={itemClass} onClick={() => { onReplyInternal(message); onClose(); }}><Lock className="h-4 w-4 text-brand" />Responder no interno</button> : null}
        {onForward && canForward(message) && !message.internal ? <button type="button" className={itemClass} onClick={() => { onForward(message); onClose(); }}><Forward className="h-4 w-4 text-brand" />Encaminhar</button> : null}
        {message.body ? <button type="button" className={itemClass} onClick={copy}><Copy className="h-4 w-4 text-brand" />Copiar texto</button> : null}
        {onAddNote && canForward(message) && !message.internal ? <button type="button" disabled={busy} className={itemClass} onClick={() => run(async () => { await onAddNote(message); onClose(); })}><Lock className="h-4 w-4 text-brand" />Adicionar às notas internas</button> : null}
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
        {!message.canReply && !message.canReact && !message.body && !message.canEdit && !message.canDelete && !onReplyInternal ? <p className="px-3 py-3 text-xs font-bold text-muted">Nenhuma ação disponível para esta mensagem.</p> : null}
      </div>
    </>
  );

  return (
    <div className="fixed inset-0 z-50" onClick={onClose} onContextMenu={(event) => { event.preventDefault(); onClose(); }} data-message-actions="menu">
      <div ref={panelRef} role="menu" aria-label="Ações da mensagem" style={{ left: position.left, top: position.top }}
        className="fixed w-72 rounded-2xl border border-line bg-white p-2 shadow-xl" onClick={(event) => event.stopPropagation()}>
        {content}
      </div>
    </div>
  );
}

// Foco da mensagem no celular (pedido do dono, 2026-10-09 — "igual ao WhatsApp do iPhone"): fundo inteiro
// desfocado e levemente escurecido, a própria mensagem (cópia visual do balão) nítida no lugar, a barra de
// reações acima e o cartão de ações abaixo. Só aparecem as ações que o servidor liberou para a mensagem.
// Margem das bordas; no topo soma a barra de status do iPhone (safeAreaTop).
const SAFE_GAP = 12;

function safeAreaTop() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;top:0;visibility:hidden;padding-top:env(safe-area-inset-top,0px)";
  document.body.appendChild(probe);
  const value = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return value;
}

function MessageFocusOverlay({ target, onClose, onReply, onReact, onEdit, onDelete, onForward, onAddNote, onReplyInternal }) {
  const { message, node } = target;
  const outbound = message.direction === "outbound";
  const stackRef = useRef(null);
  const bubbleRef = useRef(null);
  const [rect] = useState(() => (node?.isConnected ? node.getBoundingClientRect() : null));
  const [top, setTop] = useState(null);
  const [moreEmojis, setMoreEmojis] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const teamReaction = message.reactions?.find((entry) => entry.sender === "team")?.emoji || "";

  useEffect(() => {
    function onKey(event) { if (event.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Cópia visual do balão segurado (sem interação), com a mesma largura de antes.
  useLayoutEffect(() => {
    const holder = bubbleRef.current;
    if (!holder || !node || !rect) return undefined;
    const clone = node.cloneNode(true);
    clone.removeAttribute("data-message-id");
    clone.setAttribute("aria-hidden", "true");
    Object.assign(clone.style, { width: `${rect.width}px`, maxWidth: "none", margin: "0", pointerEvents: "none" });
    holder.appendChild(clone);
    return () => clone.remove();
  }, [node, rect]);

  // Posição: a mensagem fica onde estava; se o conjunto não couber, desliza para caber na tela.
  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;
    const height = stack.offsetHeight;
    const bubbleTop = bubbleRef.current?.offsetTop || 0;
    const viewport = Math.min(window.innerHeight, window.visualViewport?.height || window.innerHeight);
    const wanted = rect ? rect.top - bubbleTop : (viewport - height) / 2;
    // Se a mensagem está embaixo, o conjunto sobe até caber inteiro (menu nunca fica cortado).
    const minTop = SAFE_GAP + safeAreaTop();
    setTop(Math.max(minTop, Math.min(wanted, viewport - height - SAFE_GAP)));
  }, [rect, moreEmojis, confirmingDelete]);

  async function run(action) {
    setBusy(true);
    try { await action(); } finally { setBusy(false); }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(message.body || ""); } catch { /* sem permissão: ignora */ }
    onClose();
  }

  function react(emoji) {
    return run(async () => { await onReact(message, teamReaction === emoji ? "" : emoji); onClose(); });
  }

  const side = outbound
    ? { right: rect ? Math.max(8, window.innerWidth - rect.right) : 12, alignItems: "flex-end" }
    : { left: rect ? Math.max(8, rect.left) : 12, alignItems: "flex-start" };
  const row = "flex w-full items-center justify-between gap-6 px-4 py-3 text-left text-[15px] font-semibold text-navy active:bg-black/5 disabled:opacity-50";
  const actions = [
    message.canReply ? <button key="reply" type="button" role="menuitem" className={row} onClick={() => { onReply(message); onClose(); }}>Responder<Reply className="h-5 w-5" /></button> : null,
    onReplyInternal ? <button key="reply-internal" type="button" role="menuitem" className={row} onClick={() => { onReplyInternal(message); onClose(); }}>Responder no interno<Lock className="h-5 w-5" /></button> : null,
    onForward && canForward(message) && !message.internal ? <button key="forward" type="button" role="menuitem" className={row} onClick={() => { onForward(message); onClose(); }}>Encaminhar<Forward className="h-5 w-5" /></button> : null,
    message.body ? <button key="copy" type="button" role="menuitem" className={row} onClick={copy}>Copiar<Copy className="h-5 w-5" /></button> : null,
    onAddNote && canForward(message) && !message.internal ? <button key="note" type="button" role="menuitem" disabled={busy} className={row} onClick={() => run(async () => { await onAddNote(message); onClose(); })}>Adicionar às notas<Lock className="h-5 w-5" /></button> : null,
    message.canEdit ? <button key="edit" type="button" role="menuitem" className={row} onClick={() => { onEdit(message); onClose(); }}>Editar<Pencil className="h-5 w-5" /></button> : null,
    message.canDelete ? <button key="delete" type="button" role="menuitem" className={`${row} text-red-600`} onClick={() => setConfirmingDelete(true)}>Apagar<Trash2 className="h-5 w-5" /></button> : null
  ].filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-md [-webkit-backdrop-filter:blur(12px)]" onClick={onClose} onContextMenu={(event) => event.preventDefault()} data-message-actions="focus">
      <div ref={stackRef} role="menu" aria-label="Ações da mensagem" className="absolute flex max-w-[calc(100%-16px)] select-none flex-col gap-2 [-webkit-touch-callout:none]"
        style={{ top: top ?? -9999, ...side }} onClick={(event) => event.stopPropagation()}>
        {message.canReact ? (
          <div className="flex max-w-full flex-col rounded-[28px] bg-white/95 p-1 shadow-xl">
            <div className="flex items-center gap-0.5" role="group" aria-label="Reagir">
              {REACTION_EMOJIS.map((emoji) => (
                <button key={emoji} type="button" disabled={busy} onClick={() => react(emoji)} aria-label={`Reagir com ${emoji}`} aria-pressed={teamReaction === emoji}
                  className={`grid h-11 w-11 place-items-center rounded-full text-[26px] transition active:scale-110 disabled:opacity-50 ${teamReaction === emoji ? "bg-slate-200" : ""}`}>{emoji}</button>
              ))}
              <button type="button" onClick={() => setMoreEmojis((value) => !value)} aria-label="Mais emojis" aria-expanded={moreEmojis}
                className="grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-600"><Plus className="h-5 w-5" /></button>
            </div>
            {moreEmojis ? (
              <div className="grid max-h-40 grid-cols-8 gap-0.5 overflow-y-auto border-t border-line p-1" role="group" aria-label="Escolher emoji">
                {EMOJIS.map((emoji) => (
                  <button key={emoji} type="button" disabled={busy} onClick={() => react(emoji)} aria-label={`Reagir com ${emoji}`} className="grid h-9 place-items-center rounded-lg text-xl active:bg-mist disabled:opacity-50">{emoji}</button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {rect ? <div ref={bubbleRef} className="max-h-[30dvh] overflow-hidden rounded-lg" /> : message.body ? (
          <p ref={bubbleRef} className="line-clamp-4 max-w-[80vw] rounded-lg bg-white px-3 py-2 text-sm text-[#111B21] shadow">{message.body}</p>
        ) : null}
        <div className="w-60 overflow-hidden rounded-2xl bg-white/85 shadow-xl backdrop-blur-xl">
          {confirmingDelete ? (
            <div className="p-4">
              <p className="text-sm font-semibold text-navy">Apagar esta mensagem para todos? O cliente verá “Mensagem apagada”.</p>
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={busy} onClick={() => run(async () => { await onDelete(message); onClose(); })} className="rounded-full bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? "Apagando…" : "Apagar para todos"}</button>
                <button type="button" disabled={busy} onClick={() => setConfirmingDelete(false)} className="rounded-full px-3 py-2 text-sm font-bold text-slate-600">Cancelar</button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-black/10">
              {actions}
              {teamReaction ? (
                <div className="border-t-[6px] border-black/5">
                  <button type="button" role="menuitem" disabled={busy} className={row} onClick={() => run(async () => { await onReact(message, ""); onClose(); })}>Remover minha reação<Smile className="h-5 w-5" /></button>
                </div>
              ) : null}
              {!actions.length && !teamReaction ? <p className="px-4 py-3 text-sm font-semibold text-muted">Nenhuma ação disponível para esta mensagem.</p> : null}
            </div>
          )}
        </div>
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

"use client";

// Atalho de fala do Henry (REGRA OFICIAL — dono, 2026-10-25; docs/BUSINESS_RULES.md HENRY-1 "Atalho de fala"). O dono grava
// 2 teclas apertadas juntas; segurar o atalho em qualquer tela do CRM (Henry minimizado ou aberto) = ouve na hora, soltar =
// envia. Salvo no servidor (style.pttShortcut, PUT /api/admin/henry): o mesmo em todos os aparelhos. Regras (gravação,
// conflito com digitação) só em lib/henry-ptt-shortcut-core.mjs. Sem teclado (celular): só a dica do anel segurado.
import { useEffect, useRef, useState } from "react";
import { HENRY_PTT_SHORTCUT_EVENT, PTT_RECORDER_INITIAL, pttRecorderStep, pttShortcutLabel, pttTokenLabel } from "@/lib/henry-ptt-shortcut-core.mjs";

export default function HenryPttShortcutSetting({ saved = "", onSaved }) {
  const [hasKeyboard, setHasKeyboard] = useState(null);
  const [recording, setRecording] = useState(false);
  const [held, setHeld] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ tone: "", text: "" });
  const recorderRef = useRef(PTT_RECORDER_INITIAL);

  useEffect(() => {
    // Teclado físico provável = ponteiro fino (mouse/trackpad). Celular/tablet só de toque: a opção não aparece.
    const media = window.matchMedia("(any-pointer: fine)");
    const sync = () => setHasKeyboard(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const persist = async (shortcut) => {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/henry", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ style: { pttShortcut: shortcut } }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Não foi possível salvar o atalho.");
      const savedShortcut = data?.style?.pttShortcut || "";
      onSaved?.(data.style);
      // O Henry desta página passa a usar o atalho novo sem recarregar.
      window.dispatchEvent(new CustomEvent(HENRY_PTT_SHORTCUT_EVENT, { detail: { shortcut: savedShortcut } }));
      setMessage(savedShortcut ? { tone: "ok", text: `Salvo: segure ${pttShortcutLabel(savedShortcut)} para falar. Vale em todos os aparelhos com teclado.` } : { tone: "ok", text: "Atalho removido." });
    } catch (error) {
      setMessage({ tone: "error", text: error?.message || "Não foi possível salvar o atalho." });
    } finally {
      setBusy(false);
    }
  };

  // Gravando: as teclas vão só para cá (captura na janela, antes do Henry e da página).
  useEffect(() => {
    if (!recording) return undefined;
    recorderRef.current = PTT_RECORDER_INITIAL;
    setHeld([]);
    const handle = (type) => (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (type === "down" && event.repeat) return;
      const next = pttRecorderStep(recorderRef.current, { type, code: event.code });
      recorderRef.current = next;
      setHeld(next.held.length ? next.held : next.peak);
      if (!next.result) return;
      setRecording(false);
      if (!next.result.ok) {
        setMessage({ tone: "error", text: next.result.error });
        return;
      }
      persist(next.result.shortcut);
    };
    const onDown = handle("down");
    const onUp = handle("up");
    const onBlur = () => {
      setRecording(false);
      setMessage({ tone: "error", text: "Gravação cancelada. Clique em “Gravar atalho” e aperte as 2 teclas juntas." });
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", onBlur);
    };
    // persist muda a cada render; a gravação só depende de "recording".
  }, [recording]);

  if (hasKeyboard === null) return null;
  if (!hasKeyboard) {
    return (
      <p className="mt-3 max-w-2xl text-sm text-muted">
        <span className="font-black text-navy">Falar segurando:</span> segure o ícone do Henry minimizado no canto — ele ouve enquanto você segura e responde quando você solta. Toque rápido abre o Henry, como sempre.
      </p>
    );
  }

  const label = pttShortcutLabel(saved);
  return (
    <div className="mt-3 flex max-w-2xl flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-black text-navy">Atalho de fala</p>
        <p className="mt-1 text-sm text-muted">
          Segure 2 teclas juntas em qualquer tela do CRM (Henry minimizado ou aberto): ele começa a ouvir na hora e responde quando você solta. Toque rápido liga/para a escuta, como o clique. Enter e Ctrl+Shift+H continuam valendo.
        </p>
        <p className="mt-2 text-sm font-bold text-navy" aria-live="polite">
          {recording ? (held.length ? `Apertando: ${held.map(pttTokenLabel).join(" + ")}` : "Aperte as 2 teclas juntas e solte…") : label ? `Atual: ${label}` : "Nenhum atalho gravado."}
        </p>
        {message.text ? (
          <p className={`mt-1 text-sm font-bold ${message.tone === "error" ? "text-red-700" : "text-emerald-800"}`} role={message.tone === "error" ? "alert" : "status"}>
            {message.text}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setMessage({ tone: "", text: "" });
            setRecording((current) => !current);
          }}
          aria-pressed={recording}
          className="rounded-control bg-navy px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
        >
          {recording ? "Cancelar" : "Gravar atalho"}
        </button>
        {label && !recording ? (
          <button type="button" disabled={busy} onClick={() => persist("")} className="rounded-control border border-line px-5 py-2.5 text-sm font-bold text-navy disabled:opacity-60">
            Limpar
          </button>
        ) : null}
      </div>
    </div>
  );
}

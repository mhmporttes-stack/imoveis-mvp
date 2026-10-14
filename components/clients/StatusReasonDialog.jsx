"use client";

import { useEffect, useId, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import { inputClasses } from "@/components/ui/Field";
import { cx } from "@/components/ui/cx";
import { CLIENT_STATUS } from "@/lib/client-status";
import { getDoNotContactReasonOptions } from "@/lib/do-not-contact-reasons";
import { STATUS_REASON_MAX_LENGTH, STATUS_REASON_REQUIRED_MESSAGE, isValidStatusReason } from "@/lib/status-reason-core.mjs";

const DO_NOT_CONTACT_REASONS = getDoNotContactReasonOptions();

// Motivo obrigatório ao arquivar ou mover para "Não contactar" (regra do dono, 2026-10-14 — FUN-14).
// A janela não fecha clicando fora; só Cancelar (nada muda) ou Confirmar com o motivo escrito.
// O servidor repete a checagem (lib/status-reason-core.mjs) e grava o motivo na linha do tempo.
export default function StatusReasonDialog({ target, onCancel, onConfirm }) {
  const ref = useRef(null);
  const [reasonKey, setReasonKey] = useState("client_requested");
  const [reasonText, setReasonText] = useState("");
  const [touched, setTouched] = useState(false);
  const titleId = useId();
  const client = target?.client || null;
  const isDnc = target?.kind === CLIENT_STATUS.DO_NOT_CONTACT;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (target && !dialog.open) {
      setReasonKey("client_requested");
      setReasonText("");
      setTouched(false);
      dialog.showModal();
    }
    if (!target && dialog.open) dialog.close();
  }, [target]);

  const valid = isValidStatusReason(reasonText);

  return (
    <dialog ref={ref} aria-labelledby={titleId} className="ui-confirm" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
      {client ? (
        <form className="p-5 sm:p-6" onSubmit={(event) => { event.preventDefault(); setTouched(true); if (valid) onConfirm(isDnc ? reasonKey : "", reasonText.trim()); }}>
          <h2 id={titleId} className="text-base font-semibold text-ink">{isDnc ? "Não contactar novamente" : "Arquivar cliente"}</h2>
          <p className="mt-1 text-sm text-ink-2">
            {isDnc ? `Por que ${client.name || "este cliente"} não deve mais ser contactado?` : `Por que ${client.name || "este cliente"} está sendo arquivado?`} O motivo é obrigatório e fica registrado no histórico.
          </p>
          {target.note ? <p className="mt-1 text-sm text-ink-2">{target.note}</p> : null}
          {isDnc ? (
            <fieldset className="mt-4 space-y-1">
              <legend className="sr-only">Motivo</legend>
              {DO_NOT_CONTACT_REASONS.map((option) => (
                <label key={option.key} className="flex min-h-touch cursor-pointer items-center gap-3 rounded-control px-2 text-sm text-ink hover:bg-navy/[0.03]">
                  <input type="radio" name="dnc-reason" value={option.key} checked={reasonKey === option.key} onChange={() => setReasonKey(option.key)} className="h-4 w-4 accent-brand" />
                  {option.label}
                </label>
              ))}
            </fieldset>
          ) : null}
          <label className="mt-3 block text-sm font-semibold text-ink" htmlFor={`${titleId}-text`}>Escreva o motivo</label>
          <textarea
            id={`${titleId}-text`}
            className={cx(inputClasses, "mt-1 py-2")}
            rows={3}
            maxLength={STATUS_REASON_MAX_LENGTH}
            placeholder={isDnc ? "Ex.: pediu para não receber mais mensagens" : "Ex.: comprou com outra imobiliária"}
            value={reasonText}
            onChange={(event) => setReasonText(event.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={touched && !valid}
            required
          />
          {touched && !valid ? <p className="mt-1 text-xs font-semibold text-danger">{STATUS_REASON_REQUIRED_MESSAGE}</p> : null}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
            <Button type="submit" variant="danger" disabled={!valid}>{isDnc ? "Confirmar" : "Arquivar"}</Button>
          </div>
        </form>
      ) : null}
    </dialog>
  );
}

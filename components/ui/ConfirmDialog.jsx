"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Button from "./Button";

// Confirmação dentro da página (substitui window.confirm): <dialog> nativo,
// Esc/fundo = cancelar, foco volta ao gatilho. Use pelo hook:
//   const [confirmAction, confirmElement] = useConfirm();
//   if (!(await confirmAction({ title, description, confirmLabel, tone: "danger" }))) return;
//   ...render {confirmElement}
export function useConfirm() {
  const [request, setRequest] = useState(null);
  const confirmAction = useCallback((options) => new Promise((resolve) => setRequest({ ...options, resolve })), []);
  const settle = useCallback((value) => {
    setRequest((current) => {
      current?.resolve(value);
      return null;
    });
  }, []);
  return [confirmAction, <ConfirmDialog key="confirm-dialog" request={request} onSettle={settle} />];
}

function ConfirmDialog({ request, onSettle }) {
  const ref = useRef(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (request && !dialog.open) dialog.showModal();
    if (!request && dialog.open) dialog.close();
  }, [request]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={request?.description ? descriptionId : undefined}
      className="ui-confirm"
      onCancel={(event) => { event.preventDefault(); onSettle(false); }}
      onClick={(event) => { if (event.target === ref.current) onSettle(false); }}
    >
      {request ? (
        <div className="p-5 sm:p-6">
          <h2 id={titleId} className="text-base font-semibold text-ink">{request.title}</h2>
          {request.description ? <p id={descriptionId} className="mt-1.5 text-sm text-ink-2">{request.description}</p> : null}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => onSettle(false)} autoFocus>{request.cancelLabel || "Cancelar"}</Button>
            <Button variant={request.tone === "danger" ? "danger" : "primary"} onClick={() => onSettle(true)}>{request.confirmLabel || "Confirmar"}</Button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

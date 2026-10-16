"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MailWarning } from "lucide-react";
import Button from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { COOLED_REASON_MIN_LENGTH, isValidCooledText } from "@/lib/cooled-clients-core.mjs";

// Caixinha da decisora no fluxo de clientes que esfriaram (dono, 2026-10-16): NÃO é janela bloqueante. Ícone de carta
// com alerta + contador no cabeçalho (celular e computador); abre quando ela quiser. Cada caso: Transferir (roleta),
// Não transferir (status negativo, um clique) ou Devolver (uma vez). Só aparece quando há caso para decidir.
// Dados: GET /api/admin/cooled-clients/inbox (só os casos do próprio usuário); decisão: POST .../[id]/decision.

const POLL_MS = 60000;

async function postJson(url, body) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}

export default function CooledClientsInbox({ align = "end" }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [statusOptions, setStatusOptions] = useState([]);
  const [notice, setNotice] = useState("");
  const rootRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/cooled-clients/inbox", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      setItems(Array.isArray(data.items) ? data.items : []);
      setStatusOptions(Array.isArray(data.statusOptions) ? data.statusOptions : []);
    } catch {
      // Sem rede: tenta de novo no próximo intervalo.
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") load(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => { if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const done = (id, message) => {
    setItems((current) => current.filter((item) => item.id !== id));
    setNotice(message);
    load();
  };

  if (!items.length && !open) return null;
  return (
    <span ref={rootRef} className="relative inline-flex" onClick={(event) => event.stopPropagation()} data-cooled-inbox="true">
      <button
        type="button"
        onClick={() => { setOpen((value) => !value); setNotice(""); }}
        title="Clientes que esfriaram"
        aria-label={`Clientes que esfriaram (${items.length} para decidir)`}
        aria-expanded={open}
        className="relative inline-flex h-7 w-7 items-center justify-center rounded-full border border-warning/40 bg-warning-soft text-warning transition-colors duration-150 before:absolute before:-inset-1.5 before:content-[''] hover:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand lg:h-8 lg:w-8"
      >
        <MailWarning className="h-4 w-4" aria-hidden="true" />
        {items.length ? (
          <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-4 justify-center rounded-full border-2 border-white bg-red-500 px-1 text-[10px] font-black leading-3 text-white tabular-nums">{items.length}</span>
        ) : null}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Clientes que esfriaram"
          className={cx("absolute top-full z-40 mt-1.5 w-[min(94vw,24rem)] overflow-hidden rounded-2xl border border-line bg-white text-left shadow-float", align === "end" ? "right-0" : "left-0")}
        >
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-sm font-extrabold text-navy">Clientes que esfriaram</span>
            <span className="text-[11px] font-semibold text-muted">{items.length} para decidir</span>
          </div>
          {notice ? <p role="status" className="border-b border-line bg-mist px-3 py-2 text-xs font-semibold text-navy">{notice}</p> : null}
          <div className="max-h-[min(75vh,32rem)] space-y-2 overflow-y-auto p-2">
            {!items.length ? <p className="px-2 py-3 text-sm text-muted">Nenhum caso para decidir agora.</p> : null}
            {items.map((item) => <CooledCaseCard key={item.id} item={item} statusOptions={statusOptions} onDone={done} />)}
          </div>
        </div>
      ) : null}
    </span>
  );
}

function CooledCaseCard({ item, statusOptions, onDone }) {
  const [mode, setMode] = useState(""); // "" | "status" | "return"
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(body, message) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await postJson(`/api/admin/cooled-clients/${item.id}/decision`, body);
      onDone(item.id, typeof message === "function" ? message(result) : message);
    } catch (decisionError) {
      setError(decisionError.message);
      setBusy(false);
    }
  }

  const canReturn = item.actions.includes("return");
  return (
    <article className="rounded-card border border-line bg-white p-3" data-cooled-case="true">
      <p className="text-sm font-extrabold text-navy">{item.clientName}{item.stageLabel ? <span className="font-semibold text-muted"> · {item.stageLabel}</span> : null}</p>
      <p className="mt-0.5 text-xs text-muted">Mais de 3 dias sem contato por {item.brokerName}</p>
      <p className="mt-2 text-[13px] leading-5 text-ink-2"><span className="font-semibold text-navy">Motivo:</span> {item.firstReason}</p>
      {item.returnedText ? <p className="mt-1 text-[13px] leading-5 text-ink-2"><span className="font-semibold text-navy">{item.returnedByName || "Gestão"} pediu:</span> {item.returnedText}</p> : null}
      {item.secondReason ? <p className="mt-1 text-[13px] leading-5 text-ink-2"><span className="font-semibold text-navy">2ª resposta:</span> {item.secondReason}</p> : null}

      {mode === "status" ? (
        <div className="mt-3 grid grid-cols-2 gap-1.5" role="group" aria-label="Status negativo">
          {statusOptions.map((option) => (
            <button
              key={option.status}
              type="button"
              disabled={busy}
              onClick={() => decide({ action: "status", status: option.status }, `${item.clientName}: ${option.label}.`)}
              className="min-h-touch rounded-control border border-line bg-mist px-2 py-2 text-xs font-bold text-navy hover:border-brand disabled:opacity-60"
            >
              {option.label}
            </button>
          ))}
          <button type="button" disabled={busy} onClick={() => setMode("")} className="min-h-touch rounded-control px-2 py-2 text-xs font-semibold text-muted hover:text-navy">Voltar</button>
        </div>
      ) : mode === "return" ? (
        <div className="mt-3">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            maxLength={1000}
            aria-label="O que faltou"
            placeholder="Escreva o que faltou no motivo do corretor."
            className="w-full rounded-control border border-line p-2 text-[13px] leading-5 text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
          <div className="mt-1.5 flex gap-1.5">
            <Button size="sm" loading={busy} disabled={!isValidCooledText(text)} onClick={() => decide({ action: "return", text }, `${item.clientName}: devolvido ao corretor.`)}>Enviar ao corretor</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode("")}>Voltar</Button>
          </div>
          {!isValidCooledText(text) ? <p className="mt-1 text-[11px] text-muted">Pelo menos {COOLED_REASON_MIN_LENGTH} letras.</p> : null}
        </div>
      ) : (
        <div className={cx("mt-3 grid gap-1.5", canReturn ? "grid-cols-3" : "grid-cols-2")}>
          <Button size="sm" loading={busy} onClick={() => decide({ action: "transfer" }, (result) => `${item.clientName}: transferido${result.waiting ? " (aguardando um corretor on-line)" : result.toName ? ` para ${result.toName}` : ""}.`)}>Transferir</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setMode("status")}>Não transferir</Button>
          {canReturn ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => setMode("return")}>Devolver</Button> : null}
        </div>
      )}
      {error ? <p role="alert" className="mt-2 text-xs text-danger">{error}</p> : null}
    </article>
  );
}

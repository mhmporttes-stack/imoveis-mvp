"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

// Modais de "Confirmar recebimento" e "Reagendar" da previsão de recebimento da comissão.
// Usados na Agenda (atividade "Confirmar recebimento") e no Financeiro (Agenda de recebimentos).
// receipt = { saleId, clientName, propertyName, amount, expectedDate } (valor = saldo previsto).
// Ambos chamam POST /api/financeiro/<id>/receipt — idempotente no servidor; aqui o botão também
// fica travado enquanto envia, para não disparar duas vezes.

const MONEY = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function todayInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function parseMoney(value) {
  const text = String(value ?? "").replace(/[^\d,.-]/g, "");
  if (!text) return 0;
  const parsed = text.includes(",") ? Number(text.replace(/\./g, "").replace(",", ".")) : Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateKey(dateKey) {
  const [year, month, day] = String(dateKey || "").split("-");
  return year && month && day ? `${day}/${month}/${year}` : "—";
}

async function postReceipt(saleId, body) {
  const response = await fetch(`/api/financeiro/${saleId}/receipt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível concluir a operação.");
  return payload;
}

function ModalShell({ title, subtitle, onClose, onSubmit, children }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-navy/70 p-0 sm:place-items-center sm:p-4" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <form
        className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-[28px] bg-white p-6 shadow-2xl sm:rounded-[28px] md:p-8"
        onSubmit={onSubmit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-brand">{title}</p>
            <h3 className="mt-2 text-2xl font-black text-navy">{subtitle}</h3>
          </div>
          <button type="button" className="shrink-0 rounded-full border border-line p-3 text-navy transition hover:bg-mist" aria-label="Fechar" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </form>
    </div>
  );
}

function Summary({ receipt }) {
  return (
    <div className="mt-5 rounded-2xl border border-line bg-[#f8fbff] p-4">
      <p className="text-sm font-bold text-muted">{receipt.propertyName || "Imóvel não informado"}</p>
      <p className="mt-1 text-2xl font-black text-navy">{MONEY.format(receipt.amount || 0)}</p>
      <p className="text-sm font-bold text-muted">Previsão: {formatDateKey(receipt.expectedDate)}</p>
    </div>
  );
}

const inputClass = "mt-2 w-full min-h-12 rounded-2xl border border-line px-4 py-3 font-bold text-navy outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10";

export function ConfirmReceiptModal({ receipt, onClose, onDone }) {
  const [amount, setAmount] = useState(MONEY.format(receipt.amount || 0));
  const [receivedDate, setReceivedDate] = useState(todayInSaoPaulo());
  const [nextExpectedDate, setNextExpectedDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const typed = parseMoney(amount);
  const isPartial = typed > 0 && Math.round(typed * 100) < Math.round((receipt.amount || 0) * 100);
  const remaining = Math.max(0, (receipt.amount || 0) - typed);

  async function submit(event) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await postReceipt(receipt.saleId, {
        action: "confirm",
        amount: typed,
        receivedDate,
        nextExpectedDate: isPartial ? nextExpectedDate : ""
      });
      onDone?.(result);
    } catch (requestError) {
      setError(requestError.message || "Não foi possível confirmar o recebimento.");
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="Confirmar recebimento" subtitle={receipt.clientName || "Cliente"} onClose={onClose} onSubmit={submit}>
      <Summary receipt={receipt} />
      {error ? <p className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">{error}</p> : null}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="font-black text-navy">
          Valor recebido
          <input className={inputClass} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} onFocus={(event) => event.target.select()} required />
        </label>
        <label className="font-black text-navy">
          Data do recebimento
          <input type="date" className={inputClass} value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} required />
        </label>
      </div>

      {isPartial ? (
        <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-black text-navy">Recebimento parcial — saldo de {MONEY.format(remaining)} continua a receber.</p>
          <label className="mt-3 block font-black text-navy">
            Nova previsão para o saldo
            <input type="date" className={inputClass} value={nextExpectedDate} onChange={(event) => setNextExpectedDate(event.target.value)} />
          </label>
          <p className="mt-2 text-xs font-bold text-muted">Sem nova data, o saldo fica sem previsão (e sem atividade na Agenda).</p>
        </div>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button type="submit" className="premium-button-primary min-h-12 flex-1" disabled={submitting || typed <= 0}>
          {submitting ? "Confirmando..." : "Confirmar recebimento"}
        </button>
        <button type="button" className="premium-button-secondary min-h-12" onClick={onClose} disabled={submitting}>Cancelar</button>
      </div>
    </ModalShell>
  );
}

export function RescheduleReceiptModal({ receipt, onClose, onDone }) {
  const [expectedDate, setExpectedDate] = useState(receipt.expectedDate || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await postReceipt(receipt.saleId, { action: "reschedule", expectedDate });
      onDone?.(result);
    } catch (requestError) {
      setError(requestError.message || "Não foi possível reagendar o recebimento.");
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="Reagendar recebimento" subtitle={receipt.clientName || "Cliente"} onClose={onClose} onSubmit={submit}>
      <Summary receipt={receipt} />
      {error ? <p className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">{error}</p> : null}
      <label className="mt-5 block font-black text-navy">
        Nova previsão de recebimento
        <input type="date" className={inputClass} value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} required />
      </label>
      <p className="mt-2 text-xs font-bold text-muted">A venda continua pendente e o valor continua &ldquo;a receber&rdquo; — só a data muda.</p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button type="submit" className="premium-button-primary min-h-12 flex-1" disabled={submitting || !expectedDate}>
          {submitting ? "Salvando..." : "Salvar nova previsão"}
        </button>
        <button type="button" className="premium-button-secondary min-h-12" onClick={onClose} disabled={submitting}>Cancelar</button>
      </div>
    </ModalShell>
  );
}

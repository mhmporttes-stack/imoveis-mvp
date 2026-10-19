"use client";

import { useMemo, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { DEFAULT_PROPERTY_VALUE, ESTIMATE_DISCLAIMER, bandForIncome, todayInSaoPaulo } from "@/lib/financiamento-estimativa-core.mjs";
import { simulate } from "@/lib/caixa-simulator-core.mjs";
import { formatCurrencyInput } from "@/lib/property-filter-options";

// "Simulador Caixa" (dono, 2026-10-19). Só as perguntas da simulação (sem nome, telefone, e-mail; Marília/SP fixo),
// rótulos curtos e 2–3 campos por linha como o bloco "Cadastro do cliente". O resultado sai na hora do MESMO motor da
// simulação automática (lib/financiamento-estimativa-core.mjs). Não cria cliente nem lead e não envia nada.

const TYPE_OPTIONS = [
  { value: "false", label: "Só eu" },
  { value: "true", label: "Conjunta" }
];
const YES_NO = [
  { value: "false", label: "Não" },
  { value: "true", label: "Sim" }
];

const INITIAL = {
  joint: "false",
  primaryMonthlyIncome: "",
  secondaryMonthlyIncome: "",
  oldestBirthDate: "",
  fgtsThreeYears: "false",
  dependents: "false",
  firstProperty: "true",
  propertyValue: "",
  downPayment: "",
  fgtsAvailable: ""
};

// Grade regular (dono, 2026-10-19): todo campo com a mesma altura e largura da coluna, rótulo de uma linha só (mesma
// linha-base) e o mesmo espaçamento. A data não pode estourar a coluna (min-width 0 / width 100%).
const LABEL = "grid min-w-0 gap-1.5 text-xs font-extrabold text-ink sm:text-sm";
const LABEL_TEXT = "block truncate whitespace-nowrap";
const INPUT = "admin-input block !h-14 w-full min-w-0 max-w-full !px-2 !font-semibold sm:!px-4";
const ROW = "grid items-end gap-x-3";

const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const moneyWhole = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const percent = (value) => `${Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% a.a.`;

function Select({ label, value, options, onChange }) {
  return (
    <label className={LABEL}>
      <span className={LABEL_TEXT}>{label}</span>
      <select className={INPUT} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function Money({ label, value, onChange, cents = false, placeholder = "R$ 0" }) {
  return (
    <label className={LABEL}>
      <span className={LABEL_TEXT}>{label}</span>
      <input
        className={INPUT}
        type="text"
        inputMode={cents ? "decimal" : "numeric"}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(cents ? event.target.value.replace(/[^\d,.]/g, "") : formatCurrencyInput(event.target.value))}
      />
    </label>
  );
}

function Row({ label, value, strong = false }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 border-b border-blue-50 py-1.5 last:border-0">
      <dt className="min-w-0 text-xs font-bold text-muted sm:text-sm">{label}</dt>
      <dd className={`shrink-0 text-right text-sm ${strong ? "font-black text-navy" : "font-extrabold text-ink"}`}>{value}</dd>
    </div>
  );
}

// "Entrada necessária" (e a falta de entrada) não aparecem aqui (dono, 2026-10-19); o cálculo segue no motor e no voto.
function ResultCard({ title, data }) {
  return (
    <section className="min-w-0 rounded-[24px] border border-blue-100 bg-white p-4" data-result={title}>
      <h3 className="text-xs font-black uppercase tracking-[0.18em] text-brand">{title}</h3>
      <dl className="mt-2">
        <Row label="Valor do imóvel" value={`${moneyWhole(data.propertyValue)} · ${data.faixa}`} />
        <Row label="Renda considerada" value={money(data.income)} />
        <Row label="Financiado" value={money(data.financing)} />
        <Row label="Subsídio" value={moneyWhole(data.subsidy)} />
        <Row label="Pode comprar até" value={money(data.purchasePower)} strong />
        <Row label="Price · 1ª / última" value={`${money(data.priceFirstInstallment)} / ${money(data.priceLastInstallment)}`} />
        <Row label="SAC · 1ª / última" value={`${money(data.sacFirstInstallment)} / ${money(data.sacLastInstallment)}`} />
        <Row label="Prazo · taxa" value={`${data.termMonths} meses · ${percent(data.annualRate)}`} />
      </dl>
    </section>
  );
}

export default function CaixaSimulator() {
  const [answers, setAnswers] = useState(INITIAL);
  const [vote, setVote] = useState(null); // { vote, id, key }
  const [caixa, setCaixa] = useState({ income: "", financing: "", subsidy: "", firstInstallment: "" });
  const [status, setStatus] = useState({ busy: false, message: "", error: "" });
  const joint = answers.joint === "true";
  const update = (key, value) => setAnswers((current) => ({ ...current, [key]: value }));
  // Valor do imóvel no Simulador Caixa (dono, 2026-10-19): enquanto o corretor NÃO digita, o campo acompanha o TETO DA FAIXA da
  // renda (até R$ 5 mil = R$ 235 mil; até R$ 9,6 mil = R$ 400 mil; até R$ 13 mil = R$ 600 mil) e muda sozinho quando a renda
  // muda de faixa; digitado, o valor dele vale (acima do teto, aviso "fora do MCMV"). Vale só aqui: a simulação automática,
  // o Refazer e o Gerador seguem com o padrão R$ 235 mil do motor.
  const incomeTotal = Number(String(answers.primaryMonthlyIncome).replace(/\D/g, "")) + (joint ? Number(String(answers.secondaryMonthlyIncome).replace(/\D/g, "")) : 0);
  const bandCap = bandForIncome(incomeTotal)?.propertyCap || 0;
  const autoPropertyValue = formatCurrencyInput(String(bandCap || DEFAULT_PROPERTY_VALUE));
  const typedProperty = Boolean(answers.propertyValue);
  const propertyFieldValue = answers.propertyValue || autoPropertyValue;
  // As respostas que vão ao motor (e ao voto) já levam o valor efetivo do imóvel: o servidor recalcula com os MESMOS números.
  const effectiveAnswers = useMemo(() => ({ ...answers, propertyValue: answers.propertyValue || (bandCap ? autoPropertyValue : "") }), [answers, bandCap, autoPropertyValue]);
  const answersKey = JSON.stringify(effectiveAnswers);
  const result = useMemo(() => simulate(effectiveAnswers, todayInSaoPaulo()), [effectiveAnswers]);
  const currentVote = vote?.key === answersKey ? vote : null;
  const ready = Number(String(answers.primaryMonthlyIncome).replace(/\D/g, "")) > 0 && Boolean(answers.oldestBirthDate);

  async function send(method, body) {
    setStatus({ busy: true, message: "", error: "" });
    try {
      const response = await fetch("/api/admin/simulador-caixa/feedback", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível registrar.");
      return data;
    } catch (error) {
      setStatus({ busy: false, message: "", error: error.message });
      return null;
    }
  }

  async function castVote(value) {
    const data = await send("POST", { vote: value, answers: effectiveAnswers });
    if (!data) return;
    setVote({ vote: value, id: data.id, key: answersKey });
    setCaixa({ income: "", financing: "", subsidy: "", firstInstallment: "" });
    setStatus({ busy: false, message: value === "up" ? "Obrigado! Registrado que bateu com a Caixa." : "Registrado. Se quiser, informe os valores da Caixa.", error: "" });
  }

  async function sendCaixaValues() {
    const data = await send("PATCH", { id: currentVote?.id, caixa });
    if (data) setStatus({ busy: false, message: "Valores da Caixa registrados. Obrigado!", error: "" });
  }

  return (
    <section className="container-page max-w-3xl space-y-5">
      <header className="space-y-1">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Marília/SP</p>
        <h1 className="text-[clamp(1.65rem,7vw,1.875rem)] font-black leading-tight text-navy">Simulador Caixa</h1>
        <p className="text-sm text-muted">Simulação rápida. Não cria cliente nem envia nada.</p>
      </header>

      <div className="space-y-3 rounded-[24px] border border-blue-100 bg-[#F5FAFF] p-4 sm:p-5">
        <div className={`${ROW} grid-cols-2`}>
          <Select label="Simulação" value={answers.joint} options={TYPE_OPTIONS} onChange={(value) => update("joint", value)} />
          <label className={LABEL}>
            <span className={LABEL_TEXT}>Nascimento</span>
            <input className={INPUT} type="date" value={answers.oldestBirthDate} onChange={(event) => update("oldestBirthDate", event.target.value)} />
          </label>
        </div>
        <div className={`${ROW} grid-cols-2`}>
          <Money label={joint ? "Renda 1" : "Renda"} value={answers.primaryMonthlyIncome} onChange={(value) => update("primaryMonthlyIncome", value)} />
          {joint ? <Money label="Renda 2" value={answers.secondaryMonthlyIncome} onChange={(value) => update("secondaryMonthlyIncome", value)} /> : null}
        </div>
        <div className={`${ROW} grid-cols-3`}>
          <Select label="3 anos FGTS" value={answers.fgtsThreeYears} options={YES_NO} onChange={(value) => update("fgtsThreeYears", value)} />
          <Select label="Dependentes" value={answers.dependents} options={YES_NO} onChange={(value) => update("dependents", value)} />
          <Select label="1º imóvel" value={answers.firstProperty} options={[YES_NO[1], YES_NO[0]]} onChange={(value) => update("firstProperty", value)} />
        </div>
        <div className={`${ROW} grid-cols-2`}>
          <Money label="Valor do imóvel" placeholder="R$ 235.000" value={propertyFieldValue} onChange={(value) => update("propertyValue", value)} />
          <p className="self-center text-xs font-bold leading-snug text-muted">{bandCap ? (typedProperty ? `Teto da faixa: ${moneyWhole(bandCap)}` : `Teto da faixa (automático): ${moneyWhole(bandCap)}`) : "Padrão R$ 235.000"}</p>
        </div>
        <div className={`${ROW} grid-cols-2`}>
          <Money label="Entrada" value={answers.downPayment} onChange={(value) => update("downPayment", value)} />
          <Money label="FGTS" value={answers.fgtsAvailable} onChange={(value) => update("fgtsAvailable", value)} />
        </div>
      </div>

      {!ready ? (
        <p className="rounded-[20px] border border-line bg-white p-4 text-sm font-semibold text-muted">Informe a renda e a data de nascimento para ver o resultado.</p>
      ) : !result.eligible ? (
        <p className="rounded-[20px] border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-ink" data-not-eligible={result.reason}>{result.message}</p>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <ResultCard title="Imóvel novo" data={result} />
            <ResultCard title="Imóvel usado" data={{ ...result.used, propertyValue: result.propertyValue, faixa: result.used.faixa || result.faixa }} />
          </div>
          <p className="text-xs font-semibold text-muted">{ESTIMATE_DISCLAIMER}</p>

          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-xs font-bold text-muted">Bateu com a Caixa?</span>
            <button
              type="button"
              aria-label="Bateu com a Caixa"
              title="Bateu com a Caixa"
              aria-pressed={currentVote?.vote === "up"}
              disabled={status.busy || Boolean(currentVote)}
              onClick={() => castVote("up")}
              className={`grid h-11 w-11 place-items-center rounded-full border transition ${currentVote?.vote === "up" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-line bg-white text-muted hover:text-emerald-700"} disabled:cursor-default`}
            >
              <ThumbsUp className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Não bateu com a Caixa"
              title="Não bateu com a Caixa"
              aria-pressed={currentVote?.vote === "down"}
              disabled={status.busy || Boolean(currentVote)}
              onClick={() => castVote("down")}
              className={`grid h-11 w-11 place-items-center rounded-full border transition ${currentVote?.vote === "down" ? "border-red-400 bg-red-50 text-red-700" : "border-line bg-white text-muted hover:text-red-700"} disabled:cursor-default`}
            >
              <ThumbsDown className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {currentVote?.vote === "down" && currentVote.id ? (
            <div className="rounded-[20px] border border-line bg-white p-4" data-caixa-values="">
              <p className="text-xs font-bold text-muted">Opcional: valores que a Caixa deu.</p>
              <div className="mt-2 grid grid-cols-2 items-end gap-x-3 gap-y-3">
                <Money label="Renda usada" value={caixa.income} onChange={(value) => setCaixa((c) => ({ ...c, income: value }))} />
                <Money label="Financiado" value={caixa.financing} onChange={(value) => setCaixa((c) => ({ ...c, financing: value }))} />
                <Money label="Subsídio" value={caixa.subsidy} onChange={(value) => setCaixa((c) => ({ ...c, subsidy: value }))} />
                <Money cents label="1ª parcela" value={caixa.firstInstallment} onChange={(value) => setCaixa((c) => ({ ...c, firstInstallment: value }))} />
              </div>
              <button type="button" className="premium-button-secondary mt-4 w-full sm:w-auto" disabled={status.busy} onClick={sendCaixaValues}>
                {status.busy ? "Salvando..." : "Salvar valores da Caixa"}
              </button>
            </div>
          ) : null}

          {status.message ? <p className="text-xs font-bold text-emerald-700" role="status">{status.message}</p> : null}
          {status.error ? <p className="text-xs font-bold text-red-700" role="alert">{status.error}</p> : null}
        </div>
      )}
    </section>
  );
}

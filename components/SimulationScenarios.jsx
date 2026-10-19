"use client";

import { useState } from "react";
import { ChevronDown, ShieldCheck } from "lucide-react";
import Button from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { SCENARIO_ORIGIN_LABELS, scenarioDiff, scenarioHighlights } from "@/lib/simulation-scenarios-core.mjs";

// Aba "Comparar simulações" (REGRA OFICIAL — dono, 2026-10-19): cenários do cliente lado a lado (celular: cartões
// roláveis; computador: colunas), com o maior poder de compra e a menor parcela destacados, diferença em relação à
// simulação atual, selo "Conferida na Caixa" e "Usar este cenário". Componente separado para o redesenho da área.
const money = (value) => (Number(value) > 0 ? Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—");
const signed = (value) => (value ? `${value > 0 ? "+" : "−"}${Math.abs(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : "igual");
const when = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");

export default function SimulationScenarios({ registrationId }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ loading: false, error: "", schemaReady: true, current: null, items: [] });
  const [busyId, setBusyId] = useState("");
  const [confirmAction, confirmElement] = useConfirm();

  async function load() {
    setState((previous) => ({ ...previous, loading: true, error: "" }));
    try {
      const response = await fetch(`/api/admin/clients/${registrationId}/cenarios`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar os cenários.");
      setState({ loading: false, error: "", schemaReady: data.schemaReady, current: data.current, items: data.items || [] });
    } catch (error) {
      setState((previous) => ({ ...previous, loading: false, error: error.message }));
    }
  }

  function toggle() {
    if (!open) load();
    setOpen(!open);
  }

  async function useScenario(scenario) {
    const ok = await confirmAction({
      title: "Usar este cenário?",
      description: scenario.checked
        ? "Isso substitui a simulação atual pelos valores deste cenário (conferido na Caixa: o link continua liberado)."
        : "Isso substitui a simulação atual pelos valores deste cenário. Ele não foi conferido na Caixa: a conferência volta a ser obrigatória e o link fica bloqueado.",
      confirmLabel: "Usar este cenário"
    });
    if (!ok) return;
    setBusyId(scenario.id);
    try {
      const response = await fetch(`/api/admin/clients/${registrationId}/cenarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: scenario.id, confirmReplace: true })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível usar este cenário.");
      window.location.reload();
    } catch (error) {
      setState((previous) => ({ ...previous, error: error.message }));
    } finally {
      setBusyId("");
    }
  }

  const cards = [
    ...(state.current ? [{ id: "atual", origin: "atual", checked: !state.current.automatic, data: state.current.data, current: true }] : []),
    ...state.items
  ];
  const highlights = scenarioHighlights(cards);

  return (
    <section className="rounded-2xl border border-line bg-white p-4 sm:p-5">
      <button type="button" onClick={toggle} className="flex w-full items-center justify-between gap-3 text-left" aria-expanded={open}>
        <span>
          <span className="block text-base font-black text-navy">Comparar simulações</span>
          <span className="block text-sm text-muted">Valores anteriores do cliente, para escolher o melhor cenário.</span>
        </span>
        <ChevronDown className={`h-5 w-5 shrink-0 text-muted transition ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open ? (
        <div className="mt-4">
          {state.loading ? <p className="text-sm text-muted">Carregando…</p> : null}
          {state.error ? <p className="text-sm font-medium text-danger">{state.error}</p> : null}
          {!state.loading && !state.schemaReady ? <p className="mb-3 text-xs text-muted">O histórico de cenários ainda não está ativado; por enquanto aparece só a simulação atual.</p> : null}
          {!state.loading && !cards.length ? <p className="text-sm text-muted">Nenhuma simulação com valores ainda.</p> : null}
          <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 md:grid md:grid-cols-3 md:overflow-visible">
            {cards.map((card) => (
              <ScenarioCard
                key={card.id}
                card={card}
                current={state.current?.data}
                highlights={highlights}
                busy={busyId === card.id}
                onUse={card.current ? null : () => useScenario(card)}
              />
            ))}
          </div>
        </div>
      ) : null}
      {confirmElement}
    </section>
  );
}

function ScenarioCard({ card, current, highlights, busy, onUse }) {
  const diff = current && !card.current ? scenarioDiff(card.data, current) : null;
  return (
    <article className={`w-[85%] shrink-0 snap-start rounded-2xl border p-4 md:w-auto ${card.current ? "border-brand bg-info-soft" : "border-line bg-white"}`}>
      <p className="text-sm font-black text-navy">{SCENARIO_ORIGIN_LABELS[card.origin] || card.origin}</p>
      <p className="text-xs text-muted">{card.current ? "Em uso agora" : [when(card.createdAt), card.createdByEmail].filter(Boolean).join(" · ")}</p>
      <p className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${card.checked ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>
        {card.checked ? <><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Conferida na Caixa</> : "Não conferida na Caixa"}
      </p>
      {card.data.annualRate ? <p className="mt-2 text-xs text-muted">Juros {String(card.data.annualRate).replace(".", ",")}% a.a.</p> : null}
      {["novo", "usado"].map((type) => {
        const values = card.data[type];
        if (!(values?.power > 0)) return null;
        const income = type === "novo" ? card.data.inputs?.incomeNovo : card.data.inputs?.incomeUsado;
        return (
          <div key={type} className="mt-3 border-t border-line pt-3">
            <p className="text-xs font-black uppercase tracking-wide text-muted">Imóvel {type}</p>
            <p className="mt-0.5 text-xs text-ink-2">Renda: {income ? money(income) : `cadastro ${money((card.data.inputs?.primaryIncomeDeclared || 0) + (card.data.inputs?.secondaryIncomeDeclared || 0))}`}</p>
            <p className="mt-1 text-lg font-black text-navy tabular-nums">{money(values.power)}</p>
            <div className="flex flex-wrap gap-1">
              {highlights[type].bestPowerId === card.id ? <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-bold text-success">Maior poder de compra</span> : null}
              {highlights[type].lowestInstallmentId === card.id ? <span className="rounded-full bg-info-soft px-2 py-0.5 text-[11px] font-bold text-info">Menor parcela</span> : null}
            </div>
            <dl className="mt-1 grid grid-cols-2 gap-x-2 text-xs tabular-nums">
              {values.propertyValue > 0 ? <><dt className="text-muted">Valor do imóvel</dt><dd className="text-right text-ink">{money(values.propertyValue)}</dd></> : null}
              <dt className="text-muted">Financiado</dt><dd className="text-right text-ink">{money(values.price.financing || values.sac.financing)}</dd>
              <dt className="text-muted">Subsídio</dt><dd className="text-right text-ink">{money(values.price.subsidy || values.sac.subsidy)}</dd>
              <dt className="text-muted">1ª Price</dt><dd className="text-right text-ink">{money(values.price.firstInstallment)}</dd>
              <dt className="text-muted">1ª SAC</dt><dd className="text-right text-ink">{money(values.sac.firstInstallment)}</dd>
              <dt className="text-muted">Prazo</dt><dd className="text-right text-ink">{values.price.termMonths || values.sac.termMonths ? `${values.price.termMonths || values.sac.termMonths} meses` : "—"}</dd>
            </dl>
            {diff ? <p className="mt-1 text-xs text-muted">vs. atual: poder {signed(diff[type].power)} · parcela {signed(diff[type].firstInstallment)}</p> : null}
          </div>
        );
      })}
      {onUse ? <Button size="sm" variant="secondary" className="mt-3 w-full" onClick={onUse} loading={busy}>Usar este cenário</Button> : null}
    </article>
  );
}

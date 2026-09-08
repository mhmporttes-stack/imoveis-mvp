"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { coverImage } from "@/lib/format";
import { calculateFamilyIncome, parseCurrencyNumber } from "@/lib/simulation-registration-schema";
import { getRenderableSimulationModels, normalizeSimulationModels } from "@/lib/simulation-models";

export default function EmpreendimentoPresentation({ simulation, properties }) {
  const [selectedId, setSelectedId] = useState(properties[0]?.id || "");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const selected = properties.find((property) => property.id === selectedId);

  const client = useMemo(() => {
    const models = normalizeSimulationModels(simulation.simulationModels, simulation);
    const renderable = getRenderableSimulationModels({ ...simulation, simulationModels: models });
    const totals = renderable[0]?.totals || {};
    return {
      rendaTotal: calculateFamilyIncome(simulation.registration || {}),
      financiamentoAprovado: Number(totals.financing) || 0,
      subsidioMcmv: Number(totals.subsidy) || 0,
      casaPaulista: 0,
      parcelaFinanciamento: parseCurrencyNumber(simulation.firstInstallment),
      fgtsDisponivel: parseCurrencyNumber(simulation.downPaymentValue) + parseCurrencyNumber(simulation.fgtsValue),
      temDependente: Boolean(simulation.registration?.hasChildrenUnder18),
      fgtsMaisDe3Anos: Boolean(simulation.registration?.hasOverThreeYearsRegisteredWork),
      tipoRenda: simulation.registration?.primaryIncomeType || ""
    };
  }, [simulation]);

  useEffect(() => {
    if (!selectedId) return;
    let current = true;
    setLoading(true);
    setResult(null);
    fetch("/api/simular-entrada", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cliente: client, propertyIds: [selectedId] })
    })
      .then((response) => response.json())
      .then((data) => { if (current) setResult(data.resultados?.[0] || null); })
      .catch(() => { if (current) setResult(null); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [client, selectedId]);

  if (!properties.length) {
    return <section className="container-page rounded-2xl border border-line bg-white p-8 font-bold text-muted">Nenhum empreendimento publicado com regras disponíveis.</section>;
  }

  return (
    <section className="container-page grid gap-6">
      <div className="rounded-2xl border border-line bg-white p-5 shadow-soft">
        <label className="grid gap-2 text-sm font-black text-navy">
          Escolha o empreendimento
          <select className="admin-input" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
            {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
          </select>
        </label>
      </div>

      {selected ? <article className="overflow-hidden rounded-[28px] border border-line bg-white shadow-soft">
        <div className="grid lg:grid-cols-[360px_1fr]">
          <img className="h-full min-h-64 w-full object-cover" src={coverImage(selected)} alt={selected.name} />
          <div className="p-6 sm:p-8">
            <p className="text-sm font-black uppercase tracking-[0.16em] text-brand">{selected.builder || "Empreendimento"}</p>
            <h2 className="mt-2 text-4xl font-black text-navy">{selected.name}</h2>
            <p className="mt-2 font-semibold text-muted">{selected.location || "Localização sob consulta"}</p>
            <div className="mt-7"><Result result={result} loading={loading} /></div>
          </div>
        </div>
      </article> : null}

      <Link className="premium-button-secondary justify-self-start" href={`/admin/simulacoes/${simulation.id}`}>Editar simulação completa</Link>
    </section>
  );
}

function Result({ result, loading }) {
  if (loading) return <p className="rounded-2xl bg-mist p-5 font-bold text-muted">Atualizando valores...</p>;
  if (!result) return <p className="rounded-2xl bg-mist p-5 font-bold text-muted">Este empreendimento ainda não possui regras de entrada completas.</p>;
  const detail = result.detalhePagamento || { ato: 0, blocos: [] };
  const status = { viavel: ["VIÁVEL", "bg-emerald-50 text-emerald-800"], ajuste: ["VIÁVEL COM AJUSTE", "bg-amber-50 text-amber-800"], inviavel: ["INVIÁVEL", "bg-red-50 text-red-800"] }[result.classificacao] || ["EM ANÁLISE", "bg-mist text-navy"];
  return <div className="grid gap-5">
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      <Metric label="Valor do imóvel" value={money(result.valorImovel)} />
      <Metric label="Desconto" value={money(result.totalDescontos)} />
      <Metric label="Preço efetivo" value={money(result.valorFinalImovel)} />
      <Metric label="Financiamento e benefícios" value={money(result.totalCoberto)} />
      <Metric label="Entrada total" value={money(result.entradaTotal)} />
      {detail.ato > 0 ? <Metric label="Ato" value={money(detail.ato)} /> : null}
      {detail.blocos.map((block, index) => <Metric key={`${block.label}-${index}`} label={block.label} value={`${block.parcelas}x de ${money(block.valorParcelaComJuros ?? block.valorParcela)}`} />)}
    </div>
    <div className={`rounded-xl px-4 py-3 text-sm font-black ${status[1]}`}>{status[0]}</div>
    {result.motivos?.length ? <div className="grid gap-1 text-sm font-bold text-red-800">{result.motivos.map((reason, index) => <p key={index}>{reason}</p>)}</div> : null}
  </div>;
}

function Metric({ label, value }) {
  return <div><p className="text-xs font-black uppercase tracking-[0.12em] text-brand">{label}</p><p className="mt-1 text-2xl font-black text-navy">{value}</p></div>;
}

function money(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
}

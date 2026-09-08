"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronLeft, ChevronRight } from "lucide-react";
import { coverImage } from "@/lib/format";
import { calculateFamilyIncome, parseCurrencyNumber } from "@/lib/simulation-registration-schema";
import { getRenderableSimulationModels, normalizeSimulationModels } from "@/lib/simulation-models";

export default function EmpreendimentoPresentation({ simulation, properties }) {
  const [selectedId, setSelectedId] = useState(properties[0]?.id || "");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [imageIndex, setImageIndex] = useState(0);
  const [manualInstallments, setManualInstallments] = useState("");
  const [manualAct, setManualAct] = useState("");
  const [useFgts, setUseFgts] = useState(true);
  const selected = properties.find((property) => property.id === selectedId);
  const images = useMemo(() => propertyImages(selected), [selected]);
  const financingInstallments = useMemo(() => {
    const models = normalizeSimulationModels(simulation.simulationModels, simulation);
    const primary = getRenderableSimulationModels({ ...simulation, simulationModels: models })[0]?.values || {};
    return {
      first: parseCurrencyNumber(primary.firstInstallment || simulation.firstInstallment),
      last: parseCurrencyNumber(primary.lastInstallment || simulation.lastInstallment)
    };
  }, [simulation]);

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
      fgtsDisponivel: useFgts ? parseCurrencyNumber(simulation.downPaymentValue) + parseCurrencyNumber(simulation.fgtsValue) : 0,
      temDependente: Boolean(simulation.registration?.hasChildrenUnder18),
      fgtsMaisDe3Anos: Boolean(simulation.registration?.hasOverThreeYearsRegisteredWork),
      tipoRenda: simulation.registration?.primaryIncomeType || ""
    };
  }, [simulation, useFgts]);

  useEffect(() => {
    setImageIndex(0);
    setManualInstallments("");
    setManualAct("");
  }, [selectedId]);

  useEffect(() => {
    if (images.length < 2) return undefined;
    const timer = window.setInterval(() => setImageIndex((index) => (index + 1) % images.length), 5000);
    return () => window.clearInterval(timer);
  }, [images]);

  useEffect(() => {
    if (!selectedId) return;
    let current = true;
    setLoading(true);
    setResult(null);
    fetch("/api/simular-entrada", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cliente: client,
        propertyIds: [selectedId],
        atoManual: parseCurrencyNumber(manualAct),
        parcelasManuais: Number(manualInstallments) || 0
      })
    })
      .then((response) => response.json())
      .then((data) => { if (current) setResult(data.resultados?.[0] || null); })
      .catch(() => { if (current) setResult(null); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [client, manualAct, manualInstallments, selectedId]);

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
          <div className="relative min-h-64 bg-slate-100">
            <img className="h-full min-h-64 w-full object-cover" src={images[imageIndex] || coverImage(selected)} alt={`${selected.name} - imagem ${imageIndex + 1}`} />
            {images.length > 1 ? <>
              <button aria-label="Imagem anterior" className="absolute left-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-navy shadow" onClick={() => setImageIndex((imageIndex - 1 + images.length) % images.length)} type="button"><ChevronLeft /></button>
              <button aria-label="Próxima imagem" className="absolute right-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-navy shadow" onClick={() => setImageIndex((imageIndex + 1) % images.length)} type="button"><ChevronRight /></button>
              <span className="absolute bottom-3 right-3 rounded-full bg-navy/85 px-3 py-1 text-xs font-black text-white">{imageIndex + 1} / {images.length}</span>
            </> : null}
          </div>
          <div className="p-6 sm:p-8">
            <p className="text-sm font-black uppercase tracking-[0.16em] text-brand">{selected.builder || "Empreendimento"}</p>
            <h2 className="mt-2 text-4xl font-black text-navy">{selected.name}</h2>
            <p className="mt-2 font-semibold text-muted">{selected.location || "Localização sob consulta"}</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="grid gap-2 text-sm font-black text-navy">Quantidade de parcelas<input className="admin-input" inputMode="numeric" min="1" placeholder="Melhor cenário" type="number" value={manualInstallments} onChange={(event) => setManualInstallments(event.target.value)} /></label>
              <label className="grid gap-2 text-sm font-black text-navy">Ato adicional<input className="admin-input" inputMode="decimal" placeholder="R$ 0,00" value={manualAct} onChange={(event) => setManualAct(event.target.value)} /></label>
              <label className="flex items-center gap-3 self-end rounded-xl border border-line px-4 py-3 text-sm font-black text-navy"><input checked={useFgts} onChange={(event) => setUseFgts(event.target.checked)} type="checkbox" />Usar saldo de FGTS/entrada</label>
            </div>
            {selected.pdfData ? <a className="premium-button-secondary mt-4 inline-flex" href={selected.pdfData} target="_blank" rel="noreferrer"><BookOpen className="mr-2 h-5 w-5" />Abrir e-book</a> : null}
            <div className="mt-7"><Result result={result} loading={loading} financingInstallments={financingInstallments} /></div>
          </div>
        </div>
      </article> : null}

      <Link className="premium-button-secondary justify-self-start" href={`/admin/simulacoes/${simulation.id}`}>Editar simulação completa</Link>
    </section>
  );
}

function Result({ result, loading, financingInstallments }) {
  if (loading) return <p className="rounded-2xl bg-mist p-5 font-bold text-muted">Atualizando valores...</p>;
  if (!result) return <p className="rounded-2xl bg-mist p-5 font-bold text-muted">Este empreendimento ainda não possui regras de entrada completas.</p>;
  const detail = result.detalhePagamento || { ato: 0, blocos: [] };
  const status = { viavel: ["VIÁVEL", "bg-emerald-50 text-emerald-800"], ajuste: ["VIÁVEL COM AJUSTE", "bg-amber-50 text-amber-800"], inviavel: ["INVIÁVEL", "bg-red-50 text-red-800"] }[result.classificacao] || ["EM ANÁLISE", "bg-mist text-navy"];
  return <div className="grid gap-5">
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      <Metric label="Valor do imóvel" value={money(result.valorImovel)} />
      <Metric label="Desconto" value={money(result.totalDescontos)} />
      {result.subsidioMcmv > 0 ? <Metric label="Subsídio MCMV" value={money(result.subsidioMcmv)} /> : null}
      {result.casaPaulista > 0 ? <Metric label="Casa Paulista" value={money(result.casaPaulista)} /> : null}
      <Metric label="Preço efetivo" value={money(result.valorFinalImovel)} />
      <Metric label="Financiamento e benefícios" value={money(result.totalCoberto)} />
      {financingInstallments.first > 0 ? <Metric label="Primeira parcela do financiamento" value={money(financingInstallments.first)} /> : null}
      {financingInstallments.last > 0 ? <Metric label="Última parcela do financiamento" value={money(financingInstallments.last)} /> : null}
      <Metric label="Entrada total" value={money(result.entradaTotal)} />
      <Metric label="Ato" value={money(detail.ato)} />
      {detail.blocos.map((block, index) => <Metric key={`${block.label}-${index}`} label={block.label} value={`${block.parcelas}x de ${money(block.valorParcelaComJuros ?? block.valorParcela)}`} />)}
    </div>
    {result.descontosAplicados?.length ? <div className="rounded-xl border border-line bg-white p-4">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-brand">Descontos aplicados</p>
      <div className="mt-2 grid gap-2 text-sm font-bold text-navy">{result.descontosAplicados.map((discount, index) => <p className="flex justify-between gap-3" key={`${discount.tipo}-${index}`}><span>{discount.label}</span><span>{money(discount.valor)}</span></p>)}</div>
      <p className="mt-3 flex justify-between gap-3 border-t border-line pt-3 font-black text-navy"><span>Total de descontos</span><span>{money(result.totalDescontos)}</span></p>
    </div> : null}
    {result.beneficiosInformativos?.length ? <Benefits benefits={result.beneficiosInformativos} propertyValue={result.valorImovel} /> : null}
    <div className={`rounded-xl px-4 py-3 text-sm font-black ${status[1]}`}>{status[0]}</div>
    {result.motivos?.length ? <div className="grid gap-1 text-sm font-bold text-red-800">{result.motivos.map((reason, index) => <p key={index}>{reason}</p>)}</div> : null}
  </div>;
}

function Benefits({ benefits, propertyValue }) {
  const freeDocuments = benefits.some((benefit) => /document/i.test(`${benefit.label} ${benefit.tipo}`) && /gr[aá]tis|gratuita|isenta/i.test(`${benefit.label} ${benefit.tipo}`));
  return <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
    <p className="text-xs font-black uppercase tracking-[0.12em] text-emerald-800">Benefícios</p>
    {freeDocuments ? <p className="mt-2 font-black text-emerald-900"><span className="mr-2 text-red-600 line-through">Documentação {money(propertyValue * 0.05)}</span> Documentação gratuita</p> : null}
    <div className="mt-2 grid gap-1 text-sm font-bold text-emerald-900">{benefits.filter((benefit) => !freeDocuments || !/document/i.test(`${benefit.label} ${benefit.tipo}`)).map((benefit, index) => <p key={`${benefit.tipo}-${index}`}>{benefit.label}{benefit.valor > 0 ? `: ${money(benefit.valor)}` : ""}</p>)}</div>
  </div>;
}

function Metric({ label, value }) {
  return <div><p className="text-xs font-black uppercase tracking-[0.12em] text-brand">{label}</p><p className="mt-1 text-2xl font-black text-navy">{value}</p></div>;
}

function money(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
}

function propertyImages(property) {
  const photos = Array.isArray(property?.photos) ? property.photos : [];
  const urls = photos.map((photo) => typeof photo === "string" ? photo : photo?.data || photo?.url || photo?.src || photo?.publicUrl).filter(Boolean);
  return urls.length ? urls : property ? [coverImage(property)] : [];
}

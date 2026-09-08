"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronLeft, ChevronRight, Expand, MapPin, X } from "lucide-react";
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
  const [appliedInstallments, setAppliedInstallments] = useState("");
  const [appliedAct, setAppliedAct] = useState("");
  const [useFgts, setUseFgts] = useState(true);
  const [expandedImage, setExpandedImage] = useState(false);
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
    setAppliedInstallments("");
    setAppliedAct("");
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
    fetch("/api/simular-entrada", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cliente: client,
        propertyIds: [selectedId],
        atoManual: parseCurrencyNumber(appliedAct),
        parcelasManuais: Number(appliedInstallments) || 0
      })
    })
      .then((response) => response.json())
      .then((data) => { if (current) setResult(data.resultados?.[0] || null); })
      .catch(() => { if (current) setResult(null); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [appliedAct, appliedInstallments, client, selectedId]);

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
            <button aria-label="Expandir imagem" className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-white/90 text-navy shadow" onClick={() => setExpandedImage(true)} type="button"><Expand className="h-5 w-5" /></button>
          </div>
          <div className="p-6 sm:p-8">
            <p className="text-sm font-black uppercase tracking-[0.16em] text-brand">{selected.builder || "Empreendimento"}</p>
            <h2 className="mt-2 text-4xl font-black text-navy">{selected.name}</h2>
            <p className="mt-2 font-semibold text-muted">{selected.location || "Localização sob consulta"}</p>
            <a className="premium-button-secondary mt-4 inline-flex px-4 py-2 text-sm" href={mapsUrl(selected)} target="_blank" rel="noreferrer"><MapPin className="mr-2 h-4 w-4" />Abrir localização</a>
            {selected.internalNotes ? <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-xs font-black uppercase tracking-[0.12em] text-amber-800">Informações internas</p><p className="mt-2 whitespace-pre-line text-sm font-semibold leading-6 text-amber-950">{selected.internalNotes}</p></div> : null}
            {selected.pdfData ? <a className="premium-button-secondary mt-4 inline-flex" href={selected.pdfData} target="_blank" rel="noreferrer"><BookOpen className="mr-2 h-5 w-5" />Abrir e-book</a> : null}
            <div className="mt-7"><Result result={result} loading={loading} financingInstallments={financingInstallments} manualInstallments={manualInstallments} setManualInstallments={setManualInstallments} manualAct={manualAct} setManualAct={setManualAct} useFgts={useFgts} setUseFgts={setUseFgts} onRecalculate={() => { setAppliedInstallments(manualInstallments); setAppliedAct(manualAct); }} /></div>
            {selected.features?.length ? <div className="mt-6 border-t border-line pt-6"><p className="text-xs font-black uppercase tracking-[0.14em] text-brand">Benefícios do empreendimento</p><div className="mt-3 flex flex-wrap gap-2">{selected.features.map((feature, index) => <span className="rounded-full border border-brand/20 bg-[#F4F9FF] px-4 py-2 text-sm font-black text-navy" key={`${typeof feature === "string" ? feature : feature.text}-${index}`}>{typeof feature === "string" ? feature : feature.text}</span>)}</div></div> : null}
          </div>
        </div>
      </article> : null}

      {expandedImage ? <div className="fixed inset-0 z-[200] grid place-items-center bg-black/90 p-4" role="dialog" aria-modal="true">
        <button aria-label="Fechar imagem" className="absolute right-5 top-5 grid h-11 w-11 place-items-center rounded-full bg-white text-navy" onClick={() => setExpandedImage(false)} type="button"><X /></button>
        <img className="max-h-[90vh] max-w-[95vw] object-contain" src={images[imageIndex]} alt={`${selected.name} ampliado`} />
        {images.length > 1 ? <><button aria-label="Imagem anterior" className="absolute left-5 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white text-navy" onClick={() => setImageIndex((imageIndex - 1 + images.length) % images.length)} type="button"><ChevronLeft /></button><button aria-label="Próxima imagem" className="absolute right-5 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white text-navy" onClick={() => setImageIndex((imageIndex + 1) % images.length)} type="button"><ChevronRight /></button></> : null}
      </div> : null}

      <Link className="premium-button-secondary justify-self-start" href={`/admin/simulacoes/${simulation.id}`}>Editar simulação completa</Link>
    </section>
  );
}

function Result({ result, loading, financingInstallments, manualInstallments, setManualInstallments, manualAct, setManualAct, useFgts, setUseFgts, onRecalculate }) {
  if (loading && !result) return <p className="rounded-2xl bg-mist p-5 font-bold text-muted">Atualizando valores...</p>;
  if (!result) return <p className="rounded-2xl bg-mist p-5 font-bold text-muted">Este empreendimento ainda não possui regras de entrada completas.</p>;
  const detail = result.detalhePagamento || { ato: 0, blocos: [] };
  const status = { viavel: ["VIÁVEL", "bg-emerald-50 text-emerald-800"], ajuste: ["VIÁVEL COM AJUSTE", "bg-amber-50 text-amber-800"], inviavel: ["INVIÁVEL", "bg-red-50 text-red-800"] }[result.classificacao] || ["EM ANÁLISE", "bg-mist text-navy"];
  const entryBlock = detail.blocos.find((block) => /parcela/i.test(block.label));
  const freeDocuments = hasFreeDocuments(result.beneficiosInformativos);
  const documentSavings = freeDocuments ? result.valorImovel * 0.05 : 0;
  return <div className="grid gap-5">
    <div className="rounded-2xl bg-navy px-5 py-6 text-center text-white"><p className="text-xs font-black uppercase tracking-[0.16em] text-white/75">Valor total do imóvel</p><p className="mt-2 text-4xl font-black">{money(result.valorImovel)}</p></div>
    {(result.descontosAplicados?.length || freeDocuments) ? <div className="rounded-xl border border-line bg-white p-4">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-brand">Descontos aplicados</p>
      <div className="mt-2 grid gap-2 text-sm font-bold text-navy">{result.descontosAplicados?.map((discount, index) => <p className="flex justify-between gap-3" key={`${discount.tipo}-${index}`}><span>{discount.label}</span><span>{money(discount.valor)}</span></p>)}
      {freeDocuments ? <p className="flex justify-between gap-3 border-t border-line pt-2"><span>Documentação gratuita</span><span><span className="mr-2 text-red-600 line-through">{money(documentSavings)}</span><span className="text-emerald-700">Grátis</span></span></p> : null}</div>
      <p className="mt-3 flex justify-between gap-3 border-t border-line pt-3 font-black text-navy"><span>Total de descontos no imóvel</span><span>{money(result.totalDescontos)}</span></p>
    </div> : null}
    <div className="grid gap-5 sm:grid-cols-2">
      {result.subsidioMcmv > 0 ? <Metric label="Subsídio MCMV" value={money(result.subsidioMcmv)} /> : null}
      {result.casaPaulista > 0 ? <Metric label="Casa Paulista" value={money(result.casaPaulista)} /> : null}
      <Metric label="Financiamento aprovado" value={money(result.financiamentoAprovado)} />
    </div>
    {(financingInstallments.first > 0 || financingInstallments.last > 0) ? <div className="grid gap-5 rounded-xl border border-line bg-mist/60 p-4 sm:grid-cols-2">
      {financingInstallments.first > 0 ? <Metric label="Primeira parcela do financiamento" value={money(financingInstallments.first)} /> : null}
      {financingInstallments.last > 0 ? <Metric label="Última parcela do financiamento" value={money(financingInstallments.last)} /> : null}
    </div> : null}
    <div className="rounded-xl border border-brand/20 bg-[#F4F9FF] p-4 sm:p-5">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-brand">Composição da entrada</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Metric label="Entrada total" value={money(result.entradaTotal)} />
        {entryBlock ? <Metric label="Parcela calculada" value={`${entryBlock.parcelas}x de ${money(entryBlock.valorParcelaComJuros ?? entryBlock.valorParcela)}`} /> : null}
        <label className="grid gap-2 text-sm font-black text-navy">Ato<input className="admin-input bg-white" inputMode="decimal" placeholder="R$ 0,00" value={manualAct} onChange={(event) => setManualAct(event.target.value)} /></label>
        <label className="grid gap-2 text-sm font-black text-navy">Quantidade de parcelas<input className="admin-input bg-white" inputMode="numeric" min="1" placeholder={entryBlock ? String(entryBlock.parcelas) : "Melhor cenário"} type="number" value={manualInstallments} onChange={(event) => setManualInstallments(event.target.value)} /></label>
      </div>
      <label className="mt-4 flex items-center gap-3 text-sm font-black text-navy"><input checked={useFgts} onChange={(event) => setUseFgts(event.target.checked)} type="checkbox" />Usar saldo de FGTS/entrada disponível</label>
      <button className="premium-button-primary mt-4 w-full" disabled={loading} onClick={onRecalculate} type="button">{loading ? "Recalculando..." : "Recalcular valores"}</button>
      {detail.blocos.filter((block) => block !== entryBlock).map((block, index) => <div className="mt-4" key={`${block.label}-${index}`}><Metric label={block.label} value={`${block.parcelas}x de ${money(block.valorParcelaComJuros ?? block.valorParcela)}`} /></div>)}
    </div>
    {result.beneficiosInformativos?.length ? <Benefits benefits={result.beneficiosInformativos} propertyValue={result.valorImovel} /> : null}
    <div className={`rounded-xl px-4 py-3 text-sm font-black ${status[1]}`}>{status[0]}</div>
    {result.motivos?.length ? <div className="grid gap-1 text-sm font-bold text-red-800">{result.motivos.map((reason, index) => <p key={index}>{reason}</p>)}</div> : null}
  </div>;
}

function Benefits({ benefits, propertyValue }) {
  const freeDocuments = hasFreeDocuments(benefits);
  return <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
    <p className="text-xs font-black uppercase tracking-[0.12em] text-emerald-800">Benefícios</p>
    <div className="mt-2 grid gap-1 text-sm font-bold text-emerald-900">{benefits.filter((benefit) => !freeDocuments || !/document/i.test(`${benefit.label} ${benefit.tipo}`)).map((benefit, index) => <p key={`${benefit.tipo}-${index}`}>{benefit.label}{benefit.valor > 0 ? `: ${money(benefit.valor)}` : ""}</p>)}</div>
  </div>;
}

function hasFreeDocuments(benefits = []) {
  return benefits.some((benefit) => /document/i.test(`${benefit.label} ${benefit.tipo}`) && /gr[aá]tis|gratuita|isenta/i.test(`${benefit.label} ${benefit.tipo}`));
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

function mapsUrl(property) {
  const query = [property.location, property.name].filter(Boolean).join(" - ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Download, FileText, ImageDown, Save, Search, Sparkles, Trash2 } from "lucide-react";
import { coverImage, propertyCardFeatures, propertyRegion, propertyPrice, typeLabel } from "@/lib/format";
import { DEFAULT_RECOMMENDATION_REASON } from "@/lib/simulation-mapper";

const BENEFIT_OPTIONS = [
  "Documentação gratuita",
  "Entrada parcelada",
  "Entrada facilitada",
  "Possibilidade de uso do FGTS",
  "Imóvel pronto para morar",
  "Imóvel novo",
  "Casa não geminada",
  "Terreno inteiro",
  "Varanda",
  "Lazer completo",
  "Condomínio fechado",
  "IPTU isento",
  "Subsídio do Minha Casa Minha Vida",
  "Financiamento pela Caixa",
  "Menor desembolso inicial",
  "Parcelas compatíveis com a renda",
  "Potencial de valorização",
  "Boa localização",
  "Entrega programada",
  "Possibilidade de renda formal e informal",
  "Possibilidade de compor renda"
];

const RECOMMENDATION_REASONS = [
  DEFAULT_RECOMMENDATION_REASON,
  "Imóvel pensado para reduzir o custo imediato da compra.",
  "Melhor aproveitamento do subsídio disponível.",
  "Possibilidade de parcelamento da entrada.",
  "Compatível com o poder de compra apresentado.",
  "Boa relação entre valor e benefícios.",
  "Possibilidade de ampliar as opções utilizando entrada ou FGTS.",
  "Estratégia de compra com potencial de valorização."
];

const INITIAL_FORM = {
  clientName: "",
  simulationDate: new Date().toISOString().slice(0, 10),
  simulationType: "usado",
  financingValue: "",
  subsidyValue: "",
  firstInstallment: "",
  lastInstallment: "",
  downPaymentValue: "",
  fgtsValue: "",
  showExpandedPower: false,
  publicNote: "",
  internalNote: "",
  outputMode: "individual",
  properties: []
};

export default function SimulationGenerator({ properties = [], initialSimulation = null }) {
  const router = useRouter();
  const [form, setForm] = useState(() => normalizeInitialSimulation(initialSimulation));
  const [propertyQuery, setPropertyQuery] = useState("");
  const [activePage, setActivePage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const totals = useMemo(() => {
    const financing = moneyNumber(form.financingValue);
    const subsidy = moneyNumber(form.subsidyValue);
    const downPayment = moneyNumber(form.downPaymentValue);
    const fgts = moneyNumber(form.fgtsValue);
    return {
      financing,
      subsidy,
      downPayment,
      fgts,
      total: financing + subsidy,
      expanded: financing + subsidy + downPayment + fgts
    };
  }, [form.downPaymentValue, form.fgtsValue, form.financingValue, form.subsidyValue]);

  const filteredProperties = useMemo(() => {
    const term = propertyQuery.trim().toLowerCase();
    return properties.filter((property) => {
      if (form.properties.some((item) => item.propertyId === property.id)) return false;
      const haystack = [property.name, property.builder, property.location, property.region, property.price, property.type].join(" ").toLowerCase();
      return !term || haystack.includes(term);
    });
  }, [form.properties, properties, propertyQuery]);

  const pages = useMemo(() => buildPresentationPages(form, totals), [form, totals]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function addProperty(property) {
    const snapshot = propertySnapshot(property, form.properties.length);
    setForm((current) => ({ ...current, properties: [...current.properties, snapshot] }));
    setActivePage(0);
  }

  function removeProperty(index) {
    setForm((current) => ({
      ...current,
      properties: current.properties.filter((_, itemIndex) => itemIndex !== index)
    }));
  }

  function moveProperty(index, direction) {
    setForm((current) => {
      const next = [...current.properties];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, properties: next.map((item, displayOrder) => ({ ...item, displayOrder })) };
    });
  }

  function updateSelectedProperty(index, field, value) {
    setForm((current) => ({
      ...current,
      properties: current.properties.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item)
    }));
  }

  function toggleBenefit(propertyIndex, benefitText) {
    setForm((current) => ({
      ...current,
      properties: current.properties.map((property, itemIndex) => {
        if (itemIndex !== propertyIndex) return property;
        const exists = property.benefits.some((benefit) => benefit.text === benefitText);
        const benefits = exists
          ? property.benefits.filter((benefit) => benefit.text !== benefitText)
          : [...property.benefits, { text: benefitText, isCustom: false, displayOrder: property.benefits.length }];
        return { ...property, benefits: benefits.map((benefit, displayOrder) => ({ ...benefit, displayOrder })) };
      })
    }));
  }

  function addCustomBenefit(propertyIndex, text) {
    const value = text.trim();
    if (!value) return;
    setForm((current) => ({
      ...current,
      properties: current.properties.map((property, itemIndex) => {
        if (itemIndex !== propertyIndex) return property;
        return {
          ...property,
          customBenefitDraft: "",
          benefits: [...property.benefits, { text: value, isCustom: true, displayOrder: property.benefits.length }]
        };
      })
    }));
  }

  function moveBenefit(propertyIndex, benefitIndex, direction) {
    setForm((current) => ({
      ...current,
      properties: current.properties.map((property, itemIndex) => {
        if (itemIndex !== propertyIndex) return property;
        const benefits = [...property.benefits];
        const target = benefitIndex + direction;
        if (target < 0 || target >= benefits.length) return property;
        [benefits[benefitIndex], benefits[target]] = [benefits[target], benefits[benefitIndex]];
        return { ...property, benefits: benefits.map((benefit, displayOrder) => ({ ...benefit, displayOrder })) };
      })
    }));
  }

  async function saveSimulation() {
    setSaving(true);
    setError("");
    setMessage("");

    const endpoint = form.id ? `/api/simulations/${form.id}` : "/api/simulations";
    const method = form.id ? "PUT" : "POST";
    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serializeForm(form, totals))
    });
    const data = await response.json();
    setSaving(false);

    if (!response.ok) {
      setError(data.error || "Não foi possível salvar a simulação.");
      return;
    }

    setMessage("Simulação salva com sucesso.");
    if (!form.id && data.id) router.replace(`/admin/simulacoes/${data.id}`);
    router.refresh();
  }

  async function downloadImages() {
    setError("");
    try {
      const svgs = buildPresentationPages(form, totals);
      for (const [index, page] of svgs.entries()) {
        const dataUrl = await svgToPngDataUrl(page.svg);
        downloadDataUrl(dataUrl, `simulacao-${safeFileName(form.clientName)}-${index + 1}.png`);
      }
    } catch (downloadError) {
      setError(downloadError.message || "Não foi possível gerar as imagens.");
    }
  }

  async function downloadPdf() {
    setError("");
    try {
      const svgs = buildPresentationPages(form, totals);
      const images = [];
      for (const page of svgs) images.push(await svgToJpegDataUrl(page.svg));
      const pdfUrl = buildPdfFromJpegs(images, 1080, 1620);
      downloadDataUrl(pdfUrl, `simulacao-${safeFileName(form.clientName)}.pdf`);
    } catch (pdfError) {
      setError(pdfError.message || "Não foi possível gerar o PDF.");
    }
  }

  return (
    <div className="container-page grid gap-8 xl:grid-cols-[minmax(0,1fr)_460px]">
      <div className="grid gap-6">
        <Panel title="Dados do cliente" eyebrow="Etapa A">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome completo do cliente" value={form.clientName} onChange={(value) => update("clientName", value)} />
            <Field label="Data da simulação" type="date" value={form.simulationDate} onChange={(value) => update("simulationDate", value)} />
          </div>
          <Field label="Observação interna" textarea value={form.internalNote} onChange={(value) => update("internalNote", value)} />
        </Panel>

        <Panel title="Dados da simulação" eyebrow="Etapa B">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-extrabold text-ink">
              Tipo da simulação
              <select className="admin-input" value={form.simulationType} onChange={(event) => update("simulationType", event.target.value)}>
                <option value="novo">Imóvel novo</option>
                <option value="usado">Imóvel usado</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-extrabold text-ink">
              Modo de páginas dos imóveis
              <select className="admin-input" value={form.outputMode} onChange={(event) => update("outputMode", event.target.value)}>
                <option value="individual">Individual</option>
                <option value="comparativo">Comparativo</option>
              </select>
            </label>
            <MoneyField label="Valor do financiamento" value={form.financingValue} onChange={(value) => update("financingValue", value)} />
            <MoneyField label="Valor do subsídio" value={form.subsidyValue} onChange={(value) => update("subsidyValue", value)} />
            <MoneyField label="Primeira parcela" value={form.firstInstallment} onChange={(value) => update("firstInstallment", value)} />
            <MoneyField label="Última parcela" value={form.lastInstallment} onChange={(value) => update("lastInstallment", value)} />
            <MoneyField label="Entrada disponível" value={form.downPaymentValue} onChange={(value) => update("downPaymentValue", value)} />
            <MoneyField label="FGTS disponível" value={form.fgtsValue} onChange={(value) => update("fgtsValue", value)} />
          </div>
          <label className="mt-5 flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 text-sm font-bold text-ink">
            <input type="checkbox" checked={form.showExpandedPower} onChange={(event) => update("showExpandedPower", event.target.checked)} />
            Mostrar poder de compra ampliado na apresentação
          </label>
          <div className="mt-5 grid gap-4 rounded-2xl border border-blue-100 bg-blue-50/70 p-5 md:grid-cols-2">
            <Metric label="Poder total de compra" value={formatCurrency(totals.total)} />
            <Metric label="Poder total ampliado" value={formatCurrency(totals.expanded)} />
          </div>
          <Field label="Observação pública" textarea value={form.publicNote} onChange={(value) => update("publicNote", value)} />
        </Panel>

        <Panel title="Imóveis sugeridos" eyebrow="Etapa C">
          <label className="relative block">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-brand" />
            <input
              className="admin-input pl-12"
              value={propertyQuery}
              onChange={(event) => setPropertyQuery(event.target.value)}
              placeholder="Pesquisar imóvel por nome, região, valor ou construtora"
            />
          </label>
          <div className="mt-5 grid max-h-[420px] gap-3 overflow-auto pr-1">
            {filteredProperties.slice(0, 10).map((property) => (
              <button
                key={property.id}
                className="grid gap-4 rounded-2xl border border-line bg-white p-3 text-left transition hover:-translate-y-0.5 hover:border-brand hover:shadow-soft sm:grid-cols-[92px_1fr_auto] sm:items-center"
                onClick={() => addProperty(property)}
                type="button"
              >
                <img src={coverImage(property)} alt="" className="h-24 w-full rounded-xl object-cover sm:h-20 sm:w-[92px]" />
                <span>
                  <span className="block text-lg font-black text-navy">{property.name}</span>
                  <span className="mt-1 block text-sm text-muted">{typeLabel(property.type)} · {propertyRegion(property)} · {propertyPrice(property)}</span>
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-[#E9F2FF] px-4 py-2 text-sm font-black text-navy">
                  <Check className="h-4 w-4" /> Selecionar
                </span>
              </button>
            ))}
          </div>
        </Panel>

        {form.properties.map((property, propertyIndex) => (
          <Panel key={`${property.propertyId}-${propertyIndex}`} title={property.customName || "Imóvel sugerido"} eyebrow={`Imóvel ${propertyIndex + 1}`}>
            <div className="mb-5 flex flex-wrap gap-3">
              <button className="premium-button-secondary" disabled={propertyIndex === 0} onClick={() => moveProperty(propertyIndex, -1)} type="button">
                <ArrowUp className="mr-2 h-4 w-4" /> Subir
              </button>
              <button className="premium-button-secondary" disabled={propertyIndex === form.properties.length - 1} onClick={() => moveProperty(propertyIndex, 1)} type="button">
                <ArrowDown className="mr-2 h-4 w-4" /> Descer
              </button>
              <button className="premium-button border border-red-200 bg-white text-red-700" onClick={() => removeProperty(propertyIndex)} type="button">
                <Trash2 className="mr-2 h-4 w-4" /> Remover
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Nome na apresentação" value={property.customName} onChange={(value) => updateSelectedProperty(propertyIndex, "customName", value)} />
              <Field label="Valor na apresentação" value={property.customPrice} onChange={(value) => updateSelectedProperty(propertyIndex, "customPrice", value)} />
              <Field label="Localização" value={property.customLocation} onChange={(value) => updateSelectedProperty(propertyIndex, "customLocation", value)} />
              <Field label="Tipo" value={property.customType} onChange={(value) => updateSelectedProperty(propertyIndex, "customType", value)} />
              <Field label="Área" value={property.customArea} onChange={(value) => updateSelectedProperty(propertyIndex, "customArea", value)} />
              <Field label="Dormitórios" value={property.customBedrooms} onChange={(value) => updateSelectedProperty(propertyIndex, "customBedrooms", value)} />
              <Field label="Construtora" value={property.customBuilder} onChange={(value) => updateSelectedProperty(propertyIndex, "customBuilder", value)} />
              <Field label="Entrega" value={property.customDelivery} onChange={(value) => updateSelectedProperty(propertyIndex, "customDelivery", value)} />
            </div>

            <label className="mt-5 grid gap-2 text-sm font-extrabold text-ink">
              Por que este imóvel foi sugerido?
              <select className="admin-input" value={property.recommendationReason} onChange={(event) => updateSelectedProperty(propertyIndex, "recommendationReason", event.target.value)}>
                {RECOMMENDATION_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
              </select>
            </label>
            <Field textarea label="Editar motivo da indicação" value={property.recommendationReason} onChange={(value) => updateSelectedProperty(propertyIndex, "recommendationReason", value)} />

            <div className="mt-6">
              <p className="text-sm font-black uppercase tracking-[0.16em] text-brand">Benefícios e destaques</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {BENEFIT_OPTIONS.map((benefit) => (
                  <label key={benefit} className="flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 text-sm font-bold text-ink">
                    <input
                      type="checkbox"
                      checked={property.benefits.some((item) => item.text === benefit)}
                      onChange={() => toggleBenefit(propertyIndex, benefit)}
                    />
                    {benefit}
                  </label>
                ))}
              </div>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <input
                  className="admin-input"
                  value={property.customBenefitDraft || ""}
                  onChange={(event) => updateSelectedProperty(propertyIndex, "customBenefitDraft", event.target.value)}
                  placeholder="Adicionar benefício personalizado"
                />
                <button className="premium-button-secondary" onClick={() => addCustomBenefit(propertyIndex, property.customBenefitDraft || "")} type="button">
                  Adicionar
                </button>
              </div>
              <div className="mt-4 grid gap-2">
                {property.benefits.map((benefit, benefitIndex) => (
                  <div key={`${benefit.text}-${benefitIndex}`} className="flex items-center justify-between gap-3 rounded-2xl bg-mist px-4 py-3">
                    <span className="font-bold text-navy">{benefit.text}</span>
                    <span className="flex gap-2">
                      <button className="rounded-full border border-line bg-white px-3 py-1 text-brand disabled:opacity-30" disabled={benefitIndex === 0} onClick={() => moveBenefit(propertyIndex, benefitIndex, -1)} type="button">↑</button>
                      <button className="rounded-full border border-line bg-white px-3 py-1 text-brand disabled:opacity-30" disabled={benefitIndex === property.benefits.length - 1} onClick={() => moveBenefit(propertyIndex, benefitIndex, 1)} type="button">↓</button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        ))}

        {error ? <Alert tone="error">{error}</Alert> : null}
        {message ? <Alert tone="success">{message}</Alert> : null}

        <div className="sticky bottom-4 z-20 flex flex-wrap gap-3 rounded-3xl border border-line bg-white/92 p-4 shadow-premium backdrop-blur">
          <button className="premium-button-primary" disabled={saving} onClick={saveSimulation} type="button">
            <Save className="mr-2 h-5 w-5" /> {saving ? "Salvando..." : "Salvar simulação"}
          </button>
          <button className="premium-button-secondary" onClick={downloadImages} type="button">
            <ImageDown className="mr-2 h-5 w-5" /> Baixar imagens
          </button>
          <button className="premium-button-secondary" onClick={downloadPdf} type="button">
            <FileText className="mr-2 h-5 w-5" /> Baixar PDF
          </button>
          <Link href="/admin/simulacoes" className="premium-button-secondary">Histórico</Link>
        </div>
      </div>

      <aside className="xl:sticky xl:top-6 xl:self-start">
        <div className="rounded-[28px] border border-line bg-white p-5 shadow-soft">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.16em] text-brand">Prévia</p>
              <h2 className="mt-1 text-2xl font-black text-navy">Apresentação</h2>
            </div>
            <span className="rounded-full bg-[#E9F2FF] px-3 py-1 text-sm font-black text-navy">
              {activePage + 1} de {pages.length}
            </span>
          </div>
          <div className="overflow-hidden rounded-2xl bg-slate-100">
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(pages[activePage]?.svg || "")}`}
              alt={`Prévia da página ${activePage + 1}`}
              className="w-full"
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {pages.map((page, index) => (
              <button
                key={`${page.title}-${index}`}
                className={`rounded-full px-4 py-2 text-sm font-black transition ${activePage === index ? "bg-navy text-white" : "border border-line bg-white text-navy hover:border-brand"}`}
                onClick={() => setActivePage(index)}
                type="button"
              >
                {index + 1}
              </button>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

function Panel({ children, eyebrow, title }) {
  return (
    <section className="rounded-[28px] border border-line bg-white p-6 shadow-soft md:p-8">
      <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-black text-navy">{title}</h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Field({ label, onChange, textarea = false, type = "text", value }) {
  const Component = textarea ? "textarea" : "input";
  return (
    <label className="mt-4 grid gap-2 text-sm font-extrabold text-ink">
      {label}
      <Component
        className={`admin-input ${textarea ? "min-h-28 py-3" : ""}`}
        type={textarea ? undefined : type}
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function MoneyField({ label, onChange, value }) {
  return (
    <Field
      label={label}
      value={value}
      onChange={(nextValue) => onChange(formatCurrencyInput(nextValue))}
    />
  );
}

function Metric({ label, value }) {
  return (
    <div>
      <p className="text-sm font-black uppercase tracking-[0.12em] text-brand">{label}</p>
      <p className="mt-1 text-3xl font-black text-navy">{value}</p>
    </div>
  );
}

function Alert({ children, tone }) {
  const classes = tone === "success"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-red-200 bg-red-50 text-red-800";
  return <div className={`rounded-2xl border px-5 py-4 font-bold ${classes}`}>{children}</div>;
}

function normalizeInitialSimulation(simulation) {
  if (!simulation) return INITIAL_FORM;
  return {
    ...INITIAL_FORM,
    ...simulation,
    financingValue: formatCurrencyInput(String(simulation.financingValue || "")),
    subsidyValue: formatCurrencyInput(String(simulation.subsidyValue || "")),
    firstInstallment: formatCurrencyInput(String(simulation.firstInstallment || "")),
    lastInstallment: formatCurrencyInput(String(simulation.lastInstallment || "")),
    downPaymentValue: formatCurrencyInput(String(simulation.downPaymentValue || "")),
    fgtsValue: formatCurrencyInput(String(simulation.fgtsValue || "")),
    properties: (simulation.properties || []).map((property, index) => ({
      ...property,
      displayOrder: index,
      customBenefitDraft: ""
    }))
  };
}

function propertySnapshot(property, displayOrder) {
  return {
    propertyId: property.id,
    displayOrder,
    customName: property.name || "",
    customPrice: property.price || "",
    customLocation: propertyRegion(property),
    customType: typeLabel(property.type),
    customArea: property.area || "",
    customBedrooms: property.bedrooms || "",
    customBuilder: property.builder || "",
    customDelivery: property.delivery || "",
    customTerms: property.terms || "",
    customDiscounts: property.discounts || "",
    customSalesText: property.salesText || "",
    recommendationReason: DEFAULT_RECOMMENDATION_REASON,
    imageUrl: coverImage(property),
    layoutMode: "individual",
    benefits: propertyCardFeatures(property, 5).map((feature, index) => ({
      text: feature.text,
      displayOrder: index,
      isCustom: false
    })),
    customBenefitDraft: ""
  };
}

function serializeForm(form, totals) {
  return {
    ...form,
    financingValue: totals.financing,
    subsidyValue: totals.subsidy,
    firstInstallment: moneyNumber(form.firstInstallment),
    lastInstallment: moneyNumber(form.lastInstallment),
    downPaymentValue: totals.downPayment,
    fgtsValue: totals.fgts,
    totalPurchasePower: totals.total,
    expandedPurchasePower: totals.expanded,
    properties: form.properties.map(({ customBenefitDraft, ...property }) => property)
  };
}

function buildPresentationPages(form, totals) {
  const pages = [buildSimulationResultSvg(form, totals)];
  const propertyPages = form.outputMode === "comparativo"
    ? chunk(form.properties, 2).map((items, index) => buildComparativePropertySvg(items, index))
    : form.properties.map((property, index) => buildPropertySvg(property, index));
  return [...pages, ...propertyPages];
}

function buildSimulationResultSvg(form, totals) {
  const typeLabelText = form.simulationType === "usado" ? "IMÓVEL USADO" : "IMÓVEL NOVO";
  const mainValue = form.showExpandedPower ? totals.expanded : totals.total;
  const subtitle = form.showExpandedPower ? "Financiamento + subsídio + entrada + FGTS" : "Soma do subsídio + financiamento";
  const client = escapeXml(form.clientName || "Cliente");

  return {
    title: "Resultado",
    svg: `
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1620" viewBox="0 0 1080 1620">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#DDF1FF"/>
      <stop offset="100%" stop-color="#36A5FF"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#0D3B66" flood-opacity=".16"/>
    </filter>
  </defs>
  <rect width="1080" height="1620" fill="url(#bg)"/>
  <text x="540" y="165" text-anchor="middle" font-family="Inter, Arial" font-weight="900" font-size="116" fill="#0757B8">CAIXA</text>
  <text x="540" y="250" text-anchor="middle" font-family="Inter, Arial" font-weight="900" font-size="60" letter-spacing="2" fill="#0757B8">SIMULAÇÃO HABITACIONAL</text>
  <rect x="382" y="310" width="316" height="62" rx="31" fill="#fff"/>
  <circle cx="418" cy="341" r="31" fill="#0757B8"/>
  <text x="462" y="356" font-family="Inter, Arial" font-weight="900" font-size="28" fill="#0757B8">${typeLabelText}</text>

  <rect x="42" y="430" width="996" height="520" rx="42" fill="#fff" filter="url(#shadow)"/>
  <text x="540" y="505" text-anchor="middle" font-family="Inter, Arial" font-weight="900" font-size="34" letter-spacing="1.5" fill="#0757B8">PODER TOTAL DE COMPRA:</text>
  <text x="540" y="625" text-anchor="middle" font-family="Inter, Arial" font-weight="900" font-size="84" fill="#072D65">${escapeXml(formatCurrency(mainValue))}</text>
  <text x="540" y="697" text-anchor="middle" font-family="Inter, Arial" font-size="31" fill="#072D65">${escapeXml(subtitle)}</text>
  <line x1="98" x2="982" y1="760" y2="760" stroke="#B8D2F0" stroke-width="2"/>
  <circle cx="150" cy="850" r="52" fill="#0757B8"/>
  <text x="225" y="828" font-family="Inter, Arial" font-weight="900" font-size="24" fill="#0757B8">VALOR DO SUBSÍDIO</text>
  <text x="225" y="885" font-family="Inter, Arial" font-weight="900" font-size="38" fill="#072D65">${escapeXml(formatCurrency(totals.subsidy))}</text>
  <line x1="540" x2="540" y1="800" y2="905" stroke="#D8E6F6" stroke-width="3"/>
  <circle cx="622" cy="850" r="52" fill="#0757B8"/>
  <text x="695" y="828" font-family="Inter, Arial" font-weight="900" font-size="24" fill="#0757B8">VALOR DO FINANCIAMENTO</text>
  <text x="695" y="885" font-family="Inter, Arial" font-weight="900" font-size="38" fill="#072D65">${escapeXml(formatCurrency(totals.financing))}</text>

  <rect x="60" y="1030" width="960" height="305" rx="38" fill="#0757B8"/>
  <text x="540" y="1115" text-anchor="middle" font-family="Inter, Arial" font-style="italic" font-size="37" fill="#fff">Cliente: ${client}</text>
  <line x1="110" x2="970" y1="1145" y2="1145" stroke="#8CC4FF" stroke-width="3"/>
  <text x="320" y="1210" text-anchor="middle" font-family="Inter, Arial" font-weight="900" font-size="28" fill="#fff">PRIMEIRA PARCELA</text>
  <text x="320" y="1282" text-anchor="middle" font-family="Inter, Arial" font-weight="900" font-size="56" fill="#fff">${escapeXml(formatCurrency(moneyNumber(form.firstInstallment)))}</text>
  <line x1="540" x2="540" y1="1180" y2="1300" stroke="#8CC4FF" stroke-width="3"/>
  <text x="765" y="1210" text-anchor="middle" font-family="Inter, Arial" font-weight="900" font-size="28" fill="#fff">ÚLTIMA PARCELA</text>
  <text x="765" y="1282" text-anchor="middle" font-family="Inter, Arial" font-weight="900" font-size="56" fill="#fff">${escapeXml(formatCurrency(moneyNumber(form.lastInstallment)))}</text>

  <text x="540" y="1390" text-anchor="middle" font-family="Inter, Arial" font-weight="900" font-size="34" letter-spacing="5" fill="#fff">WWW.MATHEUSMACHADOIMOVEIS.COM.BR</text>
  <rect x="60" y="1445" width="960" height="125" rx="34" fill="#0757B8"/>
  <text x="190" y="1518" text-anchor="middle" font-family="Inter, Arial" font-size="25" fill="#fff">Condições facilitadas</text>
  <text x="540" y="1518" text-anchor="middle" font-family="Inter, Arial" font-weight="900" font-size="24" fill="#fff">@MHM.MACHADO</text>
  <text x="870" y="1518" text-anchor="middle" font-family="Inter, Arial" font-size="25" fill="#fff">Segurança e tranquilidade</text>
</svg>`
  };
}

function buildPropertySvg(property, index) {
  const benefits = property.benefits.slice(0, 7);
  return {
    title: property.customName,
    svg: `
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1620" viewBox="0 0 1080 1620">
  <defs>
    <linearGradient id="bg${index}" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="#DDF1FF"/><stop offset="100%" stop-color="#36A5FF"/></linearGradient>
    <clipPath id="photo${index}"><rect x="70" y="260" width="940" height="560" rx="42"/></clipPath>
  </defs>
  <rect width="1080" height="1620" fill="url(#bg${index})"/>
  <text x="70" y="130" font-family="Inter, Arial" font-weight="900" font-size="42" fill="#0757B8">IMÓVEL SUGERIDO</text>
  <text x="70" y="205" font-family="Inter, Arial" font-weight="900" font-size="58" fill="#072D65">${escapeXml(trimText(property.customName, 28))}</text>
  ${property.imageUrl ? `<image href="${escapeXml(property.imageUrl)}" x="70" y="260" width="940" height="560" preserveAspectRatio="xMidYMid slice" clip-path="url(#photo${index})"/>` : `<rect x="70" y="260" width="940" height="560" rx="42" fill="#E9F2FF"/>`}
  <rect x="70" y="865" width="940" height="230" rx="34" fill="#fff"/>
  <text x="115" y="935" font-family="Inter, Arial" font-weight="900" font-size="34" fill="#0757B8">${escapeXml(property.customPrice || "Consulte condições")}</text>
  <text x="115" y="995" font-family="Inter, Arial" font-size="29" fill="#072D65">${escapeXml(property.customLocation || "Localização a confirmar")}</text>
  <text x="115" y="1050" font-family="Inter, Arial" font-size="27" fill="#52657C">${escapeXml([property.customType, property.customBedrooms, property.customArea].filter(Boolean).join(" · "))}</text>
  <rect x="70" y="1135" width="940" height="300" rx="34" fill="#0757B8"/>
  <text x="115" y="1200" font-family="Inter, Arial" font-weight="900" font-size="30" fill="#fff">Principais benefícios</text>
  ${benefits.map((benefit, benefitIndex) => `<text x="${benefitIndex < 4 ? 120 : 560}" y="${1255 + (benefitIndex % 4) * 45}" font-family="Inter, Arial" font-size="25" fill="#fff">• ${escapeXml(trimText(benefit.text, 28))}</text>`).join("")}
  <text x="80" y="1490" font-family="Inter, Arial" font-weight="900" font-size="28" fill="#0757B8">POR QUE ESTE IMÓVEL?</text>
  ${wrapSvgText(property.recommendationReason, 82, 1535, 30, 2, "#072D65", 23)}
  <text x="540" y="1585" text-anchor="middle" font-family="Inter, Arial" font-weight="900" font-size="24" fill="#0757B8">@MHM.MACHADO</text>
</svg>`
  };
}

function buildComparativePropertySvg(items, index) {
  return {
    title: `Comparativo ${index + 1}`,
    svg: `
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1620" viewBox="0 0 1080 1620">
  <rect width="1080" height="1620" fill="#DDF1FF"/>
  <text x="70" y="135" font-family="Inter, Arial" font-weight="900" font-size="52" fill="#072D65">COMPARATIVO DE IMÓVEIS</text>
  ${items.map((property, itemIndex) => propertyComparisonBlock(property, itemIndex)).join("")}
  <text x="540" y="1585" text-anchor="middle" font-family="Inter, Arial" font-weight="900" font-size="24" fill="#0757B8">@MHM.MACHADO</text>
</svg>`
  };
}

function propertyComparisonBlock(property, itemIndex) {
  const y = itemIndex === 0 ? 210 : 875;
  return `
  <rect x="70" y="${y}" width="940" height="610" rx="38" fill="#fff"/>
  ${property.imageUrl ? `<image href="${escapeXml(property.imageUrl)}" x="100" y="${y + 35}" width="370" height="300" preserveAspectRatio="xMidYMid slice"/>` : ""}
  <text x="505" y="${y + 80}" font-family="Inter, Arial" font-weight="900" font-size="36" fill="#072D65">${escapeXml(trimText(property.customName, 24))}</text>
  <text x="505" y="${y + 135}" font-family="Inter, Arial" font-weight="900" font-size="30" fill="#0757B8">${escapeXml(property.customPrice || "Consulte condições")}</text>
  <text x="505" y="${y + 185}" font-family="Inter, Arial" font-size="25" fill="#52657C">${escapeXml(property.customLocation || "")}</text>
  ${property.benefits.slice(0, 5).map((benefit, index) => `<text x="120" y="${y + 405 + index * 38}" font-family="Inter, Arial" font-size="25" fill="#072D65">• ${escapeXml(trimText(benefit.text, 50))}</text>`).join("")}
`;
}

function wrapSvgText(text, x, y, lineHeight, maxLines, fill, fontSize) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = `${line} ${word}`.trim();
    if (candidate.length > 78 && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.map((item, index) => `<text x="${x}" y="${y + index * lineHeight}" font-family="Inter, Arial" font-size="${fontSize}" fill="${fill}">${escapeXml(item)}</text>`).join("");
}

async function svgToPngDataUrl(svg) {
  const canvas = await svgToCanvas(svg);
  return canvas.toDataURL("image/png");
}

async function svgToJpegDataUrl(svg) {
  const canvas = await svgToCanvas(svg);
  return canvas.toDataURL("image/jpeg", 0.94);
}

async function svgToCanvas(svg) {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1620;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  return canvas;
}

function buildPdfFromJpegs(images, width, height) {
  const objects = [];
  const pages = [];
  let objectId = 1;

  for (const image of images) {
    const binary = atob(image.split(",")[1]);
    const imageObjectId = objectId++;
    const pageObjectId = objectId++;
    const contentObjectId = objectId++;
    objects[imageObjectId] = `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${binary.length} >>\nstream\n${binary}\nendstream`;
    objects[contentObjectId] = `<< /Length 45 >>\nstream\nq ${width} 0 0 ${height} 0 0 cm /Im${imageObjectId} Do Q\nendstream`;
    objects[pageObjectId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im${imageObjectId} ${imageObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
    pages.push(`${pageObjectId} 0 R`);
  }

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pages.join(" ")}] /Count ${pages.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 1; index < objects.length; index++) {
    offsets[index] = pdf.length;
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index++) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  const bytes = new Uint8Array(pdf.length);
  for (let index = 0; index < pdf.length; index++) bytes[index] = pdf.charCodeAt(index) & 0xff;
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

function downloadDataUrl(dataUrl, fileName) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  if (dataUrl.startsWith("blob:")) window.setTimeout(() => URL.revokeObjectURL(dataUrl), 1000);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
}

function formatCurrencyInput(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return formatCurrency(Number(digits) / 100);
}

function moneyNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value || "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function trimText(value, max) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function safeFileName(value) {
  return String(value || "cliente").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, FileText, ImageDown, Save, Search, Sparkles, Trash2 } from "lucide-react";
import { coverImage, propertyCardFeatures, propertyRegion, propertyPrice, typeLabel } from "@/lib/format";
import { DEFAULT_RECOMMENDATION_REASON } from "@/lib/simulation-mapper";

const CLIENT_WHATSAPP_NOTE_PREFIX = "WhatsApp do cadastro:";

const SEND_FORMAT_OPTIONS = [
  { value: "pdf", label: "PDF" },
  { value: "image", label: "Imagem" }
];

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
  clientWhatsApp: "",
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
  const [caixaLogoDataUri, setCaixaLogoDataUri] = useState("");
  const [simulationAssetDataUris, setSimulationAssetDataUris] = useState({
    financingIconDataUri: "",
    subsidyIconDataUri: "",
    footerStripDataUri: ""
  });
  const [propertyImageDataUris, setPropertyImageDataUris] = useState({});
  const [propertyQuery, setPropertyQuery] = useState("");
  const [activePage, setActivePage] = useState(0);
  const [sendFormat, setSendFormat] = useState("pdf");
  const [saving, setSaving] = useState(false);
  const [sendingSimulation, setSendingSimulation] = useState(false);
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

  useEffect(() => {
    let mounted = true;
    const sources = {
      caixaLogoDataUri: "/assets/caixa-logo-transparent.png",
      financingIconDataUri: "/assets/simulation-financing-icon.png",
      subsidyIconDataUri: "/assets/simulation-subsidy-icon.png",
      footerStripDataUri: "/assets/simulation-footer-strip.png"
    };

    Promise.all(
      Object.entries(sources).map(async ([key, source]) => {
        try {
          return [key, await assetToDataUri(source)];
        } catch {
          return [key, ""];
        }
      })
    ).then((entries) => {
      if (!mounted) return;
      const next = Object.fromEntries(entries);
      setCaixaLogoDataUri(next.caixaLogoDataUri || "");
      setSimulationAssetDataUris({
        financingIconDataUri: next.financingIconDataUri || "",
        subsidyIconDataUri: next.subsidyIconDataUri || "",
        footerStripDataUri: next.footerStripDataUri || ""
      });
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setForm((current) => {
      let changed = false;
      const nextProperties = current.properties.map((item) => {
        const sourceProperty = properties.find((property) => property.id === item.propertyId);
        if (!sourceProperty) return item;

        const sourceImage = coverImage(sourceProperty);
        const shouldHydrateImage = !item.imageUrl || (item.imageUrl === "/assets/hero-marilia.png" && sourceImage !== item.imageUrl);
        if (!shouldHydrateImage) return item;

        changed = true;
        return { ...item, imageUrl: sourceImage };
      });

      return changed ? { ...current, properties: nextProperties } : current;
    });
  }, [properties]);

  const propertyImageSourceKey = useMemo(
    () => form.properties.map((property) => property.imageUrl).filter(Boolean).join("|"),
    [form.properties]
  );

  useEffect(() => {
    const sources = Array.from(new Set(form.properties.map((property) => property.imageUrl).filter(Boolean)));
    if (!sources.length) return undefined;

    let cancelled = false;
    Promise.all(
      sources.map(async (source) => {
        if (source.startsWith("data:")) return [source, source];
        try {
          return [source, await assetToDataUri(source)];
        } catch {
          return [source, ""];
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      setPropertyImageDataUris((current) => {
        const next = { ...current };
        for (const [source, dataUri] of entries) {
          if (dataUri) next[source] = dataUri;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [form.properties, propertyImageSourceKey]);

  const presentationForm = useMemo(
    () => withResolvedPropertyImages(form, propertyImageDataUris),
    [form, propertyImageDataUris]
  );

  const simulationAssets = useMemo(
    () => ({ caixaLogoDataUri, ...simulationAssetDataUris }),
    [caixaLogoDataUri, simulationAssetDataUris]
  );

  const pages = useMemo(() => buildPresentationPages(presentationForm, totals, simulationAssets), [presentationForm, simulationAssets, totals]);

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

  function removeBenefit(propertyIndex, benefitIndex) {
    setForm((current) => ({
      ...current,
      properties: current.properties.map((property, itemIndex) => {
        if (itemIndex !== propertyIndex) return property;
        const benefits = property.benefits
          .filter((_, index) => index !== benefitIndex)
          .map((benefit, displayOrder) => ({ ...benefit, displayOrder }));
        return { ...property, benefits };
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
      const downloads = await createSimulationImageDownloads(form, totals, simulationAssets, propertyImageDataUris);
      for (const item of downloads) downloadDataUrl(item.dataUrl, item.fileName);
    } catch (downloadError) {
      setError(downloadError.message || "Não foi possível gerar as imagens.");
    }
  }

  async function downloadPdf() {
    setError("");
    try {
      const pdfUrl = await createSimulationPdfUrl(form, totals, simulationAssets, propertyImageDataUris);
      downloadDataUrl(pdfUrl, `simulacao-${safeFileName(form.clientName)}.pdf`);
    } catch (pdfError) {
      setError(pdfError.message || "Não foi possível gerar o PDF.");
    }
  }

  async function sendSimulationToWhatsApp() {
    const phone = normalizeClientWhatsApp(form.clientWhatsApp);
    if (!phone) {
      setError("Informe um WhatsApp válido do cliente antes de enviar a simulação.");
      setMessage("");
      return;
    }

    setSendingSimulation(true);
    setError("");
    setMessage("");
    const whatsappWindow = window.open("about:blank", "_blank");

    try {
      const format = sendFormat === "image" ? "image" : "pdf";
      if (format === "image") {
        const downloads = await createSimulationImageDownloads(form, totals, simulationAssets, propertyImageDataUris);
        for (const item of downloads) downloadDataUrl(item.dataUrl, item.fileName);
      } else {
        const pdfUrl = await createSimulationPdfUrl(form, totals, simulationAssets, propertyImageDataUris);
        downloadDataUrl(pdfUrl, `simulacao-${safeFileName(form.clientName)}.pdf`);
      }

      const whatsappUrl = buildClientWhatsAppUrl(phone, form.clientName);

      if (whatsappWindow) {
        whatsappWindow.opener = null;
        whatsappWindow.location.href = whatsappUrl;
      } else {
        window.open(whatsappUrl, "_blank", "noopener,noreferrer");
      }

      setMessage(`${format === "image" ? "Imagem baixada" : "PDF baixado"}. O WhatsApp do cliente foi aberto para voce anexar e enviar a simulacao.`);
    } catch (sendError) {
      if (whatsappWindow) whatsappWindow.close();
      setError(sendError.message || "Não foi possível preparar o envio da simulação.");
    } finally {
      setSendingSimulation(false);
    }
  }

  return (
    <div className="container-page grid min-w-0 gap-8 xl:grid-cols-[minmax(0,1fr)_460px]">
      <div className="grid min-w-0 gap-6">
        <Panel title="Dados do cliente" eyebrow="Etapa A">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome completo do cliente" value={form.clientName} onChange={(value) => update("clientName", value)} />
            <Field
              autoComplete="tel"
              inputMode="numeric"
              label="WhatsApp do cliente"
              placeholder="(14) 99999-9999"
              type="tel"
              value={form.clientWhatsApp}
              onChange={(value) => update("clientWhatsApp", formatPhoneInput(value))}
            />
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
              className="admin-input admin-search-input"
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
                      <button
                        aria-label={`Remover ${benefit.text}`}
                        className="rounded-full border border-red-100 bg-white px-3 py-1 text-red-600 transition hover:border-red-200 hover:bg-red-50"
                        onClick={() => removeBenefit(propertyIndex, benefitIndex)}
                        type="button"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        ))}

        {error ? <Alert tone="error">{error}</Alert> : null}
        {message ? <Alert tone="success">{message}</Alert> : null}

        <div className="grid gap-4 rounded-3xl border border-line bg-white p-4 shadow-soft sm:p-5">
          <div className="grid gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.14em] text-brand">Formato para envio</p>
              <p className="mt-1 text-sm font-semibold text-muted">Escolha se deseja preparar PDF ou imagem para anexar no WhatsApp.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {SEND_FORMAT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={`rounded-full px-5 py-3 text-sm font-black transition ${
                    sendFormat === option.value
                      ? "bg-navy text-white shadow-soft"
                      : "border border-line bg-white text-navy hover:border-brand"
                  }`}
                  onClick={() => setSendFormat(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <button className="premium-button-primary" disabled={saving} onClick={saveSimulation} type="button">
            <Save className="mr-2 h-5 w-5" /> {saving ? "Salvando..." : "Salvar simulação"}
          </button>
          <button className="premium-button-secondary" onClick={downloadImages} type="button">
            <ImageDown className="mr-2 h-5 w-5" /> Baixar imagens
          </button>
          <button className="premium-button-secondary" onClick={downloadPdf} type="button">
            <FileText className="mr-2 h-5 w-5" /> Baixar PDF
          </button>
          <button
            className="premium-button bg-[#25D366] text-white shadow-[0_18px_45px_rgba(18,140,82,0.24)] hover:-translate-y-0.5 hover:bg-[#20BF5A] hover:shadow-[0_22px_56px_rgba(18,140,82,0.32)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={sendingSimulation}
            onClick={sendSimulationToWhatsApp}
            type="button"
          >
            <WhatsAppIcon className="mr-2 h-5 w-5" /> {sendingSimulation ? "Preparando..." : "Enviar simulação"}
          </button>
          <Link href="/admin/simulacoes" className="premium-button-secondary">Histórico</Link>
        </div>
      </div>

      <aside className="min-w-0 xl:sticky xl:top-6 xl:self-start">
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
    <section className="min-w-0 rounded-[28px] border border-line bg-white p-4 shadow-soft sm:p-6 md:p-8">
      <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">{eyebrow}</p>
      <h2 className="mt-2 text-[clamp(1.65rem,7vw,1.875rem)] font-black leading-tight text-navy">{title}</h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Field({ label, onChange, textarea = false, type = "text", value, ...props }) {
  const Component = textarea ? "textarea" : "input";
  return (
    <label className="mt-4 grid min-w-0 gap-2 text-sm font-extrabold text-ink">
      {label}
      <Component
        className={`admin-input min-w-0 ${textarea ? "min-h-28 py-3" : ""}`}
        {...(textarea ? props : { type, ...props })}
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
      type="text"
      inputMode="decimal"
      pattern="[0-9,.]*"
      enterKeyHint="next"
      autoComplete="off"
      value={value}
      onChange={(nextValue) => onChange(formatCurrencyInput(nextValue))}
    />
  );
}

function Metric({ label, value }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-black uppercase tracking-[0.12em] text-brand">{label}</p>
      <p className="mt-1 break-words text-[clamp(1.5rem,8vw,1.875rem)] font-black leading-tight text-navy">{value}</p>
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
  const internalNote = simulation.internalNote || "";
  return {
    ...INITIAL_FORM,
    ...simulation,
    clientWhatsApp: formatPhoneInput(extractClientWhatsApp(internalNote)),
    internalNote: removeClientWhatsAppLine(internalNote),
    financingValue: formatStoredCurrencyInput(simulation.financingValue),
    subsidyValue: formatStoredCurrencyInput(simulation.subsidyValue),
    firstInstallment: formatStoredCurrencyInput(simulation.firstInstallment),
    lastInstallment: formatStoredCurrencyInput(simulation.lastInstallment),
    downPaymentValue: formatStoredCurrencyInput(simulation.downPaymentValue),
    fgtsValue: formatStoredCurrencyInput(simulation.fgtsValue),
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
    internalNote: mergeClientWhatsAppIntoInternalNote(form.internalNote, form.clientWhatsApp),
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

function withResolvedPropertyImages(form, imageDataUris = {}) {
  return {
    ...form,
    properties: form.properties.map((property) => ({
      ...property,
      imageUrl: imageDataUris[property.imageUrl] || property.imageUrl
    }))
  };
}

async function resolveSimulationImagesForExport(form, imageDataUris = {}) {
  const entries = await Promise.all(
    form.properties.map(async (property) => {
      const source = property.imageUrl;
      if (!source || source.startsWith("data:")) return [source, source || ""];
      if (imageDataUris[source]) return [source, imageDataUris[source]];
      try {
        return [source, await assetToDataUri(source)];
      } catch {
        return [source, source];
      }
    })
  );
  return withResolvedPropertyImages(form, Object.fromEntries(entries));
}

async function createSimulationPdfUrl(form, totals, simulationAssets, propertyImageDataUris) {
  const exportForm = await resolveSimulationImagesForExport(form, propertyImageDataUris);
  const svgs = buildPresentationPages(exportForm, totals, simulationAssets);
  const images = [];
  for (const page of svgs) images.push(await svgToJpegDataUrl(page.svg));
  return buildPdfFromJpegs(images, 1080, 1620);
}

async function createSimulationImageDownloads(form, totals, simulationAssets, propertyImageDataUris) {
  const exportForm = await resolveSimulationImagesForExport(form, propertyImageDataUris);
  const svgs = buildPresentationPages(exportForm, totals, simulationAssets);
  const fileBase = safeFileName(form.clientName);
  const downloads = [];
  for (const [index, page] of svgs.entries()) {
    downloads.push({
      dataUrl: await svgToPngDataUrl(page.svg),
      fileName: `simulacao-${fileBase}-${index + 1}.png`
    });
  }
  return downloads;
}

function buildPresentationPages(form, totals, simulationAssets = {}) {
  const pages = [buildSimulationResultSvg(form, totals, simulationAssets)];
  const propertyPages = form.outputMode === "comparativo"
    ? chunk(form.properties, 2).map((items, index) => buildComparativePropertySvg(items, index))
    : form.properties.map((property, index) => buildPropertySvg(property, index));
  return [...pages, ...propertyPages];
}

function buildSimulationResultSvg(form, totals, simulationAssets = {}) {
  const {
    caixaLogoDataUri = "",
    financingIconDataUri = "",
    subsidyIconDataUri = "",
    footerStripDataUri = ""
  } = simulationAssets;
  const typeLabelText = form.simulationType === "usado" ? "IMÓVEL USADO" : "IMÓVEL NOVO";
  const mainValue = totals.total;
  const subtitle = "Soma do financiamento + subsídio";
  const client = escapeXml(form.clientName || "Cliente");
  const mainValueSvg = fittedSvgText(formatCurrency(mainValue), {
    x: 540,
    y: 625,
    maxWidth: 900,
    maxFontSize: 84,
    minFontSize: 64,
    fill: "#072D65"
  });
  const financingValueSvg = fittedSvgText(formatCurrency(totals.financing), {
    x: 365,
    y: 890,
    maxWidth: 315,
    maxFontSize: 39,
    minFontSize: 30,
    fill: "#072D65"
  });
  const subsidyValueSvg = fittedSvgText(formatCurrency(totals.subsidy), {
    x: 835,
    y: 890,
    maxWidth: 290,
    maxFontSize: 39,
    minFontSize: 30,
    fill: "#072D65"
  });

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
  ${caixaLogoDataUri ? `<image href="${caixaLogoDataUri}" x="250" y="50" width="580" height="145" preserveAspectRatio="xMidYMid meet"/>` : ""}
  <text x="540" y="250" text-anchor="middle" font-family="Inter, Arial" font-weight="900" font-size="60" letter-spacing="2" fill="#0757B8">SIMULAÇÃO HABITACIONAL</text>
  <rect x="398" y="312" width="324" height="58" rx="29" fill="#fff"/>
  <circle cx="402" cy="341" r="39" fill="#0757B8"/>
  <path d="M382 341 L402 325 L422 341" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M388 338 V360 H416 V338" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"/>
  <path d="M398 360 V348 H407 V360" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>
  <text x="456" y="342" dominant-baseline="middle" font-family="Inter, Arial" font-weight="900" font-size="28" fill="#0757B8">${typeLabelText}</text>

  <rect x="42" y="430" width="996" height="520" rx="42" fill="#fff" filter="url(#shadow)"/>
  <text x="540" y="505" text-anchor="middle" font-family="Inter, Arial" font-weight="900" font-size="34" letter-spacing="1.5" fill="#0757B8">PODER TOTAL DE COMPRA:</text>
  ${mainValueSvg}
  <text x="540" y="697" text-anchor="middle" font-family="Inter, Arial" font-size="31" fill="#072D65">${escapeXml(subtitle)}</text>
  <line x1="98" x2="982" y1="760" y2="760" stroke="#B8D2F0" stroke-width="2"/>
  ${financingIconDataUri ? `<image href="${financingIconDataUri}" x="78" y="792" width="116" height="116" preserveAspectRatio="xMidYMid meet"/>` : `<circle cx="136" cy="850" r="56" fill="#0757B8"/><path d="M116 817 H147 L165 835 V881 H116 Z" fill="none" stroke="#fff" stroke-width="7" stroke-linejoin="round"/><path d="M147 817 V837 H165" fill="none" stroke="#fff" stroke-width="7" stroke-linejoin="round"/><path d="M128 848 H153 M128 865 H144" stroke="#fff" stroke-width="5" stroke-linecap="round"/><circle cx="159" cy="868" r="12" fill="none" stroke="#fff" stroke-width="5"/>`}
  <text x="365" y="826" text-anchor="middle" font-family="Inter, Arial" font-weight="900" font-size="26" fill="#0757B8">FINANCIAMENTO</text>
  ${financingValueSvg}
  <line x1="540" x2="540" y1="800" y2="905" stroke="#D8E6F6" stroke-width="3"/>
  ${subsidyIconDataUri ? `<image href="${subsidyIconDataUri}" x="570" y="792" width="116" height="116" preserveAspectRatio="xMidYMid meet"/>` : `<circle cx="628" cy="850" r="56" fill="#0757B8"/><path d="M598 865 C612 856 623 856 636 865 L658 877" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/><path d="M602 844 H622 C631 844 636 850 636 857 C636 864 631 869 622 869 H610" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path d="M639 827 V873" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M654 835 C649 829 643 827 635 828 C626 829 622 834 622 840 C622 849 631 851 639 854 C649 857 655 861 654 868 C653 876 645 880 635 879 C626 879 619 875 615 870" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`}
  <text x="835" y="826" text-anchor="middle" font-family="Inter, Arial" font-weight="900" font-size="26" fill="#0757B8">SUBSÍDIO</text>
  ${subsidyValueSvg}

  <rect x="60" y="1030" width="960" height="305" rx="38" fill="#0757B8"/>
  <text x="540" y="1115" text-anchor="middle" font-family="Inter, Arial" font-style="italic" font-size="37" fill="#fff">Cliente: ${client}</text>
  <line x1="110" x2="970" y1="1145" y2="1145" stroke="#8CC4FF" stroke-width="3"/>
  <text x="320" y="1210" text-anchor="middle" font-family="Inter, Arial" font-weight="900" font-size="28" fill="#fff">PRIMEIRA PARCELA</text>
  <text x="320" y="1282" text-anchor="middle" font-family="Inter, Arial" font-weight="900" font-size="56" fill="#fff">${escapeXml(formatCurrency(moneyNumber(form.firstInstallment)))}</text>
  <line x1="540" x2="540" y1="1180" y2="1300" stroke="#8CC4FF" stroke-width="3"/>
  <text x="765" y="1210" text-anchor="middle" font-family="Inter, Arial" font-weight="900" font-size="28" fill="#fff">ÚLTIMA PARCELA</text>
  <text x="765" y="1282" text-anchor="middle" font-family="Inter, Arial" font-weight="900" font-size="56" fill="#fff">${escapeXml(formatCurrency(moneyNumber(form.lastInstallment)))}</text>

  <text x="540" y="1390" text-anchor="middle" font-family="Inter, Arial" font-weight="900" font-size="34" letter-spacing="5" fill="#fff">WWW.MATHEUSMACHADOIMOVEIS.COM.BR</text>
  ${footerStripDataUri ? `<image href="${footerStripDataUri}" x="60" y="1410" width="960" height="195" preserveAspectRatio="xMidYMid meet"/>` : `<rect x="60" y="1445" width="960" height="125" rx="34" fill="#0757B8"/>`}
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
  <rect x="70" y="875" width="940" height="350" rx="34" fill="#0757B8"/>
  <text x="115" y="950" font-family="Inter, Arial" font-weight="900" font-size="31" fill="#fff">Principais benefícios</text>
  ${benefits.map((benefit, benefitIndex) => `<text x="${benefitIndex < 4 ? 120 : 560}" y="${1012 + (benefitIndex % 4) * 48}" font-family="Inter, Arial" font-size="26" fill="#fff">• ${escapeXml(trimText(benefit.text, 28))}</text>`).join("")}
  <rect x="70" y="1270" width="940" height="215" rx="34" fill="#fff" opacity=".9"/>
  <text x="115" y="1345" font-family="Inter, Arial" font-weight="900" font-size="28" fill="#0757B8">POR QUE ESTE IMÓVEL?</text>
  ${wrapSvgText(property.recommendationReason, 115, 1395, 33, 2, "#072D65", 24)}
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

function fittedSvgText(text, { x, y, maxWidth, maxFontSize, minFontSize, fill, weight = "900", anchor = "middle" }) {
  const value = String(text || "");
  const estimatedWidth = estimateSvgTextWidth(value, maxFontSize);
  const fontSize = estimatedWidth > maxWidth
    ? Math.max(minFontSize, Math.floor(maxFontSize * (maxWidth / estimatedWidth)))
    : maxFontSize;
  const fittedWidth = estimateSvgTextWidth(value, fontSize);
  const fitAttrs = fittedWidth > maxWidth
    ? ` textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"`
    : "";

  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Inter, Arial" font-weight="${weight}" font-size="${fontSize}" fill="${fill}"${fitAttrs}>${escapeXml(value)}</text>`;
}

function estimateSvgTextWidth(text, fontSize) {
  const widthUnits = Array.from(String(text || "")).reduce((total, char) => {
    if (char === " ") return total + 0.32;
    if (char === "." || char === ",") return total + 0.24;
    if (char === "$") return total + 0.62;
    if (/[0-9]/.test(char)) return total + 0.58;
    return total + 0.6;
  }, 0);

  return widthUnits * fontSize;
}

async function svgToPngDataUrl(svg) {
  const canvas = await svgToCanvas(svg);
  return canvas.toDataURL("image/png");
}

async function assetToDataUri(src) {
  const response = await fetch(src);
  if (!response.ok) throw new Error("Não foi possível carregar a logo da Caixa.");
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
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
  const catalogId = 1;
  const pagesId = 2;
  let nextId = 3;
  const bodies = [];
  const pageRefs = [];

  for (const [index, image] of images.entries()) {
    const imageBytes = dataUrlToBytes(image);
    const imageId = nextId++;
    const contentId = nextId++;
    const pageId = nextId++;
    const imageName = `Im${index + 1}`;
    const content = `q\n${width} 0 0 ${height} 0 0 cm\n/${imageName} Do\nQ`;

    bodies[imageId] = concatBytes(
      asciiBytes(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`),
      imageBytes,
      asciiBytes("\nendstream")
    );
    bodies[contentId] = asciiBytes(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    bodies[pageId] = asciiBytes(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /${imageName} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageRefs.push(`${pageId} 0 R`);
  }

  bodies[catalogId] = asciiBytes(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  bodies[pagesId] = asciiBytes(`<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageRefs.length} >>`);

  const maxId = nextId - 1;
  const chunks = [asciiBytes("%PDF-1.4\n")];
  const offsets = new Array(maxId + 1).fill(0);
  let length = chunks[0].length;

  for (let id = 1; id <= maxId; id += 1) {
    offsets[id] = length;
    const header = asciiBytes(`${id} 0 obj\n`);
    const footer = asciiBytes("\nendobj\n");
    chunks.push(header, bodies[id], footer);
    length += header.length + bodies[id].length + footer.length;
  }

  const xrefOffset = length;
  let xref = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id += 1) {
    xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${maxId + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(asciiBytes(xref));

  return URL.createObjectURL(new Blob(chunks, { type: "application/pdf" }));
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function asciiBytes(value) {
  return new TextEncoder().encode(value);
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
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

function formatStoredCurrencyInput(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) return formatCurrency(value);

  const text = String(value).trim();
  if (!text) return "";
  if (/^-?\d+(\.\d+)?$/.test(text) && !text.includes(",")) {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? formatCurrency(parsed) : "";
  }

  return formatCurrencyInput(text);
}

function formatPhoneInput(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length > 11) digits = digits.slice(2);
  digits = digits.slice(0, 11);

  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function normalizeClientWhatsApp(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return "";
}

function buildClientWhatsAppUrl(phone, clientName = "") {
  const firstName = getFirstName(clientName);
  const greeting = firstName ? `Olá ${firstName}!` : "Olá!";
  const message = `${greeting}\nSua simulação de financiamento ficou pronta.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function getFirstName(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean)[0] || "";
}

function extractClientWhatsApp(note) {
  const line = String(note || "")
    .split(/\r?\n/)
    .find((item) => item.trim().toLowerCase().startsWith(CLIENT_WHATSAPP_NOTE_PREFIX.toLowerCase()));
  return line ? line.replace(CLIENT_WHATSAPP_NOTE_PREFIX, "").replace(/\D/g, "") : "";
}

function removeClientWhatsAppLine(note) {
  return String(note || "")
    .split(/\r?\n/)
    .filter((item) => !item.trim().toLowerCase().startsWith(CLIENT_WHATSAPP_NOTE_PREFIX.toLowerCase()))
    .join("\n")
    .trim();
}

function mergeClientWhatsAppIntoInternalNote(note, phone) {
  const cleanedNote = removeClientWhatsAppLine(note);
  const digits = String(phone || "").replace(/\D/g, "");
  return [
    digits ? `${CLIENT_WHATSAPP_NOTE_PREFIX} ${digits}` : "",
    cleanedNote
  ].filter(Boolean).join("\n");
}

function moneyNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  const normalized = String(value || "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
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

function WhatsAppIcon({ className }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className} fill="currentColor">
      <path d="M16.04 3.2A12.74 12.74 0 0 0 5.2 22.65L3.72 28l5.48-1.43A12.75 12.75 0 1 0 16.04 3.2Zm0 2.27a10.47 10.47 0 0 1 8.86 16.04 10.47 10.47 0 0 1-14.96 2.74l-.39-.24-3.25.85.87-3.16-.26-.41A10.46 10.46 0 0 1 16.04 5.47Zm-4.45 5.62c-.22 0-.58.08-.88.42-.3.34-1.15 1.12-1.15 2.74s1.18 3.18 1.34 3.4c.16.22 2.27 3.64 5.63 4.96 2.79 1.1 3.36.88 3.96.82.6-.05 1.94-.79 2.21-1.55.27-.76.27-1.42.19-1.55-.08-.14-.3-.22-.63-.38-.33-.16-1.94-.96-2.24-1.07-.3-.11-.52-.16-.74.16-.22.33-.85 1.07-1.04 1.29-.19.22-.38.25-.71.08-.33-.16-1.38-.51-2.63-1.62-.97-.86-1.63-1.93-1.82-2.26-.19-.33-.02-.5.14-.67.15-.15.33-.38.49-.57.16-.19.22-.33.33-.55.11-.22.05-.41-.03-.57-.08-.16-.74-1.79-1.01-2.45-.27-.64-.54-.55-.74-.56h-.63Z" />
    </svg>
  );
}

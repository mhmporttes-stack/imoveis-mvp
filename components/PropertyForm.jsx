"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  BadgeDollarSign,
  Bath,
  BedDouble,
  Building2,
  CalendarClock,
  Car,
  CheckCircle2,
  Dumbbell,
  Hammer,
  Home,
  KeyRound,
  Leaf,
  MapPin,
  Percent,
  Ruler,
  ShieldCheck,
  Sparkles,
  Store,
  Trees,
  UsersRound,
  Wallet,
  Waves
} from "lucide-react";
import { DEFAULT_FEATURE_ICON, FEATURE_ICON_OPTIONS, SUGGESTED_FEATURES, normalizePropertyFeatures } from "@/lib/property-features";
import { ADMIN_REGION_OPTIONS, normalizeRegionValue } from "@/lib/property-filter-options";

const TYPE_OPTIONS = [
  { value: "apartamento", label: "Apartamento" },
  { value: "casa", label: "Casa" },
  { value: "terreno", label: "Terreno" },
  { value: "chacara", label: "Chácara" },
  { value: "casa-condominio", label: "Casa em condomínio" },
  { value: "loteamento", label: "Loteamento" },
  { value: "condominio", label: "Condomínio" }
];

const STATUS_OPTIONS = [
  "Pré-lançamento",
  "Lançamento",
  "Em obras",
  "Pronto para morar",
  "Venda",
  "Oportunidade"
];

const MAX_PHOTOS = 8;
const MAX_PHOTO_UPLOAD_BYTES = 1_200_000;

const emptyProperty = {
  name: "",
  builder: "",
  location: "",
  region: "",
  status: "",
  type: "apartamento",
  price: "",
  terms: "",
  discounts: "",
  installmentEntry: "",
  delivery: "",
  area: "",
  bedrooms: "",
  features: [],
  builderUrl: "",
  whatsapp: "",
  instagram: "",
  internalNotes: "",
  salesText: "",
  photos: [],
  pdfName: "",
  pdfData: "",
  isPublished: true,
  isFeatured: false,
  displayOrder: 0
};

export default function PropertyForm({ property }) {
  const router = useRouter();
  const [form, setForm] = useState(() => normalizeInitialProperty(property));
  const [featureDraft, setFeatureDraft] = useState("");
  const [featureIconDraft, setFeatureIconDraft] = useState(DEFAULT_FEATURE_ICON);
  const [status, setStatus] = useState("Use IA, site ou PDF para acelerar o cadastro.");
  const [photoStatus, setPhotoStatus] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [processingPhotos, setProcessingPhotos] = useState(false);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function analyzeUrl() {
    if (!form.builderUrl) {
      setStatus("Informe o link da construtora antes de analisar.");
      return;
    }
    setStatus("Lendo site e criando rascunho com IA...");
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceType: "url", url: form.builderUrl })
    });
    const draft = await response.json();
    setForm((current) => normalizeInitialProperty({ ...current, ...draft, builderUrl: current.builderUrl || draft.builderUrl }));
    setStatus("Rascunho preenchido. Revise antes de salvar.");
  }

  async function analyzePdf(file) {
    if (!file) return;
    setStatus("Extraindo texto do PDF...");
    const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.worker.min.mjs";
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str).join(" "));
    }
    setStatus("Interpretando PDF com IA...");
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceType: "pdf", text: pages.join("\n"), fileName: file.name })
    });
    const draft = await response.json();
    setForm((current) => normalizeInitialProperty({ ...current, ...draft }));
    setStatus("Rascunho preenchido. Revise antes de salvar.");
  }

  async function handlePhotos(files) {
    const selectedFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
    const limitedFiles = selectedFiles.slice(0, MAX_PHOTOS);

    if (!limitedFiles.length) {
      update("photos", []);
      setPhotoStatus("");
      return;
    }

    setProcessingPhotos(true);
    setSaveError("");
    setPhotoStatus(`Otimizando e enviando ${limitedFiles.length} foto(s)...`);

    try {
      const photos = [];

      for (let index = 0; index < limitedFiles.length; index += 1) {
        const file = limitedFiles[index];
        setPhotoStatus(`Otimizando e enviando foto ${index + 1} de ${limitedFiles.length}...`);
        let optimized = await optimizeImageFile(file);

        if (optimized.blob.size > MAX_PHOTO_UPLOAD_BYTES) {
          optimized = await optimizeImageFile(file, { maxWidth: 1280, maxHeight: 960, quality: 0.62 });
        }

        if (optimized.blob.size > MAX_PHOTO_UPLOAD_BYTES) {
          optimized = await optimizeImageFile(file, { maxWidth: 1024, maxHeight: 768, quality: 0.56 });
        }

        if (optimized.blob.size > MAX_PHOTO_UPLOAD_BYTES) {
          throw new Error(`A foto "${file.name}" continua muito grande. Tente uma versão menor.`);
        }

        const uploadedPhoto = await uploadPhoto(optimized.blob, optimized.name, property?.id || form.name || "novo-imovel");
        photos.push(uploadedPhoto);
      }

      update("photos", photos);
      const limitedText = selectedFiles.length > MAX_PHOTOS ? ` Apenas as ${MAX_PHOTOS} primeiras foram usadas.` : "";
      setPhotoStatus(`${photos.length} foto(s) enviadas para o Supabase Storage.${limitedText}`);
    } catch (error) {
      setPhotoStatus("");
      setSaveError(error.message || "Não foi possível processar as fotos. Tente imagens menores.");
    } finally {
      setProcessingPhotos(false);
    }
  }

  async function handlePdf(file) {
    if (!file) return;
    const pdf = await fileToDataUrl(file);
    setForm((current) => ({ ...current, pdfName: pdf.name, pdfData: pdf.data }));
  }

  function toggleFeature(feature) {
    setForm((current) => {
      const features = normalizeFeatures(current.features);
      const exists = features.some((item) => item.text === feature.text);
      const nextFeatures = exists
        ? features.filter((item) => item.text !== feature.text)
        : [...features, feature];
      return { ...current, features: nextFeatures };
    });
  }

  function addCustomFeature() {
    const feature = featureDraft.trim();
    if (!feature) return;
    setForm((current) => {
      const features = normalizeFeatures(current.features);
      return features.some((item) => item.text === feature)
        ? current
        : { ...current, features: [...features, { text: feature, icon: featureIconDraft }] };
    });
    setFeatureDraft("");
  }

  function removeFeature(index) {
    setForm((current) => ({
      ...current,
      features: normalizeFeatures(current.features).filter((_, itemIndex) => itemIndex !== index)
    }));
  }

  function movePhoto(index, direction) {
    setForm((current) => {
      const photos = Array.isArray(current.photos) ? current.photos : [];
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= photos.length) return current;
      const nextPhotos = [...photos];
      [nextPhotos[index], nextPhotos[nextIndex]] = [nextPhotos[nextIndex], nextPhotos[index]];
      return { ...current, photos: nextPhotos };
    });
  }

  function removePhoto(index) {
    setForm((current) => ({
      ...current,
      photos: Array.isArray(current.photos) ? current.photos.filter((_, itemIndex) => itemIndex !== index) : []
    }));
  }

  function updateFeatureIcon(index, icon) {
    setForm((current) => {
      const features = normalizeFeatures(current.features);
      if (!features[index]) return current;
      return {
        ...current,
        features: features.map((feature, itemIndex) => (
          itemIndex === index ? { ...feature, icon } : feature
        ))
      };
    });
  }

  function moveFeature(index, direction) {
    setForm((current) => {
      const features = normalizeFeatures(current.features);
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= features.length) return current;
      const nextFeatures = [...features];
      [nextFeatures[index], nextFeatures[nextIndex]] = [nextFeatures[nextIndex], nextFeatures[index]];
      return { ...current, features: nextFeatures };
    });
  }

  async function submit(event) {
    event.preventDefault();
    if (processingPhotos) return;
    setSaving(true);
    setSaveError("");
    const url = property?.id ? `/api/properties/${property.id}` : "/api/properties";
    const method = property?.id ? "PUT" : "POST";
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || `Não foi possível salvar. Código ${response.status}.`);
      }

      router.push("/admin");
      router.refresh();
    } catch (error) {
      setSaving(false);
      setSaveError(error.message || "Não foi possível salvar o empreendimento.");
      setStatus("Revise os dados e tente salvar novamente.");
    }
  }

  const selectedFeatures = normalizeFeatures(form.features);

  return (
    <form onSubmit={submit} className="container-page grid gap-8 rounded-[28px] border border-line bg-white p-8 shadow-soft">
      <section className="rounded-3xl border border-blue-100 bg-[#F4F9FF] p-6">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Cadastro inteligente</p>
            <h2 className="mt-2 text-3xl font-extrabold text-navy">Preencher com IA</h2>
            <p className="mt-2 text-muted">{status}</p>
          </div>
          <Sparkles className="h-10 w-10 text-brand" />
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="grid gap-3 rounded-2xl bg-white p-4">
            <label className="font-extrabold text-ink">Link da construtora</label>
            <input className="rounded-2xl border border-line px-4 py-3 outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" value={form.builderUrl || ""} onChange={(event) => update("builderUrl", event.target.value)} placeholder="https://..." />
            <button type="button" onClick={analyzeUrl} className="premium-button-primary">Ler site com IA</button>
          </div>
          <div className="grid gap-3 rounded-2xl bg-white p-4">
            <label className="font-extrabold text-ink">PDF ou e-book</label>
            <input type="file" accept="application/pdf" onChange={(event) => analyzePdf(event.target.files?.[0])} />
            <span className="text-sm font-semibold text-muted">O PDF gera um rascunho para revisão.</span>
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <Field label="Nome" value={form.name} onChange={(value) => update("name", value)} required />
        <Field label="Construtora" value={form.builder} onChange={(value) => update("builder", value)} />
        <label className="grid gap-2 font-extrabold text-ink">
          Região
          <select className="rounded-2xl border border-line px-4 py-3 outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" value={normalizeRegionValue(form.region)} onChange={(event) => update("region", event.target.value)}>
            <option value="">Selecione a região</option>
            {ADMIN_REGION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <Field label="Cidade, bairro ou endereço completo" value={form.location} onChange={(value) => update("location", value)} placeholder="Marília, Centro" />
        <label className="grid gap-2 font-extrabold text-ink">
          Tipo
          <select className="rounded-2xl border border-line px-4 py-3 outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" value={form.type} onChange={(event) => update("type", event.target.value)}>
            {TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="grid gap-2 font-extrabold text-ink">
          Status do empreendimento
          <select className="rounded-2xl border border-line px-4 py-3 outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" value={form.status || ""} onChange={(event) => update("status", event.target.value)}>
            <option value="">Usar padrão automático</option>
            {STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <Field label="Preço inicial" value={form.price} onChange={(value) => update("price", value)} placeholder="R$ 389.000" />
        <Field label="Prazo de entrega" value={form.delivery} onChange={(value) => update("delivery", value)} />
        <Field label="Metragem" value={form.area} onChange={(value) => update("area", value)} />
        <Field label="Quartos" value={form.bedrooms} onChange={(value) => update("bedrooms", value)} />
        <Field label="Entrada parcelada" value={form.installmentEntry} onChange={(value) => update("installmentEntry", value)} />
        <Field label="WhatsApp" value={form.whatsapp} onChange={(value) => update("whatsapp", value)} />
        <Field label="Instagram" value={form.instagram} onChange={(value) => update("instagram", value)} />
      </section>

      <section className="grid gap-5 rounded-3xl border border-line bg-[#F8FBFF] p-6">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Características</p>
          <h3 className="mt-2 text-2xl font-extrabold text-navy">Diferenciais exibidos no card</h3>
          <p className="mt-2 text-muted">Marque os itens principais, adicione personalizados e ordene os mais importantes primeiro.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SUGGESTED_FEATURES.map((feature) => (
            <label key={feature.text} className="flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 font-bold text-ink">
              <input type="checkbox" checked={selectedFeatures.some((item) => item.text === feature.text)} onChange={() => toggleFeature(feature)} />
              <FeaturePreviewIcon icon={feature.icon} />
              {feature.text}
            </label>
          ))}
        </div>

        <div className="grid gap-3 xl:grid-cols-[1fr_360px_auto]">
          <input
            value={featureDraft}
            onChange={(event) => setFeatureDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addCustomFeature();
              }
            }}
            className="min-h-12 flex-1 rounded-2xl border border-line px-4 py-3 outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
            placeholder="Ex.: 160 m², 2 vagas, varanda gourmet"
          />
          <FeatureIconPicker
            value={featureIconDraft}
            onChange={setFeatureIconDraft}
            ariaLabel="Escolher ícone do novo diferencial"
          />
          <button type="button" onClick={addCustomFeature} className="premium-button-secondary">
            Adicionar diferencial
          </button>
        </div>

        {selectedFeatures.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {selectedFeatures.map((feature, index) => (
              <div key={`${feature.text}-${index}`} className="grid gap-3 rounded-2xl border border-brand/20 bg-white p-4 sm:grid-cols-[1fr_minmax(220px,auto)_auto] sm:items-center">
                <span className="inline-flex items-center gap-2 text-sm font-extrabold text-navy">
                  <FeaturePreviewIcon icon={feature.icon} />
                  {feature.text}
                </span>
                <FeatureIconPicker
                  compact
                  value={feature.icon || DEFAULT_FEATURE_ICON}
                  onChange={(icon) => updateFeatureIcon(index, icon)}
                  ariaLabel={`Ícone de ${feature.text}`}
                />
                <span className="inline-flex items-center gap-2">
                  <button type="button" onClick={() => moveFeature(index, -1)} disabled={index === 0} className="rounded-full border border-line px-3 py-2 text-brand disabled:opacity-30" aria-label={`Mover ${feature.text} para cima`}>↑</button>
                  <button type="button" onClick={() => moveFeature(index, 1)} disabled={index === selectedFeatures.length - 1} className="rounded-full border border-line px-3 py-2 text-brand disabled:opacity-30" aria-label={`Mover ${feature.text} para baixo`}>↓</button>
                  <button type="button" onClick={() => removeFeature(index)} className="rounded-full border border-line px-3 py-2 text-slate-500 hover:text-navy" aria-label={`Remover ${feature.text}`}>×</button>
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="grid gap-5 rounded-3xl border border-line bg-white p-6 lg:grid-cols-3">
        <label className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3 font-extrabold text-ink">
          <input type="checkbox" checked={form.isPublished !== false} onChange={(event) => update("isPublished", event.target.checked)} />
          Publicar no site
        </label>
        <label className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3 font-extrabold text-ink">
          <input type="checkbox" checked={form.isFeatured === true} onChange={(event) => update("isFeatured", event.target.checked)} />
          Destaque na vitrine
        </label>
        <Field label="Ordem de exibição" type="number" value={form.displayOrder} onChange={(value) => update("displayOrder", value)} />
      </section>

      <Textarea label="Resumo para cliente" value={form.salesText} onChange={(value) => update("salesText", value)} />
      <Textarea label="Condições comerciais" value={form.terms} onChange={(value) => update("terms", value)} />
      <Textarea label="Descontos/subsídios" value={form.discounts} onChange={(value) => update("discounts", value)} />
      <Textarea label="Observações internas" value={form.internalNotes} onChange={(value) => update("internalNotes", value)} />

      <section className="grid gap-5 lg:grid-cols-2">
        <label className="grid gap-2 font-extrabold text-ink">
          Fotos
          <input type="file" accept="image/*" multiple onChange={(event) => handlePhotos(event.target.files || [])} />
          {photoStatus ? <span className="text-sm font-semibold text-muted">{photoStatus}</span> : null}
        </label>
        <label className="grid gap-2 font-extrabold text-ink">
          PDF/e-book final
          <input type="file" accept="application/pdf" onChange={(event) => handlePdf(event.target.files?.[0])} />
        </label>
      </section>

      <PhotoOrderEditor photos={form.photos} onMove={movePhoto} onRemove={removePhoto} />

      <div className="flex flex-col gap-3 border-t border-line pt-6 sm:flex-row">
        <button disabled={saving || processingPhotos} className="premium-button-primary disabled:cursor-not-allowed disabled:opacity-60" type="submit">
          {processingPhotos ? "Otimizando fotos..." : saving ? "Salvando..." : "cadastrar imóvel"}
        </button>
        <button type="button" onClick={() => router.push("/admin")} className="premium-button-secondary">
          Cancelar
        </button>
      </div>
      {saveError ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-bold text-red-700">
          {saveError}
        </p>
      ) : null}
    </form>
  );
}

function PhotoOrderEditor({ photos = [], onMove, onRemove }) {
  const orderedPhotos = Array.isArray(photos) ? photos.filter((photo) => photo?.data) : [];
  if (!orderedPhotos.length) return null;

  return (
    <section className="grid gap-5 rounded-3xl border border-line bg-[#F8FBFF] p-6">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Ordem das fotos</p>
        <h3 className="mt-2 text-2xl font-extrabold text-navy">Escolha a capa e a sequência da galeria</h3>
        <p className="mt-2 text-muted">Use as setas para ordenar. A primeira foto será a capa do imóvel no site.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {orderedPhotos.map((photo, index) => (
          <article key={`${photo.storagePath || photo.data}-${index}`} className="overflow-hidden rounded-2xl border border-line bg-white shadow-soft">
            <div className="relative aspect-[4/3] overflow-hidden bg-mist">
              <img
                src={photo.data}
                alt={photo.name || `Foto ${index + 1}`}
                className="h-full w-full object-cover"
              />
              <span className="absolute left-3 top-3 rounded-full bg-navy px-3 py-1 text-xs font-black text-white shadow-soft">
                {index === 0 ? "Capa" : `Foto ${index + 1}`}
              </span>
            </div>
            <div className="grid gap-3 p-4">
              <p className="truncate text-sm font-bold text-muted" title={photo.name || `Foto ${index + 1}`}>
                {photo.name || `Foto ${index + 1}`}
              </p>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => onMove(index, -1)}
                  disabled={index === 0}
                  className="rounded-full border border-line px-3 py-2 text-sm font-black text-brand transition hover:border-brand disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={`Mover foto ${index + 1} para cima`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => onMove(index, 1)}
                  disabled={index === orderedPhotos.length - 1}
                  className="rounded-full border border-line px-3 py-2 text-sm font-black text-brand transition hover:border-brand disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={`Mover foto ${index + 1} para baixo`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  className="rounded-full border border-line px-3 py-2 text-sm font-black text-slate-500 transition hover:border-red-200 hover:text-red-700"
                  aria-label={`Remover foto ${index + 1}`}
                >
                  ×
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Field({ label, value, onChange, ...props }) {
  return (
    <label className="grid gap-2 font-extrabold text-ink">
      {label}
      <input {...props} className="rounded-2xl border border-line px-4 py-3 outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" value={value ?? ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Textarea({ label, value, onChange }) {
  return (
    <label className="grid gap-2 font-extrabold text-ink">
      {label}
      <textarea className="min-h-32 rounded-2xl border border-line px-4 py-3 outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" value={value || ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function normalizeInitialProperty(property) {
  return {
    ...emptyProperty,
    ...(property || {}),
    region: normalizeRegionValue(property?.region) || "",
    features: normalizeFeatures(property?.features),
    isPublished: property?.isPublished === false ? false : true,
    isFeatured: property?.isFeatured === true,
    displayOrder: property?.displayOrder ?? 0
  };
}

function normalizeFeatures(features) {
  return normalizePropertyFeatures(features);
}

function FeatureIconPicker({ value, onChange, ariaLabel, compact = false }) {
  return (
    <div
      className={`flex flex-wrap gap-2 ${compact ? "" : "rounded-2xl border border-line bg-white p-2"}`}
      role="radiogroup"
      aria-label={ariaLabel || "Escolher ícone do diferencial"}
    >
      {FEATURE_ICON_OPTIONS.map((option) => {
        const Icon = FEATURE_ICONS[option.value] || Sparkles;
        const selected = value === option.value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition duration-200 focus:outline-none focus:ring-4 focus:ring-brand/20 ${
              selected
                ? "border-brand bg-brand text-white shadow-soft"
                : "border-line bg-white text-brand hover:-translate-y-0.5 hover:border-brand hover:bg-[#F4F9FF]"
            }`}
            aria-label={`Usar ícone ${option.label}`}
            aria-pressed={selected}
            title={option.label}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

function FeaturePreviewIcon({ icon }) {
  const Icon = FEATURE_ICONS[icon] || Sparkles;
  return <Icon className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />;
}

const FEATURE_ICONS = {
  bath: Bath,
  bed: BedDouble,
  building: Building2,
  calendar: CalendarClock,
  car: Car,
  check: CheckCircle2,
  dumbbell: Dumbbell,
  hammer: Hammer,
  home: Home,
  key: KeyRound,
  leaf: Leaf,
  map: MapPin,
  money: BadgeDollarSign,
  percent: Percent,
  ruler: Ruler,
  shield: ShieldCheck,
  sparkles: Sparkles,
  store: Store,
  trees: Trees,
  users: UsersRound,
  wallet: Wallet,
  waves: Waves
};

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, data: reader.result });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function optimizeImageFile(file, options = {}) {
  const { maxWidth = 1600, maxHeight = 1200, quality = 0.74 } = options;
  const image = await loadImage(file);
  const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });

  if (!context) {
    throw new Error("Não foi possível otimizar a imagem neste navegador.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const blob = await canvasToBlob(canvas, quality);
  return {
    name: file.name.replace(/\.[^.]+$/, ".jpg"),
    blob
  };
}

async function uploadPhoto(blob, name, propertyId) {
  const formData = new FormData();
  formData.append("file", blob, name);
  formData.append("propertyId", propertyId);

  const response = await fetch("/api/uploads/images", {
    method: "POST",
    body: formData
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error || `Não foi possível enviar ${name}.`);
  }

  return {
    name: result.name || name,
    data: result.data,
    storagePath: result.storagePath
  };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível carregar uma das imagens selecionadas."));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("Não foi possível compactar a imagem."));
    }, "image/jpeg", quality);
  });
}

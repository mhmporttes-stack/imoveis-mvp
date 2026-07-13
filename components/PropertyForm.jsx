"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sparkles } from "lucide-react";

const REGION_OPTIONS = [
  "Zona Norte",
  "Zona Sul",
  "Zona Leste",
  "Zona Oeste",
  "Região Central",
  "Distrito Industrial",
  "Próximo ao Centro",
  "Condomínio Esmeralda",
  "Jardim Aquarius",
  "Outra"
];

const STATUS_OPTIONS = [
  "Pré-lançamento",
  "Lançamento",
  "Em obras",
  "Pronto para morar",
  "Venda",
  "Oportunidade"
];

const FEATURE_OPTIONS = [
  "2 quartos",
  "3 quartos",
  "1 suíte",
  "2 suítes",
  "Varanda gourmet",
  "Piscina",
  "Lazer completo",
  "Churrasqueira",
  "Área de serviço",
  "Portaria 24 horas",
  "Elevador",
  "Infraestrutura completa",
  "Aceita financiamento",
  "Entrada facilitada",
  "2 vagas",
  "Pronto para construir"
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
      const nextFeatures = features.includes(feature)
        ? features.filter((item) => item !== feature)
        : [...features, feature];
      return { ...current, features: nextFeatures };
    });
  }

  function addCustomFeature() {
    const feature = featureDraft.trim();
    if (!feature) return;
    setForm((current) => {
      const features = normalizeFeatures(current.features);
      return features.includes(feature) ? current : { ...current, features: [...features, feature] };
    });
    setFeatureDraft("");
  }

  function removeFeature(feature) {
    setForm((current) => ({
      ...current,
      features: normalizeFeatures(current.features).filter((item) => item !== feature)
    }));
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
        <Field label="Região" value={form.region} onChange={(value) => update("region", value)} placeholder="Zona Norte" list="region-options" />
        <datalist id="region-options">
          {REGION_OPTIONS.map((option) => <option key={option} value={option} />)}
        </datalist>
        <Field label="Cidade, bairro ou endereço completo" value={form.location} onChange={(value) => update("location", value)} placeholder="Marília, Centro" />
        <label className="grid gap-2 font-extrabold text-ink">
          Tipo
          <select className="rounded-2xl border border-line px-4 py-3 outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" value={form.type} onChange={(event) => update("type", event.target.value)}>
            <option value="casa">Casa</option>
            <option value="apartamento">Apartamento</option>
            <option value="loteamento">Loteamento</option>
            <option value="condominio">Condomínio</option>
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
          {FEATURE_OPTIONS.map((feature) => (
            <label key={feature} className="flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 font-bold text-ink">
              <input type="checkbox" checked={selectedFeatures.includes(feature)} onChange={() => toggleFeature(feature)} />
              {feature}
            </label>
          ))}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
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
          <button type="button" onClick={addCustomFeature} className="premium-button-secondary">
            Adicionar diferencial
          </button>
        </div>

        {selectedFeatures.length ? (
          <div className="flex flex-wrap gap-3">
            {selectedFeatures.map((feature, index) => (
              <span key={`${feature}-${index}`} className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-white px-4 py-2 text-sm font-extrabold text-navy">
                {feature}
                <button type="button" onClick={() => moveFeature(index, -1)} disabled={index === 0} className="text-brand disabled:opacity-30" aria-label={`Mover ${feature} para cima`}>↑</button>
                <button type="button" onClick={() => moveFeature(index, 1)} disabled={index === selectedFeatures.length - 1} className="text-brand disabled:opacity-30" aria-label={`Mover ${feature} para baixo`}>↓</button>
                <button type="button" onClick={() => removeFeature(feature)} className="text-slate-500 hover:text-navy" aria-label={`Remover ${feature}`}>×</button>
              </span>
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

      <div className="flex flex-col gap-3 border-t border-line pt-6 sm:flex-row">
        <button disabled={saving || processingPhotos} className="premium-button-primary disabled:cursor-not-allowed disabled:opacity-60" type="submit">
          {processingPhotos ? "Otimizando fotos..." : saving ? "Salvando..." : "Salvar empreendimento"}
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
    features: normalizeFeatures(property?.features),
    isPublished: property?.isPublished === false ? false : true,
    isFeatured: property?.isFeatured === true,
    displayOrder: property?.displayOrder ?? 0
  };
}

function normalizeFeatures(features) {
  return Array.isArray(features) ? features.filter(Boolean) : [];
}

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

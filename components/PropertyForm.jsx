"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sparkles } from "lucide-react";

const emptyProperty = {
  name: "",
  builder: "",
  location: "",
  type: "apartamento",
  price: "",
  terms: "",
  discounts: "",
  installmentEntry: "",
  delivery: "",
  area: "",
  bedrooms: "",
  builderUrl: "",
  whatsapp: "",
  instagram: "",
  internalNotes: "",
  salesText: "",
  photos: [],
  pdfName: "",
  pdfData: ""
};

export default function PropertyForm({ property }) {
  const router = useRouter();
  const [form, setForm] = useState(property || emptyProperty);
  const [status, setStatus] = useState("Use IA, site ou PDF para acelerar o cadastro.");
  const [saving, setSaving] = useState(false);

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
    setForm((current) => ({ ...current, ...draft, builderUrl: current.builderUrl || draft.builderUrl }));
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
    setForm((current) => ({ ...current, ...draft }));
    setStatus("Rascunho preenchido. Revise antes de salvar.");
  }

  async function handlePhotos(files) {
    const photos = await Promise.all(Array.from(files).map(fileToDataUrl));
    update("photos", photos);
  }

  async function handlePdf(file) {
    if (!file) return;
    const pdf = await fileToDataUrl(file);
    setForm((current) => ({ ...current, pdfName: pdf.name, pdfData: pdf.data }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    const url = property?.id ? `/api/properties/${property.id}` : "/api/properties";
    const method = property?.id ? "PUT" : "POST";
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    router.push("/admin");
    router.refresh();
  }

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
        <Field label="Cidade/bairro" value={form.location} onChange={(value) => update("location", value)} placeholder="Marília, Centro" />
        <label className="grid gap-2 font-extrabold text-ink">
          Tipo
          <select className="rounded-2xl border border-line px-4 py-3 outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" value={form.type} onChange={(event) => update("type", event.target.value)}>
            <option value="casa">Casa</option>
            <option value="apartamento">Apartamento</option>
            <option value="loteamento">Loteamento</option>
            <option value="condominio">Condomínio</option>
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

      <Textarea label="Resumo para cliente" value={form.salesText} onChange={(value) => update("salesText", value)} />
      <Textarea label="Condições comerciais" value={form.terms} onChange={(value) => update("terms", value)} />
      <Textarea label="Descontos/subsídios" value={form.discounts} onChange={(value) => update("discounts", value)} />
      <Textarea label="Observações internas" value={form.internalNotes} onChange={(value) => update("internalNotes", value)} />

      <section className="grid gap-5 lg:grid-cols-2">
        <label className="grid gap-2 font-extrabold text-ink">
          Fotos
          <input type="file" accept="image/*" multiple onChange={(event) => handlePhotos(event.target.files || [])} />
        </label>
        <label className="grid gap-2 font-extrabold text-ink">
          PDF/e-book final
          <input type="file" accept="application/pdf" onChange={(event) => handlePdf(event.target.files?.[0])} />
        </label>
      </section>

      <div className="flex flex-col gap-3 border-t border-line pt-6 sm:flex-row">
        <button disabled={saving} className="premium-button-primary" type="submit">
          {saving ? "Salvando..." : "Salvar empreendimento"}
        </button>
        <button type="button" onClick={() => router.push("/admin")} className="premium-button-secondary">
          Cancelar
        </button>
      </div>
    </form>
  );
}

function Field({ label, value, onChange, ...props }) {
  return (
    <label className="grid gap-2 font-extrabold text-ink">
      {label}
      <input {...props} className="rounded-2xl border border-line px-4 py-3 outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" value={value || ""} onChange={(event) => onChange(event.target.value)} />
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

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, data: reader.result });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

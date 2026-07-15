"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ImageIcon, PlayCircle, Quote } from "lucide-react";

const MEDIA_TYPES = [
  { value: "none", label: "Sem mídia" },
  { value: "image", label: "Imagem" },
  { value: "video_upload", label: "Vídeo enviado" },
  { value: "video_url", label: "Vídeo por link" }
];

const emptyTestimonial = {
  clientName: "",
  clientDescription: "",
  testimonialText: "",
  mediaType: "none",
  imageUrl: "",
  imageStoragePath: "",
  videoUrl: "",
  videoStoragePath: "",
  videoThumbnailUrl: "",
  videoThumbnailStoragePath: "",
  displayOrder: 0,
  isPublished: true,
  authorizationConfirmed: false
};

export default function TestimonialForm({ testimonial }) {
  const router = useRouter();
  const [form, setForm] = useState(() => ({ ...emptyTestimonial, ...(testimonial || {}) }));
  const [status, setStatus] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateMediaType(value) {
    setForm((current) => ({
      ...current,
      mediaType: value,
      imageUrl: value === "image" ? current.imageUrl : "",
      imageStoragePath: value === "image" ? current.imageStoragePath : "",
      videoUrl: value === "video_upload" || value === "video_url" ? current.videoUrl : "",
      videoStoragePath: value === "video_upload" ? current.videoStoragePath : "",
      videoThumbnailUrl: value === "video_upload" || value === "video_url" ? current.videoThumbnailUrl : "",
      videoThumbnailStoragePath: value === "video_upload" || value === "video_url" ? current.videoThumbnailStoragePath : ""
    }));
  }

  async function handleUpload(file, kind) {
    if (!file) return;
    setUploading(true);
    setSaveError("");
    setStatus("Enviando arquivo para o Supabase Storage...");

    try {
      const uploadFile = kind === "images" || kind === "thumbnails"
        ? await optimizeImageFile(file)
        : file;
      const formData = new FormData();
      formData.append("file", uploadFile, uploadFile.name || file.name);
      formData.append("kind", kind);
      formData.append("testimonialId", testimonial?.id || form.clientName || "novo-depoimento");

      const response = await fetch("/api/uploads/testimonials", {
        method: "POST",
        body: formData
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || "Não foi possível enviar o arquivo.");
      }

      if (kind === "images") {
        setForm((current) => ({ ...current, imageUrl: result.url, imageStoragePath: result.storagePath }));
      }

      if (kind === "videos") {
        setForm((current) => ({ ...current, videoUrl: result.url, videoStoragePath: result.storagePath }));
      }

      if (kind === "thumbnails") {
        setForm((current) => ({ ...current, videoThumbnailUrl: result.url, videoThumbnailStoragePath: result.storagePath }));
      }

      setStatus("Arquivo enviado. Revise a prévia antes de salvar.");
    } catch (error) {
      if (kind === "images" || kind === "thumbnails") {
        try {
          const optimizedFile = await optimizeImageFile(file);
          const fallbackUrl = await fileToDataUrl(optimizedFile);

          if (kind === "images") {
            setForm((current) => ({ ...current, imageUrl: fallbackUrl, imageStoragePath: "" }));
          }

          if (kind === "thumbnails") {
            setForm((current) => ({ ...current, videoThumbnailUrl: fallbackUrl, videoThumbnailStoragePath: "" }));
          }

          setSaveError("");
          setStatus("O Supabase Storage recusou o upload, mas a imagem foi otimizada e anexada ao depoimento. Ainda sera necessario salvar o cadastro.");
          return;
        } catch {
          // Mantem a mensagem original do upload se a imagem tambem nao puder ser otimizada.
        }
      }

      setStatus("");
      setSaveError(error.message || "Não foi possível enviar o arquivo.");
    } finally {
      setUploading(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (uploading) return;
    setSaving(true);
    setSaveError("");

    const url = testimonial?.id ? `/api/testimonials/${testimonial.id}` : "/api/testimonials";
    const method = testimonial?.id ? "PUT" : "POST";

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || "Não foi possível salvar o depoimento.");
      }

      router.push("/admin/depoimentos");
      router.refresh();
    } catch (error) {
      setSaving(false);
      setSaveError(error.message || "Não foi possível salvar o depoimento.");
    }
  }

  return (
    <form onSubmit={submit} className="container-page grid gap-8 rounded-[28px] border border-line bg-white p-8 shadow-soft">
      <section className="grid gap-5 lg:grid-cols-2">
        <Field label="Nome do cliente" value={form.clientName} onChange={(value) => update("clientName", value)} required />
        <Field label="Identificação curta" value={form.clientDescription} onChange={(value) => update("clientDescription", value)} placeholder="Cliente comprador" />
        <label className="grid gap-2 font-extrabold text-ink">
          Tipo de mídia
          <select className="rounded-2xl border border-line px-4 py-3 outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" value={form.mediaType} onChange={(event) => updateMediaType(event.target.value)}>
            {MEDIA_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <Field label="Ordem de exibição" type="number" value={form.displayOrder} onChange={(value) => update("displayOrder", value)} />
      </section>

      <Textarea label="Texto do depoimento" value={form.testimonialText} onChange={(value) => update("testimonialText", value)} />

      {form.mediaType === "image" ? (
        <UploadField label="Imagem do cliente ou enviada pelo cliente" accept="image/jpeg,image/png,image/webp" onChange={(file) => handleUpload(file, "images")} />
      ) : null}

      {form.mediaType === "video_upload" ? (
        <section className="grid gap-5 lg:grid-cols-2">
          <UploadField label="Vídeo enviado" accept="video/mp4,video/webm,video/quicktime" onChange={(file) => handleUpload(file, "videos")} />
          <UploadField label="Capa personalizada do vídeo" accept="image/jpeg,image/png,image/webp" onChange={(file) => handleUpload(file, "thumbnails")} />
        </section>
      ) : null}

      {form.mediaType === "video_url" ? (
        <section className="grid gap-5 lg:grid-cols-2">
          <Field label="Link externo do vídeo" value={form.videoUrl} onChange={(value) => update("videoUrl", value)} placeholder="https://..." />
          <UploadField label="Capa personalizada do vídeo" accept="image/jpeg,image/png,image/webp" onChange={(file) => handleUpload(file, "thumbnails")} />
        </section>
      ) : null}

      <section className="grid gap-5 rounded-3xl border border-line bg-[#F8FBFF] p-6 lg:grid-cols-[1fr_1fr]">
        <label className="flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 font-extrabold text-ink">
          <input type="checkbox" checked={form.isPublished === true} onChange={(event) => update("isPublished", event.target.checked)} />
          Publicar na página inicial
        </label>
        <label className="flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 font-extrabold text-ink">
          <input type="checkbox" checked={form.authorizationConfirmed === true} onChange={(event) => update("authorizationConfirmed", event.target.checked)} />
          Cliente autorizou o uso do conteúdo
        </label>
      </section>

      <Preview testimonial={form} />

      {status ? <p className="rounded-2xl border border-blue-100 bg-[#F4F9FF] px-5 py-4 font-bold text-navy">{status}</p> : null}
      {saveError ? <p className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-bold text-red-700">{saveError}</p> : null}

      <div className="flex flex-col gap-3 border-t border-line pt-6 sm:flex-row">
        <button disabled={saving || uploading} className="premium-button-primary disabled:cursor-not-allowed disabled:opacity-60" type="submit">
          {uploading ? "Enviando mídia..." : saving ? "Salvando..." : "Salvar depoimento"}
        </button>
        <button type="button" onClick={() => router.push("/admin/depoimentos")} className="premium-button-secondary">
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
      <input {...props} className="rounded-2xl border border-line px-4 py-3 outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" value={value ?? ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Textarea({ label, value, onChange }) {
  return (
    <label className="grid gap-2 font-extrabold text-ink">
      {label}
      <textarea className="min-h-36 rounded-2xl border border-line px-4 py-3 outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" value={value || ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function UploadField({ label, accept, onChange }) {
  return (
    <label className="grid gap-2 font-extrabold text-ink">
      {label}
      <input type="file" accept={accept} onChange={(event) => onChange(event.target.files?.[0])} />
    </label>
  );
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function Preview({ testimonial }) {
  const mediaImage = testimonial.mediaType === "image"
    ? testimonial.imageUrl
    : testimonial.videoThumbnailUrl;

  return (
    <section className="rounded-3xl border border-line bg-[#F8FBFF] p-6">
      <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Prévia</p>
      <article className="mt-5 overflow-hidden rounded-[24px] border border-line bg-white shadow-soft">
        {mediaImage ? (
          <div className="relative h-56 bg-mist">
            <Image src={mediaImage} alt={`Prévia de ${testimonial.clientName || "depoimento"}`} fill className="object-cover" unoptimized />
            {testimonial.mediaType === "video_upload" || testimonial.mediaType === "video_url" ? (
              <span className="absolute inset-0 grid place-items-center bg-navy/20 text-white">
                <PlayCircle className="h-14 w-14 drop-shadow-lg" />
              </span>
            ) : null}
          </div>
        ) : (
          <div className="grid h-32 place-items-center bg-mist text-brand">
            {testimonial.mediaType === "image" ? <ImageIcon className="h-10 w-10" /> : testimonial.mediaType === "none" ? <Quote className="h-10 w-10" /> : <PlayCircle className="h-10 w-10" />}
          </div>
        )}
        <div className="p-6">
          <p className="text-lg leading-8 text-ink">“{testimonial.testimonialText || "Texto do depoimento"}”</p>
          <p className="mt-5 font-extrabold text-navy">{testimonial.clientName || "Nome do cliente"}</p>
          <p className="mt-1 text-sm font-bold text-muted">{testimonial.clientDescription || "Identificação curta"}</p>
        </div>
      </article>
    </section>
  );
}

async function optimizeImageFile(file) {
  if (!file.type.startsWith("image/")) return file;

  const image = await loadImage(file);
  const maxWidth = 1400;
  const maxHeight = 1000;
  const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { alpha: false });

  if (!context) return file;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const blob = await canvasToBlob(canvas);
  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível carregar a imagem selecionada."));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Não foi possível otimizar a imagem."));
    }, "image/jpeg", 0.78);
  });
}

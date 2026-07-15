"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ImageIcon, PlayCircle, Quote } from "lucide-react";

export default function AdminTestimonialList({ testimonials = [] }) {
  const router = useRouter();

  async function removeTestimonial(testimonial) {
    if (!confirm(`Excluir depoimento de "${testimonial.clientName}"?`)) return;
    await fetch(`/api/testimonials/${testimonial.id}`, { method: "DELETE" });
    router.refresh();
  }

  async function togglePublication(testimonial) {
    await fetch(`/api/testimonials/${testimonial.id}/publish`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPublished: !testimonial.isPublished })
    });
    router.refresh();
  }

  return (
    <div className="container-page grid gap-5">
      {testimonials.length ? testimonials.map((testimonial) => (
        <article key={testimonial.id} className="grid gap-5 rounded-2xl border border-line bg-white p-4 shadow-soft lg:grid-cols-[120px_1fr_auto] lg:items-center">
          <MediaPreview testimonial={testimonial} />
          <div>
            <div className="mb-3 flex flex-wrap gap-2">
              <span className="rounded-full bg-[#E9F2FF] px-3 py-1 text-sm font-extrabold text-navy">
                {testimonial.isPublished ? "Publicado" : "Rascunho"}
              </span>
              <span className="rounded-full border border-line px-3 py-1 text-sm font-bold text-muted">
                Ordem {testimonial.displayOrder}
              </span>
              <span className="rounded-full border border-line px-3 py-1 text-sm font-bold text-muted">
                {mediaTypeLabel(testimonial.mediaType)}
              </span>
            </div>
            <h2 className="text-2xl font-extrabold text-navy">{testimonial.clientName}</h2>
            <p className="mt-1 font-bold text-brand">{testimonial.clientDescription || "Identificação a confirmar"}</p>
            <p className="mt-3 line-clamp-2 text-muted">{testimonial.testimonialText}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link className="premium-button-secondary" href={`/admin/depoimentos/${testimonial.id}`}>Editar</Link>
            <button className="premium-button-secondary" onClick={() => togglePublication(testimonial)} type="button">
              {testimonial.isPublished ? <EyeOff className="mr-2 h-5 w-5" /> : <Eye className="mr-2 h-5 w-5" />}
              {testimonial.isPublished ? "Despublicar" : "Publicar"}
            </button>
            <button className="premium-button border border-red-200 bg-white text-red-700 hover:shadow-soft" onClick={() => removeTestimonial(testimonial)} type="button">
              Excluir
            </button>
          </div>
        </article>
      )) : (
        <div className="rounded-2xl border border-line bg-white p-12 text-center shadow-soft">
          <h2 className="text-2xl font-extrabold text-navy">Nenhum depoimento cadastrado</h2>
          <p className="mt-3 text-muted">Cadastre o primeiro depoimento real para exibir na página inicial.</p>
        </div>
      )}
    </div>
  );
}

function MediaPreview({ testimonial }) {
  const image = testimonial.mediaType === "image"
    ? testimonial.imageUrl
    : testimonial.videoThumbnailUrl;

  return (
    <div className="relative mx-auto grid aspect-[9/16] w-full max-w-[150px] place-items-center overflow-hidden rounded-2xl bg-mist text-brand lg:max-w-[96px]">
      {image ? (
        <Image src={image} alt={`Mídia de ${testimonial.clientName}`} fill className="object-cover" unoptimized />
      ) : testimonial.mediaType === "video_upload" || testimonial.mediaType === "video_url" ? (
        <PlayCircle className="h-10 w-10" />
      ) : testimonial.mediaType === "image" ? (
        <ImageIcon className="h-10 w-10" />
      ) : (
        <Quote className="h-10 w-10" />
      )}
    </div>
  );
}

function mediaTypeLabel(type) {
  const labels = {
    none: "Sem mídia",
    image: "Imagem",
    video_upload: "Vídeo enviado",
    video_url: "Vídeo por link"
  };

  return labels[type] || "Sem mídia";
}

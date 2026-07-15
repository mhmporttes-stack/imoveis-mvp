"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Play, Quote, X } from "lucide-react";
import SectionHeading from "@/components/SectionHeading";

export default function TestimonialsSection({ testimonials = [] }) {
  const [activeVideo, setActiveVideo] = useState(null);
  const closeButtonRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!activeVideo) return undefined;

    previousFocusRef.current = document.activeElement;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => closeButtonRef.current?.focus(), 60);

    function handleKeyDown(event) {
      if (event.key === "Escape") closeVideo();
      if (event.key === "Tab") keepFocusInside(event);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [activeVideo]);

  if (!testimonials.length) return null;

  function openVideo(testimonial) {
    setActiveVideo(testimonial);
  }

  function closeVideo() {
    setActiveVideo(null);
  }

  function keepFocusInside(event) {
    const focusable = Array.from(document.querySelectorAll("[data-video-modal] button, [data-video-modal] video, [data-video-modal] iframe"))
      .filter((element) => !element.disabled);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <section className="bg-mist py-24">
      <SectionHeading
        eyebrow="Depoimentos"
        title="Experiências reais, decisões mais seguras."
        subtitle="Conheça a experiência de clientes atendidos durante a busca e a compra do imóvel."
        titleClassName="max-w-none md:whitespace-nowrap md:text-[clamp(2.1rem,3vw,3rem)]"
        subtitleClassName="max-w-none md:whitespace-nowrap"
      />

      <div className="container-page grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {testimonials.map((testimonial) => (
          <TestimonialCard key={testimonial.id} testimonial={testimonial} onPlay={() => openVideo(testimonial)} />
        ))}
      </div>

      {activeVideo ? (
        <VideoModal testimonial={activeVideo} closeButtonRef={closeButtonRef} onClose={closeVideo} />
      ) : null}
    </section>
  );
}

function TestimonialCard({ testimonial, onPlay }) {
  const hasImage = testimonial.mediaType === "image" && testimonial.imageUrl;
  const hasVideo = (testimonial.mediaType === "video_upload" || testimonial.mediaType === "video_url") && testimonial.videoUrl;
  const mediaImage = hasImage ? testimonial.imageUrl : testimonial.videoThumbnailUrl;
  const hasMedia = hasImage || hasVideo;

  return (
    <article className="group h-full overflow-hidden rounded-[28px] border border-line/80 bg-white shadow-[0_22px_70px_rgba(13,59,102,0.10)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_28px_90px_rgba(13,59,102,0.14)]">
      <div className={hasMedia ? "grid min-h-[520px] bg-white sm:grid-cols-[1fr_44%]" : "flex h-full flex-col bg-white"}>
        {hasMedia ? (
          <div className="relative order-1 min-h-[420px] overflow-hidden rounded-t-[28px] bg-[#EAF2FB] sm:order-2 sm:min-h-full sm:rounded-l-none sm:rounded-r-[28px]">
            {mediaImage ? (
              <Image
                src={mediaImage}
                alt={`Depoimento de ${testimonial.clientName}`}
                fill
                sizes="(min-width: 1280px) 260px, (min-width: 768px) 34vw, 70vw"
                className="testimonial-media-mask object-cover"
                unoptimized
              />
            ) : (
              <div className="grid h-full place-items-center text-brand">
                <Play className="h-12 w-12" />
              </div>
            )}

            {hasVideo ? (
              <button
                aria-label={`Reproduzir depoimento de ${testimonial.clientName}`}
                className="absolute inset-0 grid place-items-center bg-navy/10 text-white transition duration-300 hover:bg-navy/20 focus:outline-none focus:ring-4 focus:ring-brand/30"
                onClick={onPlay}
                type="button"
              >
                <span className="grid h-16 w-16 place-items-center rounded-full border border-white/35 bg-white/20 shadow-soft">
                  <Play className="ml-1 h-8 w-8 fill-white" />
                </span>
              </button>
            ) : null}
          </div>
        ) : null}

        <div className={`relative z-10 order-2 flex flex-1 flex-col bg-white p-7 sm:order-1 sm:p-8 ${hasMedia ? "sm:pr-2" : ""}`}>
          <Quote className="h-9 w-9 text-brand" aria-hidden="true" />
          <p className="mt-6 flex-1 text-[1.08rem] leading-8 text-ink sm:text-lg sm:leading-9">“{testimonial.testimonialText}”</p>
          <div className="mt-8">
            <p className="text-xl font-black leading-tight text-navy">{testimonial.clientName}</p>
            {testimonial.clientDescription ? (
              <p className="mt-1.5 text-sm font-bold leading-6 text-muted">{testimonial.clientDescription}</p>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function VideoModal({ testimonial, closeButtonRef, onClose }) {
  const videoUrl = testimonial.videoUrl;
  const embedUrl = toEmbedUrl(videoUrl);
  const isDirect = isDirectVideoUrl(videoUrl);

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[1000] grid place-items-center bg-black/88 px-4 py-8 backdrop-blur-sm"
      data-video-modal
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <div className="relative w-full max-w-5xl rounded-[28px] border border-white/15 bg-[#061A2F] p-3 shadow-[0_30px_100px_rgba(0,0,0,0.45)]">
        <button
          ref={closeButtonRef}
          aria-label="Fechar vídeo"
          className="absolute right-4 top-4 z-10 grid h-11 w-11 place-items-center rounded-full bg-white/90 text-navy shadow-soft transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-blue-200/60"
          onClick={onClose}
          type="button"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="overflow-hidden rounded-[22px] bg-black">
          {isDirect ? (
            <video
              className="max-h-[78vh] w-full bg-black"
              controls
              playsInline
              poster={testimonial.videoThumbnailUrl || undefined}
              src={videoUrl}
            />
          ) : (
            <iframe
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="aspect-video w-full"
              src={embedUrl || videoUrl}
              title={`Vídeo de ${testimonial.clientName}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function isDirectVideoUrl(url = "") {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(url) || url.includes("/storage/v1/object/public/");
}

function toEmbedUrl(url = "") {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtube.com")) {
      const id = parsed.searchParams.get("v");
      return id ? `https://www.youtube.com/embed/${id}` : url;
    }

    if (parsed.hostname.includes("youtu.be")) {
      const id = parsed.pathname.replace("/", "");
      return id ? `https://www.youtube.com/embed/${id}` : url;
    }

    if (parsed.hostname.includes("vimeo.com")) {
      const id = parsed.pathname.split("/").filter(Boolean).pop();
      return id ? `https://player.vimeo.com/video/${id}` : url;
    }

    return url;
  } catch {
    return "";
  }
}

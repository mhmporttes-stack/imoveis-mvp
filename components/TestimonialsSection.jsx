"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Play, Quote, X } from "lucide-react";
import SectionHeading from "@/components/SectionHeading";

export default function TestimonialsSection({ testimonials = [] }) {
  const [activeVideo, setActiveVideo] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [visibleCount, setVisibleCount] = useState(3);
  const closeButtonRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    function updateVisibleCount() {
      if (window.innerWidth >= 1280) {
        setVisibleCount(3);
      } else if (window.innerWidth >= 768) {
        setVisibleCount(2);
      } else {
        setVisibleCount(1);
      }
    }

    updateVisibleCount();
    window.addEventListener("resize", updateVisibleCount);
    return () => window.removeEventListener("resize", updateVisibleCount);
  }, []);

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

  useEffect(() => {
    if (!testimonials.length) return;
    setActiveIndex((index) => Math.min(index, testimonials.length - 1));
  }, [testimonials.length]);

  const canRotate = testimonials.length > visibleCount;

  useEffect(() => {
    if (!canRotate || activeVideo) return undefined;

    const interval = window.setInterval(() => {
      setActiveIndex((index) => (index + 1) % testimonials.length);
    }, 6000);

    return () => window.clearInterval(interval);
  }, [activeVideo, canRotate, testimonials.length]);

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

  function moveCarousel(direction) {
    setActiveIndex((index) => (index + direction + testimonials.length) % testimonials.length);
  }

  const visibleTestimonials = testimonials.length <= visibleCount
    ? testimonials
    : Array.from({ length: visibleCount }, (_, offset) => testimonials[(activeIndex + offset) % testimonials.length]);

  return (
    <section className="bg-mist py-24">
      <SectionHeading
        eyebrow="Depoimentos"
        title="Experiências reais, decisões mais seguras."
        subtitle="Conheça a experiência de clientes atendidos durante a busca e a compra do imóvel."
        titleClassName="max-w-none md:whitespace-nowrap md:text-[clamp(2.1rem,3vw,3rem)]"
        subtitleClassName="max-w-none md:whitespace-nowrap"
      />

      <div className="container-page">
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {visibleTestimonials.map((testimonial) => (
            <TestimonialCard key={testimonial.id} testimonial={testimonial} onPlay={() => openVideo(testimonial)} />
          ))}
        </div>

        {canRotate ? (
          <div className="mt-8 flex items-center justify-between gap-4">
            <div className="flex gap-2">
              {testimonials.map((testimonial, index) => (
                <button
                  key={testimonial.id}
                  aria-label={`Mostrar depoimento ${index + 1}`}
                  className={`h-2.5 rounded-full transition-all duration-300 ${index === activeIndex ? "w-8 bg-brand" : "w-2.5 bg-navy/18 hover:bg-navy/32"}`}
                  onClick={() => setActiveIndex(index)}
                  type="button"
                />
              ))}
            </div>

            <div className="flex gap-3">
              <button
                aria-label="Ver depoimentos anteriores"
                className="grid h-12 w-12 place-items-center rounded-full border border-line bg-white text-navy shadow-soft transition hover:-translate-y-0.5 hover:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15"
                onClick={() => moveCarousel(-1)}
                type="button"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                aria-label="Ver próximos depoimentos"
                className="grid h-12 w-12 place-items-center rounded-full border border-line bg-white text-navy shadow-soft transition hover:-translate-y-0.5 hover:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15"
                onClick={() => moveCarousel(1)}
                type="button"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>
        ) : null}
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
    <article className="group flex h-full flex-col overflow-hidden rounded-[28px] border border-line/80 bg-white shadow-[0_22px_70px_rgba(13,59,102,0.10)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_28px_90px_rgba(13,59,102,0.14)]">
      {hasMedia ? (
        <div className="bg-white px-5 pt-5">
          <div className="relative mx-auto aspect-[9/16] w-full max-w-[270px] overflow-hidden rounded-[24px] border border-line bg-[#F4F8FD] shadow-soft">
            {mediaImage ? (
              <Image
                src={mediaImage}
                alt={`Depoimento de ${testimonial.clientName}`}
                fill
                sizes="(min-width: 1280px) 260px, (min-width: 768px) 34vw, 70vw"
                className="object-contain"
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
        </div>
      ) : null}

      <div className="flex flex-1 flex-col bg-white p-7 sm:p-8">
        <Quote className="h-9 w-9 text-brand" aria-hidden="true" />
        <p className="mt-6 flex-1 text-[1.03rem] leading-8 text-ink sm:text-[1.08rem]">“{testimonial.testimonialText}”</p>
        <div className="mt-8">
          <p className="text-xl font-black leading-tight text-navy">{testimonial.clientName}</p>
          {testimonial.clientDescription ? (
            <p className="mt-1.5 text-sm font-bold leading-6 text-muted">{testimonial.clientDescription}</p>
          ) : null}
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

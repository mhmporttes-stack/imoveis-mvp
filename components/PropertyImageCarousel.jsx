"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

const AUTO_PLAY_INTERVAL = 3000;
const SWIPE_THRESHOLD = 48;

export default function PropertyImageCarousel({ photos, propertyName }) {
  const images = useMemo(
    () =>
      (photos || [])
        .filter((photo) => photo?.data)
        .map((photo, index) => ({
          src: photo.data,
          alt: photo.name || `${propertyName} - foto ${index + 1}`
        })),
    [photos, propertyName]
  );

  const [currentIndex, setCurrentIndex] = useState(0);
  const [autoPlayKey, setAutoPlayKey] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const carouselTouchStart = useRef(null);
  const carouselSwiped = useRef(false);
  const lightboxTouchStart = useRef(null);
  const hasMultipleImages = images.length > 1;
  const currentImage = images[currentIndex] || images[0];
  const lightboxImage = images[lightboxIndex] || currentImage;

  const restartAutoPlay = useCallback(() => {
    setAutoPlayKey((value) => value + 1);
  }, []);

  const nextIndex = useCallback(
    (index) => (images.length ? (index + 1) % images.length : 0),
    [images.length]
  );

  const previousIndex = useCallback(
    (index) => (images.length ? (index - 1 + images.length) % images.length : 0),
    [images.length]
  );

  const goToNext = useCallback(
    (manual = true) => {
      setCurrentIndex((index) => nextIndex(index));
      if (manual) restartAutoPlay();
    },
    [nextIndex, restartAutoPlay]
  );

  const goToPrevious = useCallback(
    (manual = true) => {
      setCurrentIndex((index) => previousIndex(index));
      if (manual) restartAutoPlay();
    },
    [previousIndex, restartAutoPlay]
  );

  const goToImage = useCallback(
    (index) => {
      setCurrentIndex(index);
      restartAutoPlay();
    },
    [restartAutoPlay]
  );

  const goToNextLightbox = useCallback(() => {
    setLightboxIndex((index) => nextIndex(index));
  }, [nextIndex]);

  const goToPreviousLightbox = useCallback(() => {
    setLightboxIndex((index) => previousIndex(index));
  }, [previousIndex]);

  const openLightbox = useCallback(() => {
    setLightboxIndex(currentIndex);
    setLightboxOpen(true);
  }, [currentIndex]);

  const closeLightbox = useCallback(() => {
    setCurrentIndex(lightboxIndex);
    setLightboxOpen(false);
    restartAutoPlay();
  }, [lightboxIndex, restartAutoPlay]);

  useEffect(() => {
    setCurrentIndex((index) => Math.min(index, Math.max(images.length - 1, 0)));
    setLightboxIndex((index) => Math.min(index, Math.max(images.length - 1, 0)));
  }, [images.length]);

  useEffect(() => {
    if (!hasMultipleImages || lightboxOpen) return undefined;

    const interval = window.setInterval(() => {
      goToNext(false);
    }, AUTO_PLAY_INTERVAL);

    return () => window.clearInterval(interval);
  }, [autoPlayKey, goToNext, hasMultipleImages, lightboxOpen]);

  useEffect(() => {
    if (!lightboxOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [lightboxOpen]);

  useEffect(() => {
    if (!lightboxOpen) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeLightbox();
      }

      if (event.key === "ArrowRight" && hasMultipleImages) {
        goToNextLightbox();
      }

      if (event.key === "ArrowLeft" && hasMultipleImages) {
        goToPreviousLightbox();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeLightbox, goToNextLightbox, goToPreviousLightbox, hasMultipleImages, lightboxOpen]);

  function handleCarouselTouchStart(event) {
    carouselTouchStart.current = event.touches[0].clientX;
  }

  function handleCarouselTouchEnd(event) {
    if (!hasMultipleImages || carouselTouchStart.current === null) return;

    const distance = event.changedTouches[0].clientX - carouselTouchStart.current;
    carouselTouchStart.current = null;

    if (Math.abs(distance) < SWIPE_THRESHOLD) return;
    carouselSwiped.current = true;
    if (distance < 0) goToNext();
    if (distance > 0) goToPrevious();
  }

  function handleLightboxTouchStart(event) {
    lightboxTouchStart.current = event.touches[0].clientX;
  }

  function handleLightboxTouchEnd(event) {
    if (!hasMultipleImages || lightboxTouchStart.current === null) return;

    const distance = event.changedTouches[0].clientX - lightboxTouchStart.current;
    lightboxTouchStart.current = null;

    if (Math.abs(distance) < SWIPE_THRESHOLD) return;
    if (distance < 0) goToNextLightbox();
    if (distance > 0) goToPreviousLightbox();
  }

  if (!currentImage) {
    return <div className="relative min-h-[520px] overflow-hidden rounded-[32px] bg-mist shadow-premium" />;
  }

  return (
    <>
      <div
        aria-label={`Abrir galeria de fotos de ${propertyName}`}
        className="relative min-h-[520px] cursor-zoom-in overflow-hidden rounded-[32px] bg-mist shadow-premium outline-none focus-visible:ring-4 focus-visible:ring-brand/30"
        onClick={() => {
          if (carouselSwiped.current) {
            carouselSwiped.current = false;
            return;
          }

          openLightbox();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openLightbox();
          }
        }}
        onTouchEnd={handleCarouselTouchEnd}
        onTouchStart={handleCarouselTouchStart}
        role="button"
        tabIndex={0}
      >
        {images.map((image, index) => (
          <Image
            alt={image.alt}
            className={`object-cover transition-opacity duration-700 ease-out ${index === currentIndex ? "opacity-100" : "opacity-0"}`}
            fill
            key={`${image.src}-${index}`}
            priority={index === 0}
            sizes="(min-width: 1024px) 56vw, 100vw"
            src={image.src}
            unoptimized
          />
        ))}

        {hasMultipleImages ? (
          <>
            <button
              aria-label="Foto anterior"
              className="absolute left-4 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/35 bg-navy/55 text-white shadow-soft backdrop-blur transition hover:bg-white hover:text-navy focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/40"
              onClick={(event) => {
                event.stopPropagation();
                goToPrevious();
              }}
              type="button"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              aria-label="Proxima foto"
              className="absolute right-4 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/35 bg-navy/55 text-white shadow-soft backdrop-blur transition hover:bg-white hover:text-navy focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/40"
              onClick={(event) => {
                event.stopPropagation();
                goToNext();
              }}
              type="button"
            >
              <ChevronRight className="h-5 w-5" />
            </button>

            <div className="absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/25 bg-navy/55 px-4 py-2 shadow-soft backdrop-blur">
              {images.map((image, index) => (
                <button
                  aria-label={`Mostrar foto ${index + 1} de ${images.length}`}
                  className={`h-2.5 rounded-full transition-all ${index === currentIndex ? "w-7 bg-white" : "w-2.5 bg-white/45 hover:bg-white/75"}`}
                  key={`${image.alt}-${index}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    goToImage(index);
                  }}
                  type="button"
                />
              ))}
            </div>
          </>
        ) : null}
      </div>

      {lightboxOpen ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-[1000] grid place-items-center bg-black/92 px-5 py-8"
          onClick={closeLightbox}
          role="dialog"
        >
          <button
            aria-label="Fechar galeria"
            className="absolute right-5 top-5 z-20 grid h-12 w-12 place-items-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur transition hover:bg-white hover:text-navy focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/35"
            onClick={(event) => {
              event.stopPropagation();
              closeLightbox();
            }}
            type="button"
          >
            <X className="h-6 w-6" />
          </button>

          {hasMultipleImages ? (
            <>
              <button
                aria-label="Foto anterior"
                className="absolute left-5 top-1/2 z-20 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur transition hover:bg-white hover:text-navy focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/35"
                onClick={(event) => {
                  event.stopPropagation();
                  goToPreviousLightbox();
                }}
                type="button"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                aria-label="Proxima foto"
                className="absolute right-5 top-1/2 z-20 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur transition hover:bg-white hover:text-navy focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/35"
                onClick={(event) => {
                  event.stopPropagation();
                  goToNextLightbox();
                }}
                type="button"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          ) : null}

          <div
            className="relative h-[82vh] w-full max-w-6xl"
            onClick={(event) => event.stopPropagation()}
            onTouchEnd={handleLightboxTouchEnd}
            onTouchStart={handleLightboxTouchStart}
          >
            <Image
              alt={lightboxImage.alt}
              className="object-contain"
              fill
              sizes="100vw"
              src={lightboxImage.src}
              unoptimized
            />
          </div>

          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-extrabold text-white backdrop-blur">
            {lightboxIndex + 1} de {images.length}
          </div>
        </div>
      ) : null}
    </>
  );
}

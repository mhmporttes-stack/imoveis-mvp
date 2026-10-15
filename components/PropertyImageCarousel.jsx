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
  // Proporção real de cada foto: no celular o quadro acompanha a foto atual (sem faixa vazia em foto deitada).
  const [ratios, setRatios] = useState({});
  const frameRef = useRef(null);
  // A foto pode já ter carregado antes da hidratação (onLoad não dispara): lê as já completas ao montar.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const found = {};
    frame.querySelectorAll("img[data-photo-index]").forEach((img) => {
      if (img.complete && img.naturalWidth && img.naturalHeight) found[img.dataset.photoIndex] = img.naturalWidth / img.naturalHeight;
    });
    if (Object.keys(found).length) setRatios((current) => ({ ...found, ...current }));
  }, []);
  // Setas (dono, 2026-10-15): sem os pontinhos de baixo; as setas aparecem na 1ª foto e, depois que ela passa, somem —
  // voltam ao passar o mouse (computador) ou ao tocar na foto (celular, por alguns segundos).
  const [leftFirstImage, setLeftFirstImage] = useState(false);
  const [arrowsRevealed, setArrowsRevealed] = useState(false);
  const revealTimer = useRef(null);
  const lastPointerType = useRef("mouse");
  useEffect(() => {
    if (currentIndex !== 0) setLeftFirstImage(true);
  }, [currentIndex]);
  useEffect(() => () => clearTimeout(revealTimer.current), []);
  const revealArrows = useCallback(() => {
    setArrowsRevealed(true);
    clearTimeout(revealTimer.current);
    revealTimer.current = setTimeout(() => setArrowsRevealed(false), 3500);
  }, []);
  const arrowsVisible = !leftFirstImage || arrowsRevealed;
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
    return <div className="relative aspect-[4/5] w-full rounded-2xl bg-mist lg:aspect-auto lg:h-full lg:min-h-[520px]" />;
  }

  return (
    <>
      <div
        aria-label={`Abrir galeria de fotos de ${propertyName}`}
        // Ficha do imóvel (dono, 2026-10-15): foto inteira e GRANDE, cantos levemente arredondados NA PRÓPRIA FOTO e a
        // mesma altura do quadro de texto ao lado (h-full no grid; no celular, proporção 4:5).
        className="group relative max-h-[80vh] w-full cursor-zoom-in outline-none focus-visible:ring-4 focus-visible:ring-brand/30 lg:!aspect-auto lg:h-full lg:max-h-none lg:min-h-[520px]"
        ref={frameRef}
        style={{ aspectRatio: String(ratios[currentIndex] || 0.8) }}
        onPointerDown={(event) => {
          lastPointerType.current = event.pointerType || "mouse";
        }}
        onClick={() => {
          if (carouselSwiped.current) {
            carouselSwiped.current = false;
            return;
          }
          // Celular: com as setas escondidas, o 1º toque só mostra as setas; o seguinte abre a galeria.
          if (lastPointerType.current !== "mouse" && hasMultipleImages && !arrowsVisible) {
            revealArrows();
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
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={image.alt}
            // Foto inteira, sem corte, centralizada e com cantos arredondados na própria imagem.
            className={`absolute inset-0 m-auto max-h-full max-w-full rounded-2xl object-contain shadow-premium transition-opacity duration-700 ease-out ${index === currentIndex ? "opacity-100" : "opacity-0"}`}
            key={`${image.src}-${index}`}
            data-photo-index={index}
            loading={index === 0 ? "eager" : "lazy"}
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (naturalWidth && naturalHeight) setRatios((current) => (current[index] ? current : { ...current, [index]: naturalWidth / naturalHeight }));
            }}
            src={image.src}
          />
        ))}

        {hasMultipleImages ? (
          <>
            <button
              aria-label="Foto anterior"
              className={`absolute left-4 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/35 bg-navy/55 text-white shadow-soft backdrop-blur transition hover:bg-white hover:text-navy focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/40 ${arrowsVisible ? "opacity-100" : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100"}`}
              onClick={(event) => {
                event.stopPropagation();
                goToPrevious();
                if (lastPointerType.current !== "mouse") revealArrows();
              }}
              type="button"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              aria-label="Proxima foto"
              className={`absolute right-4 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/35 bg-navy/55 text-white shadow-soft backdrop-blur transition hover:bg-white hover:text-navy focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/40 ${arrowsVisible ? "opacity-100" : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100"}`}
              onClick={(event) => {
                event.stopPropagation();
                goToNext();
                if (lastPointerType.current !== "mouse") revealArrows();
              }}
              type="button"
            >
              <ChevronRight className="h-5 w-5" />
            </button>

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

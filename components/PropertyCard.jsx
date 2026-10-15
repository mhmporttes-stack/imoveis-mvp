import Image from "next/image";
import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import { coverImage } from "@/lib/format";
import {
  hasPublicPrice,
  propertyDisplayTitle,
  propertyHighlights,
  propertyPlaceLine
} from "@/components/site/property-display";

// Card compacto do site (2026-10-15): no celular é uma linha (foto à esquerda, texto à direita) para caber
// vários imóveis por tela; a partir de 640px vira o card vertical. O card inteiro é o link.
// Título montado do cadastro quando o nome é genérico ("Casa" → "Casa 3 quartos · Zona Norte"); sem região
// cadastrada, a linha de localização some (nada de "Região a confirmar").
export default function PropertyCard({ property }) {
  const title = propertyDisplayTitle(property);
  const place = propertyPlaceLine(property);
  const highlights = propertyHighlights(property, 3);
  const status = String(property.status || "").trim();
  const hasPrice = hasPublicPrice(property);

  return (
    <Link
      href={`/empreendimentos/${property.id}`}
      className="group grid h-full grid-cols-[112px_minmax(0,1fr)] overflow-hidden rounded-[18px] border border-line bg-white transition duration-300 hover:-translate-y-1 hover:border-brand/30 hover:shadow-soft focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/25 sm:flex sm:flex-col sm:rounded-[22px]"
    >
      <div className="relative min-h-[128px] overflow-hidden bg-[#EAF2FB] sm:aspect-[4/3] sm:min-h-0">
        <Image
          src={coverImage(property)}
          alt={`Foto de ${title}`}
          fill
          sizes="(min-width: 1280px) 420px, (min-width: 640px) 50vw, 112px"
          className="object-cover transition duration-700 group-hover:scale-[1.035]"
        />
        {status ? (
          <span className="absolute left-3 top-3 hidden rounded-full bg-navy/90 px-3 py-1.5 text-xs font-extrabold text-white backdrop-blur sm:inline-flex">
            {status}
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3.5 sm:gap-2.5 sm:p-5">
        {status ? <span className="text-[11px] font-black uppercase tracking-[0.12em] text-brand sm:hidden">{status}</span> : null}
        <h3 className="line-clamp-2 text-[15px] font-extrabold leading-snug text-navy sm:text-xl sm:leading-tight">{title}</h3>
        {place ? (
          <p className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-muted sm:text-sm">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-brand sm:h-4 sm:w-4" aria-hidden="true" />
            <span className="truncate">{place}</span>
          </p>
        ) : null}
        {highlights.length ? (
          <p className="line-clamp-1 text-xs font-semibold text-ink-2 sm:text-sm">
            {highlights.map((feature) => feature.text).join(" · ")}
          </p>
        ) : null}

        <div className="mt-auto flex items-end justify-between gap-3 pt-1.5 sm:border-t sm:border-line sm:pt-4">
          {hasPrice ? (
            <p className="min-w-0 text-sm font-extrabold text-navy sm:text-lg">
              <span className="block text-[11px] font-bold text-muted sm:text-xs">A partir de</span>
              {property.price}
            </p>
          ) : (
            <p className="text-xs font-bold text-muted sm:text-sm">Valor sob consulta</p>
          )}
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-extrabold text-brand sm:text-sm">
            <span className="sr-only sm:not-sr-only">Ver imóvel</span>
            <ArrowRight className="h-3.5 w-3.5 transition duration-300 group-hover:translate-x-0.5 sm:h-4 sm:w-4" aria-hidden="true" />
          </span>
        </div>
      </div>
    </Link>
  );
}

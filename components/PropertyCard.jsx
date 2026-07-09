import Image from "next/image";
import Link from "next/link";
import { coverImage, propertyCity, statusLabel, typeLabel } from "@/lib/format";

export default function PropertyCard({ property, large = false }) {
  return (
    <article className="group overflow-hidden rounded-2xl border border-line bg-white shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-premium">
      <Link href={`/empreendimentos/${property.id}`} className="relative block overflow-hidden">
        <div className={large ? "relative h-[360px]" : "relative h-[260px]"}>
          <Image src={coverImage(property)} alt={property.name} fill className="object-cover transition duration-700 group-hover:scale-105" />
        </div>
        <span className="absolute left-5 top-5 rounded-full bg-navy px-4 py-2 text-sm font-black text-white">{statusLabel(property)}</span>
      </Link>
      <div className="grid gap-5 p-7">
        <div className="flex items-center justify-between gap-4">
          <span className="rounded-full bg-[#E9F2FF] px-4 py-2 text-sm font-extrabold text-navy">{typeLabel(property.type)}</span>
          <span className="font-extrabold text-muted">{propertyCity(property.location)}</span>
        </div>
        <div>
          <p className="text-sm font-black uppercase tracking-[0.16em] text-brand">{property.builder || "Construtora"}</p>
          <h3 className="mt-2 text-2xl font-extrabold leading-tight text-navy">{property.name}</h3>
          <p className="mt-3 line-clamp-3 leading-7 text-muted">{property.salesText || "Empreendimento com condições comerciais sob consulta."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {property.bedrooms ? <span className="rounded-full border border-line px-3 py-2 text-sm font-bold text-muted">{property.bedrooms}</span> : null}
          {property.area ? <span className="rounded-full border border-line px-3 py-2 text-sm font-bold text-muted">{property.area}</span> : null}
          {property.delivery ? <span className="rounded-full border border-line px-3 py-2 text-sm font-bold text-muted">{property.delivery}</span> : null}
        </div>
        <div className="flex flex-col justify-between gap-4 border-t border-line pt-5 sm:flex-row sm:items-center">
          <p className="text-xl font-black text-navy">A partir de {property.price || "consulte"}</p>
          <Link href={`/empreendimentos/${property.id}`} className="premium-button-primary">
            Ver detalhes
          </Link>
        </div>
      </div>
    </article>
  );
}

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BadgeDollarSign,
  Bath,
  BedDouble,
  Building2,
  CalendarClock,
  Car,
  CheckCircle2,
  Dumbbell,
  Hammer,
  Home,
  KeyRound,
  Leaf,
  MapPin,
  Percent,
  Ruler,
  ShieldCheck,
  Sparkles,
  Store,
  Trees,
  UsersRound,
  Wallet,
  Waves
} from "lucide-react";
import { coverImage, propertyCardFeatures, propertyPrice, propertyRegion, statusLabel } from "@/lib/format";

export default function PropertyCard({ property, large = false }) {
  const imageHeight = large ? "h-[280px] lg:h-[300px]" : "h-[230px] sm:h-[250px]";
  const features = propertyCardFeatures(property, 4);
  const price = propertyPrice(property);
  const hasPrice = Boolean(property.price?.trim());
  const status = statusLabel(property);
  const region = propertyRegion(property);

  return (
    <article className="group flex h-full overflow-hidden rounded-[24px] border border-line bg-white shadow-soft transition duration-300 hover:-translate-y-1.5 hover:shadow-premium">
      <div className="flex w-full flex-col">
        <Link
          href={`/empreendimentos/${property.id}`}
          className={`relative block ${imageHeight} overflow-hidden bg-[#EAF2FB]`}
          aria-label={`Ver detalhes de ${property.name}`}
        >
          <Image
            src={coverImage(property)}
            alt={`Foto principal de ${property.name}`}
            fill
            sizes="(min-width: 1280px) 390px, (min-width: 768px) 50vw, 100vw"
            className="object-cover transition duration-700 group-hover:scale-[1.035]"
          />
          {status ? (
            <span className="absolute left-5 top-5 rounded-full bg-navy px-4 py-2 text-xs font-extrabold text-white shadow-lg shadow-navy/20">
              {status}
            </span>
          ) : null}
        </Link>

        <div className="flex flex-1 flex-col gap-5 p-6 sm:p-7">
          <div className="grid gap-3">
            <h3 className="line-clamp-2 text-2xl font-extrabold leading-tight text-navy">
              {property.name}
            </h3>
            <p className="flex items-center gap-2 text-sm font-bold text-slate-500">
              <MapPin className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
              <span className="truncate">{region}</span>
            </p>
          </div>

          <ul className="grid min-h-[116px] gap-3" aria-label={`Diferenciais de ${property.name}`}>
            {features.length ? features.map((feature) => (
              <li key={`${feature.text}-${feature.icon}`} className="flex items-center gap-3 text-[15px] font-semibold text-slate-500">
                <FeatureIcon feature={feature} />
                <span className="line-clamp-1">{feature.text}</span>
              </li>
            )) : (
              <li className="flex items-center gap-3 text-[15px] font-semibold text-slate-500">
                <Sparkles className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                <span>Condições sob consulta</span>
              </li>
            )}
          </ul>

          <div className="mt-auto border-t border-line pt-5">
            <div className="flex flex-col gap-4">
              <div>
                {hasPrice ? (
                  <>
                    <p className="text-sm font-bold text-slate-500">A partir de</p>
                    <p className="mt-1 text-2xl font-extrabold text-navy">{price}</p>
                  </>
                ) : (
                  <p className="text-xl font-extrabold text-navy">{price}</p>
                )}
              </div>

              <Link
                href={`/empreendimentos/${property.id}`}
                className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-gradient-to-r from-navy to-brand px-6 text-sm font-extrabold text-white shadow-lg shadow-brand/20 transition duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-brand/25 focus:outline-none focus:ring-4 focus:ring-brand/25"
              >
                Ver detalhes
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function FeatureIcon({ feature }) {
  const Icon = FEATURE_ICONS[feature.icon] || Sparkles;
  return <Icon className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />;
}

const FEATURE_ICONS = {
  bath: Bath,
  bed: BedDouble,
  building: Building2,
  calendar: CalendarClock,
  car: Car,
  check: CheckCircle2,
  dumbbell: Dumbbell,
  hammer: Hammer,
  home: Home,
  key: KeyRound,
  leaf: Leaf,
  map: MapPin,
  money: BadgeDollarSign,
  percent: Percent,
  ruler: Ruler,
  shield: ShieldCheck,
  sparkles: Sparkles,
  store: Store,
  trees: Trees,
  users: UsersRound,
  wallet: Wallet,
  waves: Waves
};

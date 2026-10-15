import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, Download, FileText, KeyRound, MapPin, MessageCircle, Ruler, Wallet } from "lucide-react";
import PropertyImageCarousel from "@/components/PropertyImageCarousel";
import { coverImage, propertyRegion, whatsappLink } from "@/lib/format";
import { getPublicProperty } from "@/lib/public-properties";
import { officialWhatsappUrl } from "@/lib/official-whatsapp.mjs";

// ISR: página pública, mesmo conteúdo para todo visitante (sem sessão/auth).
// force-dynamic forçava um round-trip ao Supabase a cada visita; 60s de cache
// é imperceptível para uma ficha de empreendimento e tira carga do banco em
// todo pico de tráfego. Achado da auditoria de performance 2026-10-01.
export const revalidate = 60;

export default async function PropertyPage({ params }) {
  const { id } = await params;
  const property = await getPublicProperty(id);
  if (!property) notFound();
  const photos = property.photos?.length ? property.photos : [{ name: property.name, data: coverImage(property) }];
  const showBuilderUrl = Boolean(property.isDevelopment && property.builderUrl);
  const hasConditions = Boolean(property.terms || property.discounts || property.installmentEntry);
  const hasMaterials = Boolean(property.pdfData || showBuilderUrl);

  return (
    <main className="pb-24">
      <section className="container-wide grid gap-8 py-12 lg:grid-cols-2 lg:items-stretch">
        <PropertyImageCarousel photos={photos} propertyName={property.name} />
        <div className="flex flex-col justify-center rounded-[32px] border border-line bg-white p-6 shadow-soft md:p-8">
          {/* Título quebra em linhas e cabe no quadro (dono, 2026-10-15: "diminua o título para caber"). */}
          <h1 className="w-full text-balance break-words text-[clamp(1.75rem,3.2vw,2.75rem)] font-black leading-tight text-navy">
            {property.name}
          </h1>
          {property.salesText ? <p className="mt-4 text-base leading-7 text-muted">{property.salesText}</p> : null}
          {property.price ? (
            <div className="mt-6 rounded-3xl bg-mist p-5">
              <p className="text-sm font-black uppercase tracking-[0.16em] text-muted">Preço inicial</p>
              <strong className="mt-2 block text-3xl font-black text-navy">A partir de {property.price}</strong>
            </div>
          ) : (
            // Sem valor no site (dono, 2026-10-15): o quadro vira o botão "Valor", que abre o WhatsApp oficial.
            <a
              className="mt-6 flex items-center justify-between gap-4 rounded-3xl bg-navy px-6 py-5 text-white shadow-soft transition hover:opacity-95"
              target="_blank"
              rel="noopener noreferrer"
              href={officialWhatsappUrl(`Olá! Quero saber o valor do imóvel ${property.name}.`)}
            >
              <span className="text-3xl font-black">Valor</span>
              <span className="inline-flex items-center gap-2 text-sm font-bold"><MessageCircle className="h-5 w-5" aria-hidden="true" />Consultar no WhatsApp</span>
            </a>
          )}
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <a className="premium-button-primary" target="_blank" rel="noopener noreferrer" href={whatsappLink(property, `Olá! Quero agendar uma visita no ${property.name}.`)}>Agendar visita</a>
            <Link className="premium-button-secondary" href="/simulacao">Simular financiamento</Link>
            <a className="premium-button-secondary" target="_blank" rel="noopener noreferrer" href={whatsappLink(property)}>Conversar no WhatsApp</a>
            {property.pdfData ? <a className="premium-button-secondary" download={property.pdfName || "catalogo.pdf"} href={property.pdfData}>Receber catálogo</a> : <a className="premium-button-secondary" target="_blank" rel="noopener noreferrer" href={whatsappLink(property, `Olá! Quero receber o catálogo do ${property.name}.`)}>Receber catálogo</a>}
          </div>
        </div>
      </section>

      <section className="container-page grid grid-cols-2 gap-3 py-6 md:grid-cols-4">
        {/* Construtora só para empreendimento (dono, 2026-10-15). */}
        <Info icon={Building2} label="Construtora" value={property.isDevelopment ? property.builder : ""} />
        <Info icon={MapPin} label="Região" value={propertyRegion(property) === "Região a confirmar" ? "" : propertyRegion(property)} />
        <Info icon={Ruler} label="Metragem" value={property.area} />
        <Info icon={KeyRound} label="Quartos" value={property.bedrooms} />
      </section>

      {/* Só o que existe no cadastro aparece; nada de "a confirmar/sob consulta" (dono, 2026-10-15). */}
      {hasConditions || hasMaterials ? (
        <section className={`container-page grid gap-8 py-12 ${hasConditions && hasMaterials ? "lg:grid-cols-[1fr_0.8fr]" : ""}`}>
          {hasConditions ? (
            <div className="rounded-[28px] border border-line bg-white p-8 shadow-soft">
              <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Condições comerciais</p>
              <h2 className="mt-3 text-[clamp(1.85rem,3vw,2.5rem)] font-black leading-tight text-navy lg:whitespace-nowrap">Compra, financiamento e campanhas.</h2>
              <div className="mt-8 grid gap-6">
                {property.terms ? <TextBlock title="Condições" text={property.terms} /> : null}
                {property.discounts ? <TextBlock title="Descontos/subsídios" text={property.discounts} /> : null}
                {property.installmentEntry ? <TextBlock title="Entrada parcelada" text={property.installmentEntry} /> : null}
              </div>
            </div>
          ) : null}
          {hasMaterials ? (
            <div className="rounded-[28px] border border-line bg-white p-8 shadow-soft">
              <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Materiais</p>
              <h2 className="mt-3 text-[clamp(1.85rem,3vw,2.5rem)] font-black leading-tight text-navy lg:whitespace-nowrap">{showBuilderUrl ? "Catálogo e construtora." : "Catálogo."}</h2>
              <div className="mt-8 grid gap-3">
                {property.pdfData ? <a className="premium-button-primary" download={property.pdfName || "catalogo.pdf"} href={property.pdfData}><Download className="mr-2 h-5 w-5" />Baixar PDF</a> : null}
                {showBuilderUrl ? <a className="premium-button-secondary" target="_blank" href={property.builderUrl}><FileText className="mr-2 h-5 w-5" />Site da construtora</a> : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="container-page py-12">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Galeria</p>
        <h2 className="mt-3 text-[clamp(2rem,3.6vw,2.75rem)] font-black leading-tight text-navy md:whitespace-nowrap">{property.isDevelopment ? "Imagens do empreendimento" : "Imagens do imóvel"}</h2>
        <div className="mt-8 grid auto-rows-[220px] gap-5 md:grid-cols-4">
          {photos.map((photo, index) => (
            <div key={`${photo.name}-${index}`} className={`relative overflow-hidden rounded-3xl bg-mist ${index === 0 ? "md:col-span-2 md:row-span-2" : ""}`}>
              <Image src={photo.data} alt={photo.name || property.name} fill className="object-contain" />
            </div>
          ))}
        </div>
      </section>

      <section className="container-page py-12">
        <div className="overflow-hidden rounded-[28px] border border-line bg-white shadow-soft">
          <div className="p-8">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Localização</p>
            <h2 className="mt-3 text-[clamp(2rem,3.6vw,2.75rem)] font-black leading-tight text-navy">Mapa</h2>
          </div>
          <iframe className="h-[440px] w-full border-0" title={`Mapa de ${property.name}`} loading="lazy" src={`https://www.google.com/maps?q=${encodeURIComponent(property.location || "Marília, SP")}&output=embed`} />
        </div>
      </section>
    </main>
  );
}

// Sem valor, o quadro não aparece ("A confirmar" não faz sentido para o cliente — dono, 2026-10-15).
function Info({ icon: Icon, label, value }) {
  if (!value) return null;
  // Quadro compacto (dono, 2026-10-15: "diminua o card da região").
  return (
    <article className="flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 shadow-soft">
      <Icon className="h-5 w-5 shrink-0 text-brand" />
      <div className="min-w-0">
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-muted">{label}</p>
        <strong className="block truncate text-base text-navy">{value}</strong>
      </div>
    </article>
  );
}

function TextBlock({ title, text }) {
  return (
    <div>
      <h3 className="text-xl font-extrabold text-navy">{title}</h3>
      <p className="mt-2 leading-8 text-muted">{text}</p>
    </div>
  );
}

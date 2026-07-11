import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, Download, FileText, KeyRound, MapPin, MessageCircle, Ruler, Wallet } from "lucide-react";
import { coverImage, propertyCity, typeLabel, whatsappLink } from "@/lib/format";
import { getPublicProperty } from "@/lib/public-properties";

export const dynamic = "force-dynamic";

export default async function PropertyPage({ params }) {
  const { id } = await params;
  const property = await getPublicProperty(id);
  if (!property) notFound();
  const photos = property.photos?.length ? property.photos : [{ name: property.name, data: coverImage(property) }];

  return (
    <main className="pb-24">
      <section className="container-wide grid gap-8 py-12 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="relative min-h-[520px] overflow-hidden rounded-[32px] bg-mist shadow-premium">
          <Image src={coverImage(property)} alt={property.name} fill className="object-cover" priority />
        </div>
        <div className="flex flex-col justify-center rounded-[32px] border border-line bg-white p-8 shadow-soft md:p-12">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">{propertyCity(property.location)} · {typeLabel(property.type)}</p>
          <h1 className="mt-5 text-5xl font-black leading-none text-navy md:text-6xl">{property.name}</h1>
          <p className="mt-6 text-xl leading-9 text-muted">{property.salesText || "Empreendimento selecionado com condições comerciais sob consulta."}</p>
          <div className="mt-8 rounded-3xl bg-mist p-6">
            <p className="text-sm font-black uppercase tracking-[0.16em] text-muted">Preço inicial</p>
            <strong className="mt-2 block text-3xl font-black text-navy">A partir de {property.price || "consulte"}</strong>
          </div>
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <a className="premium-button-primary" target="_blank" rel="noopener noreferrer" href={whatsappLink(property, `Olá! Quero agendar uma visita no ${property.name}.`)}>Agendar visita</a>
            <a className="premium-button-secondary" target="_blank" rel="noopener noreferrer" href={whatsappLink(property, `Olá! Quero simular o financiamento do ${property.name}.`)}>Simular financiamento</a>
            <a className="premium-button-secondary" target="_blank" rel="noopener noreferrer" href={whatsappLink(property)}>Conversar no WhatsApp</a>
            {property.pdfData ? <a className="premium-button-secondary" download={property.pdfName || "catalogo.pdf"} href={property.pdfData}>Receber catálogo</a> : <a className="premium-button-secondary" target="_blank" rel="noopener noreferrer" href={whatsappLink(property, `Olá! Quero receber o catálogo do ${property.name}.`)}>Receber catálogo</a>}
          </div>
        </div>
      </section>

      <section className="container-page grid gap-6 py-12 md:grid-cols-4">
        <Info icon={Building2} label="Construtora" value={property.builder || "A confirmar"} />
        <Info icon={MapPin} label="Cidade" value={property.location || "Marília"} />
        <Info icon={Ruler} label="Metragem" value={property.area || "A confirmar"} />
        <Info icon={KeyRound} label="Quartos" value={property.bedrooms || "A confirmar"} />
      </section>

      <section className="container-page grid gap-8 py-12 lg:grid-cols-[1fr_0.8fr]">
        <div className="rounded-[28px] border border-line bg-white p-8 shadow-soft">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Condições comerciais</p>
          <h2 className="mt-3 text-4xl font-black text-navy">Compra, financiamento e campanhas.</h2>
          <div className="mt-8 grid gap-6">
            <TextBlock title="Condições" text={property.terms || "Consulte as condições atualizadas."} />
            <TextBlock title="Descontos/subsídios" text={property.discounts || "Campanhas sob consulta."} />
            <TextBlock title="Entrada parcelada" text={property.installmentEntry || "Condição a confirmar."} />
          </div>
        </div>
        <div className="rounded-[28px] border border-line bg-white p-8 shadow-soft">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Materiais</p>
          <h2 className="mt-3 text-4xl font-black text-navy">Catálogo e construtora.</h2>
          <div className="mt-8 grid gap-3">
            {property.pdfData ? <a className="premium-button-primary" download={property.pdfName || "catalogo.pdf"} href={property.pdfData}><Download className="mr-2 h-5 w-5" />Baixar PDF</a> : <span className="rounded-2xl bg-mist p-5 font-bold text-muted">Catálogo ainda não anexado.</span>}
            {property.builderUrl ? <a className="premium-button-secondary" target="_blank" href={property.builderUrl}><FileText className="mr-2 h-5 w-5" />Site da construtora</a> : null}
          </div>
        </div>
      </section>

      <section className="container-page py-12">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Galeria</p>
        <h2 className="mt-3 text-4xl font-black text-navy">Imagens do empreendimento</h2>
        <div className="mt-8 grid auto-rows-[220px] gap-5 md:grid-cols-4">
          {photos.map((photo, index) => (
            <div key={`${photo.name}-${index}`} className={`relative overflow-hidden rounded-3xl bg-mist ${index === 0 ? "md:col-span-2 md:row-span-2" : ""}`}>
              <Image src={photo.data} alt={photo.name || property.name} fill className="object-cover" />
            </div>
          ))}
        </div>
      </section>

      <section className="container-page py-12">
        <div className="overflow-hidden rounded-[28px] border border-line bg-white shadow-soft">
          <div className="p-8">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Localização</p>
            <h2 className="mt-3 text-4xl font-black text-navy">Mapa</h2>
          </div>
          <iframe className="h-[440px] w-full border-0" title={`Mapa de ${property.name}`} loading="lazy" src={`https://www.google.com/maps?q=${encodeURIComponent(property.location || "Marília, SP")}&output=embed`} />
        </div>
      </section>
    </main>
  );
}

function Info({ icon: Icon, label, value }) {
  return (
    <article className="rounded-2xl border border-line bg-white p-6 shadow-soft">
      <Icon className="h-7 w-7 text-brand" />
      <p className="mt-5 text-sm font-black uppercase tracking-[0.14em] text-muted">{label}</p>
      <strong className="mt-2 block text-xl text-navy">{value}</strong>
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

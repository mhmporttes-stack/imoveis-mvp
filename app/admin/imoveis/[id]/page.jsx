import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import AdminSectionNav from "@/components/AdminSectionNav";
import { requireAdminPage } from "@/lib/admin-auth";
import { buildGoogleMapsUrl, coverImage, propertyPrice, typeLabel } from "@/lib/format";
import { getProperty } from "@/lib/properties";
import { redactPropertyForAuth } from "@/lib/property-visibility";

export const dynamic = "force-dynamic";

// Detalhe só leitura de um imóvel (publicado ou não) para toda a equipe (dono, 2026-10-15). Informações internas só
// dono/gestor (redactPropertyForAuth, no servidor).
export default async function ImovelConsultaPage({ params }) {
  const auth = await requireAdminPage();
  const { id } = await params;
  const property = redactPropertyForAuth(await getProperty(id), auth);
  if (!property || property.isDevelopment) notFound();
  const photos = (property.photos || []).map((photo) => (typeof photo === "string" ? photo.trim() : photo?.data || photo?.url || photo?.src || photo?.publicUrl || "")).filter(Boolean);

  return <main className="min-h-screen bg-mist py-10 sm:py-14">
    <AdminSectionNav active="properties-catalog" />
    <section className="container-page mt-6 grid gap-6 lg:grid-cols-[minmax(280px,480px)_1fr]">
      <div className="grid content-start gap-3">
        <div className="relative min-h-[280px] overflow-hidden rounded-2xl border border-line bg-white shadow-soft"><Image src={coverImage(property)} alt={property.name} fill className="object-cover" /></div>
        {photos.length > 1 ? <div className="grid grid-cols-3 gap-2">
          {photos.slice(1, 10).map((src, index) => <a key={`${src}-${index}`} href={src} target="_blank" rel="noreferrer" className="relative aspect-square overflow-hidden rounded-xl border border-line bg-white">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={src} alt={`${property.name} — foto ${index + 2}`} loading="lazy" className="h-full w-full object-cover" /></a>)}
        </div> : null}
      </div>
      <div className="grid min-w-0 content-start gap-5 rounded-2xl border border-line bg-white p-6 shadow-soft sm:p-8">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-brand">{typeLabel(property.type)} · {property.isPublished ? "No site" : "Fora do site"}</p>
          <h1 className="mt-1 text-2xl font-black text-navy">{property.name}</h1>
          <p className="mt-1 text-xl font-black text-navy">{propertyPrice(property)}</p>
        </div>
        <Info label="Localização" value={property.location} />
        <Info label="Quartos" value={property.bedrooms} />
        <Info label="Área" value={property.area} />
        <Info label="Condições" value={property.terms || property.salesText} />
        <Info label="Diferenciais" value={(property.features || []).map((item) => (typeof item === "string" ? item : item.text)).filter(Boolean).join(" • ")} />
        {property.internalNotes ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-5"><p className="text-xs font-black uppercase tracking-[0.14em] text-amber-800">Informações internas</p><p className="mt-2 whitespace-pre-line font-semibold leading-7 text-amber-950">{property.internalNotes}</p></div> : null}
        <div className="flex flex-wrap gap-3">
          <a className="premium-button-secondary" href={buildGoogleMapsUrl(property)} target="_blank" rel="noreferrer"><MapPin className="mr-2 h-5 w-5" aria-hidden="true" />Localização</a>
          <Link className="premium-button-secondary" href="/admin/imoveis">Voltar</Link>
        </div>
      </div>
    </section>
  </main>;
}

function Info({ label, value }) {
  if (!value) return null;
  return <div><p className="text-xs font-black uppercase tracking-[0.14em] text-brand">{label}</p><p className="mt-1 whitespace-pre-line font-semibold leading-7 text-muted">{value}</p></div>;
}

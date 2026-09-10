import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import { requireAdminPage } from "@/lib/admin-auth";
import { coverImage } from "@/lib/format";
import { getProperty } from "@/lib/properties";

export const dynamic = "force-dynamic";

export default async function InternalDevelopmentPage({ params }) {
  await requireAdminPage();
  const { id } = await params;
  const property = await getProperty(id);
  if (!property?.isDevelopment) notFound();

  return <main className="min-h-screen bg-mist py-10 sm:py-14">
    <section className="container-page mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div><p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Consulta interna</p><h1 className="mt-2 text-4xl font-black text-navy">{property.name}</h1><p className="mt-3 text-muted">Informações comerciais exclusivas para atendimento.</p></div>
      <AdminLogoutButton />
    </section>
    <AdminSectionNav active="developments" />
    <section className="container-page mt-6 grid gap-6 lg:grid-cols-[minmax(280px,420px)_1fr]">
      <div className="relative min-h-[320px] overflow-hidden rounded-2xl border border-line bg-white shadow-soft"><Image src={coverImage(property)} alt={property.name} fill className="object-cover" /></div>
      <div className="grid content-start gap-5 rounded-2xl border border-line bg-white p-6 shadow-soft sm:p-8">
        <div><p className="text-xs font-black uppercase tracking-[0.14em] text-brand">Construtora</p><p className="mt-1 text-xl font-black text-navy">{property.builder || "Não informada"}</p></div>
        <Info label="Localização" value={property.location} />
        <Info label="Previsão de entrega" value={property.delivery} />
        <Info label="Informações comerciais" value={property.terms || property.salesText} />
        <Info label="Diferenciais" value={(property.features || []).map((item) => typeof item === "string" ? item : item.text).filter(Boolean).join(" • ")} />
        {property.internalNotes ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-5"><p className="text-xs font-black uppercase tracking-[0.14em] text-amber-800">Informações internas</p><p className="mt-2 whitespace-pre-line font-semibold leading-7 text-amber-950">{property.internalNotes}</p></div> : null}
        <div className="flex flex-wrap gap-3">{property.pdfData ? <a className="premium-button-primary" href={property.pdfData} target="_blank" rel="noreferrer">Abrir e-book</a> : null}<Link className="premium-button-secondary" href="/admin/empreendimentos">Voltar</Link></div>
      </div>
    </section>
  </main>;
}

function Info({ label, value }) {
  if (!value) return null;
  return <div><p className="text-xs font-black uppercase tracking-[0.14em] text-brand">{label}</p><p className="mt-1 whitespace-pre-line font-semibold leading-7 text-muted">{value}</p></div>;
}

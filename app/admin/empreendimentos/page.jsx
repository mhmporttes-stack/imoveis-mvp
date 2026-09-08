import Image from "next/image";
import Link from "next/link";
import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import { requireAdminPage } from "@/lib/admin-auth";
import { coverImage } from "@/lib/format";
import { listProperties } from "@/lib/properties";

export const dynamic = "force-dynamic";

export default async function EmpreendimentosPage() {
  await requireAdminPage();
  const properties = (await listProperties()).filter((property) => property.isPublished && property.isDevelopment);

  return <main className="min-h-screen bg-mist py-14">
    <section className="container-page mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div><p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Produtos</p><h1 className="mt-2 text-4xl font-black text-navy">Empreendimentos</h1><p className="mt-3 text-muted">Consulte condições comerciais, diferenciais e materiais de apoio.</p></div>
      <AdminLogoutButton />
    </section>
    <AdminSectionNav active="developments" />
    <section className="container-page grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {properties.map((property) => <article key={property.id} className="overflow-hidden rounded-2xl border border-line bg-white shadow-soft">
        <div className="relative aspect-[16/9] bg-slate-100"><Image src={coverImage(property)} alt={property.name} fill className="object-cover" /></div>
        <div className="grid gap-3 p-5"><div><p className="text-xs font-black uppercase text-brand">{property.builder || "Construtora não informada"}</p><h2 className="mt-1 text-xl font-black text-navy">{property.name}</h2></div>
          <p className="text-sm font-semibold text-muted">{property.location || "Localização sob consulta"}</p>
          <p className="text-sm text-muted">Entrega: {property.delivery || "a confirmar"}</p>
          <p className="line-clamp-3 text-sm leading-6 text-muted">{property.salesText || property.terms || "Condições comerciais sob consulta."}</p>
          <div className="flex flex-wrap gap-2 pt-2"><Link className="premium-button-secondary px-4 py-2 text-sm" href={`/admin/empreendimentos/consulta/${property.id}`}>Consulta interna</Link>{property.pdfData ? <a className="premium-button-secondary px-4 py-2 text-sm" href={property.pdfData} download={property.pdfName || `${property.name}.pdf`}>Baixar book</a> : null}</div>
        </div>
      </article>)}
      {!properties.length ? <p className="rounded-2xl border border-line bg-white p-8 font-bold text-muted">Nenhum empreendimento disponível para consulta.</p> : null}
    </section>
  </main>;
}

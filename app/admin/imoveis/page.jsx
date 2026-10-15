import Image from "next/image";
import Link from "next/link";
import AdminSectionNav from "@/components/AdminSectionNav";
import { requireAdminPage } from "@/lib/admin-auth";
import { coverImage, propertyPrice, typeLabel } from "@/lib/format";
import { listProperties } from "@/lib/properties";
import { redactPropertiesForAuth } from "@/lib/property-visibility";

export const dynamic = "force-dynamic";

// Consulta de imóveis para TODA a equipe (dono, 2026-10-15): corretor e associado veem todos os imóveis cadastrados,
// publicados ou não no site — só leitura (editar/publicar continua em /admin, admin e gestor). Informações internas
// filtradas no servidor (redactPropertiesForAuth).
export default async function ImoveisConsultaPage() {
  const auth = await requireAdminPage();
  const properties = redactPropertiesForAuth((await listProperties()).filter((property) => !property.isDevelopment), auth);

  return <main className="min-h-screen bg-mist py-10 sm:py-14">
    <AdminSectionNav active="properties-catalog" />
    <section className="container-page mb-6 mt-6">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-brand">Cadastros</p>
      <h1 className="mt-1 text-3xl font-black text-navy">Imóveis</h1>
      <p className="mt-1 text-sm font-semibold text-muted">Todos os imóveis cadastrados no CRM, inclusive os que não estão no site.</p>
    </section>
    <section className="container-page grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {properties.map((property) => <article key={property.id} className="min-w-0 overflow-hidden rounded-2xl border border-line bg-white shadow-soft">
        <div className="relative aspect-[16/9] bg-slate-100">
          <Image src={coverImage(property)} alt={property.name} fill className="object-cover" />
          <span className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-xs font-bold ${property.isPublished ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
            {property.isPublished ? "No site" : "Fora do site"}
          </span>
        </div>
        <div className="grid gap-2 p-5">
          <p className="text-xs font-black uppercase text-brand">{typeLabel(property.type)}</p>
          <h2 className="text-xl font-black text-navy">{property.name}</h2>
          <p className="text-sm font-semibold text-muted">{property.location || "Localização sob consulta"}</p>
          <p className="text-base font-black text-navy">{propertyPrice(property)}</p>
          <div className="pt-2"><Link className="premium-button-secondary px-4 py-2 text-sm" href={`/admin/imoveis/${property.id}`}>Ver detalhes</Link></div>
        </div>
      </article>)}
      {!properties.length ? <p className="rounded-2xl border border-line bg-white p-8 font-bold text-muted">Nenhum imóvel cadastrado.</p> : null}
    </section>
  </main>;
}

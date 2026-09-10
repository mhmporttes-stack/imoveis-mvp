"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { coverImage, propertyCity, typeLabel } from "@/lib/format";

export default function AdminPropertyList({ properties }) {
  const router = useRouter();

  async function removeProperty(property) {
    if (!confirm(`Excluir "${property.name}"?`)) return;
    await fetch(`/api/properties/${property.id}`, { method: "DELETE" });
    router.refresh();
  }

  async function togglePublished(property) {
    const nextPublished = !property.isPublished;
    const action = nextPublished ? "aprovar e publicar" : "reprovar (tirar do site)";
    if (!confirm(`Confirma ${action} "${property.name}" no site público?`)) return;

    const response = await fetch(`/api/properties/${property.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPublished: nextPublished })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      alert(data.error || "Não foi possível atualizar a publicação.");
      return;
    }

    router.refresh();
  }

  return (
    <div className="container-page grid gap-5">
      {properties.length ? properties.map((property) => (
        <article key={property.id} className="grid gap-5 rounded-2xl border border-line bg-white p-4 shadow-soft lg:grid-cols-[180px_1fr_auto] lg:items-center">
          <div className="relative h-44 overflow-hidden rounded-2xl bg-mist lg:h-32">
            <Image src={coverImage(property)} alt={property.name} fill className="object-cover" />
          </div>
          <div>
            <div className="mb-3 flex flex-wrap gap-2">
              <span className={`rounded-full px-3 py-1 text-sm font-extrabold ${property.isPublished ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{property.isPublished ? "Publicado" : "Em moderação"}</span>
              <span className="rounded-full bg-[#E9F2FF] px-3 py-1 text-sm font-extrabold text-navy">{typeLabel(property.type)}</span>
              <span className="rounded-full border border-line px-3 py-1 text-sm font-bold text-muted">{propertyCity(property.location)}</span>
            </div>
            <h2 className="text-2xl font-extrabold text-navy">{property.name}</h2>
            <p className="mt-2 text-muted">{property.builder || "Construtora a confirmar"} · {property.price || "Preço sob consulta"}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link className="premium-button-secondary" href={`/empreendimentos/${property.id}`}>Abrir</Link>
            <Link className="premium-button-secondary" href={`/admin/empreendimentos/${property.id}`}>Editar</Link>
            <Link className="premium-button-secondary" href={`/admin/empreendimentos/${property.id}?aba=regras`}>Regras de entrada</Link>
            <button
              className={`premium-button border hover:shadow-soft ${property.isPublished ? "border-amber-200 bg-white text-amber-700" : "border-emerald-200 bg-white text-emerald-700"}`}
              onClick={() => togglePublished(property)}
            >
              {property.isPublished ? "Reprovar (tirar do site)" : "Aprovar e publicar"}
            </button>
            <button className="premium-button border border-red-200 bg-white text-red-700 hover:shadow-soft" onClick={() => removeProperty(property)}>
              Excluir
            </button>
          </div>
        </article>
      )) : (
        <div className="rounded-2xl border border-line bg-white p-12 text-center shadow-soft">
          <h2 className="text-2xl font-extrabold text-navy">Nenhum empreendimento cadastrado</h2>
          <p className="mt-3 text-muted">Comece adicionando o primeiro imóvel ao portfólio.</p>
        </div>
      )}
    </div>
  );
}

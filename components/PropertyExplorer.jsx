"use client";

import { useEffect, useMemo, useState } from "react";
import PropertyCard from "@/components/PropertyCard";

export default function PropertyExplorer({ properties }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");

  useEffect(() => {
    function receiveSearch(event) {
      setQuery(event.detail || "");
    }
    window.addEventListener("home-search", receiveSearch);
    return () => window.removeEventListener("home-search", receiveSearch);
  }, []);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return properties.filter((property) => {
      const haystack = [property.name, property.builder, property.location, property.salesText].join(" ").toLowerCase();
      return (!term || haystack.includes(term)) && (!type || property.type === type);
    });
  }, [properties, query, type]);

  return (
    <section id="todos" className="py-24">
      <div className="container-page mb-10 rounded-[28px] border border-line bg-white p-6 shadow-soft">
        <div className="grid gap-5 lg:grid-cols-[1fr_240px]">
          <label className="grid gap-2 font-extrabold text-ink">
            Pesquisa
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="rounded-2xl border border-line px-5 py-4 outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
              placeholder="Nome, bairro, cidade ou construtora"
            />
          </label>
          <label className="grid gap-2 font-extrabold text-ink">
            Tipo
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
              className="rounded-2xl border border-line px-5 py-4 outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
            >
              <option value="">Todos</option>
              <option value="casa">Casa</option>
              <option value="apartamento">Apartamento</option>
              <option value="loteamento">Loteamento</option>
              <option value="condominio">Condomínio</option>
            </select>
          </label>
        </div>
      </div>

      <div className="container-page grid gap-7 md:grid-cols-2 xl:grid-cols-3">
        {filtered.length ? filtered.map((property) => <PropertyCard key={property.id} property={property} />) : (
          <div className="col-span-full rounded-2xl border border-line bg-white p-12 text-center shadow-soft">
            <h3 className="text-2xl font-extrabold text-navy">Nenhum empreendimento encontrado</h3>
            <p className="mt-3 text-muted">Tente outro bairro, cidade ou tipo de imóvel.</p>
          </div>
        )}
      </div>
    </section>
  );
}

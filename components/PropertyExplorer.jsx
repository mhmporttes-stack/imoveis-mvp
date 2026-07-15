"use client";

import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import PropertyCard from "@/components/PropertyCard";
import {
  REGION_FILTER_OPTIONS,
  PROPERTY_TYPE_OPTIONS,
  currencyInputToNumber,
  formatCurrencyInput,
  normalizeRegionValue,
  parsePriceValue,
  propertyTypeMatches
} from "@/lib/property-filter-options";
import { featureText } from "@/lib/property-features";

const EMPTY_FILTERS = {
  type: "",
  minPrice: "",
  maxPrice: "",
  region: ""
};

export default function PropertyExplorer({ properties = [] }) {
  const [query, setQuery] = useState("");
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS);
  const [activeFilters, setActiveFilters] = useState(EMPTY_FILTERS);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    function receiveSearch(event) {
      setQuery(String(event.detail || "").trim());
    }

    window.addEventListener("home-search", receiveSearch);
    return () => window.removeEventListener("home-search", receiveSearch);
  }, []);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const minPrice = currencyInputToNumber(activeFilters.minPrice);
    const maxPrice = currencyInputToNumber(activeFilters.maxPrice);

    return properties.filter((property) => {
      const haystack = [
        property.name,
        property.builder,
        property.region,
        property.location,
        property.status,
        property.salesText,
        ...(Array.isArray(property.features) ? property.features.map(featureText) : [])
      ].join(" ").toLowerCase();

      const price = parsePriceValue(property.price);
      const region = normalizeRegionValue(property.region);
      const matchesQuery = !term || haystack.includes(term);
      const matchesType = propertyTypeMatches(property.type, activeFilters.type);
      const matchesRegion = !activeFilters.region || region === activeFilters.region;
      const matchesMinPrice = minPrice === null || (price !== null && price >= minPrice);
      const matchesMaxPrice = maxPrice === null || (price !== null && price <= maxPrice);

      return matchesQuery && matchesType && matchesRegion && matchesMinPrice && matchesMaxPrice;
    });
  }, [activeFilters, properties, query]);

  const resultText = `${filtered.length} ${filtered.length === 1 ? "imóvel encontrado" : "imóveis encontrados"}`;

  function updateFilter(field, value) {
    setDraftFilters((current) => ({ ...current, [field]: value }));
  }

  function updateMoneyFilter(field, value) {
    updateFilter(field, formatCurrencyInput(value));
  }

  function applyFilters(event) {
    event?.preventDefault();
    setIsLoading(true);
    window.setTimeout(() => {
      setActiveFilters(draftFilters);
      setIsLoading(false);
    }, 280);
  }

  function clearFilters() {
    setIsLoading(true);
    window.setTimeout(() => {
      setDraftFilters(EMPTY_FILTERS);
      setActiveFilters(EMPTY_FILTERS);
      setQuery("");
      setIsLoading(false);
    }, 220);
  }

  return (
    <section id="todos" className="bg-mist py-24">
      <div className="container-page">
        <div className="mb-12 max-w-[1120px]">
          <p className="text-sm font-black uppercase tracking-[0.22em] text-brand">Busca inteligente</p>
          <h2 className="mt-3 text-[clamp(2rem,3.1vw,3.15rem)] font-black leading-[1.04] text-navy md:whitespace-nowrap">
            Encontre o imóvel ideal para você
          </h2>
          <p className="mt-4 max-w-[980px] text-[clamp(1rem,1.25vw,1.125rem)] leading-8 text-muted">
            Selecione suas preferências e veja os imóveis compatíveis com a sua busca.
          </p>
        </div>

        <form onSubmit={applyFilters} className="rounded-[28px] border border-line bg-white p-5 shadow-soft md:p-7">
          <div className="grid gap-4 lg:grid-cols-[1.05fr_1fr_1fr_1fr_auto] lg:items-end">
            <label className="grid gap-2 text-sm font-extrabold text-ink">
              Tipo do imóvel
              <select
                value={draftFilters.type}
                onChange={(event) => updateFilter("type", event.target.value)}
                className="min-h-14 rounded-2xl border border-line bg-white px-4 text-base font-bold text-ink outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
              >
                {PROPERTY_TYPE_OPTIONS.map((option) => (
                  <option key={option.value || "todos"} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-2 text-sm font-extrabold text-ink">
              Valor mínimo
              <input
                inputMode="numeric"
                value={draftFilters.minPrice}
                onChange={(event) => updateMoneyFilter("minPrice", event.target.value)}
                className="min-h-14 rounded-2xl border border-line bg-white px-4 text-base font-bold text-ink outline-none transition placeholder:font-semibold placeholder:text-muted focus:border-brand focus:ring-4 focus:ring-brand/10"
                placeholder="R$ 250.000,00"
              />
            </label>

            <label className="grid gap-2 text-sm font-extrabold text-ink">
              Valor máximo
              <input
                inputMode="numeric"
                value={draftFilters.maxPrice}
                onChange={(event) => updateMoneyFilter("maxPrice", event.target.value)}
                className="min-h-14 rounded-2xl border border-line bg-white px-4 text-base font-bold text-ink outline-none transition placeholder:font-semibold placeholder:text-muted focus:border-brand focus:ring-4 focus:ring-brand/10"
                placeholder="R$ 500.000,00"
              />
            </label>

            <label className="grid gap-2 text-sm font-extrabold text-ink">
              Região
              <select
                value={draftFilters.region}
                onChange={(event) => updateFilter("region", event.target.value)}
                className="min-h-14 rounded-2xl border border-line bg-white px-4 text-base font-bold text-ink outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
              >
                {REGION_FILTER_OPTIONS.map((option) => (
                  <option key={option.value || "todas"} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-navy to-brand px-7 text-base font-black text-white shadow-lg shadow-brand/20 transition duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-brand/25 focus:outline-none focus:ring-4 focus:ring-brand/25"
            >
              <Search className="h-5 w-5" aria-hidden="true" />
              Buscar imóveis
            </button>
          </div>

          <div className="mt-6 flex flex-col gap-4 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-full bg-[#E9F2FF] px-4 py-2 text-sm font-extrabold text-navy">
                <SlidersHorizontal className="h-4 w-4 text-brand" aria-hidden="true" />
                {resultText}
              </span>
              {query ? (
                <span className="rounded-full border border-line px-4 py-2 text-sm font-bold text-muted">
                  Busca: {query}
                </span>
              ) : null}
            </div>

            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-navy/15 bg-white px-5 text-sm font-extrabold text-navy transition duration-300 hover:-translate-y-0.5 hover:border-brand hover:shadow-soft focus:outline-none focus:ring-4 focus:ring-brand/15"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Limpar filtros
            </button>
          </div>
        </form>
      </div>

      <div className="container-wide mt-12">
        {isLoading ? (
          <PropertySkeletonGrid />
        ) : filtered.length ? (
          <div className="grid gap-8 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((property) => <PropertyCard key={property.id} property={property} />)}
          </div>
        ) : (
          <div className="mx-auto max-w-3xl rounded-[28px] border border-line bg-white p-10 text-center shadow-soft">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[#E9F2FF] text-brand">
              <Search className="h-7 w-7" aria-hidden="true" />
            </div>
            <h3 className="mt-6 text-2xl font-extrabold text-navy">
              Nenhum imóvel foi encontrado com os filtros selecionados.
            </h3>
            <p className="mt-3 leading-7 text-muted">
              Ajuste os critérios e faça uma nova busca.
            </p>
            <button type="button" onClick={clearFilters} className="premium-button-primary mt-7">
              Limpar filtros
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function PropertySkeletonGrid() {
  return (
    <div className="grid gap-8 md:grid-cols-2 xl:grid-cols-3" aria-label="Carregando imóveis">
      {Array.from({ length: 3 }).map((_, index) => (
        <article key={index} className="overflow-hidden rounded-[24px] border border-line bg-white shadow-soft">
          <div className="h-[230px] animate-pulse bg-slate-200 sm:h-[250px]" />
          <div className="grid gap-4 p-7">
            <div className="h-7 w-3/4 animate-pulse rounded-full bg-slate-200" />
            <div className="h-4 w-1/2 animate-pulse rounded-full bg-slate-200" />
            <div className="mt-3 grid gap-3">
              <div className="h-4 w-2/3 animate-pulse rounded-full bg-slate-200" />
              <div className="h-4 w-3/5 animate-pulse rounded-full bg-slate-200" />
              <div className="h-4 w-1/2 animate-pulse rounded-full bg-slate-200" />
            </div>
            <div className="mt-3 h-12 animate-pulse rounded-full bg-slate-200" />
          </div>
        </article>
      ))}
    </div>
  );
}

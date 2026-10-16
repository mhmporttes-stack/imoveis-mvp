"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, RotateCcw, Search } from "lucide-react";
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
import { hasPublicPrice, propertyDisplayTitle, propertyStage } from "@/components/site/property-display";

const EMPTY_FILTERS = { stage: "", type: "", minPrice: "", maxPrice: "", region: "" };
const PAGE_SIZE = 6;

const STAGE_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "pronto", label: "Prontos para morar" },
  { value: "planta", label: "Na planta" }
];

// Busca da home (2026-10-15): uma só lista, filtrada na hora (sem botão "Buscar" nem espera falsa), com
// 6 imóveis e "Ver mais". Os campos de valor só aparecem quando algum imóvel publicado tem preço — sem
// preço publicado, filtrar por valor zerava a lista. Âncoras antigas (#todos, #empreendimentos) continuam
// caindo aqui. ?situacao=pronto|planta na URL já abre filtrado (links do rodapé).
export default function PropertyExplorer({ properties = [] }) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const anyPrice = useMemo(() => properties.some(hasPublicPrice), [properties]);
  const availableStages = useMemo(() => new Set(properties.map(propertyStage).filter(Boolean)), [properties]);

  useEffect(() => {
    function receiveSearch(event) {
      setQuery(String(event.detail || "").trim());
    }
    function readUrl() {
      const stage = new URLSearchParams(window.location.search).get("situacao");
      if (stage === "pronto" || stage === "planta") setFilters((current) => ({ ...current, stage }));
    }
    readUrl();
    window.addEventListener("home-search", receiveSearch);
    window.addEventListener("popstate", readUrl);
    return () => {
      window.removeEventListener("home-search", receiveSearch);
      window.removeEventListener("popstate", readUrl);
    };
  }, []);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query, filters]);

  const filtered = useMemo(() => {
    const term = normalize(query);
    const minPrice = anyPrice ? currencyInputToNumber(filters.minPrice) : null;
    const maxPrice = anyPrice ? currencyInputToNumber(filters.maxPrice) : null;

    const list = properties.filter((property) => {
      const haystack = normalize([
        propertyDisplayTitle(property),
        property.name,
        property.builder,
        property.region,
        property.location,
        property.status,
        property.salesText,
        ...(Array.isArray(property.features) ? property.features.map(featureText) : [])
      ].join(" "));

      const price = parsePriceValue(property.price);
      const matchesQuery = !term || haystack.includes(term);
      const matchesStage = !filters.stage || propertyStage(property) === filters.stage;
      const matchesType = propertyTypeMatches(property.type, filters.type);
      const matchesRegion = !filters.region || normalizeRegionValue(property.region) === filters.region;
      const matchesMinPrice = minPrice === null || (price !== null && price >= minPrice);
      const matchesMaxPrice = maxPrice === null || (price !== null && price <= maxPrice);
      return matchesQuery && matchesStage && matchesType && matchesRegion && matchesMinPrice && matchesMaxPrice;
    });

    // Destaques (marcados no painel) primeiro; o resto mantém a ordem do cadastro.
    return [...list.filter((p) => p.isFeatured), ...list.filter((p) => !p.isFeatured)];
  }, [anyPrice, filters, properties, query]);

  const hasActiveFilters = Boolean(query || Object.values(filters).some(Boolean));
  const priceFilterActive = anyPrice && Boolean(filters.minPrice || filters.maxPrice);
  const shown = filtered.slice(0, visibleCount);
  const remaining = filtered.length - shown.length;

  function updateFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setQuery("");
  }

  const selectClass =
    "h-12 w-full appearance-none rounded-xl border border-line bg-white pl-3.5 pr-9 text-[15px] font-bold text-ink outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10";

  return (
    <section id="imoveis" aria-labelledby="imoveis-title" className="scroll-mt-20 py-10 sm:py-16">
      <span id="todos" className="block scroll-mt-20" aria-hidden="true" />
      <span id="empreendimentos" className="block scroll-mt-20" aria-hidden="true" />
      <div className="container-page">
        <div className="flex flex-col items-center gap-1 text-center">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-brand sm:text-sm">Imóveis em Marília</p>
            <h2 id="imoveis-title" className="mt-2 text-[clamp(1.6rem,3vw,2.5rem)] font-black uppercase leading-tight text-navy">
              Encontre o seu
            </h2>
          </div>
          <p className="text-sm font-bold text-muted" aria-live="polite">
            {filtered.length} {filtered.length === 1 ? "imóvel" : "imóveis"}
            {hasActiveFilters ? " com esses filtros" : " à venda"}
          </p>
        </div>

        <form
          onSubmit={(event) => event.preventDefault()}
          role="search"
          className="mt-5 grid gap-3 rounded-[20px] border border-line bg-mist p-3 sm:p-4"
        >
          <div className={`grid gap-3 ${anyPrice ? "lg:grid-cols-[1.6fr_1fr_1fr_1fr_1fr]" : "lg:grid-cols-[2fr_1fr_1fr]"}`}>
            <label className="flex h-12 items-center gap-2.5 rounded-xl border border-line bg-white px-3.5 transition focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/10">
              <Search className="h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
              <span className="sr-only">Buscar por bairro, nome ou diferencial</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                enterKeyHint="search"
                className="w-full min-w-0 bg-transparent text-base font-semibold text-ink outline-none placeholder:font-medium placeholder:text-faint"
                placeholder="Bairro, nome ou diferencial"
              />
            </label>

            <div className="grid grid-cols-2 gap-3 lg:contents">
              <SelectField label="Tipo" value={filters.type} onChange={(value) => updateFilter("type", value)} className={selectClass}>
                {PROPERTY_TYPE_OPTIONS.map((option) => (
                  <option key={option.value || "todos"} value={option.value}>{option.value ? option.label : "Tipo"}</option>
                ))}
              </SelectField>
              <SelectField label="Região" value={filters.region} onChange={(value) => updateFilter("region", value)} className={selectClass}>
                {REGION_FILTER_OPTIONS.map((option) => (
                  <option key={option.value || "todas"} value={option.value}>{option.value ? `Zona ${option.label}`.replace("Zona Centro", "Centro") : "Região"}</option>
                ))}
              </SelectField>
            </div>

            {anyPrice ? (
              <div className="grid grid-cols-2 gap-3 lg:contents">
                <MoneyField label="Valor mínimo" value={filters.minPrice} onChange={(value) => updateFilter("minPrice", formatCurrencyInput(value))} placeholder="Valor mínimo" />
                <MoneyField label="Valor máximo" value={filters.maxPrice} onChange={(value) => updateFilter("maxPrice", formatCurrencyInput(value))} placeholder="Valor máximo" />
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none]">
            {STAGE_OPTIONS.filter((option) => !option.value || availableStages.has(option.value)).map((option) => {
              const active = filters.stage === option.value;
              return (
                <button
                  key={option.value || "todos"}
                  type="button"
                  aria-pressed={active}
                  onClick={() => updateFilter("stage", option.value)}
                  className={`inline-flex h-10 shrink-0 items-center rounded-full px-4 text-sm font-extrabold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/20 ${
                    active ? "bg-navy text-white" : "border border-line bg-white text-navy hover:border-brand/40"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="ml-auto inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-bold text-muted transition hover:text-navy focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/20"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Limpar
              </button>
            ) : null}
          </div>
          {priceFilterActive ? (
            <p className="px-1 text-xs font-semibold text-muted">Imóveis sem valor publicado não entram no filtro de valor.</p>
          ) : null}
        </form>

        <div className="mt-5 sm:mt-8">
          {filtered.length ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
                {shown.map((property) => <PropertyCard key={property.id} property={property} />)}
              </div>
              {remaining > 0 ? (
                <div className="mt-6 flex justify-center sm:mt-8">
                  <button
                    type="button"
                    onClick={() => setVisibleCount(filtered.length)}
                    className="inline-flex h-12 items-center gap-2 rounded-full border border-navy/15 bg-white px-6 text-sm font-extrabold text-navy transition hover:border-brand hover:shadow-soft focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/20"
                  >
                    Ver mais {remaining} {remaining === 1 ? "imóvel" : "imóveis"}
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="mx-auto max-w-xl rounded-[20px] border border-line bg-white p-8 text-center">
              <h3 className="text-xl font-extrabold text-navy">Nenhum imóvel com esses filtros.</h3>
              <p className="mt-2 leading-7 text-muted">Tire algum filtro para ver mais opções.</p>
              <button type="button" onClick={clearFilters} className="premium-button-secondary mt-6 min-h-12">
                Ver todos os imóveis
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function SelectField({ label, value, onChange, className, children }) {
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={className}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
    </label>
  );
}

function MoneyField({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <input
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-xl border border-line bg-white px-3.5 text-[15px] font-bold text-ink outline-none transition placeholder:font-medium placeholder:text-faint focus:border-brand focus:ring-4 focus:ring-brand/10"
        placeholder={placeholder}
        aria-label={label}
      />
    </label>
  );
}

function normalize(value = "") {
  return String(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

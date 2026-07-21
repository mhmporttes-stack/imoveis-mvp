"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, Home, Phone, Search, UserRound } from "lucide-react";
import {
  booleanLabel,
  calculateFamilyIncome,
  formatCurrency,
  formatDateTimeBR,
  simulationTypeLabel
} from "@/lib/simulation-registration-schema";

export default function AdminRegistrationList({ registrations = [] }) {
  const [query, setQuery] = useState("");

  const filteredRegistrations = useMemo(() => {
    const text = query.trim().toLowerCase();
    const phone = query.replace(/\D/g, "");
    if (!text && !phone) return registrations;

    return registrations.filter((registration) => {
      const nameMatch = registration.fullName.toLowerCase().includes(text);
      const phoneMatch = phone ? registration.phoneNormalized.includes(phone) : false;
      return nameMatch || phoneMatch;
    });
  }, [query, registrations]);

  if (!registrations.length) {
    return (
      <section className="container-page rounded-[28px] border border-line bg-white p-8 shadow-soft">
        <h2 className="text-2xl font-black text-navy">Nenhum cadastro recebido</h2>
        <p className="mt-3 text-muted">Quando um cliente concluir a simulação no site, o cadastro aparecerá aqui.</p>
      </section>
    );
  }

  return (
    <section className="container-page">
      <label className="relative mb-6 block max-w-xl">
        <span className="sr-only">Buscar cadastro por nome ou telefone</span>
        <Search className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-brand" aria-hidden="true" />
        <input
          className="admin-input admin-search-input h-14 rounded-2xl"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar por nome ou telefone"
          type="search"
          value={query}
        />
      </label>

      {filteredRegistrations.length ? (
        <div className="grid gap-5">
          {filteredRegistrations.map((registration) => (
            <RegistrationCard key={registration.id} registration={registration} />
          ))}
        </div>
      ) : (
        <div className="rounded-[28px] border border-line bg-white p-8 shadow-soft">
          <h2 className="text-2xl font-black text-navy">Nenhum cadastro encontrado</h2>
          <p className="mt-3 text-muted">Tente buscar por outro nome ou telefone.</p>
        </div>
      )}
    </section>
  );
}

function RegistrationCard({ registration }) {
  const familyIncome = calculateFamilyIncome(registration);

  return (
    <article className="rounded-[28px] border border-line bg-white p-6 shadow-soft transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_20px_55px_rgba(13,59,102,0.12)]">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-blue-50 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-brand">
              {simulationTypeLabel(registration.simulationType)}
            </span>
            <span className="rounded-full bg-slate-100 px-4 py-2 text-xs font-black text-navy">
              Renda familiar {formatCurrency(familyIncome)}
            </span>
          </div>
          <h2 className="text-2xl font-black leading-tight text-navy">{registration.fullName}</h2>
          <div className="mt-4 grid gap-3 text-sm font-bold text-muted sm:grid-cols-2 xl:grid-cols-4">
            <InfoItem icon={Phone} label={registration.phone} />
            <InfoItem icon={CalendarClock} label={formatDateTimeBR(registration.createdAt)} />
            <InfoItem icon={UserRound} label={`Titular: ${formatCurrency(registration.primaryMonthlyIncome)}`} />
            <InfoItem
              icon={UserRound}
              label={
                registration.simulationType === "joint"
                  ? `2ª pessoa: ${formatCurrency(registration.secondaryMonthlyIncome)}`
                  : "Sem segunda pessoa"
              }
            />
          </div>
        </div>

        <div className="grid min-w-[250px] gap-3 text-sm">
          <StatusLine label="Imóvel no nome" value={booleanLabel(registration.hasResidentialProperty)} icon={Home} />
          <StatusLine label="Valor disponível" value={formatCurrency(registration.availablePurchaseResource)} />
          <Link href={`/admin/cadastros/${registration.id}`} className="premium-button-primary justify-center">
            Abrir cadastro
          </Link>
        </div>
      </div>
    </article>
  );
}

function InfoItem({ icon: Icon, label }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Icon className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </span>
  );
}

function StatusLine({ icon: Icon, label, value }) {
  return (
    <div className="rounded-2xl border border-line bg-slate-50 px-4 py-3">
      <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-muted">
        {Icon ? <Icon className="h-4 w-4 text-brand" aria-hidden="true" /> : null}
        {label}
      </p>
      <p className="mt-1 font-black text-navy">{value}</p>
    </div>
  );
}

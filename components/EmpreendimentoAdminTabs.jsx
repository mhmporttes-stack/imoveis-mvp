"use client";

import { useState } from "react";
import PropertyForm from "@/components/PropertyForm";
import EmpreendimentoRegrasEntradaForm from "@/components/EmpreendimentoRegrasEntradaForm";

export default function EmpreendimentoAdminTabs({ property, canPublish, showRegrasEntradaTab, initialTab = "dados" }) {
  const [tab, setTab] = useState(initialTab === "regras" ? "regras" : "dados");

  if (!showRegrasEntradaTab) {
    return <PropertyForm property={property} canPublish={canPublish} isDevelopment />;
  }

  return (
    <div className="grid gap-6">
      <div className="container-page">
        <div className="flex w-fit gap-2 rounded-full border border-line bg-white p-1.5 shadow-soft">
          <TabButton active={tab === "dados"} onClick={() => setTab("dados")}>
            Dados do empreendimento
          </TabButton>
          <TabButton active={tab === "regras"} onClick={() => setTab("regras")}>
            Regras de Entrada
          </TabButton>
        </div>
      </div>

      {tab === "dados" ? <PropertyForm property={property} canPublish={canPublish} isDevelopment /> : null}
      {tab === "regras" ? <EmpreendimentoRegrasEntradaForm propertyId={property.id} /> : null}
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-5 py-2.5 text-sm font-black transition ${
        active ? "bg-brand text-white shadow-soft" : "text-muted hover:text-navy"
      }`}
    >
      {children}
    </button>
  );
}

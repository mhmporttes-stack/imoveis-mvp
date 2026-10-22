"use client";

import { useState } from "react";
import PropertyForm from "@/components/PropertyForm";
import EmpreendimentoRegrasEntradaForm from "@/components/EmpreendimentoRegrasEntradaForm";
import { tabClasses } from "@/components/ui/Tabs";

export default function EmpreendimentoAdminTabs({ property, canPublish, showRegrasEntradaTab, initialTab = "dados" }) {
  const [tab, setTab] = useState(initialTab === "regras" ? "regras" : "dados");

  if (!showRegrasEntradaTab) {
    return <PropertyForm property={property} canPublish={canPublish} isDevelopment />;
  }

  return (
    <div className="grid gap-6">
      <div className="container-page">
        <div className="mm-noscroll flex gap-1.5 overflow-x-auto py-1" role="group" aria-label="Seções do empreendimento">
          <TabButton active={tab === "dados"} onClick={() => setTab("dados")}>
            Dados do empreendimento
          </TabButton>
          <TabButton active={tab === "regras"} onClick={() => setTab("regras")}>
            Regras de Entrada
          </TabButton>
        </div>
      </div>

      {tab === "dados" ? <div className="admin-motion-enter"><PropertyForm property={property} canPublish={canPublish} isDevelopment /></div> : null}
      {tab === "regras" ? <div className="admin-motion-enter"><EmpreendimentoRegrasEntradaForm propertyId={property.id} /></div> : null}
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={tabClasses(active)}
    >
      {children}
    </button>
  );
}

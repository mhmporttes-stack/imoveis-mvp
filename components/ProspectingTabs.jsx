"use client";

import { useState } from "react";
import ProspectingManager from "@/components/ProspectingManager";
import BrokerBasesOverview from "@/components/BrokerBasesOverview";

// "Base da Imobiliária" é a prospecção compartilhada de sempre (sem nenhuma
// mudança de comportamento). A segunda aba muda conforme quem está logado:
// dono da operação -> "Bases dos Corretores" (visão gerencial de todo mundo);
// qualquer outro perfil -> "Minha Base" (só a própria).
export default function ProspectingTabs({ initialCompanyContacts = [], isAdmin = false, isOwner = false, users = [] }) {
  const [tab, setTab] = useState("company");
  const [mineContacts, setMineContacts] = useState(null);
  const [mineError, setMineError] = useState("");

  const secondTabLabel = isOwner ? "Bases dos Corretores" : "Minha Base";

  async function selectTab(next) {
    setTab(next);
    if (next === "mine" && mineContacts === null) {
      try {
        const response = await fetch("/api/prospecting?scope=mine");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Não foi possível carregar sua base.");
        setMineContacts(data);
      } catch (error) {
        setMineError(error.message || "Não foi possível carregar sua base.");
      }
    }
  }

  return (
    <section className="container-page space-y-5">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => selectTab("company")}
          className={`min-h-10 rounded-full border px-4 text-sm font-extrabold transition ${
            tab === "company" ? "border-brand bg-blue-50 text-brand" : "border-navy/10 bg-white text-navy hover:border-brand"
          }`}
        >
          Base da Imobiliária
        </button>
        <button
          type="button"
          onClick={() => selectTab("mine")}
          className={`min-h-10 rounded-full border px-4 text-sm font-extrabold transition ${
            tab === "mine" ? "border-brand bg-blue-50 text-brand" : "border-navy/10 bg-white text-navy hover:border-brand"
          }`}
        >
          {secondTabLabel}
        </button>
      </div>

      {tab === "company" ? (
        <ProspectingManager key="company" initialContacts={initialCompanyContacts} isAdmin={isAdmin} users={users} scope="company" label="Fila compartilhada" />
      ) : isOwner ? (
        <BrokerBasesOverview />
      ) : mineError ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{mineError}</p>
      ) : mineContacts === null ? (
        <p className="text-sm font-bold text-muted">Carregando…</p>
      ) : (
        <ProspectingManager key="mine" initialContacts={mineContacts} scope="mine" label="Minha base" />
      )}
    </section>
  );
}

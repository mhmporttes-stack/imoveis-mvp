"use client";

import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import Avatar from "@/components/Avatar";
import ProspectingManager from "@/components/ProspectingManager";

// Visão gerencial exclusiva do administrador principal: lista os corretores
// e o tamanho da base individual de cada um; ao clicar, abre a base daquele
// corretor em modo somente leitura (o mesmo ProspectingManager reutilizado).
export default function BrokerBasesOverview({ isOwner = false, users = [] }) {
  const [brokers, setBrokers] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [selectedContacts, setSelectedContacts] = useState(null);
  const [selectedError, setSelectedError] = useState("");

  useEffect(() => {
    if (selected) return;
    const controller = new AbortController();
    fetch("/api/prospecting/broker-bases", { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Não foi possível carregar as bases dos corretores.");
        setBrokers(data);
      })
      .catch((requestError) => {
        if (requestError.name !== "AbortError") setError(requestError.message || "Não foi possível carregar as bases dos corretores.");
      });
    return () => controller.abort();
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setSelectedContacts(null);
    setSelectedError("");
    fetch(`/api/prospecting/broker-bases/${selected.brokerId}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Não foi possível carregar esta base.");
        setSelectedContacts(data);
      })
      .catch((requestError) => {
        if (requestError.name !== "AbortError") setSelectedError(requestError.message || "Não foi possível carregar esta base.");
      });
    return () => controller.abort();
  }, [selected]);

  if (selected) {
    return (
      <section className="container-page space-y-4">
        <button type="button" onClick={() => setSelected(null)} className="premium-button-secondary">
          <ChevronLeft className="h-4 w-4" /> Voltar para Bases dos Corretores
        </button>
        {selectedError ? <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{selectedError}</p> : null}
        {!selectedContacts && !selectedError ? <p className="text-sm font-bold text-muted">Carregando…</p> : null}
        {selectedContacts ? (
          <ProspectingManager
            key={selected.brokerId}
            scope="broker"
            brokerId={selected.brokerId}
            label={`Base da(o) ${selected.name}`}
            initialContacts={selectedContacts}
            isOwner={isOwner}
            users={users}
          />
        ) : null}
      </section>
    );
  }

  return (
    <section className="container-page space-y-5">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.16em] text-brand">Visão gerencial</p>
        <h2 className="mt-2 text-3xl font-black text-navy">Bases dos Corretores</h2>
      </div>

      {error ? <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}

      {!brokers && !error ? <p className="text-sm font-bold text-muted">Carregando…</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(brokers || []).map((broker) => (
          <button
            key={broker.brokerId}
            type="button"
            onClick={() => setSelected(broker)}
            className="flex items-center gap-3 rounded-[22px] border border-line bg-white p-4 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-brand/40"
          >
            <Avatar name={broker.name} photoUrl={broker.photoUrl} size={44} />
            <div className="min-w-0">
              <p className="truncate font-extrabold text-navy">{broker.name}</p>
              <p className="text-sm font-bold text-muted">{broker.contactCount} contato{broker.contactCount === 1 ? "" : "s"}</p>
            </div>
          </button>
        ))}
      </div>

      {brokers && !brokers.length ? (
        <p className="rounded-[24px] border border-line bg-white p-8 text-center font-black text-navy">
          Nenhum corretor ativo encontrado.
        </p>
      ) : null}
    </section>
  );
}

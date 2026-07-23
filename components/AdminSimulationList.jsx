"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { getRenderableSimulationModels, simulationModelLabel } from "@/lib/simulation-models";

const SITE_REGISTRATION_SIMULATION_SOURCE = "Cadastro do site";

export default function AdminSimulationList({ simulations = [] }) {
  const router = useRouter();

  async function removeSimulation(simulation) {
    if (!confirm(`Excluir a simulação de "${simulation.clientName}"?`)) return;
    await fetch(`/api/simulations/${simulation.id}`, { method: "DELETE" });
    router.refresh();
  }

  async function duplicateSimulation(simulation) {
    const payload = {
      ...simulation,
      id: undefined,
      clientName: `${simulation.clientName} - cópia`,
      simulationDate: new Date().toISOString().slice(0, 10)
    };
    const response = await fetch("/api/simulations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) {
      alert(data.error || "Não foi possível duplicar a simulação.");
      return;
    }
    router.push(`/admin/simulacoes/${data.id}`);
  }

  return (
    <section className="container-page grid gap-5">
      {simulations.length ? simulations.map((simulation) => (
        <SimulationCard
          duplicateSimulation={duplicateSimulation}
          key={simulation.id}
          removeSimulation={removeSimulation}
          simulation={simulation}
        />
      )) : (
        <div className="rounded-2xl border border-line bg-white p-12 text-center shadow-soft">
          <h2 className="text-2xl font-extrabold text-navy">Nenhuma simulação salva</h2>
          <p className="mt-3 text-muted">Crie sua primeira apresentação de simulação habitacional.</p>
          <Link href="/admin/simulacoes/nova" className="mt-7 inline-flex premium-button-primary">Nova simulação</Link>
        </div>
      )}
    </section>
  );
}

function SimulationCard({ duplicateSimulation, removeSimulation, simulation }) {
  const pendingSiteSimulation = isPendingSiteSimulation(simulation);
  const simulationModels = getRenderableSimulationModels(simulation);
  const modelBadge = simulationModels.length > 1
    ? "Imóvel novo + usado"
    : simulationModels[0]?.label || simulationModelLabel(simulation.simulationType);
  const modelSummary = simulationModels
    .map((model) => `${model.label}: ${formatCurrency(model.totals.total)} (Financiamento: ${formatCurrency(model.totals.financing)} · Subsídio: ${formatCurrency(model.totals.subsidy)})`)
    .join(" · ");

  return (
    <article className="rounded-2xl border border-line bg-white p-6 shadow-soft">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
        <div>
          <div className="mb-3 flex flex-wrap gap-2">
            <span className="rounded-full bg-[#E9F2FF] px-3 py-1 text-sm font-extrabold text-navy">
              {modelBadge}
            </span>
            <span className="rounded-full border border-line px-3 py-1 text-sm font-bold text-muted">
              {formatDate(simulation.simulationDate)}
            </span>
          </div>
          <h2 className="text-2xl font-extrabold text-navy">{simulation.clientName}</h2>
          {pendingSiteSimulation ? (
            <p className="mt-2 text-base font-black text-red-700">Simulação não realizada</p>
          ) : (
            <p className="mt-2 text-muted">{modelSummary}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <Link className="premium-button-secondary" href={`/admin/simulacoes/${simulation.id}`}>Abrir</Link>
          <button className="premium-button-secondary" onClick={() => duplicateSimulation(simulation)} type="button">
            Duplicar
          </button>
          <button className="premium-button border border-red-200 bg-white text-red-700 hover:shadow-soft" onClick={() => removeSimulation(simulation)} type="button">
            Excluir
          </button>
        </div>
      </div>
    </article>
  );
}

function isPendingSiteSimulation(simulation) {
  return (
    simulation.createdBy === SITE_REGISTRATION_SIMULATION_SOURCE &&
    Number(simulation.totalPurchasePower || 0) === 0 &&
    Number(simulation.financingValue || 0) === 0 &&
    Number(simulation.subsidyValue || 0) === 0 &&
    Number(simulation.firstInstallment || 0) === 0 &&
    Number(simulation.lastInstallment || 0) === 0 &&
    !(simulation.properties || []).length
  );
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return "Sem data";
  return new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR");
}

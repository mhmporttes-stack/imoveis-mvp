import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import SimulationGenerator from "@/components/SimulationGenerator";
import { requireAdminPage } from "@/lib/admin-auth";
import { canManageProperties, listProperties } from "@/lib/properties";
import { canManageSimulations } from "@/lib/simulations";

export const dynamic = "force-dynamic";

export default async function NewSimulationPage() {
  await requireAdminPage();

  if (!canManageSimulations() || !canManageProperties()) {
    return (
      <main className="bg-mist py-14">
        <section className="container-page rounded-[28px] border border-line bg-white p-10 shadow-soft">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Nova simulação</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Gerador desativado</h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">Configure o Supabase para usar imóveis e salvar simulações.</p>
          <Link href="/admin/simulacoes" className="mt-8 inline-flex premium-button-primary">Voltar</Link>
        </section>
      </main>
    );
  }

  const properties = await listProperties();

  return (
    <main className="bg-mist py-14">
      <section className="container-page mb-8">
        <Link href="/admin/simulacoes" className="inline-flex items-center gap-2 text-sm font-black text-brand transition hover:text-navy">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Voltar para clientes
        </Link>
      </section>
      <SimulationGenerator properties={properties} />
    </main>
  );
}

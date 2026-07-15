import Link from "next/link";
import AdminLogoutButton from "@/components/AdminLogoutButton";
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
      <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Gerador de Simulações</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Nova simulação</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">Insira os dados da Caixa, selecione imóveis cadastrados e gere imagens profissionais.</p>
        </div>
        <AdminLogoutButton />
      </section>
      <SimulationGenerator properties={properties} />
    </main>
  );
}

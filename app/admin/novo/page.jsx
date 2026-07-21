import PropertyForm from "@/components/PropertyForm";
import AdminLogoutButton from "@/components/AdminLogoutButton";
import { requireAdminPage } from "@/lib/admin-auth";
import { canManageProperties } from "@/lib/properties";

export default async function NewPropertyPage() {
  await requireAdminPage();

  if (!canManageProperties()) {
    return (
      <main className="bg-mist py-14">
        <section className="container-page rounded-[28px] border border-line bg-white p-10 shadow-soft">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Novo cadastro</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Cadastro desativado em producao</h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">
            Configure o Supabase para cadastrar empreendimentos em producao.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="bg-mist py-14">
      <section className="container-page mb-6 sm:mb-8">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="min-w-0">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Novo cadastro</p>
            <h1 className="mt-3 text-[clamp(2.35rem,11vw,3.75rem)] font-black leading-[0.95] text-navy">Cadastrar empreendimento</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted sm:text-lg sm:leading-8">Preencha manualmente ou use IA para gerar um rascunho a partir de site, PDF ou e-book.</p>
          </div>
          <AdminLogoutButton />
        </div>
      </section>
      <PropertyForm />
    </main>
  );
}

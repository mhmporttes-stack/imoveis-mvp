import PropertyForm from "@/components/PropertyForm";
import { requireAdminPage } from "@/lib/admin-auth";
import { canManageProperties } from "@/lib/properties";
import { isGeneralAdminAuth, isManagerProfile } from "@/lib/admin-profiles";

export default async function NewPropertyPage() {
  const auth = await requireAdminPage();
  const canPublish = isGeneralAdminAuth(auth) || isManagerProfile(auth.profile);

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
      <PropertyForm canPublish={canPublish} />
    </main>
  );
}

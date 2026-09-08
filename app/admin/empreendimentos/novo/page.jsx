import PropertyForm from "@/components/PropertyForm";
import AdminLogoutButton from "@/components/AdminLogoutButton";
import { requireAdminPage } from "@/lib/admin-auth";
import { isGeneralAdminAuth, isManagerProfile } from "@/lib/admin-profiles";

export default async function NewDevelopmentPage() {
  const auth = await requireAdminPage();
  const canPublish = isGeneralAdminAuth(auth) || isManagerProfile(auth.profile);

  return (
    <main className="bg-mist py-14">
      <section className="container-page mb-6 sm:mb-8">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="min-w-0">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Novo empreendimento</p>
            <h1 className="mt-3 text-[clamp(2.35rem,11vw,3.75rem)] font-black leading-[0.95] text-navy">Cadastrar empreendimento</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted sm:text-lg sm:leading-8">Cadastre os dados comerciais e depois configure as regras de entrada.</p>
          </div>
          <AdminLogoutButton />
        </div>
      </section>
      <PropertyForm canPublish={canPublish} isDevelopment />
    </main>
  );
}

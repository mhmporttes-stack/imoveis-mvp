import { notFound } from "next/navigation";
import EmpreendimentoAdminTabs from "@/components/EmpreendimentoAdminTabs";
import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-auth";
import { isGeneralAdminAuth, isManagerProfile } from "@/lib/admin-profiles";
import { canManageProperties, getProperty } from "@/lib/properties";

export const dynamic = "force-dynamic";

export default async function EditPropertyPage({ params, searchParams }) {
  const auth = await requireAdminPage();
  if (!isGeneralAdminAuth(auth) && !isManagerProfile(auth.profile)) redirect("/admin/simulacoes");

  if (!canManageProperties()) {
    return (
      <main className="bg-mist py-14">
        <section className="container-page rounded-[28px] border border-line bg-white p-10 shadow-soft">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Edicao</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Edicao desativada em producao</h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">
            Configure o Supabase para editar empreendimentos em producao.
          </p>
        </section>
      </main>
    );
  }

  const { id } = await params;
  const query = await searchParams;
  const property = await getProperty(id);
  if (!property) notFound();

  return (
    <main className="bg-mist py-14">
      <EmpreendimentoAdminTabs property={property} canPublish showRegrasEntradaTab initialTab={query?.aba} />
    </main>
  );
}

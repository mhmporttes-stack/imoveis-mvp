import { notFound } from "next/navigation";
import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import GuideEditor from "@/components/guide/GuideEditor";
import { requireBrokerManagementPage } from "@/lib/admin-auth";
import { getGuide, listLibraryOptions } from "@/lib/attendance-guides";

export const dynamic = "force-dynamic";

// Editor visual de um guia (mesmo acesso das Automações: admin e gestor).
export default async function GuideEditorPage({ params }) {
  await requireBrokerManagementPage("/admin/simulacoes");
  const { id } = await params;

  let guide;
  let libraryOptions = [];
  try {
    [guide, libraryOptions] = await Promise.all([getGuide(id), listLibraryOptions()]);
  } catch {
    // id inválido (não é uuid) ou guia inexistente
    notFound();
  }

  return (
    <main className="min-h-screen bg-mist py-8">
      <section className="container-page mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand">Gestão · Guia de Atendimento</p>
          <h1 className="mt-1 text-2xl font-black text-navy md:text-3xl">Editor de guia</h1>
        </div>
        <AdminLogoutButton />
      </section>
      <AdminSectionNav active="attendance-guide" />
      <GuideEditor initialGuide={guide} libraryOptions={libraryOptions} />
    </main>
  );
}

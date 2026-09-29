import AdminSectionNav from "@/components/AdminSectionNav";
import GuideManager from "@/components/guide/GuideManager";
import { requireBrokerManagementPage } from "@/lib/admin-auth";
import { listGuides } from "@/lib/attendance-guides";

export const dynamic = "force-dynamic";

// Gestão → Guia de Atendimento (treinamento dos corretores). Só admin e gestor editam; o corretor usa o guia no Chat.
export default async function AttendanceGuidesPage() {
  await requireBrokerManagementPage("/admin/simulacoes");

  let guides = null;
  try {
    guides = await listGuides();
  } catch (error) {
    console.error("Guia de Atendimento: falha ao listar", error);
  }

  return (
    <main className="min-h-screen bg-mist py-14">
      <AdminSectionNav active="attendance-guide" />
      {guides ? (
        <GuideManager initialGuides={guides} />
      ) : (
        <p className="container-page rounded-2xl bg-red-50 px-4 py-3 font-bold text-red-700">Não foi possível carregar os guias. Verifique se a migration do Guia de Atendimento foi aplicada no banco.</p>
      )}
    </main>
  );
}

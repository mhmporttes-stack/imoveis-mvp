import { notFound } from "next/navigation";
import AdminSectionNav from "@/components/AdminSectionNav";
import FlowEditor from "@/components/flows/FlowEditor";
import { requireBrokerManagementPage } from "@/lib/admin-auth";
import { WhatsappFlowError, getWhatsappFlow } from "@/lib/whatsapp-flows";

export const dynamic = "force-dynamic";

// Editor visual de um Fluxo do WhatsApp (mesmo acesso de Automações: admin e gestor).
export default async function FlowEditorPage({ params }) {
  await requireBrokerManagementPage("/admin/simulacoes");
  const { id } = await params;

  let flow;
  try {
    flow = await getWhatsappFlow(id);
  } catch (error) {
    if (error instanceof WhatsappFlowError && error.status === 404) notFound();
    // id inválido (não é uuid) também cai aqui como erro do banco.
    notFound();
  }

  return (
    <main className="min-h-screen bg-mist py-8">
      <AdminSectionNav active="automations" />
      <FlowEditor initialFlow={flow} />
    </main>
  );
}

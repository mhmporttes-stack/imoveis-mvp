import { notFound } from "next/navigation";
import AdminLogoutButton from "@/components/AdminLogoutButton";
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
    <main className="min-h-screen bg-mist py-14">
      <section className="container-page mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Automações · Fluxos do WhatsApp</p>
          <h1 className="mt-2 text-3xl font-black text-navy md:text-4xl">Editor de fluxo</h1>
        </div>
        <AdminLogoutButton />
      </section>
      <AdminSectionNav active="automations" />
      <FlowEditor initialFlow={flow} />
    </main>
  );
}

import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import WhatsappChat from "@/components/WhatsappChat";
import { requireBrokerManagementPage } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

// Chat do WhatsApp oficial (caixa de entrada). Mesmo acesso que já existia
// quando ficava dentro de Automações > WhatsApp Master (admin e gestor).
export default async function ChatPage() {
  await requireBrokerManagementPage("/admin/simulacoes");

  return (
    <main className="min-h-screen bg-mist py-14">
      <section className="container-page mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Área restrita</p>
          <h1 className="mt-2 text-3xl font-black text-navy md:text-4xl">Chat</h1>
        </div>
        <AdminLogoutButton />
      </section>
      <AdminSectionNav active="chat" />
      <WhatsappChat />
    </main>
  );
}

import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import WhatsappChat from "@/components/WhatsappChat";
import { requireAdminPage } from "@/lib/admin-auth";
import { isGeneralAdminAuth, isManagerProfile } from "@/lib/admin-profiles";

export const dynamic = "force-dynamic";

// Chat do WhatsApp oficial (caixa de entrada). Administrador e gestor veem
// tudo; corretor e associado veem só as conversas dos SEUS clientes (o
// escopo é aplicado no servidor, em lib/whatsapp-chat.js).
export default async function ChatPage({ searchParams }) {
  const auth = await requireAdminPage();
  const params = (await searchParams) || {};
  const canManage = isGeneralAdminAuth(auth) || isManagerProfile(auth.profile);

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
      <WhatsappChat canManage={canManage} currentUserId={auth.profile?.id || ""} initialClientId={typeof params.client === "string" ? params.client : ""} />
    </main>
  );
}

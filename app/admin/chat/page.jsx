import AdminSectionNav from "@/components/AdminSectionNav";
import WhatsappChat from "@/components/WhatsappChat";
import { requireWhatsappAccessPage } from "@/lib/admin-auth";
import { isGeneralAdminAuth, isManagerProfile } from "@/lib/admin-profiles";

export const dynamic = "force-dynamic";

// Chat do WhatsApp oficial (caixa de entrada). Administrador e gestor veem
// tudo; corretor e associado veem só as conversas dos SEUS clientes (o
// escopo é aplicado no servidor, em lib/whatsapp-chat.js).
export default async function ChatPage({ searchParams }) {
  // Acesso WhatsApp bloqueado (2026-10-04): o Chat nem abre — volta para o painel de clientes.
  const auth = await requireWhatsappAccessPage();
  const params = (await searchParams) || {};
  const canManage = isGeneralAdminAuth(auth) || isManagerProfile(auth.profile);

  return (
    <main className="min-h-screen bg-mist py-14">
      <AdminSectionNav active="chat" />
      <WhatsappChat canManage={canManage} canEditRules={isGeneralAdminAuth(auth)} currentUserId={auth.profile?.id || ""} initialClientId={typeof params.client === "string" ? params.client : ""} />
    </main>
  );
}

import AdminSectionNav from "@/components/AdminSectionNav";
import WhatsappChat from "@/components/WhatsappChat";
import { requireWhatsappAccessPage } from "@/lib/admin-auth";
import { isGeneralAdminAuth, isManagerProfile } from "@/lib/admin-profiles";
import { isChatDisabled, isChatRestrictedProfile } from "@/lib/chat-control";
import { isArchivedChatViewer } from "@/lib/whatsapp-chat-scope.mjs";

export const dynamic = "force-dynamic";

// Chat do WhatsApp oficial (caixa de entrada). Administrador e gestor veem
// tudo; corretor e associado veem só as conversas dos SEUS clientes (o
// escopo é aplicado no servidor, em lib/whatsapp-chat.js).
export default async function ChatPage({ searchParams }) {
  // Acesso WhatsApp bloqueado (2026-10-04): o Chat nem abre — volta para o painel de clientes.
  const auth = await requireWhatsappAccessPage();
  // Chat desativado pelo dono (lib/chat-control.js): corretor/associado veem só o aviso; administrador e gestor seguem vendo as conversas.
  if (isChatRestrictedProfile(auth.profile) && (await isChatDisabled())) {
    return (
      <main className="min-h-screen bg-mist py-14">
        <AdminSectionNav active="chat" />
        <section className="container-page mx-auto mt-8 max-w-xl rounded-[28px] border border-line bg-white p-8 text-center shadow-soft">
          <h1 className="text-2xl font-black text-navy">Chat temporariamente desativado</h1>
          <p className="mt-3 text-base font-semibold leading-7 text-muted">Por enquanto, envie e responda as mensagens dos clientes pelo WhatsApp do seu celular. Avisaremos quando o Chat voltar.</p>
        </section>
      </main>
    );
  }
  const params = (await searchParams) || {};
  const canManage = isGeneralAdminAuth(auth) || isManagerProfile(auth.profile);

  return (
    // Modo aplicativo (pedido do dono, 2026-10-09): a tela fica fixa na altura da janela e só a lista/mensagens rolam
    // (WhatsappChat appMode + .chat-app-* em app/globals.css).
    <main className="bg-mist pt-3 md:pt-6">
      <AdminSectionNav active="chat" />
      <WhatsappChat appMode canManage={canManage} canEditRules={isGeneralAdminAuth(auth)} currentUserId={auth.profile?.id || ""} canSeeArchived={isArchivedChatViewer(auth)} initialClientId={typeof params.client === "string" ? params.client : ""} />
    </main>
  );
}

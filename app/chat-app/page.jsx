import { redirect } from "next/navigation";
import WhatsappChat from "@/components/WhatsappChat";
import ChatAppHome from "@/components/ChatAppHome";
import { WhatsappAccessProvider } from "@/components/WhatsappAccessProvider";
import { getAdminFromCookies } from "@/lib/admin-auth";
import { isGeneralAdminAuth, isManagerProfile } from "@/lib/admin-profiles";
import { isChatDisabled, isChatRestrictedProfile } from "@/lib/chat-control";
import { isArchivedChatViewer } from "@/lib/whatsapp-chat-scope.mjs";
import { isBasicMode, isEffectivelyBlocked } from "@/lib/whatsapp-access-core.mjs";

export const dynamic = "force-dynamic";

// App "Chat" da tela inicial (pedido do dono, 2026-10-09): o próprio endereço do atalho É o Chat — abre só o
// Chat mesmo quando o iPhone abre o atalho numa aba do Safari. Mesmas regras de /admin/chat (login, acesso
// WhatsApp bloqueado, Chat desativado, escopo por perfil no servidor em lib/whatsapp-chat.js).
export default async function ChatAppPage({ searchParams }) {
  const auth = await getAdminFromCookies();
  if (!auth.ok) redirect(`/admin/login${auth.status === 403 ? "?error=unauthorized&" : "?"}next=/chat-app`);
  if (isEffectivelyBlocked(auth.profile)) {
    return <ChatAppNotice title="Chat indisponível" text="O acesso ao WhatsApp está bloqueado para esta conta." />;
  }
  if (isChatRestrictedProfile(auth.profile) && (await isChatDisabled())) {
    return <ChatAppNotice title="Chat temporariamente desativado" text="Por enquanto, envie e responda as mensagens dos clientes pelo WhatsApp do seu celular. Avisaremos quando o Chat voltar." />;
  }
  const params = (await searchParams) || {};
  const canManage = isGeneralAdminAuth(auth) || isManagerProfile(auth.profile);

  return (
    <WhatsappAccessProvider blocked={false} basic={isBasicMode(auth.profile)}>
      <ChatAppHome />
      <main className="bg-mist">
        <WhatsappChat appMode canManage={canManage} canEditRules={isGeneralAdminAuth(auth)} currentUserId={auth.profile?.id || ""} canSeeArchived={isArchivedChatViewer(auth)} initialClientId={typeof params.client === "string" ? params.client : ""} initialText="" />
      </main>
    </WhatsappAccessProvider>
  );
}

function ChatAppNotice({ title, text }) {
  return (
    <main className="grid min-h-screen place-items-center bg-mist px-4">
      <section className="w-full max-w-md rounded-[28px] border border-line bg-white p-8 text-center shadow-soft">
        <h1 className="text-2xl font-black text-navy">{title}</h1>
        <p className="mt-3 text-base font-semibold leading-7 text-muted">{text}</p>
      </section>
    </main>
  );
}

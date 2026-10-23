import AdminSectionNav from "@/components/AdminSectionNav";
import MarketplaceChat from "@/components/marketplace/MarketplaceChat";
import { requireAdminPage } from "@/lib/admin-auth";
import { chatViewerKey } from "@/lib/chat-viewer-key.mjs";
import { isGeneralAdminAuth, isManagerProfile, listVisibleTeamProfiles } from "@/lib/admin-profiles";
import { isUuid } from "@/lib/short-links.mjs";

export const dynamic = "force-dynamic";

// Chat do Marketplace (MKT-2, dono, 2026-10-20): conversas do Facebook Marketplace espelhadas pela extensão do PC do
// dono. Escopo e permissões aplicados no servidor (lib/marketplace-chat.js).
export default async function MarketplaceChatPage({ searchParams }) {
  const auth = await requireAdminPage();
  // ?conversa=<id>: aviso da mensagem interna (sino/push, MKT-2i) abre direto a conversa. O escopo continua no servidor
  // (conversa fora do escopo responde 403 ao abrir).
  const requested = (await searchParams)?.conversa;
  const initialConversationId = typeof requested === "string" && isUuid(requested) ? requested : "";
  const isAdmin = isGeneralAdminAuth(auth);
  const canAssign = isAdmin || isManagerProfile(auth.profile);
  const team = canAssign ? (await listVisibleTeamProfiles(auth)).map((profile) => ({ id: profile.id, name: profile.name })) : [];

  return (
    <main className="bg-mist pt-3 md:pt-6">
      <AdminSectionNav active="marketplace-chat" />
      {/* viewerName = perfil efetivo (preenche [corretor] dos atalhos); gestão dos atalhos = admin/gestor (o servidor confere). */}
      <MarketplaceChat canEditSettings={isAdmin} canAssign={canAssign} canManageShortcuts={canAssign} viewerName={auth.profile?.name || ""} team={team} viewerKey={chatViewerKey(auth)} initialConversationId={initialConversationId} />
    </main>
  );
}

import AdminSectionNav from "@/components/AdminSectionNav";
import MarketplaceChat from "@/components/marketplace/MarketplaceChat";
import { requireAdminPage } from "@/lib/admin-auth";
import { isGeneralAdminAuth, isManagerProfile, listVisibleTeamProfiles } from "@/lib/admin-profiles";

export const dynamic = "force-dynamic";

// Chat do Marketplace (MKT-2, dono, 2026-10-20): conversas do Facebook Marketplace espelhadas pela extensão do PC do
// dono. Escopo e permissões aplicados no servidor (lib/marketplace-chat.js).
export default async function MarketplaceChatPage() {
  const auth = await requireAdminPage();
  const isAdmin = isGeneralAdminAuth(auth);
  const canAssign = isAdmin || isManagerProfile(auth.profile);
  const team = canAssign ? (await listVisibleTeamProfiles(auth)).map((profile) => ({ id: profile.id, name: profile.name })) : [];

  return (
    <main className="bg-mist pb-6 pt-3 md:pt-6">
      <AdminSectionNav active="marketplace-chat" />
      <MarketplaceChat canEditSettings={isAdmin} canAssign={canAssign} team={team} />
    </main>
  );
}

import AdminSectionNav from "@/components/AdminSectionNav";
import ProspectingTabs from "@/components/ProspectingTabs";
import { isOwnerAdminEmail, requireAdminPage } from "@/lib/admin-auth";
import { isGeneralAdminAuth } from "@/lib/admin-profiles";
import { listAdminProfiles } from "@/lib/admin-profiles";
import { listProspectingContacts } from "@/lib/prospecting";

export const dynamic = "force-dynamic";

export default async function ProspectingPage() {
  const auth = await requireAdminPage();
  const isAdmin = isGeneralAdminAuth(auth);
  const isOwner = isOwnerAdminEmail(auth.user?.email);
  const [contacts, users] = await Promise.all([listProspectingContacts(auth, "company"), isAdmin ? listAdminProfiles() : []]);
  return <main className="min-h-screen bg-mist py-14">
    <AdminSectionNav active="prospecting" />
    <ProspectingTabs initialCompanyContacts={contacts} isAdmin={isAdmin} isOwner={isOwner} users={users.filter((user) => user.status === "active")} />
  </main>;
}

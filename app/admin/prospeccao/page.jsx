import AdminSectionNav from "@/components/AdminSectionNav";
import ProspectingConnectGate from "@/components/ProspectingConnectGate";
import ProspectingTabs from "@/components/ProspectingTabs";
import { isOwnerAdminEmail, requireAdminPage } from "@/lib/admin-auth";
import { isGeneralAdminAuth } from "@/lib/admin-profiles";
import { listAdminProfiles } from "@/lib/admin-profiles";
import { listProspectingContacts } from "@/lib/prospecting";
import { getProspectingGate } from "@/lib/prospecting-eligibility";

export const dynamic = "force-dynamic";

export default async function ProspectingPage() {
  const auth = await requireAdminPage();
  // Prospecção SÓ com WhatsApp conectado (2026-10-02): corretor desconectado vê só o aviso (as
  // rotas também barram no servidor). Administrador geral e gestor mantêm a supervisão.
  const gate = await getProspectingGate(auth, "access");
  if (!gate.allowed) {
    return <main className="min-h-screen bg-mist py-14">
      <AdminSectionNav active="prospecting" />
      <ProspectingConnectGate message={gate.message} />
    </main>;
  }
  const isAdmin = isGeneralAdminAuth(auth);
  const isOwner = isOwnerAdminEmail(auth.user?.email);
  const [contacts, users] = await Promise.all([listProspectingContacts(auth, "company"), isAdmin ? listAdminProfiles() : []]);
  return <main className="min-h-screen bg-mist py-14">
    <AdminSectionNav active="prospecting" />
    <ProspectingTabs initialCompanyContacts={contacts} isAdmin={isAdmin} isOwner={isOwner} users={users.filter((user) => user.status === "active")} />
  </main>;
}

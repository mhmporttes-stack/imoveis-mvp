import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import ProspectingManager from "@/components/ProspectingManager";
import { requireAdminPage } from "@/lib/admin-auth";
import { isGeneralAdminAuth } from "@/lib/admin-profiles";
import { listAdminProfiles } from "@/lib/admin-profiles";
import { listProspectingContacts } from "@/lib/prospecting";

export const dynamic = "force-dynamic";

export default async function ProspectingPage() {
  const auth = await requireAdminPage();
  const isAdmin = isGeneralAdminAuth(auth);
  const [contacts, users] = await Promise.all([listProspectingContacts(auth), isAdmin ? listAdminProfiles() : []]);
  return <main className="min-h-screen bg-mist py-14">
    <section className="container-page mb-8 flex items-end justify-between gap-5"><div><p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Área restrita</p><h1 className="mt-3 text-5xl font-black text-navy">Prospecção</h1><p className="mt-4 text-lg text-muted">Contatos disponíveis para atendimento.</p></div><AdminLogoutButton /></section>
    <AdminSectionNav active="prospecting" />
    <ProspectingManager initialContacts={contacts} isAdmin={isAdmin} users={users.filter((user) => user.status === "active")} />
  </main>;
}

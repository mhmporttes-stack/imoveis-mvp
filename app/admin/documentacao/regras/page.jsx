import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import DocumentAiRulesManager from "@/components/DocumentAiRulesManager";
import { requireGeneralAdminPage } from "@/lib/admin-auth";
import { listDocumentAiRules } from "@/lib/document-ai-rules";

export const dynamic = "force-dynamic";

export default async function DocumentAiRulesPage() {
  await requireGeneralAdminPage("/admin/simulacoes");
  const rules = await listDocumentAiRules();
  return (
    <main className="min-h-screen bg-mist py-8">
      <section className="container-page mb-5 flex items-center justify-between gap-4">
        <div><p className="text-xs font-black uppercase tracking-widest text-brand">Gestão · Documentação</p><h1 className="mt-1 text-2xl font-black text-navy">Regras da IA</h1></div>
        <AdminLogoutButton />
      </section>
      <AdminSectionNav active="document-rules" />
      <DocumentAiRulesManager initialRules={rules} />
    </main>
  );
}

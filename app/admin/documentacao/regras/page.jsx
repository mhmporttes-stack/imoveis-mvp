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
      <AdminSectionNav active="document-rules" />
      <DocumentAiRulesManager initialRules={rules} />
    </main>
  );
}

import SmsBatchWorkspace from "@/components/SmsBatchWorkspace";
import { requirePerformancePage } from "@/lib/admin-auth";
import { loadSmsBatch } from "@/lib/sms-batch";

export const dynamic = "force-dynamic";

// Lote de SMS (dono, 2026-11-02): admin geral/gestor (equipe) e corretor (lote próprio); associado volta ao painel. Pensada para o app no iPhone (cartões grandes, um toque).
export default async function SmsBatchPage() {
  const auth = await requirePerformancePage();
  let initial = null;
  let initialError = "";
  try {
    initial = await loadSmsBatch(auth);
  } catch (error) {
    console.error("Lote de SMS: falha ao carregar:", error?.message || error);
    initialError = error?.status ? error.message : "Não foi possível carregar o Lote de SMS agora.";
  }

  return (
    <main className="min-h-screen bg-mist py-6 sm:py-14">
      <div className="container-page mx-auto max-w-2xl">
        <h1 className="mb-1 text-xl font-extrabold text-ink">Lote de SMS</h1>
        <p className="mb-4 text-sm text-muted">Envie o link do cadastro por SMS, um toque por contato, a quem ainda não teve nenhuma tentativa de contato.</p>
        <SmsBatchWorkspace initial={initial} initialError={initialError} />
      </div>
    </main>
  );
}

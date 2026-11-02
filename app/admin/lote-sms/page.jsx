import SmsBatchWorkspace from "@/components/SmsBatchWorkspace";
import { requirePerformancePage } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

// Lote de SMS (dono, 2026-11-02): admin geral/gestor (equipe) e corretor (lote próprio); associado volta ao painel. Pensada para o app no iPhone (cartões grandes, um toque).
// A lista NÃO é montada aqui: a página abre na hora (só confere o perfil) e a tela busca a lista em /api/admin/lote-sms,
// mostrando "Carregando…" e, se falhar ou demorar, o aviso com "Tentar de novo" na própria tela — nunca a página de erro
// do Next (antes a lista era montada antes de a página abrir: lenta = tela travada e depois "Algo deu errado").
export default async function SmsBatchPage() {
  await requirePerformancePage();

  return (
    <main className="min-h-screen bg-mist py-6 sm:py-14">
      <div className="container-page mx-auto max-w-2xl">
        <h1 className="mb-1 text-xl font-extrabold text-ink">Lote de SMS</h1>
        <p className="mb-4 text-sm text-muted">Envie o link do cadastro por SMS, um toque por contato, a quem ainda não teve nenhuma tentativa de contato.</p>
        <SmsBatchWorkspace />
      </div>
    </main>
  );
}

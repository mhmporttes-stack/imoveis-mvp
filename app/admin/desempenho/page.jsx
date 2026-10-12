import AdminSectionNav from "@/components/AdminSectionNav";
import PerformanceOverviewDashboard from "@/components/PerformanceOverviewDashboard";
import { requireBrokerManagementPage } from "@/lib/admin-auth";
import { chatViewerKey } from "@/lib/chat-viewer-key.mjs";
import { canLoadPerformanceOverview } from "@/lib/performance-overview";

export const dynamic = "force-dynamic";
// Voltar para esta tela na hora (desempenho, 2026-10-12): o navegador reaproveita a tela por até 5 min.
// Sair da conta / "Alterar conta" chamam router.refresh(), que descarta o reaproveitamento.
export const unstable_dynamicStaleTime = 300;

// Desempenho abre na hora (pedido do dono, 2026-10-12 — o toque em Desempenho ficava no "carregando" esperando o servidor
// montar todos os números): a página só confere a permissão; os números vêm da MESMA API (/api/performance-overview,
// mesmo período padrão "month") pela própria tela, que mostra na hora os já guardados nesta conta (pré-carregados pelo
// AdminWarmup ou da visita anterior, components/chat-view-cache.js) e atualiza em seguida.
export default async function PerformancePage() {
  const auth = await requireBrokerManagementPage();
  const error = canLoadPerformanceOverview() ? "" : "Configure o Supabase para carregar o painel de desempenho.";

  return (
    <main className="min-h-screen bg-mist py-14">
      <AdminSectionNav active="performance" />
      <PerformanceOverviewDashboard initialOverview={null} initialError={error} viewerKey={chatViewerKey(auth)} />
    </main>
  );
}

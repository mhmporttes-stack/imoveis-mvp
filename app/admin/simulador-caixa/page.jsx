import AdminSectionNav from "@/components/AdminSectionNav";
import CaixaSimulator from "@/components/CaixaSimulator";
import { requireAdminPage } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export const metadata = { title: "Simulador Caixa" };

// "Simulador Caixa" (dono, 2026-10-19): todos os perfis do painel. Simulação rápida com o mesmo motor da simulação
// automática; não cria cliente nem lead e não envia nada. O voto 👍/👎 vai para /api/admin/simulador-caixa/feedback.
export default async function CaixaSimulatorPage() {
  await requireAdminPage();
  return (
    <main className="min-h-screen bg-mist py-14">
      <AdminSectionNav active="caixa-simulator" />
      <CaixaSimulator />
    </main>
  );
}

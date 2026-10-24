import { Wallet } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Kpi, { KpiGrid } from "@/components/ui/Kpi";

// Financeiro do GESTOR (FIN-9 — dono, 2026-10-24): somente leitura, só as vendas em que ele é o gestor da venda e
// só a parte dele. Os dados já chegam projetados pelo servidor (lib/financial-manager-view-core.mjs); nada aqui grava.
const STATUS = {
  pending: { label: "Pendente", tone: "neutral" },
  partial: { label: "Parcial", tone: "warning" },
  received: { label: "Recebido", tone: "success" }
};

const money = (value) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
const date = (value) => (value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)) : "—");

export default function FinancialManagerCommissions({ sales = [] }) {
  const total = sales.reduce((sum, sale) => sum + sale.managerCommission, 0);
  const received = sales.reduce((sum, sale) => sum + sale.managerReceived, 0);
  return (
    <section className="container-page space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold text-ink">Minhas comissões de gestor</h1>
        <p className="mt-1 text-sm text-ink-2">Vendas em que você é o gestor da venda. Só a sua parte, somente leitura.</p>
      </div>
      <KpiGrid label="Resumo das comissões de gestor">
        <Kpi label="Sua comissão (total)" value={money(total)} />
        <Kpi label="Já recebido" value={money(received)} tone="success" />
        <Kpi label="A receber" value={money(Math.max(0, total - received))} />
      </KpiGrid>
      {sales.length ? (
        <ul className="grid gap-3">
          {sales.map((sale) => {
            const status = STATUS[sale.financialStatus] || STATUS.pending;
            return (
              <li key={sale.id}>
                <Card padding="md">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-extrabold text-ink">{sale.clientName || "Cliente"}</p>
                      <p className="text-sm text-ink-2">{[sale.propertyName, sale.brokerName ? `Corretor: ${sale.brokerName}` : "", `Venda em ${date(sale.saleDate)}`].filter(Boolean).join(" · ")}</p>
                    </div>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                    <div><dt className="text-xs text-muted">Sua parte</dt><dd className="font-bold tabular-nums text-ink">{money(sale.managerCommission)}{sale.managerPercentage ? <span className="ml-1 text-xs font-medium text-muted">({sale.managerPercentage}%)</span> : null}</dd></div>
                    <div><dt className="text-xs text-muted">Recebido</dt><dd className="font-bold tabular-nums text-ink">{money(sale.managerReceived)}</dd></div>
                    <div><dt className="text-xs text-muted">A receber</dt><dd className="font-bold tabular-nums text-ink">{money(sale.managerToReceive)}</dd></div>
                  </dl>
                </Card>
              </li>
            );
          })}
        </ul>
      ) : (
        <Card padding="none"><EmptyState icon={Wallet} title="Nenhuma venda com comissão de gestor" description="Quando uma venda tiver você como gestor, ela aparece aqui com a sua parte." /></Card>
      )}
    </section>
  );
}

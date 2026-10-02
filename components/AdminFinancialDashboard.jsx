"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  ChevronDown,
  ChevronRight,
  HeartPulse,
  ExternalLink,
  Plus,
  ReceiptText,
  Trash2,
  WalletCards
} from "lucide-react";
import { calculateCommissionDistribution, calculateInvoiceDeduction, resolveInvoicePercentage } from "@/lib/financial-calculations";
import { calculateReceivableMetrics, computeForecastAmount, flattenReceivableEntries } from "@/lib/financial-expected-receipt-core.mjs";
import { parseBrazilianDecimal, parseBrazilianMoney } from "@/lib/money-br.mjs";
import { ConfirmReceiptModal, RescheduleReceiptModal } from "@/components/ReceiptActionModals";
import FinancialHealthTab from "@/components/FinancialHealthTab";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import UiField, { inputClasses } from "@/components/ui/Field";
import { cx } from "@/components/ui/cx";
import {
  Collapsible,
  EditorFooter,
  FilterBar,
  FinancialStatusBadge,
  HeroNumbers,
  PaymentStatusBadge,
  SectionTabs
} from "@/components/FinancialSalesParts";

const FINANCIAL_STATUS_OPTIONS = [
  { value: "pending", label: "Pendente" },
  { value: "partial", label: "Parcialmente recebido" },
  { value: "received", label: "Recebido" },
  { value: "cancelled", label: "Cancelado" }
];

const PAYMENT_STATUS_OPTIONS = [
  { value: "expected", label: "Previsto" },
  { value: "received", label: "Recebido" },
  { value: "overdue", label: "Atrasado" },
  { value: "cancelled", label: "Cancelado" }
];

const EXPENSE_CATEGORIES = [
  "Repasse",
  "Corretor parceiro",
  "Captador",
  "Indicador",
  "Documentação",
  "Cartório",
  "ITBI",
  "Engenharia",
  "Marketing",
  "Tráfego pago",
  "Bonificação",
  "Taxa",
  "Outros"
];

const PERIOD_OPTIONS = [
  { value: "today", label: "Hoje" },
  { value: "week", label: "Esta semana" },
  { value: "month", label: "Este mês" },
  { value: "lastMonth", label: "Mês anterior" },
  { value: "quarter", label: "Este trimestre" },
  { value: "year", label: "Este ano" },
  { value: "custom", label: "Personalizado" },
  { value: "all", label: "Todo período" }
];

const MONEY_FORMATTER = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
});

const MONTH_FORMATTER = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", month: "long" });

const DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});

export default function AdminFinancialDashboard({ initialSales = [], financialUsers = [], currentUser = null, canEdit = false, canManageForecast = false, health = null }) {
  const isAssociate = currentUser?.role === "associate";
  const [sales, setSales] = useState(() => ensureArray(initialSales));
  const [activeTab, setActiveTab] = useState("dashboard");
  const [period, setPeriod] = useState("month");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [brokerFilter, setBrokerFilter] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedSaleId, setSelectedSaleId] = useState(sales[0]?.id || "");
  const [draftSale, setDraftSale] = useState(() => createDraftSale(sales[0]));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [resultView, setResultView] = useState("separated");
  const [receiptAction, setReceiptAction] = useState(null);
  // Celular/tablet: "list" mostra a lista de vendas, "editor" a venda aberta (com "Voltar"). Em xl as duas aparecem juntas.
  const [mobileStep, setMobileStep] = useState("list");
  const brokers = useMemo(() => financialUsers.filter((user) => ["admin", "manager", "broker"].includes(user.role) && user.status === "active"), [financialUsers]);
  const managers = useMemo(() => financialUsers.filter((user) => ["admin", "manager"].includes(user.role) && user.status === "active"), [financialUsers]);

  const selectedSale = useMemo(
    () => sales.find((sale) => sale.id === selectedSaleId) || null,
    [sales, selectedSaleId]
  );

  const filteredSales = useMemo(() => {
    return sales.filter((sale) => {
      if (!matchesPeriod(sale.saleDate, period, startDate, endDate)) return false;
      if (statusFilter !== "all" && sale.financialStatus !== statusFilter) return false;
      if (clientFilter && !normalizeText(sale.clientName).includes(normalizeText(clientFilter))) return false;
      if (brokerFilter && !normalizeText(sale.brokerName || sale.brokerEmail).includes(normalizeText(brokerFilter))) return false;
      if (propertyFilter && !normalizeText(sale.propertyName).includes(normalizeText(propertyFilter))) return false;
      return true;
    });
  }, [sales, period, startDate, endDate, clientFilter, brokerFilter, propertyFilter, statusFilter]);

  const metrics = useMemo(() => calculateDashboardMetrics(filteredSales), [filteredSales]);
  // Recebimentos (a receber/recebido no mês, 30/60/90 dias, agenda) são por data de RECEBIMENTO/previsão:
  // não podem depender do período da data da VENDA (uma venda de setembro prevista para outubro some do
  // filtro "Este mês"). Os demais filtros (cliente, corretor, imóvel, status) continuam valendo.
  const receivableSales = useMemo(() => sales.filter((sale) => {
    if (statusFilter !== "all" && sale.financialStatus !== statusFilter) return false;
    if (clientFilter && !normalizeText(sale.clientName).includes(normalizeText(clientFilter))) return false;
    if (brokerFilter && !normalizeText(sale.brokerName || sale.brokerEmail).includes(normalizeText(brokerFilter))) return false;
    if (propertyFilter && !normalizeText(sale.propertyName).includes(normalizeText(propertyFilter))) return false;
    return true;
  }), [sales, clientFilter, brokerFilter, propertyFilter, statusFilter]);
  const payments = useMemo(() => flattenReceivableEntries(receivableSales, (sale) => calculateSaleTotals(sale).grossCommission), [receivableSales]);
  const receivableMetrics = useMemo(() => calculateReceivableMetrics(payments), [payments]);
  const draftTotals = useMemo(() => calculateSaleTotals(draftSale), [draftSale]);

  function selectSale(sale) {
    setSelectedSaleId(sale.id);
    setDraftSale(createDraftSale(sale));
    setMessage("");
    setError("");
    setActiveTab("vendas");
    setMobileStep("editor");
  }

  function clearFilters() {
    setPeriod("month");
    setStartDate("");
    setEndDate("");
    setClientFilter("");
    setBrokerFilter("");
    setPropertyFilter("");
    setStatusFilter("all");
  }

  function updateDraftField(field, value) {
    setDraftSale((current) => {
      const next = { ...current, [field]: value };
      const saleValue = normalizeMoneyValue(field === "saleValue" ? value : next.saleValue);

      if (field === "financialStatus") {
        next.manualStatus = true;
      }

      if (field === "brokerId") {
        const broker = brokers.find((user) => user.id === value);
        if (broker) {
          next.brokerName = broker.name;
          next.brokerEmail = broker.email;
          next.brokerSharePercentage = formatPercentInput(broker.brokerCommissionPercentage ?? 50);
          next.agencySharePercentage = formatPercentInput(broker.agencyCommissionPercentage ?? 50);
          next.managerId = broker.managerId || "";
          next.managerPercentage = formatPercentInput(broker.defaultManagerPercentage ?? 10);
        }
      }

      if (field === "hasManagerCommission" && value) {
        const broker = brokers.find((user) => user.id === next.brokerId);
        next.managerId = next.managerId || broker?.managerId || "";
        if (!parseBrazilianDecimal(next.managerPercentage)) {
          next.managerPercentage = formatPercentInput(broker?.defaultManagerPercentage ?? 10);
        }
      }

      if (field === "commissionPercentage") {
        const percentage = parseBrazilianDecimal(value);
        next.commissionInputMode = "percentage";
        next.grossCommission = saleValue > 0 ? formatCurrencyInput(roundMoney((saleValue * percentage) / 100)) : "";
      }

      if (field === "grossCommission") {
        const amount = normalizeMoneyValue(value);
        next.commissionInputMode = "amount";
        next.commissionPercentage = saleValue > 0 ? formatPercentInput(roundMoney((amount / saleValue) * 100, 4)) : "";
      }

      if (field === "saleValue") {
        if (next.commissionInputMode === "percentage") {
          const percentage = parseBrazilianDecimal(next.commissionPercentage);
          next.grossCommission = saleValue > 0 ? formatCurrencyInput(roundMoney((saleValue * percentage) / 100)) : "";
        } else {
          const amount = normalizeMoneyValue(next.grossCommission);
          next.commissionPercentage = saleValue > 0 ? formatPercentInput(roundMoney((amount / saleValue) * 100, 4)) : "";
        }
      }

      return next;
    });
  }

  function updateExpense(index, field, value) {
    setDraftSale((current) => ({
      ...current,
      expenses: ensureArray(current.expenses).map((expense, itemIndex) =>
        itemIndex === index ? { ...expense, [field]: value } : expense
      )
    }));
  }

  function addExpense() {
    setDraftSale((current) => ({
      ...current,
      expenses: [
        ...ensureArray(current.expenses),
        {
          localId: `expense-${Date.now()}`,
          description: "",
          category: "Outros",
          amount: "",
          note: "",
          displayOrder: ensureArray(current.expenses).length
        }
      ]
    }));
  }

  function removeExpense(index) {
    setDraftSale((current) => ({
      ...current,
      expenses: ensureArray(current.expenses).filter((_, itemIndex) => itemIndex !== index)
    }));
  }

  function updatePayment(index, field, value) {
    setDraftSale((current) => ({
      ...current,
      payments: ensureArray(current.payments).map((payment, itemIndex) =>
        itemIndex === index ? { ...payment, [field]: value } : payment
      )
    }));
  }

  function addPayment() {
    setDraftSale((current) => ({
      ...current,
      payments: [
        ...ensureArray(current.payments),
        {
          localId: `payment-${Date.now()}`,
          installmentNumber: ensureArray(current.payments).length + 1,
          amount: "",
          expectedDate: "",
          receivedDate: "",
          status: "expected",
          note: ""
        }
      ]
    }));
  }

  function removePayment(index) {
    setDraftSale((current) => ({
      ...current,
      payments: ensureArray(current.payments).filter((_, itemIndex) => itemIndex !== index)
    }));
  }

  async function saveDraft() {
    if (!draftSale?.id) return;
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/financeiro/${draftSale.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyName: draftSale.propertyName,
          brokerName: draftSale.brokerName,
          saleDate: draftSale.saleDate,
          saleValue: draftSale.saleValue,
          commissionPercentage: draftSale.commissionPercentage,
          grossCommission: draftSale.grossCommission,
          commissionInputMode: draftSale.commissionInputMode,
          financialStatus: draftSale.financialStatus,
          ...(canManageForecast ? { expectedReceiptDate: draftSale.expectedReceiptDate || "" } : {}),
          manualStatus: draftSale.manualStatus,
          invoicePercentage: draftSale.invoicePercentage,
          brokerId: draftSale.brokerId,
          hasManagerCommission: draftSale.hasManagerCommission,
          managerId: draftSale.managerId,
          managerPercentage: draftSale.managerPercentage,
          brokerSharePercentage: draftSale.brokerSharePercentage,
          agencySharePercentage: draftSale.agencySharePercentage,
          notes: draftSale.notes,
          expenses: draftSale.expenses,
          payments: draftSale.payments
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível salvar a venda.");

      setSales((current) => current.map((sale) => (sale.id === payload.id ? payload : sale)));
      setDraftSale(createDraftSale(payload));
      setMessage("Alterações financeiras salvas.");
    } catch (requestError) {
      setError(requestError.message || "Não foi possível salvar a venda.");
    } finally {
      setSaving(false);
    }
  }

  function applyReceiptResult(result) {
    const updated = result?.sale;
    if (updated?.id) {
      setSales((current) => current.map((sale) => (sale.id === updated.id ? updated : sale)));
      setDraftSale((current) => (current?.id === updated.id ? createDraftSale(updated) : current));
    }
    setReceiptAction(null);
    setError("");
    setMessage(result?.alreadyConfirmed ? "Este recebimento já havia sido confirmado." : "Previsão de recebimento atualizada.");
  }

  async function deleteSale() {
    if (!draftSale?.id) return;
    if (!confirm("Excluir esta venda financeira? O cadastro do cliente será preservado.")) return;
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/financeiro/${draftSale.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível excluir a venda.");

      const nextSales = sales.filter((sale) => sale.id !== draftSale.id);
      setSales(nextSales);
      setSelectedSaleId(nextSales[0]?.id || "");
      setDraftSale(createDraftSale(nextSales[0]));
      setMobileStep("list");
      setMessage("Venda financeira excluída.");
    } catch (requestError) {
      setError(requestError.message || "Não foi possível excluir a venda.");
    } finally {
      setSaving(false);
    }
  }

  const monthLabel = MONTH_FORMATTER.format(new Date());
  const extraFilterCount = [clientFilter, brokerFilter, propertyFilter].filter((value) => String(value).trim()).length;
  const tabs = [
    { key: "dashboard", label: "Resumo", icon: BarChart3 },
    ...(canEdit ? [{ key: "vendas", label: "Vendas", icon: ReceiptText }] : []),
    { key: "recebimentos", label: "Recebimentos", icon: WalletCards },
    ...(health ? [{ key: "saude", label: "Saúde", icon: HeartPulse }] : [])
  ];
  // No celular a venda aberta ocupa a tela inteira (lista -> editor, com "Voltar"); a partir de xl lista e editor ficam lado a lado.
  const editingOnMobile = canEdit && activeTab === "vendas" && mobileStep === "editor";
  const hideOnMobileEditing = editingOnMobile ? "max-xl:hidden" : "";

  return (
    <section className="container-page space-y-4 md:space-y-5">
      {activeTab !== "saude" && (
        <header className={hideOnMobileEditing}>
          <h2 className="text-[28px] font-bold leading-9 tracking-[-0.02em] text-navy">Vendas e comissões</h2>
          <details className="group mt-1">
            <summary className="inline-flex min-h-touch cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand [&::-webkit-details-marker]:hidden">
              Como as vendas entram aqui
              <ChevronDown className="h-4 w-4 transition-transform duration-150 ease-out-ui group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
            </summary>
            <p className="max-w-3xl pb-2 text-sm leading-6 text-ink-2">
              As vendas entram automaticamente quando um cliente chega em Venda realizada. Ajuste VGV, comissão, repasses e parcelas sem expor dados financeiros para outros usuários.
            </p>
          </details>
        </header>
      )}

      {!isAssociate && (
        <div className={hideOnMobileEditing}>
          <SectionTabs tabs={tabs} active={activeTab} onChange={setActiveTab} />
        </div>
      )}

      {activeTab !== "saude" && (
        <div className={hideOnMobileEditing}>
          <HeroNumbers
            received={formatCurrency(receivableMetrics.receivedThisMonth)}
            receivable={formatCurrency(receivableMetrics.expectedThisMonth)}
            overdue={formatCurrency(receivableMetrics.overdueBeforeMonth)}
            overdueActive={receivableMetrics.overdueBeforeMonth > 0}
            monthLabel={monthLabel}
            onSeeOverdue={isAssociate ? null : () => setActiveTab("recebimentos")}
          />
        </div>
      )}

      {activeTab !== "saude" && (
        <div className={hideOnMobileEditing}>
          <FilterBar
            onClear={clearFilters}
            extraCount={extraFilterCount}
            hint={activeTab === "recebimentos" ? "Aqui o período não conta: recebimentos aparecem pela data de pagamento ou previsão, não pela data da venda." : ""}
            primary={<>
              <SelectField label="Período" value={period} onChange={setPeriod} options={PERIOD_OPTIONS} />
              <SelectField
                label="Status financeiro"
                value={statusFilter}
                onChange={setStatusFilter}
                options={[{ value: "all", label: "Todos" }, ...FINANCIAL_STATUS_OPTIONS]}
              />
            </>}
            extra={<>
              <TextField label="Cliente" value={clientFilter} onChange={setClientFilter} placeholder="Buscar cliente" />
              <TextField label="Corretor" value={brokerFilter} onChange={setBrokerFilter} placeholder="Responsável" />
              <TextField label="Imóvel" value={propertyFilter} onChange={setPropertyFilter} placeholder="Empreendimento ou imóvel" />
            </>}
          />
          {period === "custom" && (
            <div className="mt-3 grid grid-cols-2 gap-3 rounded-card border border-line bg-white p-3 sm:max-w-md sm:p-4">
              <TextField label="Data inicial" type="date" value={startDate} onChange={setStartDate} />
              <TextField label="Data final" type="date" value={endDate} onChange={setEndDate} />
            </div>
          )}
        </div>
      )}

      {message && <Feedback tone="success">{message}</Feedback>}
      {error && <Feedback tone="error">{error}</Feedback>}

      {activeTab === "dashboard" && (
        <>
          <DashboardTab
            metrics={metrics}
            salesCount={filteredSales.length}
            resultView={resultView}
            onResultViewChange={setResultView}
            currentUser={currentUser}
            isAssociate={isAssociate}
            payments={payments}
            onSeeReceivables={() => setActiveTab("recebimentos")}
          />
          {isAssociate ? <div><h3 className="mb-3 text-lg font-semibold text-navy">Vendas com participação</h3><SalesList sales={filteredSales} showReceiptDates={false} /></div> : null}
        </>
      )}

      {canEdit && activeTab === "vendas" && (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,0.85fr)_minmax(560px,1.15fr)]">
          <div className={mobileStep === "editor" ? "max-xl:hidden" : ""}>
            <SalesList sales={filteredSales} selectedSaleId={selectedSaleId} onSelect={selectSale} showReceiptDates />
          </div>
          <div className={mobileStep === "list" ? "max-xl:hidden" : ""}>
            <SaleEditor
              sale={selectedSale}
              draftSale={draftSale}
              draftTotals={draftTotals}
              saving={saving}
              onFieldChange={updateDraftField}
              onSave={saveDraft}
              onDelete={deleteSale}
              onBack={() => setMobileStep("list")}
              onExpenseChange={updateExpense}
              onExpenseAdd={addExpense}
              onExpenseRemove={removeExpense}
              onPaymentChange={updatePayment}
              onPaymentAdd={addPayment}
              onPaymentRemove={removePayment}
              canManageForecast={canManageForecast}
              brokers={brokers}
              managers={managers}
            />
          </div>
        </div>
      )}

      {health && activeTab === "saude" && (
        health.error ? (
          <div className="rounded-card border border-danger-line bg-white">
            <EmptyState
              tone="danger"
              icon={HeartPulse}
              title="Não foi possível carregar a Saúde financeira"
              description={`${health.error} O restante do Financeiro continua funcionando; cadastrar contas e confirmar pagamentos na Saúde só volta depois dessa atualização do banco.`}
            />
          </div>
        ) : (
          <FinancialHealthTab sales={sales} initialExpenses={health.expenses} initialOccurrences={health.occurrences} initialSettings={health.settings} eligibleBrokers={brokers} today={health.today} />
        )
      )}

      {activeTab === "recebimentos" && (
        <ReceivablesTab payments={payments} metrics={receivableMetrics} canEdit={canEdit && canManageForecast} onReceiptAction={setReceiptAction} />
      )}
      <div className="contents">
        {receiptAction?.type === "confirm" ? (
          <ConfirmReceiptModal receipt={receiptAction.receipt} onClose={() => setReceiptAction(null)} onDone={applyReceiptResult} />
        ) : null}
        {receiptAction?.type === "reschedule" ? (
          <RescheduleReceiptModal receipt={receiptAction.receipt} onClose={() => setReceiptAction(null)} onDone={applyReceiptResult} />
        ) : null}
      </div>
    </section>
  );
}

function DashboardTab({ metrics, salesCount, resultView, onResultViewChange, currentUser, isAssociate = false, payments = [], onSeeReceivables = () => {} }) {
  const ownBroker = metrics.byBrokerId?.[currentUser?.id] || 0;
  const ownManager = metrics.byManagerId?.[currentUser?.id] || 0;
  const consolidated = metrics.agencyCommission + ownBroker + ownManager;
  const cards = isAssociate ? [
    { title: "VGV das vendas", value: formatCurrency(metrics.saleValue) },
    { title: "Minha comissão", value: formatCurrency(metrics.freeCommission) },
    { title: "Comissão a receber", value: formatCurrency(metrics.receivableTotal) },
    { title: "Total de vendas", value: String(salesCount) },
    { title: "Média por venda", value: formatCurrency(metrics.averageCommission) }
  ] : [
    { title: "VGV total", value: formatCurrency(metrics.saleValue) },
    { title: "Comissão bruta", value: formatCurrency(metrics.grossCommission) },
    { title: "Despesas e repasses", value: formatCurrency(metrics.expenseTotal) },
    { title: "Comissão livre", value: formatCurrency(metrics.freeCommission) },
    { title: "Receita da imobiliária", value: formatCurrency(metrics.agencyCommission) },
    { title: "Comissão de corretores", value: formatCurrency(metrics.brokerCommission) },
    { title: "Comissão de gestores", value: formatCurrency(metrics.managerCommission) },
    ...(resultView === "separated" ? [
      { title: "Minha produção como corretor", value: formatCurrency(ownBroker) },
      { title: "Meu resultado como gestor", value: formatCurrency(ownManager) }
    ] : [{ title: "Resultado consolidado", value: formatCurrency(consolidated) }]),
    { title: "Comissão recebida", value: formatCurrency(metrics.receivedTotal) },
    { title: "Comissão a receber", value: formatCurrency(metrics.receivableTotal) },
    { title: "Total de vendas", value: String(salesCount) },
    { title: "Comissão média por venda", value: formatCurrency(metrics.averageCommission) },
    { title: "Margem líquida", value: `${formatPercent(metrics.marginPercentage)}%` }
  ];
  // "Para acompanhar": o que ainda não entrou (já vem ordenado por data; vencidos primeiro). Só leitura dos mesmos
  // lançamentos da aba Recebimentos — previsão do dono continua só para o dono (já omitida dos dados dos demais).
  const today = startOfDate(new Date());
  const open = payments.filter((payment) => payment.status !== "received" && payment.status !== "cancelled");
  const upcoming = open.slice(0, 5);

  return (
    <div className="space-y-4">
      {!isAssociate && upcoming.length > 0 ? (
        <section aria-labelledby="para-acompanhar" className="rounded-card border border-line bg-white">
          <div className="flex items-center justify-between gap-3 px-4 pt-3">
            <h3 id="para-acompanhar" className="text-base font-semibold text-navy">Para acompanhar</h3>
            <Button variant="ghost" onClick={onSeeReceivables}>
              Ver todos ({open.length})
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <ul className="divide-y divide-line">
            {upcoming.map((payment) => {
              const date = parseDate(payment.expectedDate);
              const overdue = payment.status === "overdue" || (date && date < today);
              return (
                <li key={payment.key} className={cx("flex items-center gap-3 px-4 py-3", overdue && "bg-danger-soft/40")}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{payment.clientName}</p>
                    <p className={cx("truncate text-xs", overdue ? "font-medium text-danger" : "text-muted")}>
                      {payment.expectedDate ? `${overdue ? "Venceu em" : "Previsto para"} ${formatDate(payment.expectedDate)}` : "Sem data prevista"} · {payment.isForecast ? "Saldo da comissão" : `Parcela ${payment.installmentNumber}`}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-navy">{formatCurrency(payment.amount)}</p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <Collapsible title="Ver detalhes" summary={isAssociate ? "VGV, comissão e médias" : "VGV, comissão bruta, repasses, resultado por função e médias"} tone="muted">
        {!isAssociate ? (
          <div role="group" aria-label="Forma de ver o resultado" className="mb-4 inline-flex rounded-control border border-line bg-mist p-1">
            {[
              { key: "separated", label: "Separado por função" },
              { key: "consolidated", label: "Consolidado" }
            ].map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={resultView === option.key}
                onClick={() => onResultViewChange(option.key)}
                className={cx(
                  "min-h-10 rounded-chip px-3.5 text-sm font-semibold transition-colors duration-150 ease-out-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                  resultView === option.key ? "bg-white text-navy shadow-sm ring-1 ring-line" : "text-muted hover:text-navy"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-3">
          {cards.map((card) => (
            <div key={card.title} className="min-w-0">
              <dt className="text-xs text-muted">{card.title}</dt>
              <dd className="mt-0.5 truncate text-lg font-semibold tabular-nums text-navy">{card.value}</dd>
            </div>
          ))}
        </dl>
      </Collapsible>
    </div>
  );
}

// Situação de recebimento de UMA venda para a lista. `showDates` = false para o associado; a previsão
// (expectedReceiptDate) só existe nos dados do dono — para os demais só aparecem datas de parcelas.
function saleReceiptInfo(sale, totals, showDates) {
  const today = startOfDate(new Date());
  const status = sale.financialStatus;
  const closed = status === "received" || status === "cancelled";
  const openParcels = ensureArray(sale.payments).filter((payment) => payment.status !== "received" && payment.status !== "cancelled");
  const dated = openParcels
    .map((payment) => ({ date: parseDate(payment.expectedDate), forecast: false }))
    .filter((item) => item.date);
  const forecastDate = sale.expectedReceiptDate && totals.receivableTotal > 0 ? parseDate(sale.expectedReceiptDate) : null;
  if (forecastDate) dated.push({ date: forecastDate, forecast: true });
  dated.sort((a, b) => a.date - b.date);
  const overdue = !closed && (openParcels.some((payment) => payment.status === "overdue") || dated.some((item) => item.date < today));
  const next = dated[0] || null;
  return {
    overdue,
    nextDate: showDates && next ? next.date : null,
    nextLabel: next?.forecast ? "Previsão" : "Parcela",
    closed
  };
}

function SalesList({ sales, selectedSaleId, onSelect, showReceiptDates = true }) {
  if (!sales.length) {
    return (
      <div className="rounded-card border border-line bg-white">
        <EmptyState
          icon={ReceiptText}
          title="Nenhuma venda encontrada"
          description="Quando um cliente for marcado como Venda realizada, a venda aparecerá aqui automaticamente. Se já marcou, confira os filtros acima."
        />
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {sales.map((sale) => {
        const active = sale.id === selectedSaleId;
        const totals = calculateSaleTotals(sale);
        const info = saleReceiptInfo(sale, totals, showReceiptDates);
        const option = FINANCIAL_STATUS_OPTIONS.find((item) => item.value === sale.financialStatus) || FINANCIAL_STATUS_OPTIONS[0];
        const classes = cx(
          "block w-full rounded-card border bg-white p-3.5 text-left sm:p-4",
          info.overdue ? "border-l-4 border-danger-line border-l-danger-strong" : "border-line",
          onSelect && "transition-[border-color,background-color] duration-150 ease-out-ui hover:border-brand/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
          active && "border-brand bg-info-soft/40 ring-1 ring-brand/30"
        );
        const body = (
          <>
            <span className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate text-base font-semibold text-navy">{sale.clientName || "Cliente sem nome"}</span>
                <span className="mt-0.5 block truncate text-sm text-muted">{formatDate(sale.saleDate)} · {sale.propertyName || "Imóvel não informado"}</span>
              </span>
              <FinancialStatusBadge value={option.value} label={option.label} overdue={info.overdue} />
            </span>
            <span className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
              <span className="text-ink-2">VGV <strong className="font-semibold tabular-nums text-ink">{formatCurrency(totals.saleValue)}</strong></span>
              <span className="text-ink-2">Comissão livre <strong className="font-semibold tabular-nums text-ink">{formatCurrency(totals.freeCommission)}</strong></span>
              {info.nextDate ? (
                <span className={cx("tabular-nums", info.overdue ? "font-semibold text-danger" : "text-ink-2")}>
                  {info.nextLabel} {DATE_FORMATTER.format(info.nextDate)}
                </span>
              ) : null}
            </span>
          </>
        );
        return (
          <li key={sale.id}>
            {onSelect ? (
              <button type="button" onClick={() => onSelect(sale)} aria-current={active ? "true" : undefined} className={classes}>{body}</button>
            ) : (
              <div className={classes}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SaleEditor({
  sale,
  draftSale,
  draftTotals,
  saving,
  onFieldChange,
  onSave,
  onDelete,
  onBack,
  onExpenseChange,
  onExpenseAdd,
  onExpenseRemove,
  onPaymentChange,
  onPaymentAdd,
  onPaymentRemove,
  brokers,
  managers,
  canManageForecast = false
}) {
  const draftForecast = computeForecastAmount({ grossCommission: draftTotals.grossCommission, financialStatus: draftSale?.financialStatus, payments: ensureArray(draftSale?.payments).map((payment) => ({ status: payment.status, amount: normalizeMoneyValue(payment.amount), expectedDate: payment.expectedDate })) });
  if (!sale?.id || !draftSale?.id) {
    return (
      <div className="rounded-card border border-line bg-white">
        <EmptyState icon={ReceiptText} title="Selecione uma venda" description="Escolha uma venda da lista para ajustar valores, comissão, repasses e recebimentos." />
      </div>
    );
  }

  const expenses = ensureArray(draftSale.expenses);
  const payments = ensureArray(draftSale.payments);

  return (
    <div className="rounded-card border border-line bg-white">
      <div className="border-b border-line p-4 md:p-5">
        <Button variant="ghost" onClick={onBack} className="-ml-3 mb-1 xl:hidden">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Voltar para vendas
        </Button>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted">Edição financeira</p>
            <h3 className="truncate text-[22px] font-semibold leading-7 tracking-[-0.01em] text-navy">{sale.clientName || "Cliente sem nome"}</h3>
            {sale.clientId ? (
              <Link
                href={`/admin/simulacoes?clientId=${sale.clientId}`}
                className="-ml-2 mt-0.5 inline-flex min-h-touch items-center gap-1.5 rounded-control px-2 text-sm font-semibold text-brand hover:bg-info-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" /> Ver cliente
              </Link>
            ) : null}
          </div>
          <Button variant="danger-ghost" onClick={onDelete} disabled={saving} className="shrink-0">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Excluir venda
          </Button>
        </div>
      </div>

      <div className="space-y-3 p-3 md:p-4">
        <Collapsible
          title="Venda"
          defaultOpen
          summary={`${draftSale.propertyName || "Imóvel não informado"} · VGV ${formatCurrency(normalizeMoneyValue(draftSale.saleValue))}`}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <TextField label="Imóvel / empreendimento" value={draftSale.propertyName} onChange={(value) => onFieldChange("propertyName", value)} />
            <SelectField label="Corretor responsável" value={draftSale.brokerId} onChange={(value) => onFieldChange("brokerId", value)} options={[{ value: "", label: "Selecione o corretor" }, ...brokers.map((user) => ({ value: user.id, label: user.name }))]} />
            <TextField label="Data da venda" type="date" value={draftSale.saleDate} onChange={(value) => onFieldChange("saleDate", value)} />
            <SelectField label="Status financeiro" value={draftSale.financialStatus} onChange={(value) => onFieldChange("financialStatus", value)} options={FINANCIAL_STATUS_OPTIONS} />
            {canManageForecast ? (
              <TextField
                label="Previsão de recebimento"
                type="date"
                value={draftSale.expectedReceiptDate}
                onChange={(value) => onFieldChange("expectedReceiptDate", value)}
                hint={draftForecast > 0
                  ? `Previsto: ${formatCurrency(draftForecast)} (saldo a receber). Não é dinheiro recebido.`
                  : "Quando você espera receber o saldo da comissão. Gera uma atividade na Agenda."}
              />
            ) : null}
            <TextField label="Valor da venda / VGV" value={draftSale.saleValue} onChange={(value) => onFieldChange("saleValue", value)} placeholder="R$ 0,00" inputMode="decimal" formatOnBlur={formatCurrencyInput} />
            <div className="md:col-span-2">
              <TextAreaField label="Observações" value={draftSale.notes} onChange={(value) => onFieldChange("notes", value)} />
            </div>
          </div>
        </Collapsible>

        <Collapsible
          title="Comissão e repasses"
          summary={`Bruta ${formatCurrency(draftTotals.grossCommission)} · livre ${formatCurrency(draftTotals.freeCommission)} · ${expenses.length} ${expenses.length === 1 ? "despesa" : "despesas"}`}
        >
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <TextField label="Percentual da comissão" value={draftSale.commissionPercentage} onChange={(value) => onFieldChange("commissionPercentage", value)} placeholder="0%" inputMode="decimal" formatOnBlur={formatPercentInput} />
              <TextField label="Comissão bruta" value={draftSale.grossCommission} onChange={(value) => onFieldChange("grossCommission", value)} placeholder="R$ 0,00" inputMode="decimal" formatOnBlur={formatCurrencyInput} />
              <div className="space-y-1.5">
                <label htmlFor="venda-nota-fiscal" className="block text-sm font-medium text-ink">Nota fiscal (%)</label>
                <div className="relative">
                  <input
                    id="venda-nota-fiscal"
                    aria-describedby="venda-nota-fiscal-ajuda"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="100"
                    step="0.01"
                    value={draftSale.invoicePercentage ?? ""}
                    placeholder="0"
                    onChange={(event) => onFieldChange("invoicePercentage", event.target.value)}
                    className={cx(inputClasses, "pr-10 tabular-nums")}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted" aria-hidden="true">%</span>
                </div>
                <p id="venda-nota-fiscal-ajuda" className="text-xs text-muted">
                  {draftTotals.invoiceDeduction > 0
                    ? `Despesa fiscal: ${formatCurrency(draftTotals.invoiceDeduction)} sobre a comissão bruta (${formatCurrency(draftTotals.grossCommission)}).`
                    : "0% = sem nota. O percentual vale só para esta venda."}
                </p>
              </div>
              <div className="hidden md:block" aria-hidden="true" />
              <TextField label="% Corretor" value={draftSale.brokerSharePercentage} onChange={(value) => onFieldChange("brokerSharePercentage", value)} inputMode="decimal" formatOnBlur={formatPercentInput} />
              <TextField label="% Imobiliária" value={draftSale.agencySharePercentage} onChange={(value) => onFieldChange("agencySharePercentage", value)} inputMode="decimal" formatOnBlur={formatPercentInput} />
              <label className="flex min-h-touch cursor-pointer items-center gap-3 rounded-control border border-line bg-white px-3 text-sm font-medium text-ink md:col-span-2">
                <input type="checkbox" checked={Boolean(draftSale.hasManagerCommission)} onChange={(event) => onFieldChange("hasManagerCommission", event.target.checked)} className="h-5 w-5 accent-brand" />
                Possui comissão de gestor
              </label>
              {draftSale.hasManagerCommission ? <>
                <SelectField label="Gestor" value={draftSale.managerId} onChange={(value) => onFieldChange("managerId", value)} options={[{ value: "", label: "Selecione o gestor" }, ...managers.map((user) => ({ value: user.id, label: user.name }))]} />
                <TextField label="% Gestor" value={draftSale.managerPercentage} onChange={(value) => onFieldChange("managerPercentage", value)} inputMode="decimal" formatOnBlur={formatPercentInput} />
              </> : null}
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-control bg-mist p-3 sm:grid-cols-4" aria-label="Como a comissão se divide">
              {[
                { title: "Gestor", value: draftTotals.managerCommission },
                { title: "Base após gestor", value: draftTotals.distributionBase },
                { title: "Corretor", value: draftTotals.brokerCommission },
                { title: "Imobiliária", value: draftTotals.agencyCommission }
              ].map((item) => (
                <div key={item.title} className="min-w-0">
                  <dt className="text-xs text-muted">{item.title}</dt>
                  <dd className="truncate text-sm font-semibold tabular-nums text-navy">{formatCurrency(item.value)}</dd>
                </div>
              ))}
            </dl>

            {draftTotals.invoiceDeduction > 0 ? (
              <p className="text-sm font-medium text-warning">Nota fiscal: desconto de {formatCurrency(draftTotals.invoiceDeduction)} ({formatPercent(draftTotals.invoicePercentage)}% da comissão bruta)</p>
            ) : null}

            <LineItemsSection
              title="Despesas e repasses"
              emptyText="Nenhuma despesa cadastrada."
              addLabel="Adicionar despesa"
              onAdd={onExpenseAdd}
            >
              {expenses.map((expense, index) => (
                <div key={expense.id || expense.localId || index} className="rounded-control border border-line bg-mist/60 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">Despesa {index + 1}</p>
                    <RemoveButton label={`Remover despesa ${index + 1}`} onClick={() => onExpenseRemove(index)} />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TextField label="Descrição" value={expense.description} onChange={(value) => onExpenseChange(index, "description", value)} />
                    <SelectField label="Categoria" value={expense.category} onChange={(value) => onExpenseChange(index, "category", value)} options={EXPENSE_CATEGORIES.map((category) => ({ value: category, label: category }))} />
                    <TextField label="Valor" value={expense.amount} onChange={(value) => onExpenseChange(index, "amount", value)} inputMode="decimal" />
                    <TextField label="Observação" value={expense.note} onChange={(value) => onExpenseChange(index, "note", value)} />
                  </div>
                </div>
              ))}
            </LineItemsSection>
          </div>
        </Collapsible>

        <Collapsible
          title="Recebimentos"
          summary={`${payments.length} ${payments.length === 1 ? "parcela" : "parcelas"} · recebido ${formatCurrency(draftTotals.receivedTotal)} · a receber ${formatCurrency(draftTotals.receivableTotal)}`}
        >
          <LineItemsSection
            title=""
            emptyText="Nenhuma parcela cadastrada."
            addLabel="Adicionar parcela"
            onAdd={onPaymentAdd}
          >
            {payments.map((payment, index) => (
              <div key={payment.id || payment.localId || index} className="rounded-control border border-line bg-mist/60 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    Parcela {payment.installmentNumber || index + 1}
                    <PaymentStatusBadge value={payment.status} label={(PAYMENT_STATUS_OPTIONS.find((item) => item.value === payment.status) || PAYMENT_STATUS_OPTIONS[0]).label} />
                  </p>
                  <RemoveButton label={`Remover parcela ${payment.installmentNumber || index + 1}`} onClick={() => onPaymentRemove(index)} />
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  <TextField label="Nº" value={payment.installmentNumber} onChange={(value) => onPaymentChange(index, "installmentNumber", value)} inputMode="numeric" />
                  <TextField label="Valor" value={payment.amount} onChange={(value) => onPaymentChange(index, "amount", value)} inputMode="decimal" />
                  <SelectField label="Status" value={payment.status} onChange={(value) => onPaymentChange(index, "status", value)} options={PAYMENT_STATUS_OPTIONS} />
                  <TextField label="Previsão" type="date" value={payment.expectedDate} onChange={(value) => onPaymentChange(index, "expectedDate", value)} />
                  <TextField label="Recebido em" type="date" value={payment.receivedDate} onChange={(value) => onPaymentChange(index, "receivedDate", value)} />
                  <TextField label="Observação" value={payment.note} onChange={(value) => onPaymentChange(index, "note", value)} />
                </div>
              </div>
            ))}
          </LineItemsSection>
        </Collapsible>
      </div>

      <EditorFooter
        saving={saving}
        onSave={onSave}
        metrics={[
          { label: "Comissão livre", value: formatCurrency(draftTotals.freeCommission) },
          { label: "Recebido", value: formatCurrency(draftTotals.receivedTotal) },
          { label: "A receber", value: formatCurrency(draftTotals.receivableTotal) }
        ]}
      />
    </div>
  );
}

function LineItemsSection({ title, emptyText, addLabel, onAdd, children }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);

  return (
    <section className="space-y-3">
      {title ? <h4 className="text-sm font-semibold text-navy">{title}</h4> : null}
      {hasChildren ? children : <p className="rounded-control bg-mist p-3 text-sm text-muted">{emptyText}</p>}
      <Button variant="secondary" onClick={onAdd} className="w-full sm:w-auto">
        <Plus className="h-4 w-4" aria-hidden="true" />
        {addLabel}
      </Button>
    </section>
  );
}

function ReceivablesTab({ payments, metrics, canEdit = false, onReceiptAction = () => {} }) {
  const today = startOfDate(new Date());
  return (
    <div className="space-y-4">
      <Collapsible title="Próximos 30, 60 e 90 dias" summary={`${formatCurrency(metrics.next30)} · ${formatCurrency(metrics.next60)} · ${formatCurrency(metrics.next90)}`} tone="muted">
        <dl className="grid grid-cols-3 gap-4">
          {[{ title: "Em 30 dias", value: metrics.next30 }, { title: "Em 60 dias", value: metrics.next60 }, { title: "Em 90 dias", value: metrics.next90 }].map((item) => (
            <div key={item.title} className="min-w-0">
              <dt className="text-xs text-muted">{item.title}</dt>
              <dd className="truncate text-base font-semibold tabular-nums text-navy sm:text-lg">{formatCurrency(item.value)}</dd>
            </div>
          ))}
        </dl>
      </Collapsible>

      <section className="rounded-card border border-line bg-white" aria-labelledby="agenda-recebimentos">
        <div className="border-b border-line px-4 py-3">
          <h3 id="agenda-recebimentos" className="text-base font-semibold text-navy">Agenda de recebimentos</h3>
          <p className="text-xs text-muted">Parcelas e previsões, da mais antiga para a mais nova.</p>
        </div>
        <ul className="divide-y divide-line">
          {payments.length ? payments.map((payment) => {
            const date = parseDate(payment.expectedDate);
            const open = payment.status !== "received" && payment.status !== "cancelled";
            const isOverdue = open && date && date < today;
            const displayStatus = isOverdue ? "overdue" : payment.status;
            const daysLate = isOverdue ? Math.max(1, Math.round((today.getTime() - date.getTime()) / 86400000)) : 0;
            const canAct = payment.isForecast && canEdit;
            const receipt = { saleId: payment.saleId, clientName: payment.clientName, propertyName: payment.propertyName, amount: payment.amount, expectedDate: payment.expectedDate };
            const statusOption = PAYMENT_STATUS_OPTIONS.find((item) => item.value === displayStatus) || PAYMENT_STATUS_OPTIONS[0];
            return (
              <li
                key={payment.key}
                className={cx(
                  "grid gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,1.6fr)_120px_130px_130px_auto] md:items-center",
                  isOverdue && "border-l-4 border-l-danger-strong bg-danger-soft/40"
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{payment.clientName}</p>
                  <p className="truncate text-xs text-muted">{payment.propertyName || "Imóvel não informado"} · {payment.isForecast ? "Previsão do saldo" : `Parcela ${payment.installmentNumber}`}</p>
                </div>
                <p className="text-base font-semibold tabular-nums text-navy md:text-right">{formatCurrency(payment.amount)}</p>
                <p className={cx("text-sm tabular-nums", isOverdue ? "font-semibold text-danger" : "text-ink-2")}>
                  {formatDate(payment.expectedDate)}
                  {isOverdue ? <span className="block text-xs font-medium">há {daysLate} {daysLate === 1 ? "dia" : "dias"}</span> : null}
                </p>
                <div><PaymentStatusBadge value={displayStatus} label={statusOption.label} /></div>
                {canAct ? (
                  <div className="grid grid-cols-2 gap-2 md:flex">
                    <Button onClick={() => onReceiptAction({ type: "confirm", receipt })}>Confirmar recebimento</Button>
                    <Button variant="secondary" onClick={() => onReceiptAction({ type: "reschedule", receipt })}>Reagendar</Button>
                  </div>
                ) : <span className="hidden md:block" />}
              </li>
            );
          }) : (
            <li><EmptyState icon={WalletCards} title="Nenhum recebimento cadastrado" description="As parcelas e previsões das vendas aparecem aqui assim que forem lançadas." /></li>
          )}
        </ul>
      </section>
      <p className="text-xs text-muted">Recebido = só pagamento confirmado. Previsão não conta como dinheiro recebido. Estes indicadores consideram todas as vendas, independentemente da data da venda.</p>
    </div>
  );
}

function TextField({ label, value, onChange, type = "text", placeholder = "", inputMode, formatOnBlur, hint }) {
  return (
    <UiField label={label} hint={hint}>
      <input
        type={type}
        value={value ?? ""}
        placeholder={placeholder}
        inputMode={inputMode}
        onFocus={formatOnBlur ? (event) => event.target.select() : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={formatOnBlur ? (event) => onChange(formatOnBlur(event.target.value)) : undefined}
        className={cx(inputClasses, "tabular-nums")}
      />
    </UiField>
  );
}

function TextAreaField({ label, value, onChange }) {
  return (
    <UiField label={label}>
      <textarea
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        className={cx(inputClasses, "min-h-24 py-2.5")}
      />
    </UiField>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <UiField label={label}>
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value)} className={inputClasses}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </UiField>
  );
}

function RemoveButton({ label, onClick }) {
  return (
    <Button variant="danger-ghost" size="icon" aria-label={label} title={label} onClick={onClick}>
      <Trash2 className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}

function Feedback({ tone, children }) {
  const classes = tone === "error"
    ? "border-danger-line bg-danger-soft text-danger"
    : "border-success-line bg-success-soft text-success";

  return <div role={tone === "error" ? "alert" : "status"} className={`rounded-control border px-4 py-3 text-sm font-medium ${classes}`}>{children}</div>;
}

function calculateDashboardMetrics(sales) {
  const total = sales.reduce((acc, sale) => {
    const saleTotals = calculateSaleTotals(sale);
    acc.saleValue += saleTotals.saleValue;
    acc.grossCommission += saleTotals.grossCommission;
    acc.expenseTotal += saleTotals.expenseTotal;
    acc.freeCommission += saleTotals.freeCommission;
    acc.agencyCommission += saleTotals.agencyCommission;
    acc.brokerCommission += saleTotals.brokerCommission;
    acc.managerCommission += saleTotals.managerCommission;
    if (sale.brokerId) acc.byBrokerId[sale.brokerId] = (acc.byBrokerId[sale.brokerId] || 0) + saleTotals.brokerCommission;
    if (sale.managerId) acc.byManagerId[sale.managerId] = (acc.byManagerId[sale.managerId] || 0) + saleTotals.managerCommission;
    acc.receivedTotal += saleTotals.receivedTotal;
    acc.receivableTotal += saleTotals.receivableTotal;
    return acc;
  }, {
    saleValue: 0,
    grossCommission: 0,
    expenseTotal: 0,
    freeCommission: 0,
    agencyCommission: 0,
    brokerCommission: 0,
    managerCommission: 0,
    byBrokerId: {},
    byManagerId: {},
    receivedTotal: 0,
    receivableTotal: 0
  });

  return {
    ...total,
    averageCommission: sales.length ? total.freeCommission / sales.length : 0,
    marginPercentage: total.saleValue > 0 ? (total.freeCommission / total.saleValue) * 100 : 0
  };
}

function calculateSaleTotals(sale = {}) {
  const saleValue = normalizeMoneyValue(sale.saleValue);
  const grossCommission = normalizeMoneyValue(sale.grossCommission);
  const invoicePercentage = resolveInvoicePercentage({ invoicePercentage: sale.invoicePercentage, invoiceIssued: sale.invoiceIssued });
  const invoiceDeduction = calculateInvoiceDeduction(grossCommission, invoicePercentage);
  const expenseTotal = ensureArray(sale.expenses).reduce((sum, expense) => sum + normalizeMoneyValue(expense.amount), 0);
  const receivedTotal = ensureArray(sale.payments)
    .filter((payment) => payment.status === "received")
    .reduce((sum, payment) => sum + normalizeMoneyValue(payment.amount), 0);
  const freeCommission = Math.max(0, grossCommission - invoiceDeduction - expenseTotal);
  let distribution;
  try {
    distribution = calculateCommissionDistribution({
      freeCommission,
      hasManagerCommission: sale.hasManagerCommission,
      managerPercentage: sale.managerPercentage,
      brokerPercentage: sale.brokerSharePercentage ?? 50,
      agencyPercentage: sale.agencySharePercentage ?? 50
    });
  } catch {
    distribution = { managerCommission: 0, distributionBase: freeCommission, brokerCommission: 0, agencyCommission: 0 };
  }
  return {
    saleValue,
    grossCommission,
    invoiceDeduction,
    invoicePercentage,
    expenseTotal,
    freeCommission,
    ...distribution,
    receivedTotal,
    // Mesma base do servidor (lib/financial-receipt-basis.mjs): falta da comissão BRUTA, não da livre.
    receivableTotal: Math.max(0, grossCommission - receivedTotal)
  };
}

function createDraftSale(sale) {
  if (!sale) return null;
  return {
    ...sale,
    saleValue: formatCurrencyInput(sale.saleValue),
    commissionPercentage: formatPercentInput(sale.commissionPercentage),
    invoicePercentage: String(resolveInvoicePercentage({ invoicePercentage: sale.invoicePercentage, invoiceIssued: sale.invoiceIssued })),
    grossCommission: formatCurrencyInput(sale.grossCommission),
    managerPercentage: formatPercentInput(sale.managerPercentage || 0),
    brokerSharePercentage: formatPercentInput(sale.brokerSharePercentage ?? 50),
    agencySharePercentage: formatPercentInput(sale.agencySharePercentage ?? 50),
    expenses: ensureArray(sale.expenses).map((expense, index) => ({
      ...expense,
      localId: expense.id || `expense-${sale.id}-${index}`,
      amount: valueToInput(expense.amount)
    })),
    payments: ensureArray(sale.payments).map((payment, index) => ({
      ...payment,
      localId: payment.id || `payment-${sale.id}-${index}`,
      amount: valueToInput(payment.amount)
    }))
  };
}

function matchesPeriod(dateValue, period, customStart, customEnd) {
  if (period === "all") return true;
  const date = parseDate(dateValue);
  if (!date) return false;
  const now = startOfDate(new Date());

  if (period === "today") return sameDay(date, now);

  if (period === "week") {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return isDateBetween(date, start, end);
  }

  if (period === "month") {
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  }

  if (period === "lastMonth") {
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return date.getFullYear() === lastMonth.getFullYear() && date.getMonth() === lastMonth.getMonth();
  }

  if (period === "quarter") {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    const start = new Date(now.getFullYear(), quarterStartMonth, 1);
    const end = new Date(now.getFullYear(), quarterStartMonth + 3, 0);
    return isDateBetween(date, start, end);
  }

  if (period === "year") {
    return date.getFullYear() === now.getFullYear();
  }

  if (period === "custom") {
    const start = parseDate(customStart);
    const end = parseDate(customEnd);
    if (start && end) return isDateBetween(date, start, end);
    if (start) return date >= start;
    if (end) return date <= end;
  }

  return true;
}

function parseDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split("-").map(Number);
    return startOfDate(new Date(year, month - 1, day));
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : startOfDate(parsed);
}

function isDateBetween(value, start, end) {
  const date = value instanceof Date ? startOfDate(value) : parseDate(value);
  if (!date) return false;
  return date >= startOfDate(start) && date <= startOfDate(end);
}

function compareDate(a, b) {
  const dateA = parseDate(a);
  const dateB = parseDate(b);
  return (dateA?.getTime() || 0) - (dateB?.getTime() || 0);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfDate(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Valor em R$ no padrão brasileiro ("1.500" = 1500) — regra única em lib/money-br.mjs (a mesma do servidor).
function normalizeMoneyValue(value) {
  return parseBrazilianMoney(value);
}

function formatCurrency(value) {
  return MONEY_FORMATTER.format(normalizeMoneyValue(value));
}

function formatCurrencyInput(value) {
  return formatCurrency(value);
}

function formatPercentInput(value) {
  return `${formatPercent(parseBrazilianDecimal(value))}%`;
}

function formatDate(value) {
  const date = parseDate(value);
  return date ? DATE_FORMATTER.format(date) : "Data não informada";
}

function formatPercent(value) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(Number(value || 0));
}

function valueToInput(value) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) && number !== 0 ? String(number) : "";
}

function roundMoney(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

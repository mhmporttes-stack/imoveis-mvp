"use client";

import { useMemo, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  DollarSign,
  Filter,
  Plus,
  ReceiptText,
  RefreshCw,
  Save,
  Trash2,
  WalletCards
} from "lucide-react";

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

const STATUS_STYLES = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  partial: "border-blue-200 bg-blue-50 text-blue-700",
  received: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-slate-200 bg-slate-50 text-slate-600"
};

const PAYMENT_STATUS_STYLES = {
  expected: "border-blue-200 bg-blue-50 text-blue-700",
  received: "border-emerald-200 bg-emerald-50 text-emerald-700",
  overdue: "border-red-200 bg-red-50 text-red-700",
  cancelled: "border-slate-200 bg-slate-50 text-slate-600"
};

const MONEY_FORMATTER = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
});

const DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});

export default function AdminFinancialDashboard({ initialSales = [] }) {
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
  const payments = useMemo(() => flattenPayments(filteredSales), [filteredSales]);
  const receivableMetrics = useMemo(() => calculateReceivableMetrics(payments), [payments]);
  const draftTotals = useMemo(() => calculateSaleTotals(draftSale), [draftSale]);

  function selectSale(sale) {
    setSelectedSaleId(sale.id);
    setDraftSale(createDraftSale(sale));
    setMessage("");
    setError("");
    setActiveTab("vendas");
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

      if (field === "commissionPercentage") {
        const percentage = normalizeMoneyValue(value);
        next.commissionInputMode = "percentage";
        next.grossCommission = saleValue > 0 ? roundMoney((saleValue * percentage) / 100) : "";
      }

      if (field === "grossCommission") {
        const amount = normalizeMoneyValue(value);
        next.commissionInputMode = "amount";
        next.commissionPercentage = saleValue > 0 ? roundMoney((amount / saleValue) * 100, 4) : "";
      }

      if (field === "saleValue") {
        if (next.commissionInputMode === "percentage") {
          const percentage = normalizeMoneyValue(next.commissionPercentage);
          next.grossCommission = saleValue > 0 ? roundMoney((saleValue * percentage) / 100) : "";
        } else {
          const amount = normalizeMoneyValue(next.grossCommission);
          next.commissionPercentage = saleValue > 0 ? roundMoney((amount / saleValue) * 100, 4) : "";
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
          manualStatus: draftSale.manualStatus,
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
      setMessage("Venda financeira excluída.");
    } catch (requestError) {
      setError(requestError.message || "Não foi possível excluir a venda.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="container-page space-y-6">
      <div className="premium-card p-5 md:p-7">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.28em] text-brand">Controle financeiro</p>
            <h2 className="mt-2 text-3xl font-black text-navy md:text-4xl">Vendas, comissões e recebimentos</h2>
            <p className="mt-2 max-w-4xl text-base leading-7 text-muted">
              As vendas entram automaticamente quando um cliente chega em Venda realizada. Ajuste VGV, comissão, repasses e parcelas sem expor dados financeiros para outros usuários.
            </p>
          </div>

          <button
            type="button"
            onClick={clearFilters}
            className="premium-button-secondary min-h-12 px-5"
          >
            <Filter size={18} />
            Limpar filtros
          </button>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SelectField label="Período" value={period} onChange={setPeriod} options={PERIOD_OPTIONS} />
          <TextField label="Cliente" value={clientFilter} onChange={setClientFilter} placeholder="Buscar cliente" />
          <TextField label="Corretor" value={brokerFilter} onChange={setBrokerFilter} placeholder="Responsável" />
          <SelectField
            label="Status financeiro"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[{ value: "all", label: "Todos" }, ...FINANCIAL_STATUS_OPTIONS]}
          />
          <TextField label="Imóvel" value={propertyFilter} onChange={setPropertyFilter} placeholder="Empreendimento ou imóvel" />
          {period === "custom" && (
            <>
              <TextField label="Data inicial" type="date" value={startDate} onChange={setStartDate} />
              <TextField label="Data final" type="date" value={endDate} onChange={setEndDate} />
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { key: "dashboard", label: "DASHBOARD", icon: BarChart3 },
          { key: "vendas", label: "VENDAS", icon: ReceiptText },
          { key: "recebimentos", label: "RECEBIMENTOS", icon: WalletCards }
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex min-h-12 items-center gap-2 rounded-full border px-5 text-sm font-black transition ${
                active
                  ? "border-navy bg-navy text-white shadow-soft"
                  : "border-navy/10 bg-white text-navy hover:border-brand"
              }`}
            >
              <Icon size={17} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {message && <Feedback tone="success">{message}</Feedback>}
      {error && <Feedback tone="error">{error}</Feedback>}

      {activeTab === "dashboard" && (
        <DashboardTab metrics={metrics} salesCount={filteredSales.length} />
      )}

      {activeTab === "vendas" && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(520px,1.1fr)]">
          <SalesList sales={filteredSales} selectedSaleId={selectedSaleId} onSelect={selectSale} />
          <SaleEditor
            sale={selectedSale}
            draftSale={draftSale}
            draftTotals={draftTotals}
            saving={saving}
            onFieldChange={updateDraftField}
            onSave={saveDraft}
            onDelete={deleteSale}
            onExpenseChange={updateExpense}
            onExpenseAdd={addExpense}
            onExpenseRemove={removeExpense}
            onPaymentChange={updatePayment}
            onPaymentAdd={addPayment}
            onPaymentRemove={removePayment}
          />
        </div>
      )}

      {activeTab === "recebimentos" && (
        <ReceivablesTab payments={payments} metrics={receivableMetrics} />
      )}
    </section>
  );
}

function DashboardTab({ metrics, salesCount }) {
  const cards = [
    { title: "VGV total", value: formatCurrency(metrics.saleValue), icon: DollarSign },
    { title: "Comissão bruta", value: formatCurrency(metrics.grossCommission), icon: ReceiptText },
    { title: "Despesas e repasses", value: formatCurrency(metrics.expenseTotal), icon: Trash2 },
    { title: "Comissão livre", value: formatCurrency(metrics.freeCommission), icon: CheckCircle2 },
    { title: "Comissão recebida", value: formatCurrency(metrics.receivedTotal), icon: WalletCards },
    { title: "Comissão a receber", value: formatCurrency(metrics.receivableTotal), icon: Clock3 },
    { title: "Total de vendas", value: String(salesCount), icon: BarChart3 },
    { title: "Comissão média por venda", value: formatCurrency(metrics.averageCommission), icon: DollarSign },
    { title: "Margem líquida", value: `${formatPercent(metrics.marginPercentage)}%`, icon: BarChart3 }
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <article key={card.title} className="premium-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-brand">{card.title}</p>
                <p className="mt-3 text-3xl font-black text-navy">{card.value}</p>
              </div>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-brand">
                <Icon size={20} />
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function SalesList({ sales, selectedSaleId, onSelect }) {
  if (!sales.length) {
    return (
      <div className="premium-card p-8 text-center">
        <p className="text-xl font-black text-navy">Nenhuma venda encontrada.</p>
        <p className="mt-2 text-muted">Quando um cliente for marcado como Venda realizada, a venda aparecerá aqui automaticamente.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sales.map((sale) => {
        const active = sale.id === selectedSaleId;
        const totals = calculateSaleTotals(sale);
        return (
          <button
            key={sale.id}
            type="button"
            onClick={() => onSelect(sale)}
            className={`w-full rounded-[22px] border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-soft ${
              active ? "border-brand bg-blue-50/60 shadow-soft" : "border-line bg-white"
            }`}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-lg font-black text-navy">{sale.clientName || "Cliente sem nome"}</p>
                <p className="mt-1 text-sm font-semibold text-muted">{formatDate(sale.saleDate)} · {sale.propertyName || "Imóvel não informado"}</p>
              </div>
              <StatusBadge value={sale.financialStatus} />
            </div>
            <div className="mt-3 grid gap-2 text-sm font-bold text-muted sm:grid-cols-2">
              <span>VGV: <strong className="text-navy">{formatCurrency(totals.saleValue)}</strong></span>
              <span>Comissão livre: <strong className="text-navy">{formatCurrency(totals.freeCommission)}</strong></span>
            </div>
          </button>
        );
      })}
    </div>
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
  onExpenseChange,
  onExpenseAdd,
  onExpenseRemove,
  onPaymentChange,
  onPaymentAdd,
  onPaymentRemove
}) {
  if (!sale?.id || !draftSale?.id) {
    return (
      <div className="premium-card p-8 text-center">
        <p className="text-xl font-black text-navy">Selecione uma venda.</p>
      </div>
    );
  }

  return (
    <div className="premium-card overflow-hidden">
      <div className="border-b border-line bg-white p-5 md:p-6">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-brand">Edição financeira</p>
        <h3 className="mt-2 text-3xl font-black text-navy">{sale.clientName || "Cliente sem nome"}</h3>
        <p className="mt-2 text-sm font-semibold text-muted">
          Comissão livre: <strong className="text-navy">{formatCurrency(draftTotals.freeCommission)}</strong> ·
          Recebido: <strong className="text-navy"> {formatCurrency(draftTotals.receivedTotal)}</strong> ·
          A receber: <strong className="text-navy"> {formatCurrency(draftTotals.receivableTotal)}</strong>
        </p>
      </div>

      <div className="space-y-6 p-5 md:p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Imóvel / empreendimento" value={draftSale.propertyName} onChange={(value) => onFieldChange("propertyName", value)} />
          <TextField label="Corretor responsável" value={draftSale.brokerName} onChange={(value) => onFieldChange("brokerName", value)} />
          <TextField label="Data da venda" type="date" value={draftSale.saleDate} onChange={(value) => onFieldChange("saleDate", value)} />
          <SelectField label="Status financeiro" value={draftSale.financialStatus} onChange={(value) => onFieldChange("financialStatus", value)} options={FINANCIAL_STATUS_OPTIONS} />
          <TextField label="Valor da venda / VGV" value={draftSale.saleValue} onChange={(value) => onFieldChange("saleValue", value)} placeholder="R$ 0,00" inputMode="decimal" />
          <TextField label="Percentual da comissão" value={draftSale.commissionPercentage} onChange={(value) => onFieldChange("commissionPercentage", value)} placeholder="0%" inputMode="decimal" />
          <TextField label="Comissão bruta" value={draftSale.grossCommission} onChange={(value) => onFieldChange("grossCommission", value)} placeholder="R$ 0,00" inputMode="decimal" />
        </div>

        <TextAreaField label="Observações" value={draftSale.notes} onChange={(value) => onFieldChange("notes", value)} />

        <LineItemsSection
          title="Despesas e repasses"
          emptyText="Nenhuma despesa cadastrada."
          addLabel="Adicionar despesa"
          onAdd={onExpenseAdd}
        >
          {ensureArray(draftSale.expenses).map((expense, index) => (
            <div key={expense.id || expense.localId || index} className="grid gap-3 rounded-2xl border border-line bg-mist/40 p-3 lg:grid-cols-[1.2fr_0.9fr_0.8fr_1fr_auto]">
              <TextField label="Descrição" value={expense.description} onChange={(value) => onExpenseChange(index, "description", value)} />
              <SelectField label="Categoria" value={expense.category} onChange={(value) => onExpenseChange(index, "category", value)} options={EXPENSE_CATEGORIES.map((category) => ({ value: category, label: category }))} />
              <TextField label="Valor" value={expense.amount} onChange={(value) => onExpenseChange(index, "amount", value)} inputMode="decimal" />
              <TextField label="Observação" value={expense.note} onChange={(value) => onExpenseChange(index, "note", value)} />
              <RemoveButton label="Remover despesa" onClick={() => onExpenseRemove(index)} />
            </div>
          ))}
        </LineItemsSection>

        <LineItemsSection
          title="Recebimentos"
          emptyText="Nenhuma parcela cadastrada."
          addLabel="Adicionar parcela"
          onAdd={onPaymentAdd}
        >
          {ensureArray(draftSale.payments).map((payment, index) => (
            <div key={payment.id || payment.localId || index} className="grid gap-3 rounded-2xl border border-line bg-mist/40 p-3 xl:grid-cols-[0.5fr_0.85fr_0.85fr_0.85fr_0.75fr_1fr_auto]">
              <TextField label="Nº" value={payment.installmentNumber} onChange={(value) => onPaymentChange(index, "installmentNumber", value)} inputMode="numeric" />
              <TextField label="Valor" value={payment.amount} onChange={(value) => onPaymentChange(index, "amount", value)} inputMode="decimal" />
              <TextField label="Previsão" type="date" value={payment.expectedDate} onChange={(value) => onPaymentChange(index, "expectedDate", value)} />
              <TextField label="Recebido em" type="date" value={payment.receivedDate} onChange={(value) => onPaymentChange(index, "receivedDate", value)} />
              <SelectField label="Status" value={payment.status} onChange={(value) => onPaymentChange(index, "status", value)} options={PAYMENT_STATUS_OPTIONS} />
              <TextField label="Observação" value={payment.note} onChange={(value) => onPaymentChange(index, "note", value)} />
              <RemoveButton label="Remover parcela" onClick={() => onPaymentRemove(index)} />
            </div>
          ))}
        </LineItemsSection>

        <div className="grid gap-3 border-t border-line pt-5 sm:grid-cols-2">
          <button type="button" onClick={onSave} disabled={saving} className="premium-button-primary min-h-12">
            <Save size={18} />
            {saving ? "Salvando..." : "Salvar financeiro"}
          </button>
          <button type="button" onClick={onDelete} disabled={saving} className="premium-button-secondary min-h-12 text-red-700 hover:border-red-300 hover:bg-red-50">
            <Trash2 size={18} />
            Excluir venda
          </button>
        </div>
      </div>
    </div>
  );
}

function LineItemsSection({ title, emptyText, addLabel, onAdd, children }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h4 className="text-xl font-black text-navy">{title}</h4>
        <button type="button" onClick={onAdd} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-brand/25 bg-white px-4 text-sm font-black text-brand transition hover:border-brand hover:bg-blue-50">
          <Plus size={16} />
          {addLabel}
        </button>
      </div>
      {hasChildren ? children : <p className="rounded-2xl border border-line bg-mist/50 p-4 text-sm font-bold text-muted">{emptyText}</p>}
    </section>
  );
}

function ReceivablesTab({ payments, metrics }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <SmallMetric title="A receber neste mês" value={formatCurrency(metrics.expectedThisMonth)} />
        <SmallMetric title="Recebido neste mês" value={formatCurrency(metrics.receivedThisMonth)} />
        <SmallMetric title="A receber próximos 30/60/90 dias" value={`${formatCurrency(metrics.next30)} / ${formatCurrency(metrics.next60)} / ${formatCurrency(metrics.next90)}`} />
      </div>

      <div className="premium-card overflow-hidden">
        <div className="border-b border-line p-5">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-brand">Parcelas</p>
          <h3 className="mt-2 text-2xl font-black text-navy">Agenda de recebimentos</h3>
        </div>
        <div className="divide-y divide-line">
          {payments.length ? payments.map((payment) => (
            <div key={payment.key} className="grid gap-3 p-4 text-sm md:grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr] md:items-center">
              <div>
                <p className="font-black text-navy">{payment.clientName}</p>
                <p className="font-semibold text-muted">{payment.propertyName || "Imóvel não informado"} · Parcela {payment.installmentNumber}</p>
              </div>
              <p className="font-black text-navy">{formatCurrency(payment.amount)}</p>
              <p className="font-bold text-muted">{formatDate(payment.expectedDate)}</p>
              <PaymentBadge value={payment.status} />
            </div>
          )) : (
            <p className="p-6 text-center font-bold text-muted">Nenhum recebimento cadastrado.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function SmallMetric({ title, value }) {
  return (
    <article className="premium-card p-5">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-brand">{title}</p>
      <p className="mt-3 text-2xl font-black text-navy">{value}</p>
    </article>
  );
}

function TextField({ label, value, onChange, type = "text", placeholder = "", inputMode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-black text-navy">{label}</span>
      <input
        type={type}
        value={value ?? ""}
        placeholder={placeholder}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        className="admin-input min-h-12 rounded-2xl"
      />
    </label>
  );
}

function TextAreaField({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-black text-navy">{label}</span>
      <textarea
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        className="admin-input min-h-28 rounded-2xl py-3"
      />
    </label>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-black text-navy">{label}</span>
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value)} className="admin-input min-h-12 rounded-2xl">
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function RemoveButton({ label, onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-red-100 bg-white px-3 text-red-700 transition hover:bg-red-50"
    >
      <Trash2 size={18} />
    </button>
  );
}

function StatusBadge({ value }) {
  const option = FINANCIAL_STATUS_OPTIONS.find((item) => item.value === value) || FINANCIAL_STATUS_OPTIONS[0];
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${STATUS_STYLES[option.value]}`}>{option.label}</span>;
}

function PaymentBadge({ value }) {
  const option = PAYMENT_STATUS_OPTIONS.find((item) => item.value === value) || PAYMENT_STATUS_OPTIONS[0];
  return <span className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-black ${PAYMENT_STATUS_STYLES[option.value]}`}>{option.label}</span>;
}

function Feedback({ tone, children }) {
  const classes = tone === "error"
    ? "border-red-200 bg-red-50 text-red-700"
    : "border-emerald-200 bg-emerald-50 text-emerald-700";

  return <div className={`rounded-2xl border p-4 text-sm font-bold ${classes}`}>{children}</div>;
}

function calculateDashboardMetrics(sales) {
  const total = sales.reduce((acc, sale) => {
    const saleTotals = calculateSaleTotals(sale);
    acc.saleValue += saleTotals.saleValue;
    acc.grossCommission += saleTotals.grossCommission;
    acc.expenseTotal += saleTotals.expenseTotal;
    acc.freeCommission += saleTotals.freeCommission;
    acc.receivedTotal += saleTotals.receivedTotal;
    acc.receivableTotal += saleTotals.receivableTotal;
    return acc;
  }, {
    saleValue: 0,
    grossCommission: 0,
    expenseTotal: 0,
    freeCommission: 0,
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
  const expenseTotal = ensureArray(sale.expenses).reduce((sum, expense) => sum + normalizeMoneyValue(expense.amount), 0);
  const receivedTotal = ensureArray(sale.payments)
    .filter((payment) => payment.status === "received")
    .reduce((sum, payment) => sum + normalizeMoneyValue(payment.amount), 0);
  const freeCommission = Math.max(0, grossCommission - expenseTotal);
  return {
    saleValue,
    grossCommission,
    expenseTotal,
    freeCommission,
    receivedTotal,
    receivableTotal: Math.max(0, freeCommission - receivedTotal)
  };
}

function flattenPayments(sales) {
  return sales.flatMap((sale) =>
    ensureArray(sale.payments).map((payment, index) => ({
      ...payment,
      key: `${sale.id}-${payment.id || index}`,
      clientName: sale.clientName || "Cliente sem nome",
      propertyName: sale.propertyName || "",
      saleId: sale.id
    }))
  ).sort((a, b) => compareDate(a.expectedDate, b.expectedDate));
}

function calculateReceivableMetrics(payments) {
  const now = startOfDate(new Date());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return {
    expectedThisMonth: payments
      .filter((payment) => payment.status !== "received" && isDateBetween(payment.expectedDate, monthStart, monthEnd))
      .reduce((sum, payment) => sum + normalizeMoneyValue(payment.amount), 0),
    receivedThisMonth: payments
      .filter((payment) => payment.status === "received" && isDateBetween(payment.receivedDate, monthStart, monthEnd))
      .reduce((sum, payment) => sum + normalizeMoneyValue(payment.amount), 0),
    next30: sumExpectedUntil(payments, now, 30),
    next60: sumExpectedUntil(payments, now, 60),
    next90: sumExpectedUntil(payments, now, 90)
  };
}

function sumExpectedUntil(payments, start, days) {
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  return payments
    .filter((payment) => payment.status !== "received" && isDateBetween(payment.expectedDate, start, end))
    .reduce((sum, payment) => sum + normalizeMoneyValue(payment.amount), 0);
}

function createDraftSale(sale) {
  if (!sale) return null;
  return {
    ...sale,
    saleValue: valueToInput(sale.saleValue),
    commissionPercentage: valueToInput(sale.commissionPercentage),
    grossCommission: valueToInput(sale.grossCommission),
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

function normalizeMoneyValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const cleaned = text.replace(/[^\d,.-]/g, "");
  if (!cleaned) return 0;
  if (cleaned.includes(",")) {
    const parsed = Number(cleaned.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value) {
  return MONEY_FORMATTER.format(normalizeMoneyValue(value));
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

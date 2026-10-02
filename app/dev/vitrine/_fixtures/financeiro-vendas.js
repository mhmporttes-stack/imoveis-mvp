// Financeiro > Vendas / Comissões — fixtures 100% fictícias para a vitrine (somente `next dev`).
// Formato de `initialSales` entregue por app/admin/financeiro/page.jsx (lib/financial.js listFinancialSales).
// Datas relativas a hoje, para a tela sempre mostrar recebido no mês, a receber, atrasado e previsão.
// Perfis: admin (dono: vê e edita previsão) · gestor (edita, sem previsão) · corretor (só leitura, só as suas vendas)
// · associado (visão PROJETADA: 10% — mesma conta de toAssociateFinancialView em lib/financial.js).
// Nada vem do banco; PATCH/DELETE só mudam a memória da página.

import { addDays, monthRange, saoPauloToday } from "@/lib/financial-health-core.mjs";
import * as saude from "./financeiro-saude";

const TODAY = saoPauloToday();
const MONTH = monthRange(TODAY);
const LAST_MONTH_DAY = (day) => addDays(MONTH.start, -30 + day);

const user = (id, name, role, extra = {}) => ({ id, name, email: `${id}@vitrine.invalid`, role, status: "active", brokerCommissionPercentage: 50, agencyCommissionPercentage: 50, managerId: "", defaultManagerPercentage: 10, ...extra });
const financialUsers = [
  user("vitrine-admin", "Dono (vitrine)", "admin"),
  user("vitrine-gestor", "Gestor Paulo", "manager"),
  user("vitrine-ana", "Ana Souza", "broker", { managerId: "vitrine-gestor" }),
  user("vitrine-bruno", "Bruno Lima", "broker", { managerId: "vitrine-gestor" }),
  user("vitrine-carla", "Carla Mendes", "broker")
];

const pay = (id, installmentNumber, amount, status, extra = {}) => ({ id, installmentNumber, amount, status, expectedDate: "", receivedDate: "", note: "", ...extra });

const baseSale = (id, clientName, propertyName, brokerId, saleDate, saleValue, pct, extra = {}) => {
  const brokerName = financialUsers.find((u) => u.id === brokerId)?.name || "";
  return {
    id, clientId: `cliente-${id}`, clientName, propertyName, brokerId, brokerName, brokerEmail: `${brokerId}@vitrine.invalid`,
    saleDate, saleValue, commissionPercentage: pct, grossCommission: Math.round(saleValue * pct) / 100,
    invoicePercentage: 6, financialStatus: "pending", expectedReceiptDate: "", hasManagerCommission: false, managerId: "", managerPercentage: 0,
    brokerSharePercentage: 50, agencySharePercentage: 50, notes: "", expenses: [], payments: [], ...extra
  };
};

const adminSales = [
  baseSale("venda-1", "Marta Alves", "Residencial Vila Real", "vitrine-ana", MONTH.start, 280000, 4, {
    financialStatus: "partial", hasManagerCommission: true, managerId: "vitrine-gestor", managerPercentage: 10,
    payments: [pay("p1", 1, 5600, "received", { expectedDate: MONTH.start, receivedDate: addDays(MONTH.start, 1) }), pay("p2", 2, 5600, "expected", { expectedDate: MONTH.end })]
  }),
  baseSale("venda-2", "João Pereira", "Parque Verde", "vitrine-ana", MONTH.start, 190000, 5, {
    payments: [pay("p3", 1, 9500, "expected", { expectedDate: addDays(MONTH.start, -12) })]
  }),
  baseSale("venda-3", "Carla Duarte", "Edifício Aurora", "vitrine-carla", MONTH.start, 350000, 4, {
    invoicePercentage: 10, expectedReceiptDate: addDays(TODAY, 12), notes: "Entrada em duas vezes; saldo após a escritura."
  }),
  baseSale("venda-4", "Diego Rocha", "Casa Bairro Alto", "vitrine-ana", LAST_MONTH_DAY(2), 420000, 3.5, {
    invoicePercentage: 0, financialStatus: "received", payments: [pce("p4", 1, 14700)]
  }),
  baseSale("venda-5", "Elisa Prado", "Residencial Sol Nascente", "vitrine-bruno", MONTH.start, 160000, 5, {
    hasManagerCommission: true, managerId: "vitrine-gestor", managerPercentage: 10, expectedReceiptDate: addDays(MONTH.start, -5),
    expenses: [{ id: "e1", description: "Captador", category: "Captador", amount: 800, note: "" }]
  }),
  baseSale("venda-6", "Rui Tavares", "Loteamento Santa Clara", "vitrine-bruno", LAST_MONTH_DAY(8), 90000, 5, { financialStatus: "cancelled", invoicePercentage: 0 })
];

function pce(id, n, amount) {
  return pay(id, n, amount, "received", { expectedDate: addDays(MONTH.start, -20), receivedDate: addDays(MONTH.start, -18) });
}

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

// Mesma conta de toAssociateFinancialView (lib/financial.js): 10% da comissão livre e 10% de cada recebimento.
function projectForAssociate(sale) {
  const gross = Number(sale.grossCommission || 0);
  const expenses = sale.expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const free = Math.max(0, gross - gross * (sale.invoicePercentage / 100) - expenses);
  const commission = round2(free * 0.1);
  return {
    ...sale, expectedReceiptDate: "", grossCommission: commission, commissionPercentage: sale.saleValue > 0 ? round2((commission / sale.saleValue) * 100) : 0,
    invoicePercentage: 0, expenses: [], payments: sale.payments.map((p) => ({ ...p, amount: round2(p.amount * 0.1) })),
    hasManagerCommission: false, managerId: "", managerPercentage: 0, brokerSharePercentage: 100, agencySharePercentage: 0
  };
}

const withoutForecast = (sale) => ({ ...sale, expectedReceiptDate: "" });

export function propsFor(perfil = "admin") {
  const common = { financialUsers };
  if (perfil === "associado") {
    return { ...common, initialSales: adminSales.filter((s) => s.brokerId === "vitrine-ana").map(projectForAssociate), currentUser: { id: "vitrine-assoc", role: "associate" }, canEdit: false, canManageForecast: false, health: null };
  }
  if (perfil === "corretor") {
    return { ...common, initialSales: adminSales.filter((s) => s.brokerId === "vitrine-ana").map(withoutForecast), currentUser: { id: "vitrine-ana", role: "broker" }, canEdit: false, canManageForecast: false, health: null };
  }
  if (perfil === "gestor") {
    return { ...common, initialSales: adminSales.map(withoutForecast), currentUser: { id: "vitrine-gestor", role: "manager" }, canEdit: true, canManageForecast: false, health: null };
  }
  const p = saude.propsFor("");
  return {
    ...common, initialSales: adminSales, currentUser: { id: "vitrine-admin", role: "admin" }, canEdit: true, canManageForecast: true,
    health: { expenses: p.initialExpenses, occurrences: p.initialOccurrences, settings: p.initialSettings, today: p.today, panel: null, error: "" }
  };
}

// ---- API fictícia (memória da página) ----

const money = (value) => {
  const raw = String(value ?? "").replace(/[^\d,.-]/g, "");
  const n = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const readBody = (init) => { try { return JSON.parse(init?.body || "{}"); } catch { return {}; } };

export const routes = [
  ...saude.routes,
  {
    method: "PATCH",
    match: /^\/api\/financeiro\/[^/]+$/,
    response: ({ url, init }) => {
      const id = url.pathname.split("/").pop();
      const b = readBody(init);
      const current = adminSales.find((s) => s.id === id) || {};
      return {
        ...current, ...b, id, saleValue: money(b.saleValue), grossCommission: money(b.grossCommission), commissionPercentage: money(b.commissionPercentage),
        invoicePercentage: money(b.invoicePercentage), managerPercentage: money(b.managerPercentage), brokerSharePercentage: money(b.brokerSharePercentage), agencySharePercentage: money(b.agencySharePercentage),
        expenses: (b.expenses || []).map((e) => ({ ...e, amount: money(e.amount) })), payments: (b.payments || []).map((p) => ({ ...p, amount: money(p.amount) }))
      };
    }
  },
  { method: "DELETE", match: /^\/api\/financeiro\/[^/]+$/, response: () => ({ ok: true }) }
];

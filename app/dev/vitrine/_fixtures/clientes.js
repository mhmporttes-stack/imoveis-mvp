// Fixture da tela "Lista de clientes" (components/clients/ClientWorkspace.jsx,
// montado como em app/admin/simulacoes/page.jsx). Dados 100% FICTÍCIOS —
// nomes com sobrenome "Exemplo/Teste/Demo", telefones (14) 90000-00xx e
// e-mails @vitrine.invalid. Nada aqui vem do banco.
//
// Sem imports de propósito (arquivo puro): as formas abaixo espelham, campo a
// campo, o que o servidor devolve:
//   - item da lista ........ rowToClientItem (lib/simulation-list-query.js)
//   - registration ......... rowToSimulationRegistration (lib/simulation-registrations.js)
//   - simulation ........... rowToSimulation (lib/simulation-mapper.js)
//   - summary .............. getSimulationListSummary (lib/simulation-list-utils.js)
//   - counters/pending ..... getSimulationClientCounters / getPendingClientsCount
//   - atividades ........... rowToActivity (lib/calendar-activities.js)
//   - tags ................. rowToTag (lib/client-tags.js)
//   - perfis ............... rowToAdminProfile (lib/admin-profiles.js)
//   - jornada .............. getPrivateJourney (lib/client-journey.js)
//   - CCA .................. getCurrentCcaStatus / rowToCca (lib/client-cca-status.js, lib/cca.js)
//
// O estado é mantido em memória (por carregamento de página): mudar status,
// tags, atividades etc. reflete no próximo fetch da lista, como na tela real.

// Arredondado para a hora cheia: o módulo é avaliado no SSR e de novo no
// navegador — com a mesma base, os rótulos relativos ("Hoje às 14:00",
// "3 dias atrás") batem na hidratação.
const NOW = (() => {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  return date.getTime();
})();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NO_CONTACT_ALERT_MS = 3 * DAY;

const iso = (ms) => new Date(ms).toISOString();
const ago = (days = 0, hours = 0) => iso(NOW - days * DAY - hours * HOUR);

// Horário "de agenda" em São Paulo (UTC-3, sem horário de verão desde 2019).
function spAt(dayOffset, hh, mm = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(NOW + dayOffset * DAY));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(`${map.year}-${map.month}-${map.day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00-03:00`).toISOString();
}

const SITE = "https://www.matheusmachadoimoveis.com.br";

// ---------------------------------------------------------------------------
// Perfis (admin_users) — 1 admin (tratado como dono na vitrine), 1 gestor,
// 4 corretores e 1 associado.
// ---------------------------------------------------------------------------

const uid = (n) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;

const P = {
  admin: uid(1),
  gestor: uid(2),
  ana: uid(3),
  bruno: uid(4),
  carla: uid(5),
  diego: uid(6),
  elisa: uid(7)
};

function profile(id, name, email, role, extra = {}) {
  return {
    id,
    authUserId: `auth-${id.slice(-4)}`,
    name,
    email,
    phone: "",
    gender: "",
    hasCreci: role === "broker" || role === "manager",
    photoUrl: "",
    role,
    linkedBrokerId: "",
    managerId: "",
    brokerCommissionPercentage: 50,
    agencyCommissionPercentage: 50,
    defaultManagerPercentage: 10,
    leadDistributionEnabled: role === "broker",
    status: "active",
    simulationRef: "",
    captacaoRef: "",
    createdAt: ago(200),
    updatedAt: ago(10),
    disabledAt: "",
    isFallback: false,
    ...extra
  };
}

const PROFILES = [
  profile(P.elisa, "Elisa Associada Demo", "elisa.demo@vitrine.invalid", "associate", { linkedBrokerId: P.bruno, simulationRef: "elisa-demo", createdAt: ago(40) }),
  profile(P.diego, "Diego Modelo", "diego.modelo@vitrine.invalid", "broker", { simulationRef: "diego-modelo", createdAt: ago(60) }),
  profile(P.carla, "Carla Demonstração", "carla.demo@vitrine.invalid", "broker", { simulationRef: "carla-demo", createdAt: ago(90) }),
  profile(P.bruno, "Bruno Fictício", "bruno.ficticio@vitrine.invalid", "broker", { managerId: P.gestor, simulationRef: "bruno-ficticio", createdAt: ago(120), photoUrl: "/icons/apple-touch-icon.png" }),
  profile(P.ana, "Ana Exemplo", "ana.exemplo@vitrine.invalid", "broker", { managerId: P.gestor, simulationRef: "ana-exemplo", createdAt: ago(150) }),
  profile(P.gestor, "Gabriel Gestor Demo", "gabriel.gestor@vitrine.invalid", "manager", { createdAt: ago(180) }),
  profile(P.admin, "Administração Vitrine", "admin@vitrine.invalid", "admin", { createdAt: ago(365) })
];
const PROFILE_BY_ID = new Map(PROFILES.map((item) => [item.id, item]));
const MANAGED_BY_GESTOR = [P.gestor, P.ana, P.bruno, P.elisa];

const ROLE_LABEL = { admin: "Administrador", manager: "Gestor", broker: "Corretor", associate: "Associado" };

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

const tagId = (n) => `00000000-0000-4000-b000-${String(n).padStart(12, "0")}`;
function tag(n, name, color) {
  return {
    id: tagId(n),
    name,
    normalizedName: name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(),
    color,
    createdAt: ago(80),
    updatedAt: ago(80)
  };
}

let TAGS = [
  tag(1, "Indicação", "#7C3AED"),
  tag(2, "MCMV Faixa 2", "#0D4F8B"),
  tag(3, "Primeiro imóvel", "#047857"),
  tag(4, "Retornar à noite", "#CA8A04"),
  tag(5, "Urgente", "#B91C1C"),
  tag(6, "Zona Norte", "#0891B2")
];
const T = Object.fromEntries(TAGS.map((item) => [item.name, item]));
const sortTags = (list) => list.slice().sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

// ---------------------------------------------------------------------------
// CCAs
// ---------------------------------------------------------------------------

const CCAS = [
  { id: uid(901), name: "CCA Exemplo Centro", companyName: "Correspondente Exemplo Ltda.", whatsapp: "(14) 90000-0901", photoUrl: "", email: "centro@cca.vitrine.invalid", notes: "", active: true, createdAt: ago(300), updatedAt: ago(30) },
  { id: uid(902), name: "CCA Demo Zona Sul", companyName: "Demo Correspondente", whatsapp: "(14) 90000-0902", photoUrl: "", email: "zonasul@cca.vitrine.invalid", notes: "", active: true, createdAt: ago(250), updatedAt: ago(20) }
];

// ---------------------------------------------------------------------------
// Clientes (simulation_registrations + simulations)
// ---------------------------------------------------------------------------

const cid = (n) => `00000000-0000-4000-c000-${String(n).padStart(12, "0")}`;
const PLACEHOLDER_BIRTH = "1900-01-01"; // marcador de "não preencheu o formulário"

function emptyPreferences() {
  return {
    status: "nao_iniciado",
    accessToken: "",
    startedAt: "",
    completedAt: "",
    updatedAt: "",
    preferredPropertyType: "",
    preferredRegions: [],
    preferredPropertyStage: "",
    preferredBedrooms: "",
    rentsCurrently: null,
    rentPriceRange: "",
    purchaseTimeline: "",
    propertyPriorities: [],
    mustHaveFeatures: ""
  };
}

function completedPreferences(overrides = {}) {
  return {
    ...emptyPreferences(),
    status: "concluido",
    accessToken: "pref-token-ficticio",
    startedAt: ago(6),
    completedAt: ago(6),
    updatedAt: ago(6),
    preferredPropertyType: "casa",
    preferredRegions: ["zona_norte", "zona_sul"],
    preferredPropertyStage: "pronto",
    preferredBedrooms: "dois",
    rentsCurrently: true,
    rentPriceRange: "de_501_a_1000",
    purchaseTimeline: "proximos_3_meses",
    propertyPriorities: ["entrada_baixa", "terreno_ou_quintal"],
    mustHaveFeatures: "Garagem para 1 carro",
    ...overrides
  };
}

function registration(n, fields) {
  const responsible = PROFILE_BY_ID.get(fields.responsibleUserId || "");
  const base = {
    id: cid(n),
    clientCode: `#C${1500 + n}`,
    prospectingContactId: "",
    prospectingAssignedPending: false,
    prospectingAssignedByUserId: "",
    responsibleUserId: "",
    pendingDistributionAt: "",
    simulationType: "individual",
    fullName: "",
    phone: `(14) 90000-${String(n).padStart(4, "0")}`,
    phoneNormalized: `+551490000${String(n).padStart(4, "0")}`,
    oldestBirthDate: PLACEHOLDER_BIRTH,
    serviceStartedAt: "",
    saleCompletedAt: "",
    primaryIncomeType: "self_employed_unregistered",
    primaryProfession: "Não informado",
    primaryMonthlyIncome: 0,
    secondaryIncomeType: null,
    secondaryProfession: null,
    secondaryMonthlyIncome: null,
    hasOverThreeYearsRegisteredWork: false,
    hasChildrenUnder18: false,
    primaryMaritalStatus: "single",
    secondaryMaritalStatus: null,
    hasResidentialProperty: false,
    availablePurchaseResource: 0,
    cpf: "",
    pis: "",
    email: "",
    status: "pending",
    approvedAt: "",
    lastStatusChangeAt: "",
    lastWhatsappContactAt: "",
    lastAdminEmail: responsible?.email || "",
    lastAdminName: responsible?.name || "",
    lastAdminActivityAt: "",
    scheduledActivityAt: "",
    scheduledActivityType: "follow_up",
    scheduledActivityNote: "",
    scheduledActivityNotifiedAt: "",
    scheduledActivityCompletedAt: "",
    scheduledActivityCompletedBy: "",
    scheduledActivityCompleted: false,
    preferencesAccessToken: "",
    propertyPreferences: emptyPreferences(),
    journeyType: "",
    contactPreference: "",
    acquisitionKind: "",
    tags: [],
    createdAt: "",
    lastFormSubmittedAt: "",
    updatedAt: ""
  };
  const merged = { ...base, ...fields };
  if (!merged.lastAdminEmail && responsible) {
    merged.lastAdminEmail = responsible.email;
    merged.lastAdminName = responsible.name;
  }
  merged.updatedAt = merged.updatedAt || merged.lastStatusChangeAt || merged.createdAt;
  merged.lastStatusChangeAt = merged.lastStatusChangeAt || merged.createdAt;
  merged.scheduledActivityCompleted = Boolean(merged.scheduledActivityCompletedAt);
  merged.familyIncome = Number(merged.primaryMonthlyIncome || 0) + Number(merged.secondaryMonthlyIncome || 0);
  return merged;
}

function simulation(n, reg, values) {
  const financingValue = values.financing || 0;
  const subsidyValue = values.subsidy || 0;
  const downPaymentValue = values.downPayment || 0;
  const fgtsValue = values.fgts || 0;
  const type = values.type || "novo";
  const model = {
    financingValue,
    subsidyValue,
    firstInstallment: values.firstInstallment || 0,
    lastInstallment: values.lastInstallment || 0
  };
  const empty = { financingValue: "", subsidyValue: "", firstInstallment: "", lastInstallment: "" };
  return {
    id: `00000000-0000-4000-d000-${String(n).padStart(12, "0")}`,
    registrationId: reg.id,
    clientName: reg.fullName,
    simulationType: type,
    financingValue,
    subsidyValue,
    firstInstallment: model.firstInstallment,
    lastInstallment: model.lastInstallment,
    downPaymentValue,
    fgtsValue,
    totalPurchasePower: financingValue + subsidyValue,
    expandedPurchasePower: financingValue + subsidyValue + downPaymentValue + fgtsValue,
    showExpandedPower: false,
    simulationDate: values.date.slice(0, 10),
    publicNote: "",
    internalNote: `WhatsApp do cadastro: ${reg.phoneNormalized.replace(/\D/g, "")}`,
    simulationModels: type === "usado" ? { novo: empty, usado: model } : { novo: model, usado: empty },
    outputMode: "individual",
    createdBy: PROFILE_BY_ID.get(reg.responsibleUserId)?.email || "admin@vitrine.invalid",
    createdByUserId: reg.responsibleUserId || P.admin,
    createdAt: values.date,
    updatedAt: values.date,
    autosaveUpdatedAt: "",
    entrySimulationSnapshots: [],
    properties: []
  };
}

// Ordem de entrada = ordem da lista (list_order_at desc no servidor).
const SEED = [
  {
    reg: registration(1, {
      fullName: "Rafael Teste Oliveira",
      status: "automated_service",
      pendingDistributionAt: ago(0, 1),
      acquisitionKind: "whatsapp_ad",
      createdAt: ago(0, 1)
    }),
    origin: { source_label: "Anúncio Meta — WhatsApp", initial_destination: "roulette" }
  },
  {
    reg: registration(2, {
      fullName: "Patrícia Exemplo Nunes",
      status: "automated_service",
      responsibleUserId: P.ana,
      acquisitionKind: "whatsapp_chat",
      contactPreference: "whatsapp",
      createdAt: ago(0, 4)
    }),
    origin: { source_label: "WhatsApp (Chat)", initial_destination: "roulette" }
  },
  {
    reg: registration(13, {
      fullName: "Fernanda Demo Ribeiro",
      status: "meeting_pending",
      responsibleUserId: P.bruno,
      simulationType: "joint",
      oldestBirthDate: "1991-03-14",
      primaryIncomeType: "registered_employment",
      primaryProfession: "Auxiliar administrativa",
      primaryMonthlyIncome: 2650,
      secondaryIncomeType: "registered_employment",
      secondaryProfession: "Motorista",
      secondaryMonthlyIncome: 2400,
      primaryMaritalStatus: "married",
      secondaryMaritalStatus: "married",
      hasOverThreeYearsRegisteredWork: true,
      hasChildrenUnder18: true,
      availablePurchaseResource: 12000,
      email: "fernanda.demo@vitrine.invalid",
      journeyType: "simulation",
      contactPreference: "whatsapp",
      propertyPreferences: completedPreferences({ preferredBedrooms: "tres_ou_mais", purchaseTimeline: "imediato" }),
      lastWhatsappContactAt: ago(0, 5),
      createdAt: ago(21),
      lastFormSubmittedAt: ago(2, 3),
      lastStatusChangeAt: ago(1),
      approvedAt: ago(4),
      tags: [T["Indicação"], T["MCMV Faixa 2"]]
    }),
    sim: { type: "novo", financing: 214000, subsidy: 18500, downPayment: 12000, fgts: 9500, firstInstallment: 1480, lastInstallment: 690, date: ago(15) },
    cca: CCAS[0],
    origin: { source_label: "Indicação de cliente", initial_destination: "broker" }
  },
  {
    reg: registration(3, {
      fullName: "Joana Exemplo Souza",
      status: "pending",
      responsibleUserId: P.bruno,
      oldestBirthDate: "1996-07-22",
      primaryIncomeType: "registered_employment",
      primaryProfession: "Atendente",
      primaryMonthlyIncome: 2800,
      hasOverThreeYearsRegisteredWork: true,
      availablePurchaseResource: 5000,
      journeyType: "simulation",
      contactPreference: "whatsapp",
      acquisitionKind: "broker_link",
      propertyPreferences: completedPreferences(),
      createdAt: ago(5, 2),
      tags: [T["MCMV Faixa 2"], T["Primeiro imóvel"]]
    }),
    origin: { source_label: "Link do corretor", initial_destination: "broker" }
  },
  {
    reg: registration(4, {
      fullName: "Lucas Fictício Andrade",
      status: "completed",
      responsibleUserId: P.carla,
      oldestBirthDate: "1993-11-02",
      primaryIncomeType: "registered_employment",
      primaryProfession: "Operador de produção",
      primaryMonthlyIncome: 3200,
      hasOverThreeYearsRegisteredWork: true,
      availablePurchaseResource: 8000,
      journeyType: "simulation",
      lastWhatsappContactAt: ago(1, 2),
      createdAt: ago(3, 6),
      tags: [T["Primeiro imóvel"]]
    }),
    sim: { type: "novo", financing: 182000, subsidy: 35000, downPayment: 5000, fgts: 3000, firstInstallment: 1150, lastInstallment: 520, date: ago(2) },
    origin: { source_label: "Site — Simulação", initial_destination: "roulette" }
  },
  {
    reg: registration(5, {
      fullName: "Marcos Teste e Aline Teste",
      status: "simulation_sent",
      responsibleUserId: P.bruno,
      simulationType: "joint",
      oldestBirthDate: "1988-05-09",
      primaryIncomeType: "registered_employment",
      primaryProfession: "Eletricista",
      primaryMonthlyIncome: 3100,
      secondaryIncomeType: "self_employed_unregistered",
      secondaryProfession: "Manicure",
      secondaryMonthlyIncome: 1500,
      primaryMaritalStatus: "stable_union",
      secondaryMaritalStatus: "stable_union",
      hasOverThreeYearsRegisteredWork: true,
      hasChildrenUnder18: true,
      availablePurchaseResource: 15000,
      journeyType: "simulation",
      lastWhatsappContactAt: ago(2, 1),
      createdAt: ago(9),
      scheduledActivityAt: spAt(1, 10, 0),
      scheduledActivityType: "follow_up",
      scheduledActivityNote: "Retornar sobre as opções de casa na Zona Norte"
    }),
    sim: { type: "usado", financing: 196000, subsidy: 12000, downPayment: 15000, fgts: 6000, firstInstallment: 1390, lastInstallment: 640, date: ago(7) },
    origin: { source_label: "Instagram orgânico", initial_destination: "broker" }
  },
  {
    reg: registration(6, {
      fullName: "Sônia Modelo Pereira",
      status: "in_service",
      responsibleUserId: P.diego,
      contactPreference: "call",
      lastWhatsappContactAt: ago(0, 3),
      createdAt: ago(1, 5),
      serviceStartedAt: ago(1, 5).slice(0, 10)
    }),
    origin: { source_label: "Cadastro manual do corretor", initial_destination: "broker" }
  },
  {
    reg: registration(8, {
      fullName: "Thiago Exemplo Martins",
      status: "documentation_pending",
      responsibleUserId: P.ana,
      oldestBirthDate: "1990-01-30",
      primaryIncomeType: "income_tax_declarant",
      primaryProfession: "Mecânico autônomo",
      primaryMonthlyIncome: 4100,
      primaryMaritalStatus: "divorced",
      hasOverThreeYearsRegisteredWork: false,
      hasChildrenUnder18: true,
      availablePurchaseResource: 20000,
      journeyType: "simulation",
      lastWhatsappContactAt: ago(4, 2),
      createdAt: ago(14),
      scheduledActivityAt: spAt(-2, 9, 30),
      scheduledActivityType: "documentacao",
      scheduledActivityNote: "Cobrar holerites e extrato do FGTS",
      tags: [T["Zona Norte"]]
    }),
    sim: { type: "novo", financing: 205000, subsidy: 8000, downPayment: 20000, fgts: 0, firstInstallment: 1520, lastInstallment: 710, date: ago(12) },
    origin: { source_label: "Anúncio Meta — Formulário", initial_destination: "roulette" }
  },
  {
    reg: registration(9, {
      fullName: "Camila Teste Rodrigues",
      status: "documents_pending",
      responsibleUserId: P.bruno,
      oldestBirthDate: "1998-09-18",
      primaryIncomeType: "registered_employment",
      primaryProfession: "Recepcionista",
      primaryMonthlyIncome: 2300,
      hasOverThreeYearsRegisteredWork: false,
      availablePurchaseResource: 3000,
      contactPreference: "call",
      journeyType: "quick_service",
      lastWhatsappContactAt: ago(1, 4),
      createdAt: ago(18),
      tags: [T["Urgente"], T["MCMV Faixa 2"], T["Primeiro imóvel"], T["Zona Norte"], T["Retornar à noite"]]
    }),
    sim: { type: "novo", financing: 158000, subsidy: 52000, downPayment: 3000, fgts: 2500, firstInstallment: 980, lastInstallment: 430, date: ago(16) },
    origin: { source_label: "Site — Atendimento rápido", initial_destination: "roulette" }
  },
  {
    reg: registration(10, {
      fullName: "Eduardo Demo Carvalho",
      status: "approval_pending",
      responsibleUserId: P.carla,
      oldestBirthDate: "1985-12-03",
      primaryIncomeType: "registered_employment",
      primaryProfession: "Técnico de enfermagem",
      primaryMonthlyIncome: 3900,
      primaryMaritalStatus: "married",
      hasOverThreeYearsRegisteredWork: true,
      hasChildrenUnder18: true,
      availablePurchaseResource: 10000,
      email: "eduardo.demo@vitrine.invalid",
      pis: "000.00000.00-0",
      journeyType: "simulation",
      lastWhatsappContactAt: ago(1, 1),
      createdAt: ago(25)
    }),
    sim: { type: "novo", financing: 228000, subsidy: 0, downPayment: 10000, fgts: 14000, firstInstallment: 1690, lastInstallment: 780, date: ago(22) },
    cca: CCAS[0],
    origin: { source_label: "Link do corretor", initial_destination: "broker" }
  },
  {
    reg: registration(11, {
      fullName: "Vanessa Fictícia Gomes",
      status: "restriction",
      responsibleUserId: P.diego,
      oldestBirthDate: "1994-04-11",
      primaryIncomeType: "registered_employment",
      primaryProfession: "Vendedora",
      primaryMonthlyIncome: 2500,
      availablePurchaseResource: 0,
      journeyType: "simulation",
      lastWhatsappContactAt: ago(6, 3),
      createdAt: ago(30),
      tags: [T["Retornar à noite"]]
    }),
    sim: { type: "novo", financing: 165000, subsidy: 41000, downPayment: 0, fgts: 0, firstInstallment: 1040, lastInstallment: 470, date: ago(27) },
    cca: CCAS[1],
    origin: { source_label: "Anúncio Meta — WhatsApp", initial_destination: "roulette" }
  },
  {
    reg: registration(12, {
      fullName: "Roberto Exemplo Lima",
      status: "approved",
      responsibleUserId: P.ana,
      oldestBirthDate: "1987-08-25",
      primaryIncomeType: "registered_employment",
      primaryProfession: "Professor",
      primaryMonthlyIncome: 4300,
      primaryMaritalStatus: "married",
      hasOverThreeYearsRegisteredWork: true,
      availablePurchaseResource: 25000,
      email: "roberto.exemplo@vitrine.invalid",
      journeyType: "simulation",
      lastWhatsappContactAt: ago(0, 6),
      createdAt: ago(35),
      approvedAt: ago(2),
      scheduledActivityAt: spAt(3, 14, 30),
      scheduledActivityType: "visita",
      scheduledActivityNote: "Visita ao decorado do residencial fictício",
      tags: [T["Indicação"], T["Zona Norte"]]
    }),
    sim: { type: "novo", financing: 236000, subsidy: 0, downPayment: 25000, fgts: 18000, firstInstallment: 1760, lastInstallment: 810, date: ago(33) },
    cca: CCAS[0],
    origin: { source_label: "Indicação de cliente", initial_destination: "broker" }
  },
  {
    reg: registration(14, {
      fullName: "Helena Demo Castro",
      status: "sale_completed",
      responsibleUserId: P.carla,
      oldestBirthDate: "1992-02-07",
      primaryIncomeType: "registered_employment",
      primaryProfession: "Analista de RH",
      primaryMonthlyIncome: 4600,
      hasOverThreeYearsRegisteredWork: true,
      availablePurchaseResource: 30000,
      journeyType: "simulation",
      lastWhatsappContactAt: ago(2, 2),
      createdAt: ago(60),
      saleCompletedAt: ago(5).slice(0, 10),
      tags: [T["Primeiro imóvel"]]
    }),
    sim: { type: "novo", financing: 248000, subsidy: 0, downPayment: 30000, fgts: 21000, firstInstallment: 1850, lastInstallment: 850, date: ago(55) },
    cca: CCAS[1],
    origin: { source_label: "Site — Simulação", initial_destination: "roulette" }
  },
  {
    reg: registration(15, {
      fullName: "Otávio Teste Barros",
      status: "archived",
      responsibleUserId: P.diego,
      lastWhatsappContactAt: ago(32),
      createdAt: ago(45)
    }),
    origin: { source_label: "Anúncio Meta — Formulário", initial_destination: "roulette" }
  },
  {
    reg: registration(16, {
      fullName: "Mirela Exemplo Dias",
      status: "do_not_contact",
      responsibleUserId: P.ana,
      lastWhatsappContactAt: ago(10),
      createdAt: ago(20)
    }),
    origin: { source_label: "Base da Imobiliária (prospecção)", initial_destination: "broker" }
  },
  // "Tentando contato" sem formulário novo fica por último na aba "Todos"
  // (mesma regra do servidor) — por isso está no fim da semente.
  {
    reg: registration(7, {
      fullName: "Gustavo Fictício Rocha",
      status: "awaiting_return",
      responsibleUserId: P.bruno,
      prospectingContactId: uid(707),
      prospectingAssignedPending: true,
      prospectingAssignedByUserId: P.admin,
      createdAt: ago(1, 3)
    }),
    origin: { source_label: "Base da Imobiliária (prospecção)", initial_destination: "broker" }
  }
];

// Estado mutável (por carregamento de página).
const REGS = new Map();
const SIMS = new Map();
const ORDER = new Map();
const CCA_BY_CLIENT = new Map();
const ORIGINS = new Map();
const JOURNEY_STATE = new Map();
SEED.forEach((entry, index) => {
  REGS.set(entry.reg.id, entry.reg);
  ORDER.set(entry.reg.id, SEED.length - index);
  if (entry.sim) SIMS.set(entry.reg.id, simulation(Number(entry.reg.id.slice(-4)), entry.reg, entry.sim));
  if (entry.cca) CCA_BY_CLIENT.set(entry.reg.id, { cca: entry.cca, enteredAt: ago(4) });
  ORIGINS.set(entry.reg.id, entry.origin || null);
});

// Atividades extras (calendar_activities) — formato de rowToActivity.
let activitySeq = 100;
function activity(clientNumber, fields) {
  const reg = REGS.get(cid(clientNumber));
  activitySeq += 1;
  return {
    id: `00000000-0000-4000-e000-${String(activitySeq).padStart(12, "0")}`,
    clientId: reg.id,
    responsibleUserId: reg.responsibleUserId,
    title: fields.note,
    activityType: fields.activityType || "follow_up",
    scheduledActivityAt: fields.at,
    note: fields.note,
    priority: fields.priority || "standard",
    status: fields.status || "pending",
    completedAt: fields.completedAt || "",
    rescheduledFromId: "",
    rescheduledToId: "",
    rescheduledToAt: "",
    source: "calendar"
  };
}

const ACTIVITIES = new Map();
function pushActivity(item) {
  if (!ACTIVITIES.has(item.clientId)) ACTIVITIES.set(item.clientId, []);
  ACTIVITIES.get(item.clientId).push(item);
}
[
  activity(6, { activityType: "ligacao", at: spAt(1, 9, 0), note: "Ligar para entender renda do cônjuge" }),
  activity(9, { activityType: "documentacao", at: spAt(-1, 16, 0), note: "Conferir RG e comprovante de residência", priority: "important" }),
  activity(9, { activityType: "ligacao", at: spAt(0, 19, 0) > iso(NOW) ? spAt(0, 19, 0) : spAt(1, 19, 0), note: "Retornar após o expediente (prefere ligação)" }),
  activity(9, { activityType: "follow_up", at: spAt(2, 11, 0), note: "Confirmar envio da carteira de trabalho digital" }),
  activity(9, { activityType: "documentacao", at: spAt(4, 10, 0), note: "Agendar assinatura do formulário da Caixa" }),
  activity(9, { activityType: "follow_up", at: spAt(-5, 10, 0), note: "Primeiro contato sobre documentos", status: "completed", completedAt: ago(5) }),
  activity(10, { activityType: "follow_up", at: spAt(2, 15, 0), note: "Cobrar retorno da CCA sobre a análise" }),
  activity(13, { activityType: "reuniao", at: spAt(1, 15, 0), note: "Reunião de fechamento na imobiliária", priority: "priority" }),
  activity(11, { activityType: "follow_up", at: spAt(-3, 18, 30), note: "Orientar sobre regularização no SPC" })
].forEach(pushActivity);

// ---------------------------------------------------------------------------
// Montagem do item (rowToClientItem) e da página
// ---------------------------------------------------------------------------

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function summaryFor(sim) {
  const empty = { completed: false, financing: 0, ownResource: 0, subsidy: 0, purchasePower: 0, components: [] };
  if (!sim) return empty;
  const model = sim.simulationModels?.[sim.simulationType] || sim;
  const financing = Number(model.financingValue) || 0;
  const subsidy = Number(model.subsidyValue) || 0;
  if (financing <= 0 && subsidy <= 0) return empty;
  const ownResource = (Number(sim.downPaymentValue) || 0) + (Number(sim.fgtsValue) || 0);
  return {
    completed: true,
    financing,
    ownResource,
    subsidy,
    purchasePower: financing + ownResource + subsidy,
    components: [
      financing > 0 ? `Financiamento: ${BRL.format(financing)}` : "",
      ownResource > 0 ? `Recurso próprio: ${BRL.format(ownResource)}` : "",
      subsidy > 0 ? `Subsídio: ${BRL.format(subsidy)}` : ""
    ].filter(Boolean)
  };
}

function resolveStatus(reg, summary) {
  if (reg.status && reg.status !== "pending") return reg.status;
  return summary.completed ? "completed" : "pending";
}

function toItem(reg) {
  const sim = SIMS.get(reg.id) || null;
  const summary = summaryFor(sim);
  return {
    id: reg.id,
    completed: summary.completed,
    lastAdminLabel: reg.lastAdminName || "",
    lastWhatsappContactAt: reg.lastWhatsappContactAt || "",
    name: reg.fullName || "Cliente sem nome",
    registration: { ...reg, tags: reg.tags.slice() },
    simulation: sim,
    sortDate: reg.lastFormSubmittedAt || reg.createdAt || "",
    createdAt: reg.createdAt || "",
    status: resolveStatus(reg, summary),
    summary,
    scheduledActivityAt: reg.scheduledActivityAt || "",
    scheduledActivityType: reg.scheduledActivityType || "follow_up",
    scheduledActivityNote: reg.scheduledActivityNote || "",
    tags: reg.tags.slice()
  };
}

const STATUS_GROUPS = {
  all: [],
  prospecting: ["awaiting_return"],
  service: ["automated_service", "in_service"],
  simulation: ["pending", "completed", "simulation_sent"],
  documentation: ["documentation_pending", "documents_pending"],
  approval: ["approval_pending", "income_commitment", "cancellation_letter", "research_mo", "restriction", "shielding", "rejected"],
  approved: ["approved"],
  meeting: ["meeting_pending", "meeting_done"],
  sale: ["sale_completed", "sale_forms", "sale_reservation", "sale_contract", "sale_caixa_signature", "sale_itbi", "sale_registry", "sale_payment"],
  archived: ["archived", "do_not_contact"]
};
const ACTIVE_STATUSES = new Set([
  "automated_service", "pending", "completed", "simulation_sent", "in_service", "awaiting_return",
  "documentation_pending", "documents_pending", "approval_pending", "shielding", "approved",
  "meeting_pending", "meeting_done"
]);

function currentPerfil() {
  if (typeof window === "undefined") return "admin";
  try {
    return new URLSearchParams(window.location.search).get("perfil") || "admin";
  } catch {
    return "admin";
  }
}

// applyResponsibleUserScope + applyDoNotContactScope por perfil.
function inScope(reg, perfil, explicitResponsible = "") {
  const responsible = reg.responsibleUserId || "";
  if (perfil === "corretor") return responsible === P.bruno && reg.status !== "do_not_contact";
  if (perfil === "associado") return [P.elisa, P.bruno].includes(responsible) && reg.status !== "do_not_contact";
  if (perfil === "gestor") {
    if (reg.status === "do_not_contact") return false;
    if (explicitResponsible === "unassigned") return !responsible;
    if (explicitResponsible) return MANAGED_BY_GESTOR.includes(explicitResponsible) && responsible === explicitResponsible;
    return !responsible || MANAGED_BY_GESTOR.includes(responsible);
  }
  // admin (tratado como dono na vitrine: vê "Não contactar").
  if (explicitResponsible === "unassigned") return !responsible;
  if (explicitResponsible) return responsible === explicitResponsible;
  return true;
}

function hasFutureActivity(reg, now) {
  const legacy = new Date(reg.scheduledActivityAt || "").getTime();
  if (Number.isFinite(legacy) && legacy >= now && !reg.scheduledActivityCompletedAt) return true;
  return (ACTIVITIES.get(reg.id) || []).some((item) => item.status === "pending" && new Date(item.scheduledActivityAt).getTime() >= now);
}

function isStale(reg, now) {
  if (["archived", "do_not_contact"].includes(reg.status)) return false;
  const reference = new Date(reg.lastWhatsappContactAt || reg.createdAt || "").getTime();
  return Number.isFinite(reference) && reference < now - NO_CONTACT_ALERT_MS;
}

function isPending(reg, now) {
  return isStale(reg, now) && !hasFutureActivity(reg, now);
}

function matchesQuery(reg, query) {
  const term = String(query || "").trim().toLowerCase();
  if (!term) return true;
  const digits = term.replace(/\D/g, "");
  return reg.fullName.toLowerCase().includes(term)
    || reg.clientCode.toLowerCase().includes(term)
    || (digits ? reg.phoneNormalized.replace(/\D/g, "").includes(digits) : false);
}

// applyScopedFilters (tudo menos aba/substatus).
function scopedRegs(filters, perfil, now) {
  const explicit = filters.responsibleUserId === "all" ? "" : filters.responsibleUserId;
  return Array.from(REGS.values()).filter((reg) => {
    if (!inScope(reg, perfil, explicit)) return false;
    if (!matchesQuery(reg, filters.query)) return false;
    if (filters.needsFirstContact && reg.status !== "automated_service") return false;
    if (filters.tagId && filters.tagId !== "all" && !reg.tags.some((item) => item.id === filters.tagId)) return false;
    if (filters.pendingOnly) return isPending(reg, now);
    if (filters.staleContactOnly && !isStale(reg, now)) return false;
    if (filters.noFutureActivityOnly && (!ACTIVE_STATUSES.has(reg.status) || hasFutureActivity(reg, now))) return false;
    return true;
  });
}

function readFilters(params) {
  return {
    query: params.get("query") || "",
    responsibleUserId: params.get("responsibleUserId") || "all",
    tagId: params.get("tagId") || "all",
    pendingOnly: params.get("pending") === "1",
    staleContactOnly: params.get("staleContact") === "1",
    noFutureActivityOnly: params.get("noFutureActivity") === "1",
    needsFirstContact: params.get("needsFirstContact") === "1",
    statusGroup: params.get("statusGroup") || "all",
    status: params.get("status") || "all"
  };
}

// Mesmo corpo de GET /api/simulation-registrations/list.
function buildListPayload({ filters, page = 1, pageSize = 5, perfil = "admin" }) {
  const now = Date.now();
  const safePageSize = [5, 10, 20].includes(Number(pageSize)) ? Number(pageSize) : 5;
  const scoped = scopedRegs(filters, perfil, now);
  const isAllTab = !filters.statusGroup || filters.statusGroup === "all";
  const groupStatuses = STATUS_GROUPS[filters.statusGroup] || [];

  const rows = scoped.filter((reg) => {
    const status = resolveStatus(reg, summaryFor(SIMS.get(reg.id)));
    if (isAllTab && status === "do_not_contact") return false;
    if (!isAllTab && groupStatuses.length && !groupStatuses.includes(status)) return false;
    if (filters.status && filters.status !== "all" && status !== filters.status) return false;
    return true;
  });

  const byOrder = (a, b) => (ORDER.get(b.id) || 0) - (ORDER.get(a.id) || 0);
  let ordered = rows.slice().sort(byOrder);
  if (isAllTab && (!filters.status || filters.status === "all")) {
    const trailing = (reg) => reg.status === "awaiting_return" && !reg.lastFormSubmittedAt;
    ordered = [...ordered.filter((reg) => !trailing(reg)), ...ordered.filter(trailing)];
  }

  const total = ordered.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const items = ordered.slice((safePage - 1) * safePageSize, safePage * safePageSize).map(toItem);

  // Contadores (getSimulationClientCounters): byStatus sob os filtros "menos
  // status"; a aba "Todos" só com escopo de permissão, sem "Não contactar".
  const byStatus = {};
  for (const reg of scoped) {
    const status = resolveStatus(reg, summaryFor(SIMS.get(reg.id)));
    byStatus[status] = (byStatus[status] || 0) + 1;
  }
  const allTotal = Array.from(REGS.values()).filter((reg) => inScope(reg, perfil) && reg.status !== "do_not_contact").length;
  const byGroup = {};
  for (const [key, statuses] of Object.entries(STATUS_GROUPS)) {
    byGroup[key] = key === "all" ? allTotal : statuses.reduce((sum, status) => sum + (byStatus[status] || 0), 0);
  }

  // getPendingClientsCount: global (só escopo).
  const pendingClientsCount = Array.from(REGS.values()).filter((reg) => inScope(reg, perfil) && isPending(reg, now)).length;

  const clientActivities = {};
  for (const item of items) {
    const list = (ACTIVITIES.get(item.id) || []).filter((entry) => entry.status !== "rescheduled");
    if (list.length) {
      clientActivities[item.id] = list.slice().sort((a, b) => new Date(a.scheduledActivityAt) - new Date(b.scheduledActivityAt));
    }
  }

  return {
    items,
    total,
    totalPages,
    page: safePage,
    pageSize: safePageSize,
    counters: { all: allTotal, byStatus, byGroup },
    pendingClientsCount,
    clientActivities
  };
}

// ---------------------------------------------------------------------------
// Props por perfil (espelha app/admin/simulacoes/page.jsx)
// ---------------------------------------------------------------------------

const INITIAL_FILTERS = {
  query: "",
  responsibleUserId: "all",
  tagId: "all",
  pendingOnly: false,
  staleContactOnly: false,
  noFutureActivityOnly: false,
  needsFirstContact: false,
  statusGroup: "all",
  status: "all"
};

export function propsFor(perfil = "admin", { pageSize = 20 } = {}) {
  const isAdmin = perfil === "admin";
  const isManager = perfil === "gestor";
  const isBrokerLike = perfil === "corretor" || perfil === "associado";
  const viewerRef = perfil === "associado" ? "elisa-demo" : "bruno-ficticio";

  const adminProfiles = isAdmin
    ? PROFILES
    : isManager
      ? PROFILES.filter((item) => MANAGED_BY_GESTOR.includes(item.id))
      : [];

  return {
    initialData: buildListPayload({ filters: INITIAL_FILTERS, page: 1, pageSize, perfil }),
    initialFilters: { ...INITIAL_FILTERS },
    adminProfiles,
    canManageResponsibleUsers: isAdmin || isManager,
    // Na vitrine o perfil "admin" representa o dono (isOwnerAdminEmail).
    canReturnAssignedProspecting: isAdmin,
    isOwner: isAdmin,
    brokerSimulationLink: isBrokerLike ? `${SITE}/simulacao?ref=${viewerRef}` : "",
    tags: sortTags(TAGS)
  };
}

// ---------------------------------------------------------------------------
// Jornada (ClientJourneyActions) — getPrivateJourney sem `registration`.
// ---------------------------------------------------------------------------

const PROGRESS_BY_STATUS = {
  automated_service: 5, pending: 15, completed: 25, simulation_sent: 30, in_service: 10, awaiting_return: 5,
  documentation_pending: 40, documents_pending: 45, approval_pending: 60, restriction: 60, approved: 75,
  meeting_pending: 85, meeting_done: 90, sale_completed: 100, archived: 0, do_not_contact: 0
};

function journeyState(reg) {
  if (!JOURNEY_STATE.has(reg.id)) {
    const n = Number(reg.id.slice(-4));
    const notified = n % 3 !== 1;
    JOURNEY_STATE.set(reg.id, {
      progress: PROGRESS_BY_STATUS[reg.status] ?? 10,
      previous_progress: Math.max(0, (PROGRESS_BY_STATUS[reg.status] ?? 10) - 15),
      current_status: reg.status,
      previous_status: "in_service",
      changed_at: reg.lastStatusChangeAt || reg.createdAt,
      version: n % 4 === 0 ? 3 : 2,
      notified_at: notified ? ago(1) : null,
      notified_by: notified ? (PROFILE_BY_ID.get(reg.responsibleUserId)?.email || null) : null,
      notified_version: notified ? (n % 2 === 0 ? 2 : (n % 4 === 0 ? 3 : 2)) : null
    });
  }
  const state = JOURNEY_STATE.get(reg.id);
  if (state.current_status !== reg.status) {
    state.previous_status = state.current_status;
    state.current_status = reg.status;
    state.previous_progress = state.progress;
    state.progress = PROGRESS_BY_STATUS[reg.status] ?? state.progress;
    state.changed_at = new Date().toISOString();
    state.version += 1;
  }
  return state;
}

function actorFor(userId) {
  const person = PROFILE_BY_ID.get(userId);
  return person ? { name: person.name, role: ROLE_LABEL[person.role] } : { name: "Sistema", role: "automacao" };
}

function journeyEvents(reg) {
  const n = reg.id.slice(-4);
  const responsible = reg.responsibleUserId;
  const events = [
    { id: `ev-${n}-1`, type: "created", occurredAt: reg.createdAt, details: {}, actor: { name: "Sistema", role: "automacao" } }
  ];
  if (responsible) {
    events.push({
      id: `ev-${n}-2`,
      type: "distribution:assigned",
      occurredAt: iso(new Date(reg.createdAt).getTime() + 5 * 60 * 1000),
      details: { fromName: "", toName: PROFILE_BY_ID.get(responsible)?.name || "" },
      actor: { name: "Sistema", role: "automacao" }
    });
  }
  if (reg.status !== "automated_service" && reg.status !== "pending") {
    events.push({
      id: `ev-${n}-3`,
      type: "status",
      occurredAt: reg.lastStatusChangeAt || reg.createdAt,
      previousStatus: "in_service",
      newStatus: reg.status,
      details: {},
      actor: actorFor(responsible)
    });
  }
  reg.tags.forEach((item, index) => {
    events.push({
      id: `ev-${n}-t${index}`,
      type: "tag_added",
      occurredAt: iso(new Date(reg.createdAt).getTime() + (index + 1) * HOUR),
      details: { tagName: item.name },
      actor: actorFor(responsible)
    });
  });
  if (reg.scheduledActivityAt) {
    events.push({
      id: `ev-${n}-a`,
      type: "activity_scheduled",
      occurredAt: iso(new Date(reg.createdAt).getTime() + 2 * HOUR),
      details: { title: reg.scheduledActivityNote, scheduledAt: reg.scheduledActivityAt },
      actor: actorFor(responsible)
    });
  }
  if (CCA_BY_CLIENT.has(reg.id)) {
    events.push({
      id: `ev-${n}-c`,
      type: "document_sent_to_cca",
      occurredAt: CCA_BY_CLIENT.get(reg.id).enteredAt,
      details: { ccaName: CCA_BY_CLIENT.get(reg.id).cca.name, documentCount: 9 },
      actor: actorFor(responsible)
    });
  }
  return events;
}

function journeyDetail(id, params) {
  const reg = REGS.get(id);
  if (!reg) {
    // Nunca devolver corpo sem `state`: ClientJourneyActions lê detail.state.*.
    return { state: { version: 1, notified_version: null, notified_at: null }, origin: null, events: [], totalEvents: 0, hasMore: false, url: "" };
  }
  const limit = Math.min(Math.max(Number(params?.get("limit")) || 20, 1), 100);
  const sort = params?.get("sort") === "asc" ? "asc" : "desc";
  const all = journeyEvents(reg).sort((a, b) => (sort === "asc" ? 1 : -1) * (new Date(a.occurredAt) - new Date(b.occurredAt)));
  const origin = ORIGINS.get(id);
  const responsibleName = PROFILE_BY_ID.get(reg.responsibleUserId)?.name || null;
  return {
    state: { ...journeyState(reg) },
    origin: origin ? { ...origin, created_by: null, initial_responsible_name: responsibleName, created_at: reg.createdAt } : null,
    events: all.slice(0, limit),
    totalEvents: all.length,
    hasMore: limit < all.length,
    url: `/dev/vitrine?tela=clientes#minha-jornada-ficticia-${id.slice(-4)}`
  };
}

// ---------------------------------------------------------------------------
// Rotas do mock de fetch
// ---------------------------------------------------------------------------

function body(init) {
  try {
    return init?.body ? JSON.parse(init.body) : {};
  } catch {
    return {};
  }
}

function idFrom(url, pattern) {
  return decodeURIComponent(url.pathname.match(pattern)?.[1] || "");
}

function touch(reg, perfil) {
  const actorId = perfil === "corretor" ? P.bruno : perfil === "associado" ? P.elisa : perfil === "gestor" ? P.gestor : P.admin;
  const actor = PROFILE_BY_ID.get(actorId);
  reg.lastAdminEmail = actor.email;
  reg.lastAdminName = actor.name;
  reg.lastAdminActivityAt = new Date().toISOString();
  reg.updatedAt = reg.lastAdminActivityAt;
}

function snapshot(reg) {
  return { ...reg, tags: reg.tags.slice() };
}

function patchRegistration({ url, init }) {
  const reg = REGS.get(idFrom(url, /^\/api\/simulation-registrations\/([^/]+)$/));
  if (!reg) return { error: "Cadastro não encontrado." };
  const patch = body(init);
  touch(reg, currentPerfil());

  if (patch.status !== undefined) {
    reg.status = patch.status;
    reg.lastStatusChangeAt = new Date().toISOString();
    if (patch.status === "approved") reg.approvedAt = reg.lastStatusChangeAt;
  }
  if (patch.responsibleUserId !== undefined) {
    reg.responsibleUserId = patch.responsibleUserId || "";
    reg.pendingDistributionAt = "";
  }
  if (patch.scheduledActivityDate && patch.scheduledActivityTime) {
    reg.scheduledActivityAt = new Date(`${patch.scheduledActivityDate}T${patch.scheduledActivityTime}:00-03:00`).toISOString();
    reg.scheduledActivityType = patch.scheduledActivityType || "follow_up";
    reg.scheduledActivityNote = patch.scheduledActivityNote || "";
    reg.scheduledActivityCompletedAt = "";
    reg.scheduledActivityCompleted = false;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "scheduledActivityAt") && !patch.scheduledActivityAt) {
    reg.scheduledActivityAt = "";
    reg.scheduledActivityType = "follow_up";
    reg.scheduledActivityNote = "";
  }
  for (const field of ["email", "pis", "fullName", "cpf"]) {
    if (patch[field] !== undefined) reg[field] = String(patch[field] || "");
  }
  return snapshot(reg);
}

function nextId(prefix) {
  activitySeq += 1;
  return `00000000-0000-4000-${prefix}-${String(activitySeq).padStart(12, "0")}`;
}

export const routes = [
  // Lista paginada/filtrada (fetchClients).
  {
    match: /^\/api\/simulation-registrations\/list(\?|$)/,
    response: ({ url }) => buildListPayload({
      filters: readFilters(url.searchParams),
      page: url.searchParams.get("page"),
      pageSize: url.searchParams.get("pageSize"),
      perfil: currentPerfil()
    }),
    delay: 260
  },

  // Cadastro: status, responsável, agenda legada, e-mail/PIS, "touch".
  { method: "PATCH", match: /^\/api\/simulation-registrations\/[^/?]+$/, response: patchRegistration },
  {
    method: "DELETE",
    match: /^\/api\/simulation-registrations\/[^/?]+$/,
    response: ({ url }) => {
      const id = idFrom(url, /^\/api\/simulation-registrations\/([^/]+)$/);
      REGS.delete(id);
      SIMS.delete(id);
      return { ok: true };
    }
  },

  // Tags do cliente.
  {
    method: "PUT",
    match: /^\/api\/simulation-registrations\/[^/]+\/tags$/,
    response: ({ url, init }) => {
      const reg = REGS.get(idFrom(url, /^\/api\/simulation-registrations\/([^/]+)\/tags$/));
      const tagIds = Array.from(new Set(body(init).tagIds || []));
      if (!reg) return { error: "Cadastro não encontrado." };
      reg.tags = sortTags(TAGS.filter((item) => tagIds.includes(item.id)));
      touch(reg, currentPerfil());
      return { ok: true, tagIds, registration: snapshot(reg) };
    }
  },

  // Botão WhatsApp do card.
  {
    method: "POST",
    match: /^\/api\/simulation-registrations\/[^/]+\/whatsapp-contact$/,
    response: ({ url }) => {
      const reg = REGS.get(idFrom(url, /^\/api\/simulation-registrations\/([^/]+)\/whatsapp-contact$/));
      if (!reg) return { error: "Cadastro não encontrado." };
      reg.lastWhatsappContactAt = new Date().toISOString();
      touch(reg, currentPerfil());
      return snapshot(reg);
    }
  },

  // Catálogo de tags.
  { match: /^\/api\/client-tags(\?|$)/, response: () => sortTags(TAGS) },
  {
    method: "POST",
    match: /^\/api\/client-tags(\?|$)/,
    status: 201,
    response: ({ init }) => {
      const payload = body(init);
      const name = String(payload.name || "").replace(/\s+/g, " ").trim() || "Nova tag";
      const existing = TAGS.find((item) => item.name.toLowerCase() === name.toLowerCase());
      if (existing) return existing;
      const created = { ...tag(0, name, /^#[0-9a-f]{6}$/i.test(payload.color || "") ? payload.color : "#0D4F8B"), id: nextId("b000"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      TAGS = sortTags([...TAGS, created]);
      return created;
    }
  },
  {
    method: "DELETE",
    match: /^\/api\/client-tags\/[^/?]+$/,
    response: ({ url }) => {
      const id = idFrom(url, /^\/api\/client-tags\/([^/]+)$/);
      TAGS = TAGS.filter((item) => item.id !== id);
      for (const reg of REGS.values()) reg.tags = reg.tags.filter((item) => item.id !== id);
      return { ok: true };
    }
  },

  // Atividades extras (calendar_activities).
  {
    method: "POST",
    match: /^\/api\/calendar-activities(\?|$)/,
    status: 201,
    response: ({ init }) => {
      const payload = body(init);
      const reg = REGS.get(payload.clientId);
      const created = {
        id: nextId("e000"),
        clientId: payload.clientId,
        responsibleUserId: payload.responsibleUserId || reg?.responsibleUserId || "",
        title: payload.title || payload.note || "Atividade",
        activityType: payload.activityType || "follow_up",
        scheduledActivityAt: new Date(payload.scheduledAt || Date.now()).toISOString(),
        note: payload.note || "",
        priority: "standard",
        status: "pending",
        completedAt: "",
        rescheduledFromId: "",
        rescheduledToId: "",
        rescheduledToAt: "",
        source: "calendar"
      };
      pushActivity(created);
      return { activity: created };
    }
  },
  {
    method: "PATCH",
    match: /^\/api\/calendar-activities\/[^/?]+$/,
    response: ({ url, init }) => {
      const id = idFrom(url, /^\/api\/calendar-activities\/([^/]+)$/);
      const payload = body(init);
      for (const list of ACTIVITIES.values()) {
        const found = list.find((item) => item.id === id);
        if (!found) continue;
        if (payload.action === "complete") {
          found.status = "completed";
          found.completedAt = new Date().toISOString();
        }
        return { activity: { ...found } };
      }
      return { error: "Atividade não encontrada." };
    }
  },
  {
    method: "DELETE",
    match: /^\/api\/calendar-activities\/[^/?]+$/,
    response: ({ url }) => {
      const id = idFrom(url, /^\/api\/calendar-activities\/([^/]+)$/);
      for (const [clientId, list] of ACTIVITIES.entries()) {
        ACTIVITIES.set(clientId, list.filter((item) => item.id !== id));
      }
      return { ok: true };
    }
  },

  // Ações de prospecção do card (Prospectar / Em atendimento / Não contactar / Devolver).
  {
    method: "POST",
    match: /^\/api\/prospecting\/clients\/[^/?]+$/,
    response: ({ url, init }) => {
      const id = idFrom(url, /^\/api\/prospecting\/clients\/([^/]+)$/);
      const reg = REGS.get(id);
      const { action } = body(init);
      if (!reg) return { error: "Cadastro não encontrado." };
      if (action === "prospect") {
        reg.status = "awaiting_return";
        reg.prospectingAssignedPending = false;
        return { status: "awaiting_return", prospectingAssignedPending: false, whatsappUrl: `https://wa.me/${reg.phoneNormalized.replace(/\D/g, "")}` };
      }
      if (action === "in_service") {
        reg.status = "in_service";
        reg.prospectingAssignedPending = false;
        reg.lastStatusChangeAt = new Date().toISOString();
        return { status: "in_service", prospectingAssignedPending: false };
      }
      if (action === "do_not_contact") {
        reg.status = "do_not_contact";
        return { removed: true };
      }
      if (action === "return_to_queue" || action === "return") {
        REGS.delete(id);
        return { removed: true };
      }
      return { error: "Ação inválida." };
    }
  },

  // Abrir simulação de cliente sem simulação (depois navega para /admin/...).
  { method: "POST", match: /^\/api\/simulations(\?|$)/, response: () => ({ id: nextId("d000") }) },
  { method: "DELETE", match: /^\/api\/simulations\/[^/?]+$/, response: { ok: true } },

  // Selo da CCA (CcaStatusCard).
  {
    match: /^\/api\/admin\/client-cca-status\/[^/?]+/,
    response: ({ url }) => {
      const id = idFrom(url, /^\/api\/admin\/client-cca-status\/([^/?]+)/);
      const link = CCA_BY_CLIENT.get(id);
      if (!link) return { current: null, history: [] };
      const current = {
        id: `cca-hist-${id.slice(-4)}`,
        clientId: id,
        enteredAt: link.enteredAt,
        exitedAt: null,
        status: { id: "cca-stage-1", key: "awaiting_cca_return", label: "Aguardando retorno da CCA" },
        cca: { id: link.cca.id, name: link.cca.name, photoUrl: link.cca.photoUrl || "" }
      };
      return { current, history: [current] };
    }
  },
  {
    method: "POST",
    match: /^\/api\/admin\/client-cca-status(\?|$)/,
    response: ({ init }) => {
      const { clientId, ccaId } = body(init);
      const cca = CCAS.find((item) => item.id === ccaId);
      if (!cca) return { error: "Selecione uma CCA." };
      CCA_BY_CLIENT.set(clientId, { cca, enteredAt: new Date().toISOString() });
      return { ok: true };
    }
  },
  { match: /^\/api\/admin\/cca(\?|$)/, response: { cca: CCAS } },

  // Jornada/histórico do cliente (ClientJourneyActions) — obrigatório: o
  // componente lê detail.state.* sem optional chaining.
  {
    match: /^\/api\/client-journey\/(?!settings)[^/?]+/,
    response: ({ url }) => journeyDetail(idFrom(url, /^\/api\/client-journey\/([^/?]+)/), url.searchParams)
  },
  {
    method: "POST",
    match: /^\/api\/client-journey\/(?!settings)[^/?]+/,
    response: ({ url, init }) => {
      const id = idFrom(url, /^\/api\/client-journey\/([^/?]+)/);
      const reg = REGS.get(id);
      if (!reg) return { error: "Cliente não encontrado." };
      const { action } = body(init);
      const state = journeyState(reg);
      if (action === "notify") {
        state.notified_at = new Date().toISOString();
        state.notified_version = state.version;
        return { ...journeyDetail(id), whatsappUrl: `https://wa.me/${reg.phoneNormalized.replace(/\D/g, "")}` };
      }
      return { ...journeyDetail(id), whatsappUrl: null };
    }
  },

  // Modal de Documentação ("Mais ações" > Documentação): sem lotes enviados.
  { match: /^\/api\/admin\/client-documents\/batches(\?|$)/, response: { batches: [] } },
  { match: /^\/api\/properties(\?|$)/, response: [] }
];

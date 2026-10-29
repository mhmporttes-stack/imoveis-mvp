// Fixture do cabeçalho do ranking (components/TopRankingBadge.jsx, montado em app/admin/layout.jsx).
// Dados 100% FICTÍCIOS. ?variante= completo (padrão) | sem-dia (dia sem pontos) | vazio | posicao (com "Sua posição").

function variante() {
  try {
    return new URLSearchParams(window.location.search).get("variante") || "completo";
  } catch {
    return "completo";
  }
}

const WEEKLY = { name: "Bruna Albuquerque Figueiredo", photoUrl: "", points: 1284, gender: "female" };
const DAILY = { name: "Diego Arantes", photoUrl: "", points: 96 };

function topRanking() {
  const v = variante();
  if (v === "vazio") return { top1: null, weeklyTop1: null };
  if (v === "sem-dia") return { top1: null, weeklyTop1: WEEKLY };
  if (v === "posicao") return { top1: DAILY, weeklyTop1: WEEKLY, isMeTop1: false, myRank: 4, myPoints: 41 };
  return { top1: DAILY, weeklyTop1: WEEKLY, isMeTop1: true };
}

// Radar Econômico (tira ECON-2): números FICTÍCIOS só para revisão visual; a forma é a de getEconomicRadar.
const MONTHS = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const LABELS = ["out", "nov", "dez", "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set"];
const hist = (values) => values.map((value, i) => ({ date: `${MONTHS[i]}-01`, value, label: `${LABELS[i]}/${MONTHS[i].slice(0, 4)}` }));
const tile = (code, name, label, values, extra = {}) => ({ code, name, label, value: values.at(-1), reference: "set/2026", direction: "down", tone: "neutral", unit: "%", history: hist(values), spark: values.slice(-6), source: "BCB", sourceLabel: "BCB (fictício na vitrine)", description: "Dado fictício da vitrine.", collectedAt: new Date().toISOString(), releasedToday: false, ...extra });

function radar() {
  const v = variante();
  if (v === "vazio") return { items: [], tiles: [], updatedAt: null, failing: false };
  const tiles = [
    tile("selic", "Selic", "14,75% a.a.", [15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 14.75, 14.75], { unit: "% a.a.", reference: "29/10/2026", releasedToday: true }),
    tile("financiamento", "Caixa (financ.)", "10,94% a.a.", [11.6, 11.5, 11.4, 11.4, 11.3, 11.2, 11.1, 11.1, 11, 11, 10.98, 10.94], { unit: "% a.a.", caixa: { value: 10.94, label: "10,94% a.a." }, average: { value: 12.31, label: "12,31% a.a.", count: 14 }, averageHistory: hist([12.9, 12.8, 12.8, 12.7, 12.7, 12.6, 12.5, 12.5, 12.4, 12.4, 12.35, 12.31]) }),
    tile("tr", "TR", "0,1702%", [0.08, 0.1, 0.12, 0.14, 0.13, 0.15, 0.16, 0.17, 0.16, 0.18, 0.17, 0.1702], { direction: "up" }),
    tile("incc", "INCC-DI", "0,30%", [0.4, 0.5, 0.3, 0.6, 0.7, 0.4, 0.9, 1.2, 0.8, 0.5, 0.4, 0.3], { tone: "good", twelveMonthsLabel: "6,10%", source: "FGV" }),
    tile("ipca", "IPCA", "0,48%", [0.2, 0.3, 0.5, 0.2, 0.4, 0.6, 0.3, 0.2, 0.1, 0.3, 0.2, 0.48], { direction: "up", tone: "bad", twelveMonthsLabel: "4,20%", source: "IBGE" }),
    tile("renda", "Renda real", "R$ 3.480", [3300, 3320, 3350, 3360, 3380, 3390, 3400, 3420, 3440, 3450, 3470, 3480], { direction: "up", unit: "R$", source: "IBGE", reference: "jul–set/2026" })
  ];
  if (v !== "sem-dia") tiles.push({ code: "mcmv", name: "MCMV · teto", fullName: "Minha Casa Minha Vida", label: "R$ 350.000", reference: "portaria 01/07/2026", direction: null, tone: "neutral", faixas: [{ nome: "Faixa 1", rendaAte: 2850, tetoImovel: 264000 }, { nome: "Faixa 3", rendaAte: 8600, tetoImovel: 350000 }], portaria: "Portaria fictícia nº 0/2026", portariaData: "2026-07-01", source: "Portaria", sourceLabel: "Portaria fictícia (vitrine)", description: "Dado fictício da vitrine.", history: [], spark: [], collectedAt: null, releasedToday: false });
  return { items: tiles.filter((t) => t.code === "ipca" || t.code === "incc"), tiles, updatedAt: new Date().toISOString(), failing: false };
}

export const routes = [
  { match: /^\/api\/daily-goal\/top-ranking/, response: topRanking },
  { match: /^\/api\/admin\/economic-indicators\/radar/, response: radar },
  { match: /^\/api\/google-contacts\/status/, response: { configured: true, status: "connected" } },
  { match: /^\/api\/admin\/whatsapp-individual\/restriction/, response: {} }
];

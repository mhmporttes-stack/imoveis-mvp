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

export const routes = [
  { match: /^\/api\/daily-goal\/top-ranking/, response: topRanking },
  { match: /^\/api\/google-contacts\/status/, response: { configured: true, status: "connected" } },
  { match: /^\/api\/admin\/whatsapp-individual\/restriction/, response: {} }
];

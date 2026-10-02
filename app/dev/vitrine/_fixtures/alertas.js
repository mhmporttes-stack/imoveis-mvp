// Fixture da Central de Alertas (components/alerts/AlertCenterGate.jsx).
// Dados FICTÍCIOS. ?cenario=informativo (5 avisos em fila) | importante (2
// importantes em sequência) — o padrão mostra os dois juntos.
const now = Date.now();
const iso = (offsetSec) => new Date(now + offsetSec * 1000).toISOString();

export const calls = { shown: [], ack: [] };

function cenario() {
  try { return new URLSearchParams(window.location.search).get("cenario") || "ambos"; } catch { return "ambos"; }
}

const informative = [1, 2, 3, 4, 5].map((n) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, kind: "informative", title: `Aviso ${n}`, body: `Mensagem informativa de demonstração número ${n}.`, created_at: iso(-60 + n) }));
let important = [
  { id: "00000000-0000-4000-9000-000000000001", kind: "important", title: "Cliente aguardando resposta", body: "Eduardo, o cliente Fulano Demo está aguardando sua resposta há mais de 10 minutos.", created_at: iso(-120) },
  { id: "00000000-0000-4000-9000-000000000002", kind: "important", title: "Cliente aguardando resposta", body: "Eduardo, o cliente Beltrano Demo está aguardando sua resposta há mais de 10 minutos.", created_at: iso(-60) }
];

export const routes = [
  { match: /^\/api\/admin\/alerts(\?|$)/, response: () => {
    const c = cenario();
    return { topic: "", informative: c === "importante" ? [] : informative, important: c === "informativo" ? [] : important };
  } },
  { method: "POST", match: /^\/api\/admin\/alerts\/shown/, response: async ({ init }) => { const body = JSON.parse(init.body || "{}"); calls.shown.push(...(body.ids || [])); window.__alertCalls = calls; return { marked: (body.ids || []).length }; } },
  { method: "POST", match: /^\/api\/admin\/alerts\/[^/]+\/ack/, response: ({ url }) => { const id = url.pathname.split("/")[4]; calls.ack.push({ id, at: new Date().toISOString() }); window.__alertCalls = calls; important = important.filter((item) => item.id !== id); return { acknowledgedAt: new Date().toISOString() }; } }
];

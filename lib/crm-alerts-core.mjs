// Central de Alertas — regras PURAS (testes: tests/crm-alerts-core.test.mjs).
// Servidor: lib/crm-alerts.js. Tela: components/alerts/AlertCenterGate.jsx.
// Dois tipos (pedido do dono, 2026-10-02):
//  - informative: flutua pela lateral ~5 s e some; não bloqueia; fila.
//  - important: bloqueia o CRM até "Entendi"; ciência registrada.

export const ALERT_KIND = Object.freeze({ INFORMATIVE: "informative", IMPORTANT: "important" });
export const ALERT_KINDS = Object.values(ALERT_KIND);

// Tempos do Informativo (spec do Designer): entrada 520 ms + visível 4,1 s + saída 380 ms ≈ 5 s.
export const INFORMATIVE_TIMING = Object.freeze({ enterMs: 520, visibleMs: 4100, exitMs: 380 });
export const INFORMATIVE_MAX_VISIBLE = Object.freeze({ desktop: 3, mobile: 2 });
// Informativo que ninguém viu em 30 min já não tem valor ("aviso de agora").
export const INFORMATIVE_MAX_AGE_MS = 30 * 60 * 1000;

export function normalizeAlertKind(kind) {
  return ALERT_KINDS.includes(kind) ? kind : null;
}

export function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

// "{primeiro_nome}, o cliente {cliente}..." — variável desconhecida/vazia some.
export function renderAlertTemplate(template, vars = {}) {
  return String(template || "")
    .replace(/\{([a-z_]+)\}/gi, (_, name) => {
      const value = vars[name];
      return value === undefined || value === null ? "" : String(value);
    })
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Mesmo evento = mesma chave (o banco tem UNIQUE recipient_id + dedupe_key).
export function replyWaitingDedupeKey(conversationId, streakStartedAt) {
  return `reply_waiting:${conversationId}:${new Date(streakStartedAt).toISOString()}`;
}

// Entrega do alerta "cliente aguardando resposta" para o corretor.
export function buildReplyWaitingDelivery({ definition, broker, clientName, minutes, conversationId, streakStartedAt }) {
  if (!definition?.enabled || !broker?.id || !conversationId || !streakStartedAt) return null;
  const kind = normalizeAlertKind(definition.kind) || ALERT_KIND.IMPORTANT;
  return {
    definition_id: definition.id || null,
    recipient_id: broker.id,
    kind,
    title: definition.title || "Cliente aguardando resposta",
    body: renderAlertTemplate(definition.body_template, {
      primeiro_nome: firstName(broker.name) || "Corretor",
      cliente: String(clientName || "").trim() || "sem nome",
      minutos: minutes
    }),
    context: { conversation_id: conversationId, link: "/admin/chat" },
    dedupe_key: replyWaitingDedupeKey(conversationId, streakStartedAt)
  };
}

// Separa o que a tela deve mostrar: Importantes pendentes (mais antigo
// primeiro) e Informativos ainda não exibidos e recentes.
export function splitPendingAlerts(rows = [], now = Date.now()) {
  const important = [];
  const informative = [];
  for (const row of rows) {
    if (!row || row.acknowledged_at) continue;
    if (row.kind === ALERT_KIND.IMPORTANT) important.push(row);
    else if (row.kind === ALERT_KIND.INFORMATIVE && !row.shown_at && now - new Date(row.created_at).getTime() <= INFORMATIVE_MAX_AGE_MS) informative.push(row);
  }
  const byOldest = (a, b) => new Date(a.created_at) - new Date(b.created_at);
  return { important: important.sort(byOldest), informative: informative.sort(byOldest) };
}

// Fila do Informativo na tela: acrescenta os novos sem repetir os que já
// estão visíveis/na fila/já exibidos nesta sessão.
export function enqueueInformative(queue = [], incoming = [], seenIds = new Set()) {
  const known = new Set([...queue.map((item) => item.id), ...seenIds]);
  return [...queue, ...incoming.filter((item) => item?.id && !known.has(item.id))];
}

// Aviso de CLIENTE NOVO (regras de automação com gatilho "cliente cadastrado pelo formulário" / "adicionado pelo corretor").
// Regra do dono (2026-10-06): notificar SÓ cliente novo — ou cliente antigo que fez um NOVO cadastro (formulário de novo).
// Nunca a cada mudança de etapa. Causa do bug: a chave de deduplicação levava a etapa (`…:<status>`), então cada mudança de
// etapa virava um "evento novo" e o push "Novo cliente" saía de novo (inclusive para clientes de semanas atrás).
// Puro e testado (tests/crm-automation-new-client.test.mjs).

export const NEW_CLIENT_TRIGGERS = new Set(["client_form_submitted", "client_added_by_broker"]);

// Só cadastros/recadastros recentes podem gerar o aviso: impede uma "avalanche" de avisos para clientes antigos (por
// exemplo, logo depois desta correção, quando as chaves antigas — com a etapa — deixam de ser usadas).
export const NEW_CLIENT_MAX_AGE_MS = 48 * 60 * 60 * 1000;

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Regra de aviso de cliente novo (não a de redistribuição pela roleta, que usa o mesmo gatilho com outra ação). */
export function isNewClientNotificationRule({ triggerType, returnsToRoundRobin = false } = {}) {
  return NEW_CLIENT_TRIGGERS.has(triggerType) && !returnsToRoundRobin;
}

/** Momento do cadastro que gera o aviso: o cadastro ou, se houver, o NOVO preenchimento do formulário (o mais recente). */
export function newClientAnchor(triggerType, client = {}) {
  const created = toDate(client.created_at);
  if (triggerType !== "client_form_submitted") return created;
  const resubmitted = toDate(client.last_form_submitted_at);
  return resubmitted && (!created || resubmitted > created) ? resubmitted : created;
}

/** Chave única do aviso: UM por cadastro/recadastro — a etapa do cliente NÃO entra. */
export function newClientEventKey(triggerType, anchor) {
  return `${triggerType}:${anchor.toISOString()}`;
}

/** Prefixo das chaves ANTIGAS (com a etapa) do mesmo cadastro: se já existe alguma, o aviso já foi dado. */
export function legacyEventKeyPrefix(triggerType, anchor) {
  return `${triggerType}:${anchor.toISOString()}:`;
}

export function isNewClientEventFresh(anchor, now = Date.now()) {
  return Boolean(anchor) && now - anchor.getTime() <= NEW_CLIENT_MAX_AGE_MS;
}

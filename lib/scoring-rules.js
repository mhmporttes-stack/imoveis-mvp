import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { assertGeneralAdmin } from "./admin-access";
import { isGeneralAdminAuth, isManagerProfile } from "./admin-profiles";
import { CLIENT_STATUS, normalizeClientStatus } from "./client-status";

// Atividades reais que já existem no sistema (cadastro, prospecção, histórico de
// status do cliente) e passam a gerar pontos configuráveis no ranking da equipe.
// Não inventamos evento novo: cada chave abaixo corresponde a um evento já
// registrado em simulation_registrations, prospecting_history ou
// client_status_history.
export const SCORING_RULE_DEFINITIONS = [
  { key: "new_client", label: "Novo cliente", description: "Cliente cadastrado no CRM" },
  { key: "prospecting", label: "Prospecção", description: "Contato de prospecção iniciado" },
  { key: "service", label: "Cliente em atendimento", description: "Cliente passou para 'Em atendimento'" },
  { key: "simulation", label: "Simulação realizada", description: "Simulação realizada ou enviada ao cliente" },
  { key: "documentation", label: "Documentação recebida", description: "Cliente enviou/teve documentação recebida" },
  { key: "sent_for_approval", label: "Cliente enviado para aprovação", description: "Cliente enviado para análise de crédito" },
  { key: "approval", label: "Cliente aprovado", description: "Crédito do cliente aprovado" },
  { key: "sale", label: "Venda realizada", description: "Cliente entrou no pipeline de venda" }
];

const SCORING_RULE_KEYS = new Set(SCORING_RULE_DEFINITIONS.map((rule) => rule.key));

// Mapeia o status real do cliente (client_status_history.new_status) para a
// atividade de pontuação correspondente. Propositalmente mais granular que o
// funil comercial (CLIENT_FUNNEL_STAGES em lib/client-status.js): a pontuação
// também reconhece "enviado para aprovação" como um marco próprio.
const STATUS_TO_SCORING_KEY = {
  [CLIENT_STATUS.IN_SERVICE]: "service",
  [CLIENT_STATUS.COMPLETED]: "simulation",
  [CLIENT_STATUS.SIMULATION_SENT]: "simulation",
  [CLIENT_STATUS.DOCUMENTATION]: "documentation",
  [CLIENT_STATUS.DOCUMENTS_PENDING]: "documentation",
  [CLIENT_STATUS.APPROVAL_PENDING]: "sent_for_approval",
  [CLIENT_STATUS.APPROVED]: "approval",
  [CLIENT_STATUS.SALE_COMPLETED]: "sale",
  [CLIENT_STATUS.SALE_FORMS]: "sale",
  [CLIENT_STATUS.SALE_RESERVATION]: "sale",
  [CLIENT_STATUS.SALE_CONTRACT]: "sale",
  [CLIENT_STATUS.SALE_CAIXA_SIGNATURE]: "sale",
  [CLIENT_STATUS.SALE_ITBI]: "sale",
  [CLIENT_STATUS.SALE_REGISTRY]: "sale",
  [CLIENT_STATUS.SALE_PAYMENT]: "sale"
};

export function getScoringKeyForStatus(status) {
  return STATUS_TO_SCORING_KEY[normalizeClientStatus(status)] || "";
}

export function canLoadScoringRules() {
  return hasSupabaseAdminConfig;
}

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

function assertCanViewScoring(auth) {
  if (isGeneralAdminAuth(auth) || isManagerProfile(auth?.profile)) return;
  throw Object.assign(new Error("Acesso não autorizado."), { status: 403 });
}

// Carrega TODAS as versões de todas as regras (tabela pequena, cresce a cada
// alteração) e organiza por rule_key/ordem cronológica — usado para aplicar a
// regra que valia no momento exato de cada evento passado (vigência).
export async function loadScoringRulesTimeline() {
  const { data, error } = await db()
    .from("scoring_rule_versions")
    .select("rule_key, points, active, effective_from, effective_to")
    .order("effective_from", { ascending: true });
  if (error) throw error;

  const timeline = new Map();
  for (const row of data || []) {
    if (!timeline.has(row.rule_key)) timeline.set(row.rule_key, []);
    timeline.get(row.rule_key).push(row);
  }
  return timeline;
}

// Pontos aplicáveis a um evento de `ruleKey` ocorrido em `timestampMs`,
// respeitando a vigência (effective_from/effective_to) e o estado ativo/inativo
// da regra naquele momento — nunca a regra atual.
export function getRulePointsAt(timeline, ruleKey, timestampMs) {
  const versions = timeline.get(ruleKey);
  if (!versions?.length || !Number.isFinite(timestampMs)) return 0;

  for (let index = versions.length - 1; index >= 0; index -= 1) {
    const version = versions[index];
    const from = new Date(version.effective_from).getTime();
    const to = version.effective_to ? new Date(version.effective_to).getTime() : Infinity;
    if (timestampMs >= from && timestampMs < to) {
      return version.active ? version.points : 0;
    }
  }
  return 0;
}

// Regras vigentes agora (uma por atividade) — usadas na tela de configuração.
export async function listCurrentScoringRules(auth) {
  assertCanViewScoring(auth);

  const { data, error } = await db()
    .from("scoring_rule_versions")
    .select("id, rule_key, points, active, effective_from, changed_by, changed_by_user:admin_users(name)")
    .is("effective_to", null);
  if (error) throw error;

  const byKey = new Map((data || []).map((row) => [row.rule_key, row]));
  return SCORING_RULE_DEFINITIONS.map((definition) => {
    const current = byKey.get(definition.key);
    return {
      ...definition,
      points: current?.points ?? 0,
      active: current?.active ?? false,
      effectiveFrom: current?.effective_from || "",
      changedByName: current?.changed_by_user?.name || ""
    };
  });
}

export async function updateScoringRule(ruleKey, { points, active }, auth) {
  assertGeneralAdmin(auth);

  if (!SCORING_RULE_KEYS.has(ruleKey)) throw new Error("Atividade de pontuação inválida.");

  const normalizedPoints = Number(points);
  if (!Number.isInteger(normalizedPoints) || normalizedPoints < 0) {
    throw new Error("Informe um valor inteiro maior ou igual a zero.");
  }

  const supabase = db();

  const { data: current, error: currentError } = await supabase
    .from("scoring_rule_versions")
    .select("id, points, active")
    .eq("rule_key", ruleKey)
    .is("effective_to", null)
    .maybeSingle();
  if (currentError) throw currentError;

  const nextActive = active !== undefined ? Boolean(active) : current?.active ?? true;
  if (current && current.points === normalizedPoints && current.active === nextActive) {
    return listCurrentScoringRules(auth);
  }

  // Fecha a versão vigente e abre a nova numa única chamada (transação atômica
  // no banco) — evita que uma falha de rede entre "fechar" e "abrir" deixe a
  // regra sem nenhuma versão vigente (pontuaria 0 até alguém notar).
  const { error: rpcError } = await supabase.rpc("set_scoring_rule_version", {
    p_rule_key: ruleKey,
    p_points: normalizedPoints,
    p_active: nextActive,
    p_changed_by: auth?.profile?.id || null
  });
  if (rpcError) throw rpcError;

  return listCurrentScoringRules(auth);
}

// Histórico de todas as alterações de regra (inclusive ativar/desativar),
// mais recente primeiro — cada linha da tabela já É o registro de auditoria.
export async function listScoringRuleHistory(auth, { limit = 50 } = {}) {
  assertCanViewScoring(auth);

  const { data, error } = await db()
    .from("scoring_rule_versions")
    .select("id, rule_key, points, active, effective_from, effective_to, changed_by_user:admin_users(name)")
    .order("effective_from", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const labelByKey = new Map(SCORING_RULE_DEFINITIONS.map((rule) => [rule.key, rule.label]));
  return (data || []).map((row) => ({
    id: row.id,
    ruleKey: row.rule_key,
    ruleLabel: labelByKey.get(row.rule_key) || row.rule_key,
    points: row.points,
    active: row.active,
    effectiveFrom: row.effective_from,
    changedByName: row.changed_by_user?.name || "Sistema"
  }));
}

export async function createManualAdjustment({ brokerId, points, reason }, auth) {
  assertGeneralAdmin(auth);

  const normalizedPoints = Number(points);
  if (!Number.isInteger(normalizedPoints) || normalizedPoints === 0) {
    throw new Error("Informe uma quantidade de pontos diferente de zero.");
  }
  const normalizedReason = String(reason || "").trim();
  if (!normalizedReason) throw new Error("Informe o motivo do ajuste.");
  if (!brokerId) throw new Error("Selecione um corretor.");

  const { data, error } = await db()
    .from("scoring_manual_adjustments")
    .insert({
      broker_id: brokerId,
      points: normalizedPoints,
      reason: normalizedReason,
      created_by: auth?.profile?.id || null
    })
    .select("id, broker_id, points, reason, created_at")
    .single();
  if (error) throw error;
  return data;
}

// Ajustes manuais no período (para somar ao total do ranking) e/ou histórico
// completo por corretor (para a seção "Histórico de ajustes").
export async function listManualAdjustments(auth, { brokerIds = null, startIso = "", endIso = "", limit = 0 } = {}) {
  assertCanViewScoring(auth);

  let query = db()
    .from("scoring_manual_adjustments")
    .select("id, broker_id, points, reason, created_at, broker:admin_users!scoring_manual_adjustments_broker_id_fkey(name), created_by_user:admin_users!scoring_manual_adjustments_created_by_fkey(name)")
    .order("created_at", { ascending: false });

  if (Array.isArray(brokerIds)) {
    if (!brokerIds.length) return [];
    query = query.in("broker_id", brokerIds);
  }
  if (startIso) query = query.gte("created_at", startIso);
  if (endIso) query = query.lt("created_at", endIso);
  if (limit) query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((row) => ({
    id: row.id,
    brokerId: row.broker_id,
    brokerName: row.broker?.name || "Corretor",
    points: row.points,
    reason: row.reason,
    createdAt: row.created_at,
    createdByName: row.created_by_user?.name || "Administrador"
  }));
}

export function formatScoringRulesError(error) {
  const message = error?.message || String(error || "");
  if (message.toLowerCase().includes("scoring_rule_versions") || message.toLowerCase().includes("scoring_manual_adjustments")) {
    return "As tabelas de pontuação ainda não existem no Supabase. Execute a migration supabase/migrations/20260912_scoring_rules.sql no SQL Editor do Supabase.";
  }
  return message || "Não foi possível concluir a operação de pontuação.";
}

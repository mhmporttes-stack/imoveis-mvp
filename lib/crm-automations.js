import "server-only";
import { z } from "zod";
import { getSupabaseAdminClient } from "./supabase";
import { assertGeneralAdmin } from "./admin-access";
import { CLIENT_STATUS, CLIENT_STATUS_VALUES } from "./client-status";
import { updateSimulationRegistration } from "./simulation-registrations";
import {
  AUTOMATION_ACTIONS,
  AUTOMATION_CONDITIONS,
  AUTOMATION_DELAY_UNITS,
  AUTOMATION_TRIGGERS
} from "./crm-automation-options";

const triggerValues = AUTOMATION_TRIGGERS.map((item) => item.value);
const conditionValues = AUTOMATION_CONDITIONS.map((item) => item.value);
const actionValues = AUTOMATION_ACTIONS.map((item) => item.value);
const delayUnits = AUTOMATION_DELAY_UNITS.map((item) => item.value);

const ruleSchema = z.object({
  name: z.string().trim().min(2).max(160),
  enabled: z.boolean().optional().default(false),
  triggerType: z.enum(triggerValues),
  triggerConfig: z.record(z.string(), z.unknown()).optional().default({}),
  conditions: z.array(z.record(z.string(), z.unknown())).max(12).optional().default([]),
  delayValue: z.coerce.number().int().min(0).max(3650).optional().default(0),
  delayUnit: z.enum(delayUnits).optional().default("minutes"),
  actions: z.array(z.record(z.string(), z.unknown())).min(1).max(5)
});

export async function listAutomationRules() {
  const { data, error } = await getSupabaseAdminClient()
    .from("crm_automation_rules")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToRule);
}

export async function createAutomationRule(payload, auth) {
  assertGeneralAdmin(auth);
  const rule = validateRule(payload);
  const { data, error } = await getSupabaseAdminClient()
    .from("crm_automation_rules")
    .insert(ruleToRecord(rule, auth?.profile?.id || null))
    .select("*")
    .single();
  if (error) throw error;
  return rowToRule(data);
}

export async function updateAutomationRule(id, payload, auth) {
  assertGeneralAdmin(auth);
  const rule = validateRule(payload);
  const { data, error } = await getSupabaseAdminClient()
    .from("crm_automation_rules")
    .update({ ...ruleToRecord(rule), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return rowToRule(data);
}

export async function setAutomationRuleEnabled(id, enabled, auth) {
  assertGeneralAdmin(auth);
  const { data, error } = await getSupabaseAdminClient()
    .from("crm_automation_rules")
    .update({ enabled: enabled === true, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return rowToRule(data);
}

export async function deleteAutomationRule(id, auth) {
  assertGeneralAdmin(auth);
  const { error } = await getSupabaseAdminClient().from("crm_automation_rules").delete().eq("id", id);
  if (error) throw error;
}

export async function runCrmAutomations({ limitPerRule = 100 } = {}) {
  const supabase = getSupabaseAdminClient();
  const { data: rows, error } = await supabase
    .from("crm_automation_rules")
    .select("*")
    .eq("enabled", true)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const results = [];
  for (const row of rows || []) {
    const rule = rowToRule(row);
    try {
      results.push(await runRule(rule, limitPerRule));
    } catch (ruleError) {
      console.error(`Falha na regra de automação ${rule.id}.`, ruleError?.message || ruleError);
      results.push({ ruleId: rule.id, checked: 0, executed: 0, failed: 1 });
    }
  }
  return results;
}

async function runRule(rule, limit) {
  const clients = await listCandidateClients(rule, limit);
  let executed = 0;
  let failed = 0;

  for (const client of clients) {
    if (!triggerMatches(rule, client) || !conditionsMatch(rule.conditions, client)) continue;
    const anchor = triggerAnchor(rule, client);
    if (!anchor || Date.now() < anchor.getTime() + durationMs(rule.delayValue, rule.delayUnit)) continue;

    const eventKey = `${rule.triggerType}:${anchor.toISOString()}:${client.status || ""}`;
    const execution = await claimExecution(rule.id, client.id, eventKey);
    if (!execution) continue;

    try {
      for (const action of rule.actions) await executeAction(action, client);
      await finishExecution(execution.id, "success", "");
      executed += 1;
    } catch (actionError) {
      await finishExecution(execution.id, "failed", String(actionError?.message || actionError).slice(0, 500));
      failed += 1;
    }
  }

  if (executed || failed) {
    await getSupabaseAdminClient()
      .from("crm_automation_rules")
      .update({
        last_run_at: new Date().toISOString(),
        run_count: rule.runCount + executed,
        updated_at: new Date().toISOString()
      })
      .eq("id", rule.id);
  }

  return { ruleId: rule.id, checked: clients.length, executed, failed };
}

async function listCandidateClients(rule, limit) {
  let query = getSupabaseAdminClient()
    .from("simulation_registrations")
    .select("id, full_name, status, responsible_user_id, created_at, updated_at, last_status_change_at, last_whatsapp_contact_at, scheduled_activity_at, scheduled_activity_completed_at")
    .order("updated_at", { ascending: false })
    .limit(limit);

  const expectedStatus = rule.triggerConfig?.status || (rule.triggerType === "simulation_sent" ? CLIENT_STATUS.SIMULATION_SENT : "");
  if (expectedStatus) query = query.eq("status", expectedStatus);
  if (rule.triggerType === "activity_created") query = query.not("scheduled_activity_at", "is", null);
  if (rule.triggerType === "activity_completed") query = query.not("scheduled_activity_completed_at", "is", null);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

function triggerMatches(rule, client) {
  const futureActivity = hasFutureActivity(client);
  if (rule.triggerType === "status_changed") return !rule.triggerConfig?.status || client.status === rule.triggerConfig.status;
  if (rule.triggerType === "simulation_sent") return client.status === CLIENT_STATUS.SIMULATION_SENT;
  if (rule.triggerType === "activity_created") return Boolean(validDate(client.scheduled_activity_at));
  if (rule.triggerType === "activity_completed") return Boolean(validDate(client.scheduled_activity_completed_at));
  if (rule.triggerType === "no_future_activity") return !futureActivity;
  return true;
}

function conditionsMatch(conditions, client) {
  return conditions.every((condition) => {
    if (condition.type === "status_equals") return client.status === condition.value;
    if (condition.type === "responsible_equals") return condition.value === "any" || (client.responsible_user_id || "") === condition.value;
    if (condition.type === "has_future_activity") return hasFutureActivity(client) === Boolean(condition.value);
    if (condition.type === "not_archived") return client.status !== CLIENT_STATUS.ARCHIVED;
    if (condition.type === "last_contact_older_than") {
      const reference = validDate(client.last_whatsapp_contact_at || client.created_at);
      return Boolean(reference && Date.now() >= reference.getTime() + durationMs(condition.amount, condition.unit));
    }
    return false;
  });
}

function triggerAnchor(rule, client) {
  if (rule.triggerType === "client_created") return validDate(client.created_at);
  if (["status_changed", "simulation_sent"].includes(rule.triggerType)) return validDate(client.last_status_change_at || client.updated_at);
  if (rule.triggerType === "activity_created") return validDate(client.scheduled_activity_at);
  if (rule.triggerType === "activity_completed") return validDate(client.scheduled_activity_completed_at);
  if (rule.triggerType === "time_without_contact") return validDate(client.last_whatsapp_contact_at || client.created_at);
  return validDate(client.updated_at || client.created_at);
}

async function claimExecution(ruleId, clientId, eventKey) {
  const { data, error } = await getSupabaseAdminClient()
    .from("crm_automation_executions")
    .insert({ rule_id: ruleId, client_id: clientId, event_key: eventKey, status: "processing" })
    .select("id")
    .single();
  if (error?.code === "23505") return null;
  if (error) throw error;
  return data;
}

async function finishExecution(id, status, error) {
  await getSupabaseAdminClient()
    .from("crm_automation_executions")
    .update({ status, error, executed_at: new Date().toISOString() })
    .eq("id", id);
}

async function executeAction(action, client) {
  if (action.type === "create_notification") {
    const recipientId = await resolveTargetUser(action, client);
    if (!recipientId) throw new Error("A notificação não possui destinatário válido.");
    const { error } = await getSupabaseAdminClient().from("crm_notifications").insert({
      recipient_user_id: recipientId,
      client_id: client.id,
      title: cleanText(action.title, 160) || "Automação do CRM",
      description: cleanText(action.message, 500),
      notification_type: "automation",
      scheduled_at: new Date().toISOString()
    });
    if (error) throw error;
    return;
  }

  if (action.type === "create_activity") {
    const scheduledAt = new Date(Date.now() + durationMs(action.offsetValue, action.offsetUnit)).toISOString();
    await updateSimulationRegistration(client.id, {
      scheduledActivityAt: scheduledAt,
      scheduledActivityType: cleanText(action.activityType, 80) || "follow_up",
      scheduledActivityNote: cleanText(action.note, 500) || "Atividade criada por automação"
    });
    return;
  }

  if (action.type === "change_status") {
    if (!CLIENT_STATUS_VALUES.includes(action.status)) throw new Error("Status inválido na automação.");
    await updateSimulationRegistration(client.id, { status: action.status });
    return;
  }

  throw new Error("Ação não suportada.");
}

async function resolveTargetUser(action, client) {
  if (action.target === "specific_user") return action.userId || null;
  if (action.target === "client_broker" && client.responsible_user_id) return client.responsible_user_id;
  const { data } = await getSupabaseAdminClient()
    .from("admin_users")
    .select("id")
    .eq("role", "admin")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

function validateRule(payload) {
  const result = ruleSchema.safeParse(payload);
  if (!result.success) throw new Error("Revise os campos obrigatórios da regra.");
  const rule = result.data;
  for (const condition of rule.conditions) {
    if (!conditionValues.includes(condition.type)) throw new Error("Condição não suportada.");
  }
  for (const action of rule.actions) {
    if (!actionValues.includes(action.type)) throw new Error("Ação não suportada.");
  }
  if (rule.triggerConfig?.status && !CLIENT_STATUS_VALUES.includes(rule.triggerConfig.status)) {
    throw new Error("Status do gatilho inválido.");
  }
  return rule;
}

function ruleToRecord(rule, createdBy) {
  return {
    name: rule.name,
    enabled: rule.enabled,
    trigger_type: rule.triggerType,
    trigger_config: rule.triggerConfig,
    condition_config: rule.conditions,
    action_config: rule.actions,
    delay_value: rule.delayValue,
    delay_unit: rule.delayUnit,
    ...(createdBy !== undefined ? { created_by: createdBy } : {})
  };
}

function rowToRule(row = {}) {
  return {
    id: row.id,
    name: row.name || "Regra sem nome",
    enabled: row.enabled === true,
    triggerType: row.trigger_type || "client_created",
    triggerConfig: row.trigger_config || {},
    conditions: Array.isArray(row.condition_config) ? row.condition_config : [],
    actions: Array.isArray(row.action_config) ? row.action_config : [],
    delayValue: Number(row.delay_value || 0),
    delayUnit: row.delay_unit || "minutes",
    lastRunAt: row.last_run_at || "",
    runCount: Number(row.run_count || 0),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function hasFutureActivity(client) {
  const scheduledAt = validDate(client.scheduled_activity_at);
  return Boolean(scheduledAt && !client.scheduled_activity_completed_at && scheduledAt.getTime() > Date.now());
}

function validDate(value) {
  const date = new Date(value || "");
  return Number.isFinite(date.getTime()) ? date : null;
}

function durationMs(value, unit) {
  const amount = Math.max(0, Number(value || 0));
  if (unit === "days") return amount * 86400000;
  if (unit === "hours") return amount * 3600000;
  return amount * 60000;
}

function cleanText(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

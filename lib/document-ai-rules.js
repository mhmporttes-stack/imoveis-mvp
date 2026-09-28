import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { assertGeneralAdmin } from "./admin-access";
import { residencePolicyInstruction } from "./document-ai-rule-core.mjs";

function db() { return getSupabaseAdminClient(); }
function map(row) { return { id: row.id, category: row.category, title: row.title, instruction: row.instruction, ruleKey: row.rule_key, policy: row.policy || {}, active: row.active, updatedAt: row.updated_at }; }

export async function listDocumentAiRules({ activeOnly = false } = {}) {
  let query = db().from("document_ai_rules").select("*").order("category").order("created_at");
  if (activeOnly) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(map);
}

export async function saveDocumentAiRule(payload, auth, id = null) {
  assertGeneralAdmin(auth);
  const category = String(payload.category || "").trim().slice(0, 100);
  const title = String(payload.title || "").trim().slice(0, 120);
  const instruction = String(payload.instruction || "").trim().slice(0, 3000);
  if (!category || !title || !instruction) throw new Error("Preencha categoria, título e instrução.");
  const record = { category, title, instruction, active: payload.active !== false, updated_at: new Date().toISOString() };
  if (id) {
    const { data: current, error: readError } = await db().from("document_ai_rules").select("rule_key").eq("id", id).single();
    if (readError) throw readError;
    if (current.rule_key === "residence_income_ownership") {
      const allowed = ["titular_only", "third_party_allowed", "validation"];
      record.policy = Object.fromEntries(["self_employed_unregistered", "registered_employment", "income_tax_declarant"].map((key) => [key, allowed.includes(payload.policy?.[key]) ? payload.policy[key] : "validation"]));
      record.instruction = residencePolicyInstruction(record.policy);
    }
    const { data, error } = await db().from("document_ai_rules").update(record).eq("id", id).select("*").single();
    if (error) throw error;
    return map(data);
  }
  const { data, error } = await db().from("document_ai_rules").insert({ ...record, created_by: auth.profile?.id || null }).select("*").single();
  if (error) throw error;
  return map(data);
}

export async function deleteDocumentAiRule(id, auth) {
  assertGeneralAdmin(auth);
  const { error } = await db().from("document_ai_rules").delete().eq("id", id);
  if (error) throw error;
  return true;
}

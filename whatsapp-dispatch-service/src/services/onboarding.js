import * as instancesRepo from "../repositories/instances.js";
import * as operations from "../repositories/operations.js";
import * as compliance from "../repositories/compliance.js";
import { sanitizeText } from "../utils/logger.js";
import { backoffDelay } from "../utils/time.js";

// Configuração automática do perfil, depois da conexão confirmada.
// Cada campo é uma etapa persistida em onboarding_runs.steps: pending → applied → confirmed (lido de volta no provedor)
// | failed | unsupported (limitação registrada). Etapa confirmada nunca é refeita numa retentativa.
// "completed" só quando TODAS as etapas obrigatórias estão confirmadas; com etapa obrigatória sem suporte do provedor
// o resultado é "completed_with_limitations" (nunca sucesso fictício).

const FIELD_STEPS = ["about", "description", "address", "email", "vertical", "websites"];
export const MAX_ONBOARDING_ATTEMPTS = 5;

export const LIMITATIONS = {
  display_name: "Nome comercial não é alterável pela Cloud API: é definido no registro do número e alterado no WhatsApp Manager com revisão da Meta. A API só lê verified_name/name_status.",
  unsupported_provider: "O provedor desta instância não expõe configuração de perfil."
};

// profile_config: { display_name, about, description, address, email, vertical, instagram_url, websites[], photo_url, required[] }
export function desiredProfile(cfg = {}) {
  const websites = [cfg.instagram_url, ...(Array.isArray(cfg.websites) ? cfg.websites : [])].filter(Boolean);
  const profile = {
    display_name: cfg.display_name || null,
    about: cfg.about || null,
    description: cfg.description || null,
    address: cfg.address || null,
    email: cfg.email || null,
    vertical: cfg.vertical || null,
    websites: websites.length ? [...new Set(websites)].slice(0, 2) : null,
    photo_url: cfg.photo_url || null
  };
  const provided = Object.keys(profile).filter((k) => profile[k] != null);
  const required = Array.isArray(cfg.required) && cfg.required.length ? cfg.required.filter((k) => provided.includes(k)) : provided;
  return { profile, provided, required };
}

export function buildSteps({ provided, required }) {
  return provided.map((key) => ({ key, required: required.includes(key), state: "pending", attempts: 0, response: null, error: null, limitation: null }));
}

export async function startOnboardingIfNeeded(ctx, instanceId, { force = false, actor = "sistema" } = {}) {
  return ctx.db.tx(async (q) => {
    const instance = await instancesRepo.getInstance(q, instanceId, { forUpdate: true });
    if (!instance || instance.connection_state !== "connected") return null;
    if (!force && !["not_started", "failed"].includes(instance.profile_state)) return operations.getRunningOnboarding(q, instanceId);
    if (!force && instance.profile_state === "failed") return null; // falha final: só reinicia por pedido explícito
    const desired = desiredProfile(instance.profile_config);
    const run = await operations.insertOnboarding(q, { instanceId, desiredProfile: desired, steps: buildSteps(desired) });
    await instancesRepo.updateInstance(q, instanceId, { profile_state: "in_progress" });
    await compliance.audit(q, { actor, action: "onboarding.start", entityType: "instance", entityId: instanceId, detail: { run: run.id, steps: desired.provided } });
    return run;
  });
}

// Executa (ou continua) os onboardings em andamento. Chamado pelo agendador.
export async function processOnboardings(ctx) {
  const { rows } = await ctx.db.query(
    `select r.id, r.instance_id, r.attempts, r.updated_at from wa_dispatch.onboarding_runs r
       join wa_dispatch.whatsapp_instances i on i.id = r.instance_id
      where r.status = 'running' and i.connection_state = 'connected' order by r.updated_at limit 10`
  );
  let processed = 0;
  for (const run of rows) {
    const wait = run.attempts ? backoffDelay(run.attempts, ctx.config.RETRY_BASE_DELAY_MS, ctx.config.RETRY_MAX_DELAY_MS, () => 0.5) : 0;
    if (Date.now() - new Date(run.updated_at).getTime() < wait) continue;
    await runOnboarding(ctx, run.id);
    processed += 1;
  }
  return processed;
}

export async function runOnboarding(ctx, runId) {
  const { rows } = await ctx.db.query(`select * from wa_dispatch.onboarding_runs where id = $1`, [runId]);
  const run = rows[0];
  if (!run || run.status !== "running") return run;
  const instance = await instancesRepo.getInstance(ctx.db, run.instance_id);
  const adapter = ctx.adapters.get(instance.provider);
  const profile = run.desired_profile.profile;
  const steps = run.steps.map((s) => ({ ...s }));
  const log = (step, patch) => Object.assign(step, patch, { updated_at: new Date().toISOString() });
  let lastError = null;

  for (const step of steps) {
    if (["confirmed", "unsupported", "failed"].includes(step.state)) continue;
    step.attempts += 1;
    try {
      if (step.key === "display_name") {
        if (!adapter.supports("readDisplayName")) { log(step, { state: "unsupported", limitation: LIMITATIONS.unsupported_provider }); continue; }
        const current = await adapter.readDisplayName(instance);
        if (current.verifiedName && current.verifiedName === profile.display_name) {
          log(step, { state: "confirmed", response: { verified_name: current.verifiedName, name_status: current.nameStatus }, error: null });
        } else {
          log(step, { state: "unsupported", response: { verified_name: current.verifiedName, name_status: current.nameStatus }, limitation: LIMITATIONS.display_name });
        }
        continue;
      }
      if (!adapter.supports("updateProfile")) { log(step, { state: "unsupported", limitation: LIMITATIONS.unsupported_provider }); continue; }
      if (step.key === "photo_url") {
        if (step.state !== "applied") {
          const { handle } = await adapter.uploadProfilePhoto(instance, { url: profile.photo_url });
          await adapter.updateProfile(instance, { profile_picture_handle: handle });
          log(step, { state: "applied", response: { success: true }, error: null });
        }
      } else if (FIELD_STEPS.includes(step.key) && step.state !== "applied") {
        await adapter.updateProfile(instance, { [step.key]: profile[step.key] });
        log(step, { state: "applied", response: { success: true }, error: null });
      }
    } catch (error) {
      lastError = sanitizeText(error?.message, 300);
      const permanent = error?.kind === "permanent" || error?.code === "unsupported_operation";
      log(step, { state: permanent || step.attempts >= MAX_ONBOARDING_ATTEMPTS ? "failed" : step.state, error: lastError });
    }
  }

  // Confirmação: lê o perfil de volta e só marca 'confirmed' o que o provedor devolve igual ao desejado.
  const applied = steps.filter((s) => s.state === "applied");
  if (applied.length) {
    try {
      const current = await adapter.getProfile(instance);
      for (const step of applied) {
        const ok = step.key === "photo_url"
          ? Boolean(current.profile_picture_url)
          : step.key === "websites"
            ? JSON.stringify(current.websites || []) === JSON.stringify(profile.websites)
            : String(current[step.key] ?? "") === String(profile[step.key]);
        if (ok) log(step, { state: "confirmed", error: null });
        else log(step, { state: step.attempts >= MAX_ONBOARDING_ATTEMPTS ? "failed" : "pending", error: "valor lido no provedor difere do desejado" });
      }
    } catch (error) {
      lastError = sanitizeText(error?.message, 300);
    }
  }

  const required = steps.filter((s) => s.required);
  const pendingLeft = steps.some((s) => ["pending", "applied"].includes(s.state));
  let status = "running";
  let profileState = "in_progress";
  if (required.some((s) => s.state === "failed")) { status = "failed"; profileState = "failed"; }
  else if (!pendingLeft && required.every((s) => s.state === "confirmed")) { status = "completed"; profileState = "completed"; }
  else if (!pendingLeft) { status = "completed_with_limitations"; profileState = "completed_with_limitations"; }
  if (!steps.length) lastError = "perfil_sem_dados_configurados_em_profile_config";
  if (!steps.length && status === "completed") { status = "completed_with_limitations"; profileState = "completed_with_limitations"; }

  return ctx.db.tx(async (q) => {
    const updated = await operations.updateOnboarding(q, runId, {
      status, steps, attempts: run.attempts + 1, lastError, finished: status !== "running"
    });
    await instancesRepo.updateInstance(q, instance.id, { profile_state: profileState });
    await compliance.audit(q, { actor: "sistema", action: "onboarding.run", entityType: "instance", entityId: instance.id, detail: {
      run: runId, status, steps: steps.map((s) => ({ key: s.key, state: s.state, error: s.error, limitation: s.limitation }))
    } });
    return updated;
  });
}

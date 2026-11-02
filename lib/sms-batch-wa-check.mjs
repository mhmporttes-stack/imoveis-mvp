// Checagem de WhatsApp do Lote de SMS (dono, 2026-11-02): orquestração SEM rede própria — quem consulta, grava e espera é
// injetado (`deps`), então tudo aqui é testado sem rede (tests/sms-batch-whatsapp.test.mjs). A ligação real (sessão do dono,
// Baileys onWhatsApp via whatsapp-individual-service, tabela sms_batch_wa_checks) está em lib/sms-batch-whatsapp.js.
// NUNCA envia mensagem: só pergunta se o número tem conta. Falha aberta: sem sessão/tabela/serviço, ou erro, o contato NÃO
// é bloqueado (a lista sai como antes) e `ctx.unavailable` explica o porquê para o aviso discreto da tela.
import { WA_CHECK_BUDGET_MS, WA_CHECK_MAX_NULLS, WA_CHECK_MAX_PER_ROUND, waCheckSpacingMs } from "./sms-batch-core.mjs";

export const WA_UNAVAILABLE = Object.freeze({
  NO_SESSION: "sem_sessao", // nenhuma sessão conectada do admin geral/dono
  NO_TABLE: "sem_tabela", // migration sms_batch_wa_checks pendente
  SERVICE: "servico", // serviço fora do ar / erro na consulta
  NO_ANSWER: "sem_resposta" // o WhatsApp não respondeu 2x seguidas
});

export function createWaCheckContext({ session = null, deps = {}, unavailable = "" } = {}) {
  const now = deps.now || Date.now;
  return {
    session,
    deps: { check: deps.check, save: deps.save, sleep: deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))), random: deps.random || Math.random, now },
    unavailable: unavailable || (session ? "" : WA_UNAVAILABLE.NO_SESSION),
    deadline: now() + WA_CHECK_BUDGET_MS,
    max: WA_CHECK_MAX_PER_ROUND,
    checked: 0, // consultas feitas nesta rodada
    nulls: 0,
    exhausted: false, // faltou tempo/teto: há candidatos ainda sem checagem (waPending)
    spentMs: 0 // tempo gasto consultando (a varredura da base não é punida por isso)
  };
}

// Marca a checagem como indisponível (o 1º motivo vale).
export function markWaUnavailable(ctx, reason) {
  if (!ctx.unavailable) ctx.unavailable = reason;
}

// Garante `candidate.hasWhatsapp` (true/false) consultando se preciso. Sem resposta possível: deixa `undefined` (entra no lote).
// Sem tempo/teto: `candidate.waPending = true` (não entra agora; a tela continua na rodada seguinte).
export async function ensureWhatsapp(ctx, candidate) {
  if (candidate.hasWhatsapp !== undefined || ctx.unavailable) return candidate;
  const { deps } = ctx;
  const spacing = ctx.checked > 0 ? waCheckSpacingMs(deps.random()) : 0;
  if (ctx.checked >= ctx.max || deps.now() + spacing >= ctx.deadline) {
    candidate.waPending = true;
    ctx.exhausted = true;
    return candidate;
  }
  const started = deps.now();
  try {
    if (spacing) await deps.sleep(spacing);
    const exists = await deps.check(ctx.session, candidate.phone);
    ctx.checked += 1;
    if (typeof exists !== "boolean") {
      ctx.nulls += 1;
      if (ctx.nulls >= WA_CHECK_MAX_NULLS) markWaUnavailable(ctx, WA_UNAVAILABLE.NO_ANSWER);
      return candidate;
    }
    ctx.nulls = 0;
    candidate.hasWhatsapp = exists;
    try {
      await deps.save(candidate.phone, exists);
    } catch (saveError) {
      // Sem como guardar (tabela ausente): usa a resposta agora, mas para de consultar para não repetir a cada abertura.
      markWaUnavailable(ctx, saveError?.code === "42P01" || saveError?.code === "PGRST205" ? WA_UNAVAILABLE.NO_TABLE : WA_UNAVAILABLE.SERVICE);
      console.warn("Lote de SMS: checagem de WhatsApp não gravada:", saveError?.message || saveError);
    }
  } catch (error) {
    markWaUnavailable(ctx, WA_UNAVAILABLE.SERVICE);
    console.warn("Lote de SMS: consulta de WhatsApp falhou (a lista sai sem filtrar):", error?.message || error);
  } finally {
    ctx.spentMs += deps.now() - started;
  }
  return candidate;
}

// Estado para a tela: ok | checking (há mais a checar, a tela continua sozinha) | limit (teto da rodada) | unavailable.
export function waCheckSummary(ctx) {
  if (ctx.unavailable) return { state: "unavailable", reason: ctx.unavailable, checked: ctx.checked, pending: false };
  if (ctx.exhausted) return { state: ctx.checked >= ctx.max ? "limit" : "checking", reason: "", checked: ctx.checked, pending: true };
  return { state: "ok", reason: "", checked: ctx.checked, pending: false };
}

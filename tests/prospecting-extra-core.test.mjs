import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EXTRA_DISPATCH_LIMIT,
  EXTRA_LOCK_REASON,
  extraDispatchAvailability,
  extraDispatchErrorMessage,
  extraGapMinutes,
  extraSendBlockReason,
  isReservationClaim,
  minutesUntilNextSendAllowed
} from "../lib/prospecting-extra-core.mjs";

// Botão "Disparar" da Prospecção (regra do dono, 2026-10-02).
const ready = { metaUnlocked: true, automationActive: true, sessionConnected: true, cycleCount: 0, openCount: 0, cooldownUntil: null };
const NOW = new Date("2026-10-05T15:00:00Z"); // segunda, 12:00 em São Paulo

test("Meta abaixo de 100% bloqueia com a mensagem pedida", () => {
  const state = extraDispatchAvailability({ ...ready, metaUnlocked: false });
  assert.equal(state.available, false);
  assert.equal(state.reason, EXTRA_LOCK_REASON.META);
  assert.equal(state.message, "Conclua 100% da Meta Diária para liberar novos disparos.");
});

test("Meta 100% sem outra trava: liberado", () => {
  assert.equal(extraDispatchAvailability(ready).available, true);
});

test("contador X/10: 1, 4 e 9 ainda permitem; 10 bloqueia como 'em processamento'", () => {
  for (const count of [1, 4, 9]) {
    const state = extraDispatchAvailability({ ...ready, cycleCount: count, openCount: count });
    assert.equal(state.available, true, String(count));
    assert.equal(state.count, count);
    assert.equal(state.limit, EXTRA_DISPATCH_LIMIT);
  }
  const full = extraDispatchAvailability({ ...ready, cycleCount: 10, openCount: 3 });
  assert.equal(full.available, false);
  assert.equal(full.message, "Limite de disparos em processamento.");
});

test("cooldown: bloqueado com minutos restantes; depois de 1 h libera", () => {
  const cooling = extraDispatchAvailability({ ...ready, cycleCount: 10, openCount: 0, cooldownUntil: new Date(NOW.getTime() + 42 * 60000).toISOString(), now: NOW });
  assert.equal(cooling.available, false);
  assert.equal(cooling.reason, EXTRA_LOCK_REASON.COOLDOWN);
  assert.equal(cooling.message, "Novos disparos disponíveis em 42 min.");
  // O banco devolve o ciclo zerado quando o cooldown acabou.
  assert.equal(extraDispatchAvailability({ ...ready, cycleCount: 0, cooldownUntil: null, now: NOW }).available, true);
});

test("número sem automação ativa ou WhatsApp desconectado não dispara", () => {
  assert.equal(extraDispatchAvailability({ ...ready, automationActive: false }).reason, EXTRA_LOCK_REASON.AUTOMATION);
  assert.equal(extraDispatchAvailability({ ...ready, sessionConnected: false }).reason, EXTRA_LOCK_REASON.WHATSAPP);
});

test("erros do banco viram mensagens curtas (11º recusado, cooldown)", () => {
  assert.equal(extraDispatchErrorMessage("EXTRA_LIMIT_REACHED"), "Limite de disparos em processamento.");
  assert.equal(extraDispatchErrorMessage("EXTRA_COOLDOWN:17"), "Novos disparos disponíveis em 17 min.");
  assert.match(extraDispatchErrorMessage("CONTACT_UNAVAILABLE"), /já foi assumido/);
  assert.equal(extraDispatchErrorMessage("outra coisa"), "");
});

test("cadência: intervalo por item sempre dentro de [mín, máx] e estável", () => {
  for (const seed of ["a", "b", "c", "item-123", "f0e1"]) {
    const gap = extraGapMinutes(seed, 5, 10);
    assert.ok(gap >= 5 && gap <= 10, `${seed}: ${gap}`);
    assert.equal(extraGapMinutes(seed, 5, 10), gap);
  }
});

test("cadência global do número: último envio de QUALQUER fila conta", () => {
  const last = new Date(NOW.getTime() - 3 * 60000).toISOString();
  assert.equal(minutesUntilNextSendAllowed({ lastSendAt: last, now: NOW, gapMinutes: 5 }), 2);
  assert.equal(minutesUntilNextSendAllowed({ lastSendAt: last, now: NOW, gapMinutes: 3 }), 0);
  assert.equal(minutesUntilNextSendAllowed({ lastSendAt: null, now: NOW, gapMinutes: 5 }), 0);
});

test("fila extra pode rodar fora da janela da Meta (07–21h), respeitando pausa e dias úteis", () => {
  const settings = { enabled: true, paused: false, business_days_only: true };
  assert.equal(extraSendBlockReason({ now: new Date("2026-10-05T19:30:00Z"), settings }), null, "16:30, depois da janela da Meta");
  assert.equal(extraSendBlockReason({ now: new Date("2026-10-06T01:00:00Z"), settings }), "fora_do_horario_extra", "22:00");
  assert.equal(extraSendBlockReason({ now: new Date("2026-10-04T15:00:00Z"), settings }), "fim_de_semana", "domingo");
  assert.equal(extraSendBlockReason({ now: new Date("2026-10-03T15:00:00Z"), settings }), null, "sabado");
  assert.equal(extraSendBlockReason({ now: NOW, settings: { ...settings, paused: true } }), "automacao_pausada");
  assert.equal(extraSendBlockReason({ now: NOW, settings: { ...settings, enabled: false } }), "automacao_desligada");
});

test("reserva do Disparar não conta como atividade (só a mensagem enviada)", () => {
  assert.equal(isReservationClaim({ source: "extra_dispatch" }), true);
  assert.equal(isReservationClaim({ source: "daily_goal" }), true);
  assert.equal(isReservationClaim({}), false, "clique manual antigo continua contando");
});

test("motor: Meta Diária e fila extra separadas; retry preserva a origem; um envio por ciclo", () => {
  const auto = readFileSync(new URL("../lib/daily-goal-auto.js", import.meta.url), "utf8");
  assert.match(auto, /!\(round\.origin === "extra_dispatch" && round\.attempt_count === 0\)/, "Meta não reenfileira a 1ª do Disparar");
  assert.match(auto, /\.eq\("broker_id", brokerId\)\.eq\("status", "pending"\)\.eq\("source", "meta"\)\s*\.select\("id"\)/, "reagendar só mexe na fila da Meta");
  assert.equal((auto.match(/source: item\.source \|\| "meta"/g) || []).length, 2, "retries mantêm a fila de origem");
  assert.match(auto, /result\?\.sent \? null : await dispatchExtraForBroker/, "extra só quando a Meta não enviou");
  const sql = readFileSync(new URL("../supabase/migrations/20261002240000_prospecting_extra_dispatch_queue.sql", import.meta.url), "utf8");
  assert.equal((sql.match(/status = 'sending'\) then\s+return null;/g) || []).length, 2, "nunca dois envios simultâneos do mesmo número");
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_CONFIG, FORBIDDEN_LIMIT_CODE, evaluateForbiddenConnectLimit, forbiddenLimitMessage } from "../whatsapp-individual-service/src/reconnect-policy.js";
import { GATE_TIMEOUT_MS, connectCooldownError, createConnectLimitGate } from "../whatsapp-individual-service/src/connect-limit.js";
import { CONNECT_EVENTS_DEFAULT_WINDOW_MS, CONNECT_EVENTS_MAX_WINDOW_MS, CONNECT_EVENT_TYPES, connectEventsWindowMs, toConnectEvent } from "../lib/whatsapp-session-telemetry-core.mjs";

// REGRA OFICIAL (dono, 2026-10-13): depois de um 403 num número (corretor + slot), no máximo 3 tentativas de conectar por
// hora NAQUELE número (manuais e automáticas); a 4ª dentro de 60 min é recusada sem tocar no WhatsApp. A contagem vem da
// telemetria já gravada (whatsapp_session_telemetry), nunca da memória do serviço. Tudo aqui é puro/falso: sem Baileys,
// sem rede, sem banco, sem enviar nada.

const MIN = 60_000;
const T0 = Date.parse("2026-10-09T14:00:00.000Z"); // dia do caso real (número da Bruna Santos)

const iso = (ms) => new Date(ms).toISOString();
const attempt = (at, trigger = "manual") => ({ type: "connect_attempt", statusCode: null, trigger, occurredAt: iso(at) });
// Um 403 gravado pela telemetria: 'disconnected' e 'intervention_required' no mesmo instante.
const forbidden = (at) => [
  { type: "disconnected", statusCode: 403, trigger: null, occurredAt: iso(at) },
  { type: "intervention_required", statusCode: 403, trigger: null, occurredAt: iso(at) }
];
const connected = (at) => ({ type: "connected", statusCode: null, trigger: null, occurredAt: iso(at) });
const dropped = (at, code = 428) => ({ type: "disconnected", statusCode: code, trigger: null, occurredAt: iso(at) });

test("caso real de 09/10: 8 tentativas de conectar em 8 minutos, todas 403 — passam 3, a 4ª em diante é recusada", () => {
  const events = [];
  const results = [];
  for (let i = 0; i < 8; i += 1) {
    const now = T0 + i * MIN;
    const verdict = evaluateForbiddenConnectLimit(events, { now });
    results.push(verdict.blocked);
    if (!verdict.blocked) events.push(attempt(now), ...forbidden(now + 2000)); // tentativa que chegou ao WhatsApp e levou 403
  }
  assert.deepEqual(results, [false, false, false, true, true, true, true, true]);
  const fourth = evaluateForbiddenConnectLimit(events, { now: T0 + 3 * MIN });
  assert.equal(fourth.attempts, 3);
  assert.equal(fourth.limit, 3);
  // a 1ª tentativa sai da janela 60 min depois dela: faltam 57 minutos a partir da 4ª
  assert.equal(fourth.waitMinutes, 57);
  assert.equal(fourth.message, "O WhatsApp recusou esta conexão (403). Para proteger o número, aguarde 57 minutos antes de tentar de novo.");
});

test("mensagem: 'N minutos' no plural e '1 minuto' no singular; nunca menos de 1", () => {
  assert.equal(forbiddenLimitMessage(1), "O WhatsApp recusou esta conexão (403). Para proteger o número, aguarde 1 minuto antes de tentar de novo.");
  assert.match(forbiddenLimitMessage(30), /aguarde 30 minutos antes de tentar de novo\.$/);
  assert.match(forbiddenLimitMessage(0), /aguarde 1 minuto /);
});

test("sem 403 na última hora não há limite: quedas comuns e muitas reconexões automáticas seguem a política de sempre", () => {
  const events = [];
  for (let i = 0; i < 10; i += 1) events.push(attempt(T0 + i * MIN, "auto_reconnect"), dropped(T0 + i * MIN + 1000));
  const verdict = evaluateForbiddenConnectLimit(events, { now: T0 + 11 * MIN });
  assert.equal(verdict.blocked, false);
  assert.equal(verdict.attempts, 0);
  assert.equal(evaluateForbiddenConnectLimit([], { now: T0 }).blocked, false);
  assert.equal(evaluateForbiddenConnectLimit(undefined, { now: T0 }).blocked, false);
});

test("tentativas automáticas e de retomada contam junto com as manuais", () => {
  const events = [attempt(T0, "manual"), ...forbidden(T0 + 1000), attempt(T0 + 10 * MIN, "auto_reconnect"), ...forbidden(T0 + 10 * MIN + 1000), attempt(T0 + 20 * MIN, "resume"), ...forbidden(T0 + 20 * MIN + 1000)];
  const verdict = evaluateForbiddenConnectLimit(events, { now: T0 + 25 * MIN });
  assert.equal(verdict.blocked, true);
  assert.equal(verdict.attempts, 3);
});

test("o reinício 515 (restart) continua a tentativa anterior: não conta como tentativa nova", () => {
  const events = [attempt(T0), attempt(T0 + 1000, "restart"), attempt(T0 + 2000, "restart"), ...forbidden(T0 + 3000)];
  const verdict = evaluateForbiddenConnectLimit(events, { now: T0 + 5 * MIN });
  assert.equal(verdict.attempts, 1);
  assert.equal(verdict.blocked, false);
});

test("a janela é deslizante: 60 min depois da mais antiga, uma nova tentativa volta a ser permitida", () => {
  const events = [];
  for (let i = 0; i < 3; i += 1) events.push(attempt(T0 + i * MIN), ...forbidden(T0 + i * MIN + 2000));
  assert.equal(evaluateForbiddenConnectLimit(events, { now: T0 + 59 * MIN }).blocked, true);
  assert.equal(evaluateForbiddenConnectLimit(events, { now: T0 + 59 * MIN }).waitMinutes, 1);
  assert.equal(evaluateForbiddenConnectLimit(events, { now: T0 + 61 * MIN }).blocked, false);
  // tudo fora da janela: nenhum episódio
  const later = evaluateForbiddenConnectLimit(events, { now: T0 + 3 * 3_600_000 });
  assert.equal(later.blocked, false);
  assert.equal(later.attempts, 0);
});

test("tentar de novo depois de a hora virar abre a janela seguinte: 3 por hora, não 3 para sempre", () => {
  const events = [];
  const decisions = [];
  for (let minute = 0; minute <= 125; minute += 5) {
    const now = T0 + minute * MIN;
    const verdict = evaluateForbiddenConnectLimit(events, { now });
    decisions.push([minute, verdict.blocked]);
    if (!verdict.blocked) events.push(attempt(now), ...forbidden(now + 2000));
  }
  const allowed = decisions.filter(([, blocked]) => !blocked).map(([minute]) => minute);
  assert.deepEqual(allowed, [0, 5, 10, 60, 65, 70, 120, 125].slice(0, allowed.length));
  assert.ok(allowed.length >= 6, "libera de novo depois de 60 min");
  // em nenhuma janela de 60 min passa de 3 tentativas
  for (const start of allowed) {
    assert.ok(allowed.filter((minute) => minute >= start && minute < start + 60).length <= 3, `janela a partir do minuto ${start}`);
  }
});

test("conexão bem-sucedida depois do 403 encerra o episódio: o WhatsApp voltou a aceitar o número", () => {
  const events = [attempt(T0), ...forbidden(T0 + 1000), attempt(T0 + MIN), ...forbidden(T0 + MIN + 1000), attempt(T0 + 2 * MIN), connected(T0 + 2 * MIN + 5000)];
  const verdict = evaluateForbiddenConnectLimit(events, { now: T0 + 10 * MIN });
  assert.equal(verdict.blocked, false);
  assert.equal(verdict.attempts, 0);
  // um 403 NOVO depois da conexão abre outro episódio, sem herdar as tentativas de antes
  const again = evaluateForbiddenConnectLimit([...events, ...forbidden(T0 + 30 * MIN)], { now: T0 + 31 * MIN });
  assert.equal(again.attempts, 0);
  assert.equal(again.blocked, false);
});

test("403 de uma conexão que estava de pé (connected -> 403) não conta a tentativa antiga que a abriu", () => {
  const events = [attempt(T0 - 30 * MIN), connected(T0 - 30 * MIN + 5000), ...forbidden(T0)];
  const verdict = evaluateForbiddenConnectLimit(events, { now: T0 + MIN });
  assert.equal(verdict.attempts, 0);
  assert.equal(verdict.blocked, false);
});

test("queda transitória antes do 403: só a tentativa que levou ao 403 entra na conta", () => {
  const events = [attempt(T0), dropped(T0 + 1000), attempt(T0 + 5000, "auto_reconnect"), dropped(T0 + 6000, 500), attempt(T0 + 15_000, "auto_reconnect"), ...forbidden(T0 + 16_000)];
  assert.equal(evaluateForbiddenConnectLimit(events, { now: T0 + MIN }).attempts, 1);
});

test("só 403 limita: 440 e 411 seguem a política antiga (intervenção sem contagem por hora)", () => {
  const events = [];
  for (let i = 0; i < 5; i += 1) events.push(attempt(T0 + i * MIN), dropped(T0 + i * MIN + 1000, 440));
  assert.equal(evaluateForbiddenConnectLimit(events, { now: T0 + 6 * MIN }).blocked, false);
});

test("telemetria desordenada e com hora inválida: ordena e ignora o que não presta", () => {
  const events = [
    ...forbidden(T0 + 2 * MIN + 1000), attempt(T0 + 2 * MIN),
    { type: "connect_attempt", trigger: "manual", occurredAt: "não é data" },
    ...forbidden(T0 + 1000), attempt(T0),
    ...forbidden(T0 + MIN + 1000), attempt(T0 + MIN),
    { type: "cycle_start", occurredAt: iso(T0) }, null, undefined
  ];
  const verdict = evaluateForbiddenConnectLimit(events, { now: T0 + 3 * MIN });
  assert.equal(verdict.blocked, true);
  assert.equal(verdict.attempts, 3);
  // aceita também hora em milissegundos
  assert.equal(evaluateForbiddenConnectLimit([{ type: "connect_attempt", trigger: "manual", occurredAt: T0 }, { type: "disconnected", statusCode: "403", occurredAt: T0 + 1000 }], { now: T0 + MIN }).attempts, 1);
});

test("mais de 3 tentativas gravadas (reconexões automáticas): libera só quando sobrar menos de 3 na janela", () => {
  const events = [];
  for (let i = 0; i < 5; i += 1) events.push(attempt(T0 + i * MIN, i === 0 ? "manual" : "auto_reconnect"), ...forbidden(T0 + i * MIN + 1000));
  const verdict = evaluateForbiddenConnectLimit(events, { now: T0 + 5 * MIN });
  assert.equal(verdict.attempts, 5);
  // precisa sair a 1ª, 2ª e 3ª da janela: libera quando a 3ª (minuto 2) completa 60 min
  assert.equal(verdict.waitMinutes, 57);
});

test("a regra está fixada em 3 tentativas por 60 minutos", () => {
  assert.equal(DEFAULT_CONFIG.forbiddenAttemptsMax, 3);
  assert.equal(DEFAULT_CONFIG.forbiddenWindowMs, 60 * MIN);
});

// ---- Porta do serviço: busca a telemetria gravada, decide com a regra pura, nunca derruba a conexão por falha de leitura ----

test("porta: grava a fila de telemetria ANTES de ler o histórico e recusa a 4ª tentativa", async () => {
  const calls = [];
  const rows = [];
  for (let i = 0; i < 3; i += 1) rows.push({ event_type: "connect_attempt", status_code: null, trigger: "manual", occurred_at: iso(T0 + i * MIN) }, { event_type: "disconnected", status_code: 403, trigger: null, occurred_at: iso(T0 + i * MIN + 2000) });
  const gate = createConnectLimitGate({
    fetchEvents: async (sessionId, windowMs) => { calls.push(["fetch", sessionId, windowMs]); return rows.map(toConnectEvent); },
    flushTelemetry: async () => { calls.push(["flush"]); },
    now: () => T0 + 3 * MIN,
    log: { warn: () => {} }
  });
  const verdict = await gate.check("sessao-1");
  assert.deepEqual(calls, [["flush"], ["fetch", "sessao-1", 60 * MIN]]);
  assert.equal(verdict.blocked, true);
  assert.equal(verdict.checked, true);
  const error = connectCooldownError(verdict);
  assert.equal(error.code, FORBIDDEN_LIMIT_CODE);
  assert.equal(error.code, "CONNECT_COOLDOWN");
  assert.equal(error.message, verdict.message);
  assert.equal(error.retryAfterMinutes, 57);
});

test("porta: sem 403 na hora deixa passar", async () => {
  const gate = createConnectLimitGate({ fetchEvents: async () => [], now: () => T0, log: { warn: () => {} } });
  assert.deepEqual(await gate.check("sessao-1"), { blocked: false, attempts: 0, limit: 3, checked: true });
});

test("porta: histórico indisponível (CRM antigo, fora do ar, resposta inválida) segue a conexão e AVISA no log", async () => {
  for (const fetchEvents of [async () => null, async () => undefined, async () => ({ ok: true }), async () => { throw new Error("rede caiu"); }]) {
    const warnings = [];
    const gate = createConnectLimitGate({ fetchEvents, now: () => T0, log: { warn: (line) => warnings.push(line) } });
    const verdict = await gate.check("sessao-1");
    assert.deepEqual(verdict, { blocked: false, checked: false });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /NÃO verificado/);
    assert.ok(!/privKey|secret/i.test(warnings[0]));
  }
});

test("porta: leitura que demora além do prazo não trava a conexão", async () => {
  const warnings = [];
  const gate = createConnectLimitGate({ fetchEvents: () => new Promise(() => {}), timeoutMs: 20, log: { warn: (line) => warnings.push(line) } });
  const verdict = await gate.check("sessao-1");
  assert.equal(verdict.blocked, false);
  assert.equal(verdict.checked, false);
  assert.match(warnings[0], /timeout/);
  assert.ok(GATE_TIMEOUT_MS >= 1000 && GATE_TIMEOUT_MS <= 15_000);
});

// ---- CRM: o que o serviço pode ler da telemetria ----

test("CRM: janela pedida fica entre 1 min e 3 h, inválida vira 1 h; só devolve o que a regra usa", () => {
  assert.equal(connectEventsWindowMs(undefined), CONNECT_EVENTS_DEFAULT_WINDOW_MS);
  assert.equal(connectEventsWindowMs("abc"), CONNECT_EVENTS_DEFAULT_WINDOW_MS);
  assert.equal(connectEventsWindowMs(-5), CONNECT_EVENTS_DEFAULT_WINDOW_MS);
  assert.equal(connectEventsWindowMs(3_600_000), 3_600_000);
  assert.equal(connectEventsWindowMs(5), 60_000);
  assert.equal(connectEventsWindowMs(10 * 3_600_000), CONNECT_EVENTS_MAX_WINDOW_MS);
  assert.deepEqual([...CONNECT_EVENT_TYPES].sort(), ["connect_attempt", "connected", "disconnected", "intervention_required"]);
  const mapped = toConnectEvent({ event_type: "disconnected", status_code: 403, trigger: null, occurred_at: "2026-10-09T14:00:02.000Z", user_id: "x", detail: "y", cycle_id: "z" });
  assert.deepEqual(Object.keys(mapped).sort(), ["occurredAt", "statusCode", "trigger", "type"]);
  assert.deepEqual(mapped, { type: "disconnected", statusCode: 403, trigger: null, occurredAt: "2026-10-09T14:00:02.000Z" });
});

// ---- Fiação (travas de código) ----

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("serviço: o limite vale ANTES de derrubar socket ou apagar credenciais, nunca no 515, e a recusa é 429 sem tocar no WhatsApp", () => {
  const sessions = read("whatsapp-individual-service/src/sessions.js");
  const gateAt = sessions.indexOf('if (trigger !== "restart" && !reusesLiveConnection) await enforceForbiddenLimit(');
  const freshAt = sessions.indexOf("if (startingFresh) {");
  const clearAt = sessions.indexOf("await clearSessionCreds(userId);");
  const startAt = sessions.indexOf("entry.connecting = startSocket(");
  assert.ok(gateAt > 0 && freshAt > gateAt && clearAt > gateAt && startAt > gateAt, "o limite precisa vir antes de qualquer efeito");
  // a recusa lança ANTES de startSocket: nenhuma tentativa (connect_attempt) nem socket é criado
  const enforce = sessions.slice(sessions.indexOf("async function enforceForbiddenLimit"), sessions.indexOf("async function startSocket"));
  assert.match(enforce, /throw connectCooldownError\(verdict\)/);
  assert.ok(!/makeWASocket|startSocket\(|sendMessage|requestPairingCode/.test(enforce));
  // automática/retomada: ciclo encerrado e número em "precisa de atenção" (mesmo motivo `forbidden`, sem alerta duplicado)
  assert.match(enforce, /NEEDS_ATTENTION_PREFIX\}forbidden:/);
  assert.match(sessions, /if \(error\?\.code === FORBIDDEN_LIMIT_CODE\) return;/);
  const server = read("whatsapp-individual-service/src/server.js");
  assert.match(server, /error\.code === FORBIDDEN_LIMIT_CODE\) return res\.status\(429\)/);
});

test("CRM: webhook devolve a telemetria recente só com o segredo do serviço; a rota Conectar repassa o 429 e mantém o guard", () => {
  const webhook = read("app/api/webhooks/whatsapp-individual/route.js");
  assert.ok(webhook.indexOf("verifyIndividualServiceSecret(secretHeader)") < webhook.indexOf('payload.type === "connect_events"'));
  assert.match(webhook, /listRecentConnectEvents\(userId, sessionSlot/);
  const route = read("app/api/admin/whatsapp-individual/connect/route.js");
  assert.ok(route.indexOf("requireAdminApi(request)") < route.indexOf("connectIndividualSession("));
  assert.match(route, /error\?\.status === 429\) return NextResponse\.json\(\{ error: error\.message \}, \{ status: 429 \}\)/);
  const lib = read("lib/whatsapp-session-telemetry.js");
  assert.match(lib, /\.eq\("user_id", userId\)\s*\.eq\("session_slot", slot\)/);
  // a tela já mostra data.error no aviso vermelho do modal
  assert.match(read("components/WhatsappIndividualStatus.jsx"), /throw new Error\(data\.error \|\| "Não foi possível conectar\."\)/);
});

test("nenhuma migration nova: a regra usa só colunas e tipos de evento já existentes", () => {
  for (const type of CONNECT_EVENT_TYPES) {
    assert.match(read("supabase/migrations/20261004100000_whatsapp_session_telemetry.sql"), new RegExp(`'${type}'`));
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HENRY_LOCKED_PHRASES,
  HENRY_LOCK_WAITS_MS,
  buildHenryLockNote,
  evaluateHenryLock,
  henryLockFailure,
  henryLockWaitAfter,
  henryLockWaitSeconds,
  isHenryLockCommand,
  isHenryToolLocked,
  isValidHenryPin,
  normalizeIdleMinutes,
  pickHenryLockedPhrase
} from "../lib/henry-lock-core.mjs";
import { hashHenryPin, hashHenryUnlockToken, newHenryUnlockToken, verifyHenryPin } from "../lib/henry-lock-crypto.mjs";
import { HENRY_TOOL_ACCESS } from "../lib/henry-voice-core.mjs";
import { buildHenryDynamicPrompt } from "../lib/henry-voice-persona.mjs";
import { alertPushKind } from "../lib/notification-policy-core.mjs";

// Tela de bloqueio do Henry (REGRA OFICIAL — dono, 2026-10-23; docs/BUSINESS_RULES.md HENRY-LOCK).
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const MIN = 60_000;
const NOW = Date.parse("2026-10-23T15:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

test("senha: 6 dígitos, hash scrypt com salt, verificação certa/errada", () => {
  assert.equal(isValidHenryPin("123456"), true);
  for (const bad of ["12345", "1234567", "12a456", "", null, 123456]) assert.equal(isValidHenryPin(bad), false);
  const stored = hashHenryPin("482913");
  assert.match(stored, /^scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/);
  assert.ok(!stored.includes("482913"), "nunca a senha em claro");
  assert.notEqual(hashHenryPin("482913"), stored, "salt aleatório: hashes diferentes");
  assert.equal(verifyHenryPin("482913", stored), true);
  assert.equal(verifyHenryPin("482914", stored), false);
  assert.equal(verifyHenryPin("48291", stored), false);
  assert.equal(verifyHenryPin("482913", "texto qualquer"), false);
  assert.equal(verifyHenryPin("482913", null), false);
  assert.throws(() => hashHenryPin("12ab56"));
});

test("token do desbloqueio: aleatório, no banco só o SHA-256", () => {
  const a = newHenryUnlockToken();
  const b = newHenryUnlockToken();
  assert.notEqual(a, b);
  assert.match(hashHenryUnlockToken(a), /^[0-9a-f]{64}$/);
  assert.equal(hashHenryUnlockToken(a), hashHenryUnlockToken(a));
  assert.equal(hashHenryUnlockToken(""), "");
  assert.equal(hashHenryUnlockToken("curto"), "");
});

test("esperas crescentes: 5 erros = 1 min, 10 = 5 min, 15 e depois = 15 min", () => {
  assert.deepEqual(HENRY_LOCK_WAITS_MS, [MIN, 5 * MIN, 15 * MIN]);
  for (const n of [0, 1, 2, 3, 4, 6, 9, 11, 14]) assert.equal(henryLockWaitAfter(n), 0, `erro ${n}`);
  assert.equal(henryLockWaitAfter(5), MIN);
  assert.equal(henryLockWaitAfter(10), 5 * MIN);
  assert.equal(henryLockWaitAfter(15), 15 * MIN);
  assert.equal(henryLockWaitAfter(20), 15 * MIN);
  assert.equal(henryLockWaitAfter(50), 15 * MIN);

  // Sequência real: 4 erros sem espera, o 5º abre 1 min e avisa o dono.
  let row = { failed_attempts: 0 };
  for (let i = 1; i <= 4; i += 1) {
    const next = henryLockFailure(row, NOW);
    assert.equal(next.notify, false);
    assert.equal(next.locked_until, null);
    assert.equal(next.attemptsLeft, 5 - i);
    row = { failed_attempts: next.failed_attempts };
  }
  const fifth = henryLockFailure(row, NOW);
  assert.equal(fifth.failed_attempts, 5);
  assert.equal(fifth.notify, true);
  assert.equal(fifth.locked_until, iso(NOW + MIN));
  assert.equal(henryLockWaitSeconds({ locked_until: fifth.locked_until }, NOW), 60);
  assert.equal(henryLockWaitSeconds({ locked_until: fifth.locked_until }, NOW + MIN + 1), 0);
  assert.equal(henryLockFailure({ failed_attempts: 9 }, NOW).locked_until, iso(NOW + 5 * MIN));
  assert.equal(henryLockFailure({ failed_attempts: 14 }, NOW).locked_until, iso(NOW + 15 * MIN));
});

test("estado: bloqueio só MANUAL (dono, 2026-10-24) — abrir a tela cheia, outro aparelho e inatividade não travam", () => {
  const token = hashHenryUnlockToken(newHenryUnlockToken());
  const base = { pin_hash: "scrypt$x", idle_minutes: 10, locked_at: null, fullscreen: true, unlock_token_hash: token, last_activity_at: iso(NOW - 2 * MIN) };

  assert.deepEqual(evaluateHenryLock(null, { now: NOW }), { configured: false, locked: false, reason: "no_pin", expire: false });
  assert.equal(evaluateHenryLock({ ...base, pin_hash: null }, { now: NOW, clientLocked: true }).locked, false);

  // Travado pelo cadeado (locked_at): continua travado em qualquer aparelho e depois de recarregar, até a senha.
  assert.deepEqual(evaluateHenryLock({ ...base, locked_at: iso(NOW) }, { tokenHash: token, now: NOW }), { configured: true, locked: true, reason: "locked", expire: false });
  assert.equal(evaluateHenryLock({ ...base, locked_at: iso(NOW) }, { tokenHash: "", now: NOW }).locked, true);
  assert.equal(evaluateHenryLock(base, { tokenHash: token, now: NOW, clientLocked: true }).locked, true, "a tela bloqueada só restringe");

  // Sem locked_at: liberado — tela cheia aberta em outro aparelho (sem cookie) e muito tempo sem interação NÃO travam.
  assert.equal(evaluateHenryLock(base, { tokenHash: token, now: NOW }).locked, false);
  assert.equal(evaluateHenryLock(base, { tokenHash: "", now: NOW }).locked, false);
  assert.equal(evaluateHenryLock(base, { tokenHash: "f".repeat(64), now: NOW }).locked, false);
  const idle = evaluateHenryLock({ ...base, last_activity_at: iso(NOW - 600 * MIN) }, { tokenHash: token, now: NOW });
  assert.deepEqual(idle, { configured: true, locked: false, reason: "unlocked", expire: false });
  assert.equal(evaluateHenryLock({ ...base, last_activity_at: null }, { now: NOW }).expire, false);
  assert.equal(evaluateHenryLock({ ...base, fullscreen: false, unlock_token_hash: null }, { now: NOW }).locked, false);
});

test("tela: abrir a tela cheia não bloqueia, sem trava por inatividade; cadeado na barra de ícones", () => {
  const screen = read("../components/henry/HenryVoiceAssistant.jsx");
  assert.ok(!/expanded && !was && !lockRef\.current\.locked\) engageLock\(\)/.test(screen), "abrir a tela cheia não chama engageLock");
  assert.ok(!/lock\.idleMinutes \* 60_000/.test(screen), "sem temporizador de inatividade");
  assert.match(screen, /onLock=\{lock\.configured && !lock\.locked \? engageLock : undefined\}/);
  const view = read("../components/henry/HenryVoiceView.jsx");
  assert.match(view, /\{onLock && !locked \? \(\n\s+<RoundButton onClick=\{onLock\} label="Bloquear a tela do Henry" dark>/);
  const server = read("../lib/henry-lock.js");
  assert.ok(!/bloqueado por inatividade/.test(server), "o servidor não grava trava sozinho");
});

test("tempo sem interação: só as opções do cartão; padrão 10 min", () => {
  assert.equal(normalizeIdleMinutes(undefined), 10);
  assert.equal(normalizeIdleMinutes(5), 5);
  assert.equal(normalizeIdleMinutes("30"), 30);
  assert.equal(normalizeIdleMinutes(7), 10);
  assert.equal(normalizeIdleMinutes(-1), 10);
});

test("ferramentas: bloqueado fecha TODAS as que leem o CRM e as que abrem tela; música continua", () => {
  for (const [name, access] of Object.entries(HENRY_TOOL_ACCESS)) {
    if (access === "leitura" || access === "navegacao" || access === "escrita_interna_confirmada" || access === "escrita_interna_direta") assert.equal(isHenryToolLocked(access), true, name);
    else assert.equal(isHenryToolLocked(access), false, name);
  }
  for (const name of ["buscar_clientes", "conversas_aguardando", "financeiro_resumo", "presenca_hoje", "consultar_crm", "relatorio_do_dia", "abrir_cliente", "abrir_tela"]) {
    assert.equal(isHenryToolLocked(HENRY_TOOL_ACCESS[name]), true, name);
  }
  assert.equal(isHenryToolLocked(HENRY_TOOL_ACCESS.spotify), false);
  assert.equal(isHenryToolLocked(undefined), false); // a lib trata ferramenta sem classe como "leitura" (ver abaixo)

  const lib = read("../lib/henry-voice.js");
  // 1ª trava: o modelo bloqueado nem recebe as ferramentas do CRM.
  assert.match(lib, /function henryToolsFor\(\{ webSearch = false, locked = false \} = \{\}\) \{\n\s+const base = locked \? TOOLS\.filter\(\(tool\) => !isHenryToolLocked\(HENRY_TOOL_ACCESS\[tool\.name\] \|\| "leitura"\)\) : TOOLS;/);
  assert.match(lib, /tools: henryToolsFor\(\{ webSearch, locked: Boolean\(lockNote\) \}\)/);
  // 2ª trava: runTool recusa antes de qualquer leitura (primeira coisa da função).
  const runTool = lib.slice(lib.indexOf("async function runTool("));
  const gate = runTool.indexOf("if (context.locked && isHenryToolLocked(HENRY_TOOL_ACCESS[name] || \"leitura\"))");
  assert.ok(gate > 0 && gate < runTool.indexOf("try {"), "trava antes do try e das leituras");
  // Relatório do dia, aniversário, memória do dia e lembretes: nada com a tela bloqueada.
  assert.match(lib, /async function composeReportAnswer\([^)]*locked = false[^)]*\) \{\n\s+\/\/[^\n]*\n\s+if \(locked\) \{/);
  assert.match(lib, /if \(locked && answer !== "no"\) return \{ reply: pick\("locked", HENRY_LOCKED_PHRASES\)/);
  assert.match(lib, /const memoryTurns = locked \? \[\] : storedTurns;/);
  assert.match(lib, /const notes = locked \? \[\] : storedNotes;/);
  assert.match(lib, /lockNote: locked \? buildHenryLockNote\(lockedPhrase\) : ""/);
});

test("rotas: estado do bloqueio conferido no servidor antes de responder", () => {
  const route = read("../app/api/admin/henry/route.js");
  assert.match(route, /resolveHenryLock\(auth, \{ tokenHash: henryLockTokenHash\(request\), clientLocked: body\?\.locked === true, touch: true \}\)/);
  assert.match(route, /answerStream\(auth, \{[^}]*locked, lockCommand, lockFields \}, style\)/);
  assert.match(route, /answerHenry\(auth, \{[^}]*locked, lockCommand \}\)/);
  assert.match(route, /dayTurns: enabled && !lock\.locked \? dayTurns : \[\]/);
  // Avisos de cliente/chegada: bloqueado segura a consulta (hold) e recusa falar a informação.
  assert.match(route, /hold: true, locked: true, events: \[\]/);
  assert.match(route, /status: 423/);

  const lockRoute = read("../app/api/admin/henry/lock/route.js");
  assert.match(lockRoute, /import \{ requireHenryOwner \} from "@\/lib\/henry-auth";/);
  for (const method of ["GET", "POST"]) {
    const body = lockRoute.slice(lockRoute.indexOf(`export async function ${method}`));
    assert.match(body.split("\n").slice(0, 3).join("\n"), /requireHenryOwner\(request\)/, method);
  }
  assert.match(lockRoute, /checkPublicRateLimit\(`henry-pin:\$\{auth\.profile\?\.id\}`, \{ windowSeconds: 60, maxAttempts: 10, failClosed: true \}\)/);
  assert.ok(!/console\.[a-z]+\([^)]*pin/i.test(lockRoute), "a senha nunca vai para log");

  const server = read("../lib/henry-lock.js");
  assert.match(server, /^import "server-only";/);
  assert.ok(!/console\.[a-z]+\([^)]*\bpin\b/.test(server), "a senha nunca vai para log");
  assert.match(server, /httpOnly: true/);
  assert.match(server, /push_kind: NOTIFICATION_KIND\.HENRY_LOCKOUT/);
  assert.equal(alertPushKind({ push_kind: "henry_lockout" }), "henry_lockout");
});

test("migration: tabela com RLS e sem acesso de anon/authenticated", () => {
  const sql = read("../supabase/migrations/20261023233000_henry_lock.sql");
  assert.match(sql, /create table if not exists public\.henry_lock/);
  assert.match(sql, /alter table public\.henry_lock enable row level security;/);
  assert.match(sql, /revoke all on table public\.henry_lock from anon, authenticated;/);
  assert.ok(!/create policy/i.test(sql));
});

test("'Henry, bloqueia' e frases do pede a senha", () => {
  for (const text of ["Henry, bloqueia", "bloqueia a tela", "Henry trava a tela", "ok Henry, bloquear", "pode bloquear Henry", "trava o Henry"]) assert.equal(isHenryLockCommand(text), true, text);
  for (const text of ["quantos clientes bloqueados?", "bloqueia o cliente João", "Henry, quem travou a meta?", "", "tá travando a tela?"]) assert.equal(isHenryLockCommand(text), false, text);

  assert.ok(HENRY_LOCKED_PHRASES.length >= 6);
  for (const phrase of HENRY_LOCKED_PHRASES) assert.match(phrase, /senha|desbloque|travad|bloquead/i);
  const first = pickHenryLockedPhrase([], () => 0);
  const second = pickHenryLockedPhrase([first], () => 0);
  assert.notEqual(first, second, "varia a frase");

  const prompt = buildHenryDynamicPrompt({ todayKey: "2026-10-23", lockNote: buildHenryLockNote("Pra isso preciso da senha.") });
  assert.match(prompt, /TELA BLOQUEADA AGORA/);
  assert.match(prompt, /NÃO fala NENHUM dado do CRM/);
  assert.ok(!/TELA BLOQUEADA/.test(buildHenryDynamicPrompt({ todayKey: "2026-10-23" })));
});

test("'Henry, bloqueia' falado chega ao servidor como pedido e aciona o bloqueio (não vai ao modelo)", async () => {
  const { detectWakeWord } = await import("../lib/henry-voice-core.mjs");
  const { classifyArmedUtterance, classifyOpenSceneUtterance, classifyTapUtterance, isConversationEnd } = await import("../lib/henry-voice-conversation.mjs");
  for (const spoken of ["Henry, bloqueia", "Henry bloqueia a tela", "ei Henry, trava a tela"]) {
    const wake = detectWakeWord(spoken);
    assert.equal(wake.called, true, spoken);
    assert.equal(isHenryLockCommand(wake.question), true, spoken);
    for (const classify of [classifyArmedUtterance, classifyOpenSceneUtterance, classifyTapUtterance]) assert.equal(classify(spoken, {}).kind, "question", `${classify.name}: ${spoken}`);
    assert.equal(isConversationEnd(wake.question), false);
  }
  // Na rota, o comando é resolvido ANTES do modelo: bloqueia no servidor e a resposta leva `lock: true` (a tela abre bloqueada).
  const route = read("../app/api/admin/henry/route.js");
  const command = route.indexOf("isHenryLockCommand(question)) {");
  assert.ok(command > 0 && command < route.indexOf("return answerStream(auth"));
  assert.match(route, /await engageHenryLock\(auth\);/);
  assert.match(route, /lockNow \? "done"/);
  const lib = read("../lib/henry-voice.js");
  assert.match(lib, /if \(lockCommand\) \{\n\s+const reply = lockCommand === "done" \? pick\("lockDone", HENRY_LOCK_DONE_PHRASES\)/);
  const screen = read("../components/henry/HenryVoiceAssistant.jsx");
  assert.match(screen, /if \(message\?\.lock === true\) \{\n\s+lockLocally\(true\);\n\s+setExpanded\(true\);/);
});

test("Pulso do CRM fica fora da trava (dono, 2026-10-23), mas o card não tira da tela bloqueada", () => {
  const pulse = read("../app/api/admin/henry/pulse/route.js");
  assert.ok(!/resolveHenryLock/.test(pulse), "o Pulso mostra dados reais mesmo bloqueado");
  const screen = read("../components/henry/HenryVoiceAssistant.jsx");
  assert.match(screen, /if \(!shouldMinimizeForNavigation\(navigate\) \|\| lockRef\.current\.locked\) return;/);
});

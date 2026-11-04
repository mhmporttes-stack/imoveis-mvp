import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// "Carregar mais N" (dono, 2026-11-04): o servidor aceita de 1 a 200 por toque (padrão 50); a tela oferece 50/100/150/200.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("servidor: quantidade validada (1 a 200, padrão 50) e usada no extra do dia", () => {
  const source = read("lib/sms-batch.js");
  assert.match(source, /export function normalizeMoreAmount/);
  assert.match(source, /const next = extra \+ \(scope === "broker"/);
  const route = read("app/api/admin/lote-sms/route.js");
  assert.match(route, /addSmsExtraBatch\(auth, body\.amount\)/);
});

test("tela: opções 50, 100, 150 e 200 e o botão mostra a quantidade escolhida", () => {
  const ui = read("components/SmsBatchWorkspace.jsx");
  assert.match(ui, /MORE_AMOUNTS = \[50, 100, 150, 200\]/);
  assert.match(ui, /amount: \["team", "manager"\]\.includes\(data\?\.scope\) \? moreAmount : 50/);
  assert.ok(!ui.includes("Carregar mais 50 contatos"));
});

test("vagas de hoje: limite base + extra do dia − enviados (carregar 200 devolve 200 vagas)", async () => {
  const { smsRoomToday } = await import("../lib/sms-batch-core.mjs");
  assert.equal(smsRoomToday(50, 0, 0), 50);
  assert.equal(smsRoomToday(50, 0, 50), 0);
  // 100 enviados, extra 100 (carregou 50 + 50), base 50: acabou; carrega 200 -> 200 vagas (antes ficavam só 50).
  assert.equal(smsRoomToday(50, 100, 150), 0);
  assert.equal(smsRoomToday(50, 300, 150), 200);
  assert.equal(smsRoomToday(50, 150, 150), 50);
  assert.equal(smsRoomToday(undefined, undefined, undefined), 0);
});

test("corretor só carrega de 50 em 50 e não vê a escolha; equipe/gestor escolhem", () => {
  const source = read("lib/sms-batch.js");
  assert.match(source, /scope === "broker" \? MORE_STEP : normalizeMoreAmount\(amount\)/);
  const ui = read("components/SmsBatchWorkspace.jsx");
  assert.match(ui, /isTeam \|\| isManager \? <MoreAmountPicker/);
});

test("avisos duplicados do mesmo envio: a linha repetida se apaga sozinha (1ª e 2ª)", () => {
  const source = read("lib/sms-batch.js");
  assert.match(source, /async function keepFirstSendOnly/);
  assert.match(source, /keepFirstSendOnly\(\{ phones: phoneLookupCandidates\(row\.phone_normalized\), event: SMS_EVENT\.FIRST/);
  assert.match(source, /keepFirstSendOnly\(\{ phones: phoneLookupCandidates\(first\.phone_normalized\), event: SMS_EVENT\.SECOND/);
  // só apaga a própria linha recém-criada
  assert.match(source, /\.delete\(\)\.eq\("id", ownId\)/);
});

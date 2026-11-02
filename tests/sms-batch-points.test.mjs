import test from "node:test";
import assert from "node:assert/strict";
import { SMS_POINTS_EVENTS, smsScoringEvents } from "../lib/sms-batch-points-core.mjs";

// PRO-18d (dono, 2026-11-02): cada SMS (1ª e 2ª) enviado no lote DO CORRETOR pontua como uma tentativa de prospecção;
// o lote da equipe não pontua; um envio = uma pontuação; inválido/inativo e desfazer não geram pontos a mais.
const BROKER_CAMPAIGN = "camp-broker";
const TEAM_CAMPAIGN = "camp-team";
const campaigns = [{ id: BROKER_CAMPAIGN, broker_id: "b1" }, { id: TEAM_CAMPAIGN, broker_id: null }];
const send = (id, event, phone, at, campaign = BROKER_CAMPAIGN) => ({ id, event, phone_normalized: phone, created_at: at, campaign_id: campaign });

test("1ª e 2ª mensagem do corretor pontuam, cada uma uma vez, para o dono da campanha", () => {
  const events = smsScoringEvents({
    sends: [send("1", "sent", "5514999990001", "2026-11-02T13:00:00Z"), send("2", "sent_2", "5514999990001", "2026-11-02T13:05:00Z")],
    campaigns
  });
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => [e.brokerId, e.event]), [["b1", SMS_POINTS_EVENTS.FIRST], ["b1", SMS_POINTS_EVENTS.SECOND]]);
  assert.match(events[0].label, /1ª mensagem/);
  assert.match(events[1].label, /2ª mensagem/);
});

test("lote da equipe (campanha sem corretor) não pontua ninguém", () => {
  assert.deepEqual(smsScoringEvents({ sends: [send("1", "sent", "5514999990001", "2026-11-02T13:00:00Z", TEAM_CAMPAIGN)], campaigns }), []);
});

test("idempotente: a mesma linha lida duas vezes ou gravada em duplicata conta uma pontuação só", () => {
  const row = send("1", "sent", "5514999990001", "2026-11-02T13:00:00Z");
  const duplicate = send("9", "sent", "14999990001", "2026-11-02T13:00:02Z");
  const once = smsScoringEvents({ sends: [row], campaigns });
  assert.equal(smsScoringEvents({ sends: [row, row], campaigns }).length, 1);
  assert.equal(smsScoringEvents({ sends: [row, duplicate], campaigns }).length, 1);
  assert.deepEqual(smsScoringEvents({ sends: [row], campaigns }), once);
  assert.equal(smsScoringEvents({ sends: [row, duplicate], campaigns })[0].sendId, "1");
});

test("número inválido/inativo tira o envio da pontuação (nunca soma a mais)", () => {
  const base = [send("1", "sent", "5514999990001", "2026-11-02T13:00:00Z"), send("2", "sent_2", "5514999990001", "2026-11-02T13:05:00Z"), send("3", "sent", "5514999990002", "2026-11-02T13:10:00Z")];
  assert.equal(smsScoringEvents({ sends: base, campaigns }).length, 3);
  const withInvalid = smsScoringEvents({ sends: [...base, send("4", "invalid", "5514999990001", "2026-11-02T14:00:00Z")], campaigns });
  assert.deepEqual(withInvalid.map((e) => e.sendId), ["3"]);
  const withInactive = smsScoringEvents({ sends: [...base, send("5", "inactive", "5514999990002", "2026-11-03T14:00:00Z")], campaigns });
  assert.deepEqual(withInactive.map((e) => e.sendId), ["1", "2"]);
});

test("opt_out (SAIR) não é envio e não pontua nem tira pontos; evento desconhecido e data inválida são ignorados", () => {
  const events = smsScoringEvents({
    sends: [send("1", "sent", "5514999990001", "2026-11-02T13:00:00Z"), send("2", "opt_out", "5514999990001", "2026-11-02T14:00:00Z"), send("3", "outro", "5514999990003", "2026-11-02T14:00:00Z"), send("4", "sent", "5514999990004", "nao-e-data")],
    campaigns
  });
  assert.deepEqual(events.map((e) => e.sendId), ["1"]);
});

test("desfazer (linha apagada) some da pontuação; corretores diferentes pontuam cada um o seu", () => {
  const two = [...campaigns, { id: "camp-b2", broker_id: "b2" }];
  const events = smsScoringEvents({ sends: [send("1", "sent", "5514999990001", "2026-11-02T13:00:00Z"), send("2", "sent", "5514999990002", "2026-11-02T13:01:00Z", "camp-b2")], campaigns: two });
  assert.deepEqual(events.map((e) => e.brokerId), ["b1", "b2"]);
  assert.equal(smsScoringEvents({ sends: [send("2", "sent", "5514999990002", "2026-11-02T13:01:00Z", "camp-b2")], campaigns: two }).length, 1);
});

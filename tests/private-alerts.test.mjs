import test from "node:test";
import assert from "node:assert/strict";
import { ALERT_AUDIENCE, canViewDelivery, onlyOwnRows, resolveAudienceRecipients, splitPendingAlerts } from "../lib/crm-alerts-core.mjs";
import { onlyRecipientRows } from "../lib/supervision-messages-core.mjs";

// Banco simulado: equipe da gestora M1 (A, B), outra equipe da gestora M2 (C), admin geral G.
const users = [
  { id: "G", role: "admin", status: "active", manager_id: null },
  { id: "M1", role: "manager", status: "active", manager_id: null },
  { id: "M2", role: "manager", status: "active", manager_id: null },
  { id: "A", role: "broker", status: "active", manager_id: "M1" },
  { id: "B", role: "broker", status: "active", manager_id: "M1" },
  { id: "C", role: "broker", status: "active", manager_id: "M2" },
  { id: "D", role: "broker", status: "active", manager_id: "M2" },
  { id: "AS", role: "associate", status: "active", manager_id: null, linked_broker_id: "A" },
  { id: "X", role: "broker", status: "inactive", manager_id: "M1" }
];

let seq = 0;
function makeDb() {
  const rows = [];
  return {
    rows,
    // Entrega: uma linha por destinatário, como createAlertDeliveries grava.
    deliver(recipientIds, kind = "important") {
      for (const recipient_id of recipientIds) rows.push({ id: `r${++seq}`, recipient_id, kind, title: "t", body: "b", created_at: new Date().toISOString(), acknowledged_at: null, shown_at: null });
    },
    // Consulta da API: .eq("recipient_id", me) + defesa onlyOwnRows.
    listFor(viewerId) {
      const queried = rows.filter((row) => row.recipient_id === viewerId);
      return splitPendingAlerts(onlyOwnRows(queried, viewerId));
    },
    // Consulta que ESQUECEU o filtro: a defesa em profundidade ainda barra.
    listWithoutQueryFilter(viewerId) {
      return splitPendingAlerts(onlyOwnRows(rows, viewerId));
    }
  };
}

const ids = (list) => list.map((row) => row.id);

test("A envia para B: B recebe; C, D, gestora, admin e associado NÃO recebem", () => {
  const db = makeDb();
  db.deliver(resolveAudienceRecipients({ type: ALERT_AUDIENCE.USER, ids: ["B"] }, users));
  assert.equal(db.listFor("B").important.length, 1);
  for (const other of ["A", "C", "D", "M1", "M2", "G", "AS"]) {
    assert.equal(db.listFor(other).important.length, 0, `${other} não deveria receber`);
    assert.equal(db.listWithoutQueryFilter(other).important.length, 0, `${other} (sem filtro na query) não deveria receber`);
  }
});

test("audiência user nunca expande por hierarquia nem inclui inativo", () => {
  assert.deepEqual(resolveAudienceRecipients({ type: "user", ids: ["A"] }, users), ["A"]);
  assert.deepEqual(resolveAudienceRecipients({ type: "user", ids: ["X"] }, users), []);
  assert.deepEqual(resolveAudienceRecipients({ type: "user", ids: [] }, users), []);
  assert.deepEqual(resolveAudienceRecipients({ type: "user" }, users), []);
});

test("gestora NÃO vê alerta privado da corretora da própria equipe; admin geral também não", () => {
  const db = makeDb();
  db.deliver(["A"]);
  assert.equal(db.listFor("M1").important.length, 0);
  assert.equal(db.listFor("G").important.length, 0);
  assert.equal(canViewDelivery("M1", db.rows[0]), false);
  assert.equal(canViewDelivery("G", db.rows[0]), false);
  assert.equal(canViewDelivery("A", db.rows[0]), true);
});

test("usuário sem identidade (sem sessão/consulta direta) não recebe nada", () => {
  const db = makeDb();
  db.deliver(["A", "B"]);
  assert.deepEqual(onlyOwnRows(db.rows, ""), []);
  assert.deepEqual(onlyOwnRows(db.rows, undefined), []);
  assert.equal(canViewDelivery("", db.rows[0]), false);
});

test("alerta GLOBAL continua indo para todos os ativos (e só os ativos)", () => {
  const got = resolveAudienceRecipients({ type: "global" }, users);
  assert.deepEqual(new Set(got), new Set(["G", "M1", "M2", "A", "B", "C", "D", "AS"]));
  assert.deepEqual(resolveAudienceRecipients({ type: "all" }, users).sort(), got.slice().sort());
  const db = makeDb();
  db.deliver(got);
  for (const id of got) assert.equal(db.listFor(id).important.length, 1);
  assert.equal(db.listFor("X").important.length, 0);
});

test("alerta de EQUIPE: membro e gestor veem; outra equipe não; admin não por ser admin", () => {
  const team1 = resolveAudienceRecipients({ type: "team", managerId: "M1" }, users);
  assert.deepEqual(new Set(team1), new Set(["M1", "A", "B", "AS"]));
  const db = makeDb();
  db.deliver(team1);
  for (const member of ["M1", "A", "B", "AS"]) assert.equal(db.listFor(member).important.length, 1);
  for (const outsider of ["M2", "C", "D", "G", "X"]) assert.equal(db.listFor(outsider).important.length, 0);
  assert.deepEqual(resolveAudienceRecipients({ type: "team" }, users), []);
});

test("audiência por perfil e 'system' (detector escolhe o destinatário)", () => {
  assert.deepEqual(new Set(resolveAudienceRecipients({ type: "role", roles: ["manager"] }, users)), new Set(["M1", "M2"]));
  assert.deepEqual(resolveAudienceRecipients({ type: "system" }, users), []);
  assert.deepEqual(resolveAudienceRecipients(undefined, users), []);
});

test("mensagem de supervisão pendente: só o destinatário", () => {
  const rows = [
    { id: "m1", recipient_id: "A", sender_id: "M1" },
    { id: "m2", recipient_id: "B", sender_id: "M1" }
  ];
  assert.deepEqual(ids(onlyRecipientRows(rows, "A")), ["m1"]);
  assert.deepEqual(ids(onlyRecipientRows(rows, "M1")), []);
  assert.deepEqual(ids(onlyRecipientRows(rows, "G")), []);
  assert.deepEqual(onlyRecipientRows(rows, ""), []);
});

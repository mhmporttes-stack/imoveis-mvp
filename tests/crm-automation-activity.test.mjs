// Aviso de atividade agendada: um por atividade, nunca a cada edição/mudança de etapa do cliente (regra do dono 2026-10-06).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { activityAnchor, activityEventKey, isActivityStillPending, isActivityTrigger } from "../lib/crm-automation-activity.mjs";

const scheduled = "2026-10-13T20:20:00.000Z";

test("chave NÃO muda com edição do cliente nem com a etapa: mesma atividade = um aviso só", () => {
  const keys = [
    { updated_at: "2026-10-06T12:10:11.515Z", status: "simulation_sent" },
    { updated_at: "2026-10-06T14:15:09.559Z", status: "in_service" },
    { updated_at: "2026-10-07T09:00:00.000Z", status: "archived" }
  ].map((edit) => activityEventKey("activity_created", { scheduled_activity_at: scheduled, ...edit }));
  assert.equal(new Set(keys).size, 1);
  assert.equal(keys[0], `activity_created@${scheduled}`);
  // reagendar = atividade nova = aviso novo
  assert.notEqual(activityEventKey("activity_created", { scheduled_activity_at: "2026-10-14T12:00:00.000Z" }), keys[0]);
  assert.equal(activityEventKey("activity_created", {}), null);
});

test("'Antes da atividade' conta da data/hora agendada, não da última edição do cliente", () => {
  const client = { scheduled_activity_at: scheduled, updated_at: "2026-10-06T12:00:00.000Z" };
  assert.equal(activityAnchor("activity_created", "before_activity", client).toISOString(), scheduled);
  assert.equal(activityAnchor("activity_created", "after", client).toISOString(), client.updated_at);
  assert.equal(activityAnchor("activity_upcoming", "before_activity", client).toISOString(), scheduled);
  assert.equal(activityAnchor("activity_completed", "after", { scheduled_activity_completed_at: scheduled }).toISOString(), scheduled);
});

test("'Atividade agendada' nunca avisa atividade que já passou ou foi concluída", () => {
  const now = Date.parse("2026-10-06T17:00:00.000Z");
  assert.equal(isActivityStillPending("activity_created", { scheduled_activity_at: "2026-09-28T12:30:00.000Z" }, now), false);
  assert.equal(isActivityStillPending("activity_created", { scheduled_activity_at: scheduled, scheduled_activity_completed_at: "2026-10-06T10:00:00Z" }, now), false);
  assert.equal(isActivityStillPending("activity_created", { scheduled_activity_at: scheduled }, now), true);
  assert.equal(isActivityStillPending("activity_created", {}, now), false);
  assert.equal(isActivityStillPending("activity_overdue", { scheduled_activity_at: "2026-09-28T12:30:00.000Z" }, now), true, "vencida segue com o próprio gatilho");
});

test("motor de automações usa a chave por atividade", () => {
  assert.equal(isActivityTrigger("activity_created"), true);
  assert.equal(isActivityTrigger("status_changed"), false);
  const lib = fs.readFileSync(path.resolve(import.meta.dirname, "../lib/crm-automations.js"), "utf8");
  assert.match(lib, /activityRule \? activityEventKey\(rule\.triggerType, client\)/);
  assert.match(lib, /activityRule && !isActivityStillPending\(rule\.triggerType, client\)/);
});

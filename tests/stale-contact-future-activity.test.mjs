// "Sem contato há +3 dias" nunca aparece para cliente com atividade futura agendada (regra do dono, 2026-10-08).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isStaleContactClient } from "../lib/client-status.js";

const now = Date.parse("2026-10-08T18:00:00Z");
const old = "2026-10-05T12:00:00Z";

test("atividade futura pendente tira o alerta; passada, concluída ou ausente não", () => {
  const base = { status: "simulation_sent", lastWhatsappContactAt: old };
  assert.equal(isStaleContactClient(base, now), true);
  assert.equal(isStaleContactClient({ ...base, scheduledActivityAt: "2026-10-13T20:20:00Z" }, now), false);
  assert.equal(isStaleContactClient({ ...base, scheduledActivityAt: "2026-10-07T20:20:00Z" }, now), true, "atividade atrasada não protege");
  assert.equal(isStaleContactClient({ ...base, scheduledActivityAt: "2026-10-13T20:20:00Z", scheduledActivityCompletedAt: "2026-10-08T10:00:00Z" }, now), true);
});

test("card considera também as atividades da agenda e o filtro do servidor exclui quem tem atividade futura", () => {
  assert.match(readFileSync(new URL("../components/clients/client-format.js", import.meta.url), "utf8"), /isStaleContactClient\(mergeActivitySignal\(client, extraActivities\)\)/);
  const q = readFileSync(new URL("../lib/simulation-list-query.js", import.meta.url), "utf8");
  assert.match(q, /applyStaleContactFilter\(query, cutoffIso\);\n\s+\/\/[^\n]*\n\s+query = applyNoOwnFutureActivityFilter\(query, nowIso\);\n\s+query = applyNotInFutureActivityIds\(query, futureActivityIds\);/);
});

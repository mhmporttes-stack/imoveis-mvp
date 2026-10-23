// Etapa 2 de velocidade (parte servidor, dono 2026-10-22). As libs são "server-only", então as travas olham o código-fonte.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("retorno automático da Prospecção saiu das leituras de tela", () => {
  for (const file of ["lib/prospecting.js", "lib/simulation-registrations.js", "components/AdminSectionNav.jsx"]) {
    assert.doesNotMatch(read(file), /autoReturnStaleProspectingContacts\s*\(/, `${file} não pode chamar o retorno automático`);
  }
  // A hibernação da Meta Diária NÃO foi aprovada para mudar: continua nas duas leituras.
  assert.match(read("lib/prospecting.js"), /await hibernateEndedDailyGoalRounds\(\);/);
  assert.match(read("lib/simulation-registrations.js"), /await hibernateEndedDailyGoalRounds\(\);/);
});

test("retorno automático roda no cron scheduled-activities, com trava e antes da rede de segurança", () => {
  const route = read("app/api/cron/scheduled-activities/route.js");
  const call = route.indexOf("await runProspectingAutoReturnJob()");
  assert.ok(call > 0, "cron chama runProspectingAutoReturnJob");
  assert.ok(call < route.indexOf("await reassignOrphanedClientsToOwner()"), "roda antes da rede de segurança (FUN-11)");
  assert.match(route, /prospectingAutoReturn,/, "resultado aparece na resposta do cron");

  const lib = read("lib/prospecting-auto-return.js");
  const job = lib.slice(lib.indexOf("export async function runProspectingAutoReturnJob"));
  assert.match(job, /if \(!\(await acquireLock\(AUTO_RETURN_LOCK_NAME, AUTO_RETURN_LOCK_SECONDS\)\)\) return \{ skipped: "ja_em_execucao" \};/);
  assert.match(job, /finally \{\s*await releaseLock\(AUTO_RETURN_LOCK_NAME\);/);
  assert.match(job, /autoReturnStaleProspectingContacts\(now\)/);
  // Trava expira antes do próximo ciclo de 2 min (execução que cair no meio não bloqueia a seguinte).
  const seconds = Number(lib.match(/AUTO_RETURN_LOCK_SECONDS = (\d+)/)[1]);
  assert.ok(seconds > 0 && seconds < 120);
});

test("regra do retorno automático continua idêntica (prazo, bloqueio e histórico)", () => {
  const lib = read("lib/prospecting-auto-return.js");
  assert.match(lib, /const ATTEMPT_LIMIT_MS = 7 \* 24 \* 60 \* 60 \* 1000;/);
  assert.match(lib, /const RETURN_BLOCK_MS = 30 \* 24 \* 60 \* 60 \* 1000;/);
  assert.match(lib, /event_type: "auto_returned", details: \{ availableAfter, reason: "attempt_timeout_7_days" \}/);
});

test("menu (AdminSectionNav) não lê a carteira para quem não vê o bloco do gestor", () => {
  const nav = read("components/AdminSectionNav.jsx");
  const earlyReturn = nav.indexOf("if (!isManager || isAdmin) return null;");
  assert.ok(earlyReturn > 0);
  assert.ok(earlyReturn < nav.indexOf("listSimulationRegistrations({"), "sai antes de qualquer leitura");
  assert.ok(earlyReturn < nav.indexOf("countUnreadCrmNotifications(admin)"));
});

test("sinais do card da lista de clientes em paralelo, roleta por último", () => {
  const src = read("lib/simulation-list-query.js");
  assert.doesNotMatch(src, /applySponsoredCostSignal\(auth, await applyChatContactSignal/, "sem encadeamento em série");
  const helper = src.slice(src.indexOf("async function applyCardSignals"));
  assert.match(helper, /await Promise\.all\(\[\s*applyChatContactSignal\(supabase, items\),\s*applySponsoredCostSignal\(auth, items\),\s*applyDocumentsOfflineSignal\(supabase, items\)\s*\]\);\s*return applyRouletteQueueSignal\(items, rouletteEntries\);/);
  assert.equal((src.match(/await applyCardSignals\(supabase, auth, items/g) || []).length, 3);
});

test("cache do ranking cobre um ciclo do cron de reconhecimentos (2 min)", () => {
  const ms = read("lib/performance-overview.js").match(/const RANKING_CACHE_MS = (\d+) \* 1000;/);
  const seconds = Number(ms[1]);
  assert.ok(seconds > 120 && seconds <= 240, `TTL ${seconds}s: > 1 ciclo (recalcula ≤ metade) e ≤ 2 ciclos`);
});

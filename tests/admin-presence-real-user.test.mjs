import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resolvePresenceProfileId,
  writePresenceSignal,
  formatRelativeActivityText,
  deriveStatus,
  PRESENCE_STATUS,
  ONLINE_WINDOW_MS,
  AWAY_WINDOW_MS
} from "../lib/admin-presence-core.mjs";
import { createHeartbeatController } from "../lib/admin-presence-heartbeat-core.mjs";

const REAL = { id: "real-admin", name: "Admin real" };
const EMULATED = { id: "corretor-emulado", name: "Corretor" };
const normalAuth = { ok: true, profile: EMULATED };
const viewAsAuth = { ok: true, accountSwitchMode: true, realProfile: REAL, profile: EMULATED };

function fakeClient() {
  const writes = [];
  return {
    writes,
    from(table) {
      return {
        upsert(row, options) {
          writes.push({ table, row, options });
          return Promise.resolve({ error: null });
        }
      };
    }
  };
}

// (a) presença só do usuário real ------------------------------------------
test("sem Alterar conta: presença vai para o próprio usuário (regressão)", () => {
  assert.equal(resolvePresenceProfileId(normalAuth), EMULATED.id);
});

test("com Alterar conta: presença vai para o admin REAL, nunca para o emulado", () => {
  assert.equal(resolvePresenceProfileId(viewAsAuth), REAL.id);
  assert.notEqual(resolvePresenceProfileId(viewAsAuth), EMULATED.id);
});

test("Alterar conta sem perfil real com id: nada é gravado (string vazia), nunca cai no emulado", () => {
  assert.equal(resolvePresenceProfileId({ ok: true, accountSwitchMode: true, realProfile: { id: "" }, profile: EMULATED }), "");
  assert.equal(resolvePresenceProfileId({ ok: true, accountSwitchMode: true, profile: EMULATED }), "");
  assert.equal(resolvePresenceProfileId({ ok: false, profile: EMULATED }), "");
  assert.equal(resolvePresenceProfileId(null), "");
});

test("gravação (heartbeat e grace) com view-as: admin_presence e admin_presence_activity só com o id real", async () => {
  for (const grace of [false, true]) {
    const client = fakeClient();
    await writePresenceSignal(client, resolvePresenceProfileId(viewAsAuth), { grace, nowMs: Date.parse("2026-10-04T12:00:30Z") });
    assert.equal(client.writes.length, 2);
    assert.deepEqual(client.writes.map((w) => w.table), ["admin_presence", "admin_presence_activity"]);
    for (const w of client.writes) assert.equal(w.row.user_id, REAL.id);
    assert.equal(client.writes.some((w) => w.row.user_id === EMULATED.id), false);
    assert.equal(client.writes[1].row.kind, grace ? "grace" : "interaction");
    assert.equal(client.writes[1].row.minute_at, "2026-10-04T12:00:00.000Z");
    assert.equal(client.writes[0].row.last_activity_at, "2026-10-04T12:00:30.000Z");
  }
});

test("sem view-as a gravação é idêntica à de antes, no próprio usuário", async () => {
  const client = fakeClient();
  await writePresenceSignal(client, resolvePresenceProfileId(normalAuth), { grace: false, nowMs: 1_000_000_000_000 });
  assert.equal(client.writes[0].row.user_id, EMULATED.id);
  assert.deepEqual(client.writes[1].options, { onConflict: "user_id,minute_at", ignoreDuplicates: true });
});

test("lib/admin-presence.js grava presença só pela identidade real e só pelo gravador do core", () => {
  const lib = readFileSync(new URL("../lib/admin-presence.js", import.meta.url), "utf8");
  assert.match(lib, /resolvePresenceProfileId\(auth\)/);
  assert.doesNotMatch(lib, /auth\?\.profile\?\.id/);
  assert.doesNotMatch(lib, /\.from\("admin_presence"\)\s*\.upsert/);
  assert.doesNotMatch(lib, /\.from\("admin_presence_activity"\)\s*\.upsert/);
});

// (b) ação operacional continua atribuída ao emulado -------------------------
test("ações operacionais seguem no perfil efetivo (emulado); só a presença usa o real", () => {
  assert.equal(viewAsAuth.profile.id, EMULATED.id);
  const rotas = [
    "../app/api/daily-goal/attempt/route.js",
    "../app/api/simulation-registrations/[id]/whatsapp-contact/route.js",
    "../app/api/prospecting/[id]/route.js"
  ];
  for (const rota of rotas) {
    const src = readFileSync(new URL(rota, import.meta.url), "utf8");
    assert.match(src, /recordAdminGrace\(auth\)/, rota);
  }
});

// (c) rota heartbeat ignora userId do corpo ------------------------------------
test("rota heartbeat não lê corpo, query nem userId; usa só a sessão", () => {
  const src = readFileSync(new URL("../app/api/admin/heartbeat/route.js", import.meta.url), "utf8");
  const code = src.replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /request\.json|request\.formData|request\.text|searchParams|userId|user_id/);
  assert.match(code, /requireAdminApi\(request\)/);
  assert.match(code, /recordAdminHeartbeat\(auth\)/);
});

test("componente do heartbeat não envia id nem corpo, sem sendBeacon/pagehide/timer periódico", () => {
  const src = readFileSync(new URL("../components/AdminPresenceHeartbeat.jsx", import.meta.url), "utf8");
  const code = src.replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /body\s*:/);
  assert.doesNotMatch(code, /sendBeacon|pagehide|setInterval/);
  const layout = readFileSync(new URL("../app/admin/layout.jsx", import.meta.url), "utf8");
  assert.match(layout, /<AdminPresenceHeartbeat userId=\{resolvePresenceProfileId\(auth\)\}/);
});

// (d) heartbeat do navegador ---------------------------------------------------
function harness({ responses, visible = true }) {
  const state = { t: 1_000_000, visible, calls: 0, timers: [] };
  const queue = [...responses];
  state.controller = createHeartbeatController({
    send: async () => {
      state.calls += 1;
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) throw next;
      return next;
    },
    isVisible: () => state.visible,
    now: () => state.t,
    setTimer: (fn, ms) => {
      const timer = { fn, ms, cleared: false };
      state.timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      timer.cleared = true;
    }
  });
  state.runTimers = async () => {
    for (const timer of state.timers.splice(0)) if (!timer.cleared) await timer.fn();
  };
  return state;
}
const ok = { ok: true, status: 200 };

test("heartbeat: máximo 1 sinal por minuto no caso normal", async () => {
  const h = harness({ responses: [ok] });
  await h.controller.ping();
  for (let i = 0; i < 50; i += 1) {
    h.t += 1000;
    await h.controller.ping();
  }
  assert.equal(h.calls, 1);
  h.t += 60000;
  await h.controller.ping();
  assert.equal(h.calls, 2);
});

test("heartbeat: nunca envia com a aba oculta; envia ao voltar", async () => {
  const h = harness({ responses: [ok], visible: false });
  await h.controller.ping();
  await h.controller.ping();
  assert.equal(h.calls, 0);
  h.visible = true;
  await h.controller.ping();
  assert.equal(h.calls, 1);
});

test("heartbeat: 5xx agenda UMA nova tentativa com atraso e depois espera o próximo minuto", async () => {
  const h = harness({ responses: [{ ok: false, status: 503 }] });
  await h.controller.ping();
  assert.equal(h.calls, 1);
  assert.equal(h.timers.length, 1);
  assert.ok(h.timers[0].ms >= 1000);
  await h.runTimers();
  assert.equal(h.calls, 2);
  assert.equal(h.timers.length, 0, "não agenda uma segunda nova tentativa");
  h.t += 1000;
  await h.controller.ping();
  assert.equal(h.calls, 2, "dentro do minuto não martela");
});

test("heartbeat: falha de rede faz 1 retry; se o retry der certo, acabou", async () => {
  const h = harness({ responses: [new TypeError("Failed to fetch"), ok] });
  await h.controller.ping();
  await h.runTimers();
  assert.equal(h.calls, 2);
  assert.equal(h.timers.length, 0);
});

test("heartbeat: retry não acontece se a aba ficou oculta ou o componente foi desmontado", async () => {
  const hidden = harness({ responses: [new TypeError("x")] });
  await hidden.controller.ping();
  hidden.visible = false;
  await hidden.runTimers();
  assert.equal(hidden.calls, 1);

  const gone = harness({ responses: [{ ok: false, status: 502 }] });
  await gone.controller.ping();
  gone.controller.cancel();
  await gone.runTimers();
  assert.equal(gone.calls, 1);
});

test("heartbeat: 401/403 não tenta de novo nem faz laço (AdminSessionKeeper renova/redireciona)", async () => {
  for (const status of [401, 403]) {
    const h = harness({ responses: [{ ok: false, status }] });
    await h.controller.ping();
    assert.equal(h.timers.length, 0);
    for (let i = 0; i < 100; i += 1) {
      h.t += 500;
      await h.controller.ping();
    }
    assert.equal(h.calls, 1, `status ${status}`);
  }
});

test("heartbeat: voltou a internet (evento online chama ping) respeita 1/min", async () => {
  const h = harness({ responses: [new TypeError("offline"), ok] });
  await h.controller.ping();
  h.timers.length = 0;
  h.t += 61000;
  await h.controller.ping();
  assert.equal(h.calls, 2);
});

test("componente registra visibilitychange, focus e online", () => {
  const src = readFileSync(new URL("../components/AdminPresenceHeartbeat.jsx", import.meta.url), "utf8");
  for (const ev of ['"visibilitychange"', '"focus"', '"online"']) assert.ok(src.includes(ev), ev);
});

// (e) texto relativo -----------------------------------------------------------
test("texto relativo usa piso, nunca arredonda para cima", () => {
  const NOW = Date.parse("2026-10-04T15:00:00Z");
  const at = (minutes, seconds = 0) => new Date(NOW - minutes * 60000 - seconds * 1000).toISOString();
  const txt = (m, s) => formatRelativeActivityText("away", at(m, s), NOW);
  assert.equal(txt(0, 59), "Última atividade há 1 min");
  assert.equal(txt(1), "Última atividade há 1 min");
  assert.equal(txt(59), "Última atividade há 59 min");
  assert.equal(txt(60), "Última atividade há 1h");
  assert.equal(txt(90), "Última atividade há 1h");
  assert.equal(txt(5 * 60), "Última atividade há 5h");
  assert.equal(txt(23 * 60), "Última atividade há 23h");
  assert.equal(txt(24 * 60), "Última atividade há 1 dia");
  assert.equal(txt(36 * 60), "Última atividade há 1 dia");
  assert.equal(txt(47 * 60), "Última atividade há 1 dia");
  assert.equal(txt(48 * 60), "Última atividade há 2 dias");
  assert.equal(formatRelativeActivityText("online", at(1), NOW), "Ativo agora");
  assert.equal(formatRelativeActivityText("offline", null, NOW), "Sem atividade registrada");
});

test("tela da equipe usa a função única de texto relativo", () => {
  const src = readFileSync(new URL("../components/OnlinePresenceBoard.jsx", import.meta.url), "utf8");
  assert.match(src, /formatRelativeActivityText/);
  assert.doesNotMatch(src, /function formatRelativeActivity\(/);
});

// (f) limiares intactos --------------------------------------------------------
test("limiares Online 5 min / Ausente 30 min inalterados", () => {
  assert.equal(ONLINE_WINDOW_MS, 5 * 60 * 1000);
  assert.equal(AWAY_WINDOW_MS, 30 * 60 * 1000);
  const NOW = Date.parse("2026-10-04T15:00:00Z");
  const ago = (m) => new Date(NOW - m * 60000).toISOString();
  assert.equal(deriveStatus(ago(5), NOW), PRESENCE_STATUS.ONLINE);
  assert.equal(deriveStatus(ago(5.01), NOW), PRESENCE_STATUS.AWAY);
  assert.equal(deriveStatus(ago(30), NOW), PRESENCE_STATUS.AWAY);
  assert.equal(deriveStatus(ago(30.01), NOW), PRESENCE_STATUS.OFFLINE);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  VOICE_MONKEY_TRIGGER_URL,
  WIFI_PRESENCE_MAX_HOURS,
  bearerToken,
  generateWifiToken,
  handleWifiPresenceRequest,
  hashWifiToken,
  isWifiPresenceEligible,
  normalizeTriggerDevice,
  parseWifiEvent,
  triggerVoiceMonkeyDevice,
  wifiPresenceState,
  wifiTokenMatches
} from "../lib/presence-wifi-core.mjs";

const OWNER = "dono@exemplo.com";
const isOwnerEmail = (email) => email === OWNER;

function headers(value) {
  return new Headers(value ? { authorization: value } : {});
}

function makeDeps({ allowed = true, owner = null } = {}) {
  const applied = [];
  return {
    applied,
    deps: {
      checkRateLimit: async () => allowed,
      findTokenOwner: async () => owner,
      isOwnerEmail,
      applyEvent: async (input) => applied.push(input)
    }
  };
}

test("chave: prefixo, hash estável e comparação só com a chave certa", () => {
  const token = generateWifiToken();
  assert.match(token, /^wfp_[0-9a-f]{48}$/);
  assert.notEqual(generateWifiToken(), token);
  const hash = hashWifiToken(token);
  assert.equal(hash.length, 64);
  assert.ok(!hash.includes(token));
  assert.equal(wifiTokenMatches(hash, token), true);
  assert.equal(wifiTokenMatches(hash, generateWifiToken()), false);
  assert.equal(wifiTokenMatches(null, token), false);
  assert.equal(wifiTokenMatches("", ""), false);
});

test("Bearer: só aceita chave wfp_", () => {
  assert.equal(bearerToken(headers("Bearer wfp_abc")), "wfp_abc");
  assert.equal(bearerToken(headers("Bearer alx_abc")), "");
  assert.equal(bearerToken(headers("wfp_abc")), "");
  assert.equal(bearerToken(headers()), "");
});

test("evento: só arrive/leave", () => {
  assert.equal(parseWifiEvent({ event: "arrive" }), "arrive");
  assert.equal(parseWifiEvent({ event: " LEAVE " }), "leave");
  assert.equal(parseWifiEvent({ event: "online" }), "");
  assert.equal(parseWifiEvent(null), "");
});

test("quem pode usar: hoje só o dono ativo", () => {
  assert.equal(isWifiPresenceEligible({ email: OWNER, status: "active" }, { isOwnerEmail }), true);
  assert.equal(isWifiPresenceEligible({ email: OWNER, status: "inactive" }, { isOwnerEmail }), false);
  assert.equal(isWifiPresenceEligible({ email: "corretor@exemplo.com", status: "active", role: "broker" }, { isOwnerEmail }), false);
  assert.equal(isWifiPresenceEligible(null, { isOwnerEmail }), false);
});

test("presença pelo Wi-Fi vale até o leave, com teto de segurança", () => {
  const at = "2026-10-23T12:00:00Z";
  const base = Date.parse(at);
  assert.equal(wifiPresenceState({ lastEvent: "arrive", lastEventAt: at, nowMs: base + 3600e3 }).present, true);
  assert.equal(wifiPresenceState({ lastEvent: "arrive", lastEventAt: at, nowMs: base + WIFI_PRESENCE_MAX_HOURS * 3600e3 }).present, false);
  assert.equal(wifiPresenceState({ lastEvent: "leave", lastEventAt: at, nowMs: base + 60e3 }).present, false);
  assert.equal(wifiPresenceState({ lastEvent: null, lastEventAt: null }).present, false);
});

test("gatilho do Voice Monkey: formato validado", () => {
  assert.equal(normalizeTriggerDevice(" tomada-ligar "), "tomada-ligar");
  assert.equal(normalizeTriggerDevice(""), "");
  assert.throws(() => normalizeTriggerDevice("tomada ligar"));
  assert.throws(() => normalizeTriggerDevice("x".repeat(65)));
});

test("rota: limite de tentativas responde 429 antes de olhar a chave", async () => {
  const { deps, applied } = makeDeps({ allowed: false, owner: { profile: { id: "u1", email: OWNER, status: "active" }, record: {} } });
  const result = await handleWifiPresenceRequest({ headers: headers("Bearer wfp_x"), body: { event: "arrive" }, deps });
  assert.equal(result.status, 429);
  assert.equal(applied.length, 0);
});

test("rota: sem chave ou chave desconhecida = 401", async () => {
  const { deps, applied } = makeDeps();
  assert.equal((await handleWifiPresenceRequest({ headers: headers(), body: { event: "arrive" }, deps })).status, 401);
  assert.equal((await handleWifiPresenceRequest({ headers: headers("Bearer wfp_x"), body: { event: "arrive" }, deps })).status, 401);
  assert.equal(applied.length, 0);
});

test("rota: chave de quem não pode usar = 403, sem efeito", async () => {
  const { deps, applied } = makeDeps({ owner: { profile: { id: "u2", email: "corretor@exemplo.com", status: "active" }, record: {} } });
  const result = await handleWifiPresenceRequest({ headers: headers("Bearer wfp_x"), body: { event: "arrive" }, deps });
  assert.equal(result.status, 403);
  assert.equal(applied.length, 0);
});

test("rota: arrive e leave aplicam o evento e respondem sem dado do CRM", async () => {
  const owner = { profile: { id: "u1", email: OWNER, status: "active" }, record: { plug_on_device: "on", plug_off_device: "off" } };
  const { deps, applied } = makeDeps({ owner });
  const arrive = await handleWifiPresenceRequest({ headers: headers("Bearer wfp_x"), body: { event: "arrive" }, deps });
  const leave = await handleWifiPresenceRequest({ headers: headers("Bearer wfp_x"), body: { event: "leave" }, deps });
  assert.deepEqual(arrive, { status: 200, json: { ok: true, event: "arrive" } });
  assert.deepEqual(leave.json, { ok: true, event: "leave" });
  assert.deepEqual(applied.map((item) => item.event), ["arrive", "leave"]);
  assert.equal((await handleWifiPresenceRequest({ headers: headers("Bearer wfp_x"), body: { event: "x" }, deps })).status, 400);
});

test("Voice Monkey: POST no /trigger com Bearer e o device; nada sem gatilho/trava/token", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200 };
  };
  const ok = await triggerVoiceMonkeyDevice({ device: "tomada-ligar", token: "tok", enabled: true, fetchImpl });
  assert.deepEqual(ok, { ok: true, status: "ok" });
  assert.equal(calls[0].url, VOICE_MONKEY_TRIGGER_URL);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(calls[0].init.body), { device: "tomada-ligar" });

  assert.equal((await triggerVoiceMonkeyDevice({ device: "", token: "tok", enabled: true, fetchImpl })).status, "sem_gatilho");
  assert.equal((await triggerVoiceMonkeyDevice({ device: "d", token: "tok", enabled: false, fetchImpl })).status, "alexa_desligada_no_ambiente");
  assert.equal((await triggerVoiceMonkeyDevice({ device: "d", token: "", enabled: true, fetchImpl })).status, "sem_token_voice_monkey");
  assert.equal(calls.length, 1);

  const refused = await triggerVoiceMonkeyDevice({ device: "d", token: "tok", enabled: true, fetchImpl: async () => ({ ok: false, status: 401 }) });
  assert.deepEqual(refused, { ok: false, status: "recusado_http_401" });
  const broken = await triggerVoiceMonkeyDevice({ device: "d", token: "tok", enabled: true, fetchImpl: async () => { throw new TypeError("x"); } });
  assert.deepEqual(broken, { ok: false, status: "falha_rede" });
  assert.ok(!JSON.stringify(refused).includes("tok"));
});

test("dono na imobiliária: arrive até leave, teto de 12 h, só o dono ativo", async () => {
  const { ownerAtOfficeFrom } = await import("../lib/presence-wifi-core.mjs");
  const at = "2026-10-23T12:00:00Z";
  const nowMs = Date.parse(at) + 5 * 3600e3; // 5 h depois: não expira em 10 min como a ROL-2f
  const users = [{ id: "u1", email: OWNER, status: "active" }, { id: "u2", email: "corretor@exemplo.com", status: "active" }];
  assert.equal(ownerAtOfficeFrom({ rows: [{ user_id: "u1", last_event: "arrive", last_event_at: at }], users, isOwnerEmail, nowMs }), true);
  assert.equal(ownerAtOfficeFrom({ rows: [{ user_id: "u1", last_event: "leave", last_event_at: at }], users, isOwnerEmail, nowMs }), false);
  assert.equal(ownerAtOfficeFrom({ rows: [{ user_id: "u1", last_event: "arrive", last_event_at: at }], users, isOwnerEmail, nowMs: Date.parse(at) + 13 * 3600e3 }), false);
  assert.equal(ownerAtOfficeFrom({ rows: [{ user_id: "u2", last_event: "arrive", last_event_at: at }], users, isOwnerEmail, nowMs }), false);
  assert.equal(ownerAtOfficeFrom({ rows: [{ user_id: "u1", last_event: "arrive", last_event_at: at }], users: [{ ...users[0], status: "inactive" }], isOwnerEmail, nowMs }), false);
});

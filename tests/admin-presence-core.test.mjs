import test from "node:test";
import assert from "node:assert/strict";
import { deriveStatus, deriveVisualStatus, visualActivityReference, PRESENCE_STATUS } from "../lib/admin-presence-core.mjs";

const NOW = Date.parse("2026-10-01T15:00:00.000Z");
const ago = (minutes) => new Date(NOW - minutes * 60000).toISOString();

test("roleta (deriveStatus): on-line só até 5 min da atividade real", () => {
  assert.equal(deriveStatus(ago(4.9), NOW), PRESENCE_STATUS.ONLINE);
  assert.equal(deriveStatus(ago(5.1), NOW), PRESENCE_STATUS.AWAY);
  assert.equal(deriveStatus(ago(31), NOW), PRESENCE_STATUS.OFFLINE);
  assert.equal(deriveStatus(null, NOW), PRESENCE_STATUS.OFFLINE);
});

test("visual: marca de tolerância recente mantém on-line por +5 min (aparência de antes)", () => {
  // atividade real há 8 min, ação de WhatsApp (grace) no mesmo minuto
  assert.equal(deriveStatus(ago(8), NOW), PRESENCE_STATUS.AWAY);
  assert.equal(deriveVisualStatus(ago(8), ago(8), NOW), PRESENCE_STATUS.ONLINE);
  // depois de 10 min da ação, sai do on-line também no visual
  assert.equal(deriveVisualStatus(ago(11), ago(11), NOW), PRESENCE_STATUS.AWAY);
});

test("visual sem marca de tolerância é igual ao status da roleta", () => {
  for (const minutes of [1, 4, 6, 20, 40]) {
    assert.equal(deriveVisualStatus(ago(minutes), null, NOW), deriveStatus(ago(minutes), NOW));
  }
});

test("referência visual nunca fica antes da atividade real", () => {
  assert.equal(visualActivityReference(ago(1), ago(30)), ago(1));
  assert.equal(visualActivityReference(null, null), null);
});

test("presenceDeviceFromUserAgent: celular x computador pelo User-Agent", async () => {
  const { presenceDeviceFromUserAgent } = await import("../lib/admin-presence-core.mjs");
  assert.equal(presenceDeviceFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"), "mobile");
  assert.equal(presenceDeviceFromUserAgent("Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36"), "mobile");
  assert.equal(presenceDeviceFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129 Safari/537.36"), "desktop");
  assert.equal(presenceDeviceFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15"), "desktop");
  assert.equal(presenceDeviceFromUserAgent(""), null);
});

test("buildPresenceSessions: separa por lacuna de inatividade e por troca de aparelho", async () => {
  const { buildPresenceSessions } = await import("../lib/admin-presence-core.mjs");
  const at = (hhmm) => `2026-10-12T${hhmm}:00.000-03:00`;
  const sessions = buildPresenceSessions([
    { minute_at: at("10:00"), kind: "interaction", device: "desktop" },
    { minute_at: at("10:04"), kind: "interaction", device: null },
    { minute_at: at("10:29"), kind: "interaction", device: "desktop" },
    { minute_at: at("13:00"), kind: "interaction", device: "mobile" },
    { minute_at: at("13:02"), kind: "interaction", device: "desktop" }
  ]);
  assert.equal(sessions.length, 4);
  assert.deepEqual(sessions.map((s) => [s.device, s.minutes]), [["desktop", 5], ["desktop", 1], ["mobile", 1], ["desktop", 1]]);
  assert.equal(buildPresenceSessions([]).length, 0);
});

test("whatsappPresenceIcons: um verde por número conectado; nenhum conectado = um cinza", async () => {
  const { whatsappPresenceIcons } = await import("../lib/admin-presence-core.mjs");
  assert.deepEqual(whatsappPresenceIcons([{ slot: 1, status: "connected" }, { slot: 2, status: "connected" }]), [{ slot: 1, connected: true }, { slot: 2, connected: true }]);
  assert.deepEqual(whatsappPresenceIcons([{ slot: 1, status: "disconnected" }, { slot: 2, status: "connected" }]), [{ slot: 2, connected: true }]);
  assert.deepEqual(whatsappPresenceIcons([{ slot: 1, status: "disconnected" }, { slot: 2, status: "error" }]), [{ slot: null, connected: false }]);
  assert.deepEqual(whatsappPresenceIcons([]), [{ slot: null, connected: false }]);
});

test("buildWhatsappConnectionPeriods: emenda reconexão rápida e separa queda longa", async () => {
  const { buildWhatsappConnectionPeriods } = await import("../lib/admin-presence-core.mjs");
  const at = (hhmm) => Date.parse(`2026-10-12T${hhmm}:00.000-03:00`);
  const dayStartMs = at("00:00");
  const periods = buildWhatsappConnectionPeriods([
    { slot: 1, type: "disconnected", ms: at("09:00") },
    { slot: 1, type: "connected", ms: at("09:01") },
    { slot: 1, type: "disconnected", ms: at("12:00") },
    { slot: 1, type: "connected", ms: at("14:00") }
  ], { dayStartMs, dayEndMs: dayStartMs + 86400000, nowMs: at("15:00"), initialBySlot: { 1: true } });
  assert.equal(periods.length, 2);
  assert.equal(periods[0].start, new Date(dayStartMs).toISOString());
  assert.equal(periods[0].end, new Date(at("12:00")).toISOString());
  assert.equal(periods[1].end, null);
  assert.equal(periods[1].minutes, 60);
});

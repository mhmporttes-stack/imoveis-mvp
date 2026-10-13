import test from "node:test";
import assert from "node:assert/strict";
import { clientIpFromHeaders, ipMatchesNetworks, networkKey, officeStatus, officeValidUntilIso } from "../lib/office-presence-core.mjs";

test("IP do cliente vem do primeiro x-forwarded-for", () => {
  assert.equal(clientIpFromHeaders({ "x-forwarded-for": "177.10.20.30, 10.0.0.1" }), "177.10.20.30");
  assert.equal(clientIpFromHeaders(new Map([["x-real-ip", "200.1.2.3"]])), "200.1.2.3");
});

test("rede: IPv4 exato e IPv6 pelo prefixo /64", () => {
  assert.equal(networkKey("177.10.20.30"), "177.10.20.30");
  assert.equal(networkKey("2804:14c:65a1:4a2b:1111:2222:3333:4444"), "2804:14c:65a1:4a2b::/64");
  assert.equal(networkKey("2804:014c:65a1:4a2b::1"), "2804:14c:65a1:4a2b::/64");
  const networks = [{ ip: "177.10.20.30" }, { ip: "2804:14c:65a1:4a2b:aaaa::1" }];
  assert.equal(ipMatchesNetworks("177.10.20.30", networks), true);
  assert.equal(ipMatchesNetworks("177.10.20.31", networks), false);
  assert.equal(ipMatchesNetworks("2804:14c:65a1:4a2b:9999:8888:7777:6666", networks), true, "outro aparelho, mesma rede");
  assert.equal(ipMatchesNetworks("2804:14c:65a1:4a2c::1", networks), false);
  assert.equal(ipMatchesNetworks("", networks), false);
});

const sp = (iso) => Date.parse(`${iso}-03:00`);

test("chegada vale até 9h do dia seguinte; sábado vale até segunda 9h", () => {
  assert.equal(officeValidUntilIso(sp("2026-10-13T10:00:00")), "2026-10-14T12:00:00.000Z", "terça 10h -> quarta 9h");
  assert.equal(officeValidUntilIso(sp("2026-10-13T23:50:00")), "2026-10-14T12:00:00.000Z");
  assert.equal(officeValidUntilIso(sp("2026-10-16T18:00:00")), "2026-10-17T12:00:00.000Z", "sexta -> sábado 9h");
  assert.equal(officeValidUntilIso(sp("2026-10-17T10:00:00")), "2026-10-19T12:00:00.000Z", "sábado -> segunda 9h");
  assert.equal(officeValidUntilIso(sp("2026-10-18T11:00:00")), "2026-10-19T12:00:00.000Z", "domingo -> segunda 9h");
});

test("regra desligada não tira ninguém da roleta", () => {
  assert.deepEqual(officeStatus({ ruleEnabled: false, validUntil: null }).eligible, true);
  assert.equal(officeStatus({ ruleEnabled: true, validUntil: null }).eligible, false);
  assert.equal(officeStatus({ ruleEnabled: true, validUntil: "2026-10-14T12:00:00.000Z", nowMs: sp("2026-10-14T08:59:00") }).eligible, true);
  assert.equal(officeStatus({ ruleEnabled: true, validUntil: "2026-10-14T12:00:00.000Z", nowMs: sp("2026-10-14T09:00:00") }).eligible, false);
});

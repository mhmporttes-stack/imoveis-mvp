import test from "node:test";
import assert from "node:assert/strict";
import { absenceUntilIso, clientIpFromHeaders, currentAbsence, ipMatchesNetworks, isCheckinIgnoredByAbsence, networkKey, nextSundayKey, officeStatus, officeValidUntilIso } from "../lib/office-presence-core.mjs";

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

test("'na imobiliária agora' (2026-10-15): Wi-Fi nos últimos 10 min; não muda a elegibilidade da roleta", () => {
  const now = Date.parse("2026-10-15T13:00:00.000Z");
  const validUntil = "2026-10-16T12:00:00.000Z";
  const here = officeStatus({ ruleEnabled: true, validUntil, lastWifiSeenAt: "2026-10-15T12:52:00.000Z", nowMs: now });
  assert.equal(here.here, true);
  assert.equal(here.eligible, true);
  const left = officeStatus({ ruleEnabled: true, validUntil, lastWifiSeenAt: "2026-10-15T12:45:00.000Z", nowMs: now });
  assert.equal(left.here, false);
  assert.equal(left.active, true);
  assert.equal(left.eligible, true);
  const released = officeStatus({ ruleEnabled: true, validUntil, lastWifiSeenAt: null, nowMs: now });
  assert.equal(released.here, false);
  assert.equal(released.eligible, true);
});

// "Marcar ausente" (dono, 2026-10-17): caso real — notebook da Bruna usado pelo Eduardo no sábado.
test("ausente: prazo vai até o fim do dia em São Paulo; 'até domingo' é o próximo domingo", () => {
  assert.equal(absenceUntilIso("2026-10-18"), "2026-10-19T03:00:00.000Z", "fim de domingo 18/10 = segunda 00:00 SP");
  assert.equal(absenceUntilIso("18/10/2026"), null);
  assert.equal(nextSundayKey(sp("2026-10-17T15:00:00")), "2026-10-18", "sábado -> domingo");
  assert.equal(nextSundayKey(sp("2026-10-18T10:00:00")), "2026-10-18", "domingo -> hoje");
  assert.equal(nextSundayKey(sp("2026-10-19T10:00:00")), "2026-10-25");
});

test("ausente: chegada pelo Wi-Fi não vale (nem volta na segunda antes das 9h); desfeita, volta a valer", () => {
  const absences = [{ markedAt: new Date(sp("2026-10-17T15:00:00")).toISOString(), absentUntil: absenceUntilIso("2026-10-18"), markedByName: "Matheus" }];
  const saturday = { firstSeenAt: new Date(sp("2026-10-17T09:30:00")).toISOString(), validUntil: "2026-10-19T12:00:00.000Z" };
  const sunday = { firstSeenAt: new Date(sp("2026-10-18T10:00:00")).toISOString(), validUntil: "2026-10-19T12:00:00.000Z" };
  const monday = { firstSeenAt: new Date(sp("2026-10-19T08:10:00")).toISOString(), validUntil: "2026-10-20T12:00:00.000Z" };
  assert.equal(isCheckinIgnoredByAbsence(saturday, absences), true, "check-in de hoje deixa de valer");
  assert.equal(isCheckinIgnoredByAbsence(sunday, absences), true, "Wi-Fi no domingo não conta");
  assert.equal(isCheckinIgnoredByAbsence(monday, absences), false, "chegada nova depois da ausência vale");
  const old = { firstSeenAt: new Date(sp("2026-10-15T09:00:00")).toISOString(), validUntil: "2026-10-16T12:00:00.000Z" };
  assert.equal(isCheckinIgnoredByAbsence(old, absences), false, "chegada já vencida antes da marcação não é afetada");

  const during = officeStatus({ ruleEnabled: true, ...saturday, lastWifiSeenAt: new Date(sp("2026-10-17T15:55:00")).toISOString(), absences, nowMs: sp("2026-10-17T16:00:00") });
  assert.equal(during.active, false);
  assert.equal(during.eligible, false);
  assert.equal(during.here, false, "ícone cinza mesmo com Wi-Fi");
  assert.equal(during.wifiDetectedWhileAbsent, true);
  assert.equal(during.absence?.markedByName, "Matheus");

  const mondayEarly = officeStatus({ ruleEnabled: true, ...saturday, absences, nowMs: sp("2026-10-19T07:00:00") });
  assert.equal(mondayEarly.absence, null, "ausência acabou");
  assert.equal(mondayEarly.eligible, false, "chegada de sábado não ressuscita");

  const undone = officeStatus({ ruleEnabled: true, ...saturday, absences: [], nowMs: sp("2026-10-17T16:00:00") });
  assert.equal(undone.eligible, true, "Desfazer: check-in volta a valer (nunca foi apagado)");
  assert.equal(officeStatus({ ruleEnabled: false, validUntil: null, absences, nowMs: sp("2026-10-17T16:00:00") }).eligible, true, "regra desligada: nada muda");
  assert.equal(currentAbsence(absences, sp("2026-10-18T23:59:00"))?.markedByName, "Matheus");
  assert.equal(currentAbsence(absences, sp("2026-10-19T00:00:00")), null);
});

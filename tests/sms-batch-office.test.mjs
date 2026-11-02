import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SMS_BATCH_OFFICE_ONLY_CODE, SMS_BATCH_OFFICE_ONLY_MESSAGE, smsOfficeDecision } from "../lib/sms-batch-office-core.mjs";
import { clientIpFromHeaders } from "../lib/office-presence-core.mjs";

// PRO-18e (dono, 2026-11-02): o corretor só usa o Lote de SMS enquanto a requisição de agora chega pela rede da imobiliária.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const networks = [{ ip: "200.10.20.30", key: "200.10.20.30", label: "Imobiliária" }, { ip: "2804:1b3:a000:1234:aaaa:bbbb:cccc:dddd", label: "Imobiliária v6" }];

test("corretor dentro da imobiliária (IPv4 igual) passa", () => {
  const decision = smsOfficeDecision({ scope: "broker", networks, ip: "200.10.20.30", action: "load" });
  assert.equal(decision.allowed, true);
  assert.equal(decision.inOffice, true);
});

test("corretor dentro pela rede IPv6 (/64) passa", () => {
  assert.equal(smsOfficeDecision({ scope: "broker", networks, ip: "2804:1b3:a000:1234:1:2:3:4", action: "load" }).allowed, true);
});

test("corretor fora da imobiliária é barrado na lista e nas ações novas", () => {
  for (const action of ["load", "more", "undo", "invalid", "opt-out", "reset-list", "settings", ""]) {
    const decision = smsOfficeDecision({ scope: "broker", networks, ip: "187.1.2.3", action });
    assert.equal(decision.allowed, false, action);
    assert.equal(decision.reason, "outside_office");
  }
  assert.equal(smsOfficeDecision({ scope: "broker", networks, ip: "", action: "load" }).allowed, false);
});

test("fora da imobiliária só se aceita registrar 'sent' e 'sent-2' (SMS já enviado, fila do aparelho)", () => {
  for (const action of ["sent", "sent-2"]) {
    const decision = smsOfficeDecision({ scope: "broker", networks, ip: "187.1.2.3", action });
    assert.equal(decision.allowed, true);
    assert.equal(decision.recordOnly, true);
  }
});

test("lista de IPs vazia: não há como verificar, nada é bloqueado", () => {
  for (const empty of [[], undefined, null]) {
    const decision = smsOfficeDecision({ scope: "broker", networks: empty, ip: "187.1.2.3", action: "load" });
    assert.equal(decision.allowed, true);
    assert.equal(decision.unverified, true);
  }
});

test("admin geral e gestor (lote da equipe) nunca são barrados", () => {
  assert.equal(smsOfficeDecision({ scope: "team", networks, ip: "187.1.2.3", action: "load" }).allowed, true);
  assert.equal(smsOfficeDecision({ scope: "team", networks, ip: "", action: "more" }).allowed, true);
});

test("IP vem do x-forwarded-for como na presença (primeiro da lista)", () => {
  const headers = new Headers({ "x-forwarded-for": "200.10.20.30, 10.0.0.1" });
  assert.equal(smsOfficeDecision({ scope: "broker", networks, ip: clientIpFromHeaders(headers), action: "load" }).allowed, true);
  assert.equal(smsOfficeDecision({ scope: "broker", networks, ip: clientIpFromHeaders(new Headers({ "x-forwarded-for": "187.1.2.3, 200.10.20.30" })), action: "load" }).allowed, false);
});

test("código e aviso do dono; a rota checa o escritório antes de qualquer ação", () => {
  assert.equal(SMS_BATCH_OFFICE_ONLY_CODE, "SMS_BATCH_OFFICE_ONLY");
  assert.equal(SMS_BATCH_OFFICE_ONLY_MESSAGE, "O Lote de SMS só funciona no Wi-Fi da imobiliária. Conecte-se ao Wi-Fi do escritório.");
  const route = read("app/api/admin/lote-sms/route.js");
  const getBody = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  const postBody = route.slice(route.indexOf("export async function POST"));
  assert.ok(getBody.indexOf("assertSmsBatchOffice") > -1 && getBody.indexOf("assertSmsBatchOffice") < getBody.indexOf("loadSmsBatch"));
  assert.ok(postBody.indexOf("assertSmsBatchOffice") > -1 && postBody.indexOf("assertSmsBatchOffice") < postBody.indexOf("markSmsSent"));
});

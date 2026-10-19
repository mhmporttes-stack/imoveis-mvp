// Trava "Simulação enviada" (regra do dono, 2026-10-12 — FUN-13). Dados 100% sintéticos.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SIMULATION_SENT_LOCK_MESSAGE,
  classifySimulationSentEvidence,
  isSimulationSentRestrictedProfile,
  shouldBlockManualSimulationSent
} from "../lib/simulation-sent-lock-core.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const LINK = "https://www.matheusmachadoimoveis.com.br/s/AbCdEf123456?p=x1y2z3";
const broker = { role: "broker" };
const associate = { role: "associate" };
const manager = { role: "manager" };
const admin = { role: "admin" };

test("sem nada enviado: não há evidência", () => {
  assert.equal(classifySimulationSentEvidence().sent, false);
  assert.equal(classifySimulationSentEvidence({ presentationEvents: 0, messages: [] }).sent, false);
});

test("evento presentation_sent na jornada conta", () => {
  const evidence = classifySimulationSentEvidence({ presentationEvents: 1 });
  assert.equal(evidence.sent, true);
  assert.equal(evidence.presentationEvent, true);
});

test("link /s/ em mensagem de saída conta (Chat ou celular); falha, entrada e nota interna não", () => {
  assert.equal(classifySimulationSentEvidence({ messages: [{ direction: "outbound", status: "sent", body: LINK }] }).presentationLink, true);
  assert.equal(classifySimulationSentEvidence({ messages: [{ direction: "outbound", status: "delivered", body: `Segue: ${LINK}` }] }).sent, true);
  assert.equal(classifySimulationSentEvidence({ messages: [{ direction: "outbound", status: "failed", body: LINK }] }).sent, false);
  assert.equal(classifySimulationSentEvidence({ messages: [{ direction: "inbound", status: "received", body: LINK }] }).sent, false);
  assert.equal(classifySimulationSentEvidence({ messages: [{ direction: "internal", status: "sent", body: LINK }] }).sent, false);
  assert.equal(classifySimulationSentEvidence({ messages: [{ direction: "outbound", status: "sent", body: "https://exemplo.com/s/abc" }] }).sent, false, "link curto/alheio não é apresentação");
  assert.equal(classifySimulationSentEvidence({ messages: [{ direction: "outbound", status: "sent", body: "Oi, tudo bem?" }] }).sent, false);
});

test("apresentação pelo oficial (botão Visualizar simulação: link só em metadata.link.url) conta — caso #C6600", () => {
  const cta = { direction: "outbound", status: "delivered", body: "Rô, sua simulação de financiamento está pronta.", metadata: { link: { label: "Visualizar simulação", url: LINK }, presentation: true } };
  assert.equal(classifySimulationSentEvidence({ messages: [cta] }).presentationLink, true);
  assert.equal(classifySimulationSentEvidence({ messages: [{ ...cta, status: "failed" }] }).sent, false);
  const formShortcut = { direction: "outbound", status: "delivered", body: "Aqui está o link para fazer a sua simulação.", metadata: { link: { label: "Fazer simulação", url: "https://www.matheusmachadoimoveis.com.br/s/12?jornada=simulacao" } } };
  assert.equal(classifySimulationSentEvidence({ messages: [formShortcut] }).sent, false, "link do formulário não é a apresentação");
});

test("PDF da simulação (simulacao-<cliente>.pdf) enviado conta; outro documento não", () => {
  const pdf = (name, status = "sent") => ({ direction: "outbound", status, message_type: "document", metadata: { media: { name } } });
  assert.equal(classifySimulationSentEvidence({ messages: [pdf("simulacao-cliente-ficticio.pdf")] }).simulationPdf, true);
  assert.equal(classifySimulationSentEvidence({ messages: [pdf("simulacao-cliente-ficticio.pdf", "failed")] }).sent, false);
  assert.equal(classifySimulationSentEvidence({ messages: [pdf("rg-cliente.pdf")] }).sent, false);
  assert.equal(classifySimulationSentEvidence({ messages: [{ direction: "outbound", status: "sent", message_type: "document" }] }).sent, false);
});

test("perfis: corretor e associado são travados; gestor e admin não", () => {
  assert.equal(isSimulationSentRestrictedProfile(broker), true);
  assert.equal(isSimulationSentRestrictedProfile(associate), true);
  assert.equal(isSimulationSentRestrictedProfile(manager), false);
  assert.equal(isSimulationSentRestrictedProfile(admin), false);
  assert.equal(isSimulationSentRestrictedProfile(null), false);
});

test("corretor/associado sem evidência: bloqueia; com evidência: passa", () => {
  for (const profile of [broker, associate]) {
    assert.equal(shouldBlockManualSimulationSent({ currentStatus: "completed", nextStatus: "simulation_sent", profile, evidenceSent: false }), true);
    assert.equal(shouldBlockManualSimulationSent({ currentStatus: "completed", nextStatus: "simulation_sent", profile, evidenceSent: true }), false);
  }
});

test("admin geral e gestor no próprio perfil passam mesmo sem evidência", () => {
  for (const profile of [manager, admin]) {
    assert.equal(shouldBlockManualSimulationSent({ currentStatus: "completed", nextStatus: "simulation_sent", profile, evidenceSent: false }), false);
  }
});

test("Alterar conta: vale o perfil EFETIVO (admin como corretor é travado; admin como gestor não)", () => {
  // Em view-as, auth.profile já é o perfil emulado (applyViewAsProfile, lib/admin-auth.js).
  const adminAsBroker = { accountSwitchMode: true, realProfile: admin, profile: broker };
  const adminAsManager = { accountSwitchMode: true, realProfile: admin, profile: manager };
  assert.equal(shouldBlockManualSimulationSent({ currentStatus: "in_service", nextStatus: "simulation_sent", profile: adminAsBroker.profile, evidenceSent: false }), true);
  assert.equal(shouldBlockManualSimulationSent({ currentStatus: "in_service", nextStatus: "simulation_sent", profile: adminAsManager.profile, evidenceSent: false }), false);
});

test("só a ida para Simulação enviada é travada; não retroativo", () => {
  assert.equal(shouldBlockManualSimulationSent({ currentStatus: "completed", nextStatus: "documentation", profile: broker, evidenceSent: false }), false);
  assert.equal(shouldBlockManualSimulationSent({ currentStatus: "simulation_sent", nextStatus: "simulation_sent", profile: broker, evidenceSent: false }), false);
  assert.equal(shouldBlockManualSimulationSent({ currentStatus: "simulation_sent", nextStatus: "documentation", profile: broker, evidenceSent: false }), false);
});

test("mensagem do dono", () => {
  assert.equal(SIMULATION_SENT_LOCK_MESSAGE, "Envie a simulação ao cliente pelo Chat (link da apresentação) antes de marcar 'Simulação enviada'.");
});

test("servidor: a trava roda antes de gravar no update e no cadastro novo; o Chat usa a mesma evidência", () => {
  const registrations = read("lib/simulation-registrations.js");
  const update = registrations.slice(registrations.indexOf("export async function updateSimulationRegistration"));
  const lockAt = update.indexOf("await assertManualSimulationSentAllowed({ clientId: id");
  assert.ok(lockAt > 0, "updateSimulationRegistration chama a trava");
  assert.ok(lockAt < update.indexOf(".update(record)"), "a trava vem antes da gravação");
  const ensure = registrations.slice(registrations.indexOf("export async function ensureManualSimulationRegistration"));
  assert.ok(ensure.indexOf("assertManualSimulationSentAllowed({ clientId: null") < ensure.indexOf(".insert(registrationToRecord"), "cadastro novo também passa pela trava");
  const chat = read("lib/whatsapp-chat.js");
  assert.match(chat, /const evidence = await loadSimulationSentEvidence\(conversation\.client_id\);/);
});

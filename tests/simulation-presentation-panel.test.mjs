// Painel da apresentação no CRM (Mesa "Atendimento depois da simulação", lote A item 4, dono 2026-10-19): "Enviar simulação"
// é o botão principal e usa a MESMA função do gerador; "Copiar link" fica no histórico como COPIADO (nunca enviado, não conta
// como envio FUN-13 nem como atendimento FUN-15f); linha "envio não registrado" por cliente.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  PRESENTATION_LINK_COPIED_EVENT,
  PRESENTATION_SENT_EVENT,
  SEND_SIMULATION_BLOCKED_TEXT,
  unregisteredSendLine
} from "../lib/simulation-presentation-send.mjs";
import { ATTENDANCE_JOURNEY_EVENTS } from "../lib/client-attendance-core.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const stripComments = (code) => code.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("copiado não é enviado: fora dos sinais de atendimento e da prova de envio", () => {
  assert.equal(PRESENTATION_LINK_COPIED_EVENT, "presentation_link_copied");
  assert.notEqual(PRESENTATION_LINK_COPIED_EVENT, PRESENTATION_SENT_EVENT);
  assert.ok(!ATTENDANCE_JOURNEY_EVENTS.includes(PRESENTATION_LINK_COPIED_EVENT));
  // a prova de envio (FUN-13) só conta o evento presentation_sent e mensagens; o copiado é lido à parte, só para a linha
  const evidence = stripComments(read("lib/simulation-sent-evidence.js"));
  const load = /export async function loadSimulationSentEvidence[\s\S]*?\n}\n/.exec(evidence)?.[0] || "";
  assert.ok(!/LINK_COPIED/.test(load));
  assert.ok(!/presentation_link_copied/.test(read("lib/simulation-sent-lock-core.mjs")));
});

test("linha 'envio não registrado': só com link aberto e sem prova de envio; variante quando foi copiado", () => {
  const day = () => "18/10";
  assert.equal(unregisteredSendLine({ firstOpenedAt: "2026-10-18T12:00:00Z", sent: false }, day), "Aberto pelo cliente em 18/10 · envio não registrado");
  assert.equal(unregisteredSendLine({ firstOpenedAt: "2026-10-18T12:00:00Z", sent: false, copiedAt: "2026-10-18T11:00:00Z" }, day), "Aberto pelo cliente em 18/10 · link copiado, envio não confirmado");
  assert.equal(unregisteredSendLine({ firstOpenedAt: "2026-10-18T12:00:00Z", sent: true }, day), null);
  assert.equal(unregisteredSendLine({ firstOpenedAt: "", sent: false }, day), null);
  assert.ok(!/enviado\b/.test(unregisteredSendLine({ firstOpenedAt: "x", copiedAt: "y" })));
});

test("painel: 'Enviar simulação' cheio pela função do gerador; Copiar/Visualizar com contorno; bloqueio sem permissão", () => {
  const panel = stripComments(read("components/presentation/SimulationPresentationPanel.jsx"));
  assert.match(panel, /window\.dispatchEvent\(new CustomEvent\(SEND_SIMULATION_REQUEST_EVENT\)\)/);
  assert.ok(!/enviar-preparar|wa\.me|whatsapp-chat\/conversations/.test(panel), "nenhum fluxo de envio duplicado no painel");
  assert.match(panel, /<Button variant="secondary" onClick=\{\(\) => copyLink\(presentation\.url\)\}>/);
  assert.match(panel, /action: "copiar-registrar"/);
  assert.match(panel, /Link copiado\. Fica no histórico como copiado às \$\{formatHour\(data\.copiedAt\)\}\./);
  assert.equal(SEND_SIMULATION_BLOCKED_TEXT, "Este cliente não pode receber mensagens.");
  assert.match(panel, /if \(!canContact\) \{[\s\S]*?<Button disabled/);
  const generator = stripComments(read("components/SimulationGenerator.jsx"));
  assert.match(generator, /sendRequestRef\.current = sendSimulationToWhatsApp;/);
  assert.match(generator, /window\.addEventListener\(SEND_SIMULATION_REQUEST_EVENT, onRequest\)/);
});

test("rota: copiar grava presentation_link_copied com o mesmo guard e escopo da simulação; estado traz canContact", () => {
  const route = stripComments(read("app/api/admin/simulacoes/[id]/apresentacao/route.js"));
  assert.match(route, /const auth = await requireAdminApi\(request\);/);
  assert.match(route, /getSimulation\(\(await params\)\.id, auth\)/);
  assert.match(route, /if \(action === "copiar-registrar"\) \{[\s\S]*?eventType: PRESENTATION_LINK_COPIED_EVENT/);
  assert.match(route, /canContact: canSendPresentationTo\(simulation\.registration\)/);
  const journey = read("components/ClientJourneyActions.jsx");
  assert.match(journey, /case "presentation_link_copied":\s*return \{ title: "LINK DA APRESENTAÇÃO COPIADO"/);
});

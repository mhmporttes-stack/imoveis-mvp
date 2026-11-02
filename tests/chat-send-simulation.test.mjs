import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CHAT_SEND_SIM_NO_SIMULATION, chatSendSimulationState } from "../lib/chat-send-simulation-core.mjs";
import { pickBestSimulationRow } from "../lib/client-simulation-pick-core.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const client = { id: "r1", status: "in_service", phone: "5514998887766" };

test("botao do Chat: aparece com cliente, telefone e simulacao", () => {
  assert.deepEqual(chatSendSimulationState({ client, simulationId: "s1" }), { visible: true, needsSimulation: false, hint: "" });
  assert.equal(chatSendSimulationState({ client: { ...client, phone: "" }, simulationId: "s1", phone: "(14) 99888-7766" }).visible, true);
});

test("botao do Chat: sem simulacao avisa em palavras simples e nao inventa valores", () => {
  const state = chatSendSimulationState({ client, simulationId: "" });
  assert.deepEqual(state, { visible: true, needsSimulation: true, hint: CHAT_SEND_SIM_NO_SIMULATION });
  assert.match(state.hint, /ainda não tem simulação/);
});

test("botao do Chat: some para Nao contactar, arquivado, sem cliente, sem telefone, grupo, Particular e somente leitura", () => {
  const hidden = { visible: false, needsSimulation: false, hint: "" };
  assert.deepEqual(chatSendSimulationState({ client: { ...client, status: "do_not_contact" }, simulationId: "s1" }), hidden);
  assert.deepEqual(chatSendSimulationState({ client: { ...client, status: "archived" }, simulationId: "s1" }), hidden);
  assert.deepEqual(chatSendSimulationState({ client: null, simulationId: "s1" }), hidden);
  assert.deepEqual(chatSendSimulationState({ client: { ...client, phone: "" }, simulationId: "s1" }), hidden);
  assert.deepEqual(chatSendSimulationState({ client, simulationId: "s1", isGroup: true }), hidden);
  assert.deepEqual(chatSendSimulationState({ client, simulationId: "s1", isPrivate: true }), hidden);
  assert.deepEqual(chatSendSimulationState({ client, simulationId: "s1", archivedReadOnly: true }), hidden);
});

test("simulacao escolhida: a com valores, depois a mais recente (mesma regra da lista de Clientes)", () => {
  const rows = [
    { id: "a", financing_value: 0, subsidy_value: 0, updated_at: "2026-11-02" },
    { id: "b", financing_value: 150000, subsidy_value: 0, updated_at: "2026-10-01" },
    { id: "c", financing_value: 150000, subsidy_value: 20000, updated_at: "2026-10-20" }
  ];
  assert.equal(pickBestSimulationRow(rows).id, "c");
  assert.equal(pickBestSimulationRow([]), null);
  assert.equal(pickBestSimulationRow([rows[0]]).id, "a");
});

test("ligacao: mesma rota do painel, so o link, nada pelo servico do CRM", () => {
  const button = read("components/ChatSendSimulationPhoneButton.jsx");
  assert.match(button, /\/api\/admin\/simulacoes\/\$\{encodeURIComponent\(conversation\.sendSimulationId\)\}\/apresentacao/);
  assert.match(button, /"enviar-preparar"/);
  assert.match(button, /"enviar-registrar"/);
  assert.match(button, /withWhatsappText\(buildExternalWhatsappUrl\(phone, device\), data\.link \|\| data\.message\)/, "só o link, sem texto");
  assert.ok(!/whatsapp-chat\/conversations|\/messages/.test(button), "não envia pelo Chat/serviço do CRM");
  assert.match(read("components/WhatsappChat.jsx"), /<ChatSendSimulationPhoneButton conversation=\{conversation\}/);
  assert.match(read("lib/whatsapp-chat.js"), /sendSimulationId: sendSimulationId \?\? null/);
  assert.match(read("lib/simulation-list-query.js"), /from "\.\/client-simulation-pick-core\.mjs"/, "a lista de Clientes usa a mesma escolha");
});

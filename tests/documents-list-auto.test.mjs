// Lista de documentos enviada sozinha quando o cliente pede pelo WhatsApp oficial (REGRA OFICIAL — dono, 2026-10-20).
// Nenhum envio real: todas as dependências de envio são falsas.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  autoDocumentsListNotice,
  decideAutoDocumentsList,
  isCodedDocumentsListRequest,
  isDocumentsListRequest,
  runAutoDocumentsList
} from "../lib/documents-list-auto-core.mjs";
import { buildForecastMessage } from "../lib/documents-forecast-core.mjs";
import { withContactCode } from "../lib/whatsapp-contact-code-core.mjs";
import { filterFlowsForPostFormContact, shouldSuppressKeywordReply } from "../lib/whatsapp-form-completion.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ID = "9185d45e-1111-2222-3333-444455556666";
// Texto exato do caso real de 2026-10-20 (pedido respondido com o menu de boas-vindas).
const REAL_CASE = "Olá! Aqui é Ryan. Vi minha simulação e acho que consigo enviar os documentos até 20/10, no período da noite. Pode me mandar a lista do meu caso?\n\nCódigo do atendimento: MM-9185D45E";
const NOW = new Date("2026-10-20T16:16:00Z");
const OPEN = { id: "c1", last_inbound_at: "2026-10-20T16:15:50Z" };

test("reconhece o pedido: texto exato do caso real, texto pronto atual, frase do dono e pequenas edições", () => {
  assert.equal(isCodedDocumentsListRequest(REAL_CASE), true);
  const ready = withContactCode(buildForecastMessage({ fullName: "Ryan Silva", data: "2026-10-22", periodo: "tarde" }), ID);
  assert.equal(isCodedDocumentsListRequest(ready), true);
  assert.equal(isDocumentsListRequest("gostaria de receber a lista da documentação"), true);
  assert.equal(isDocumentsListRequest("GOSTARIA DE RECEBER A LISTA DA DOCUMENTACAO"), true);
  assert.equal(isDocumentsListRequest("Pode me mandar a lista de documentos?"), true);
  assert.equal(isDocumentsListRequest("me envia a lista do meu caso por favor"), true);
});

test("não reconhece: sem código, ou mensagem com código que não pede a lista", () => {
  assert.equal(isCodedDocumentsListRequest("Pode me mandar a lista do meu caso?"), false, "sem código do atendimento");
  assert.equal(isCodedDocumentsListRequest(withContactCode("Olá! Quero agendar um atendimento.", ID)), false);
  assert.equal(isCodedDocumentsListRequest(withContactCode("Olá, preenchi meu cadastro. Gostaria de receber a minha simulação.", ID)), false);
  assert.equal(isDocumentsListRequest("já mandei os documentos"), false);
});

test("decisão: Não contactar e telefone bloqueado nunca recebem — avisa o corretor (regra 9)", () => {
  assert.deepEqual(decideAutoDocumentsList({ registration: { id: ID, status: "do_not_contact" }, conversation: OPEN }, NOW), { action: "notify", reason: "nao_contactar" });
  assert.deepEqual(decideAutoDocumentsList({ registration: { id: ID, status: "in_service" }, conversation: OPEN, doNotContactReason: "telefone" }, NOW), { action: "notify", reason: "telefone_bloqueado" });
});

test("decisão: arquivado recebe (exceção do dono); janela fechada avisa; repetição/lista já enviada não reenvia", () => {
  assert.deepEqual(decideAutoDocumentsList({ registration: { id: ID, status: "archived" }, conversation: OPEN }, NOW), { action: "send" });
  assert.deepEqual(decideAutoDocumentsList({ registration: { id: ID, status: "in_service" }, conversation: { id: "c1", last_inbound_at: "2026-10-18T10:00:00Z" } }, NOW), { action: "notify", reason: "janela_fechada" });
  assert.equal(decideAutoDocumentsList({ registration: { id: ID, status: "in_service" }, conversation: OPEN, recentAutoList: true }, NOW).action, "skip");
  assert.deepEqual(decideAutoDocumentsList({ registration: { id: ID, status: "in_service" }, conversation: OPEN, recentListSent: true }, NOW), { action: "skip", reason: "lista_ja_enviada_ao_cadastro" });
});

function fakeDeps(overrides = {}) {
  const calls = { text: [], image: [], recorded: [], notified: [], prepared: 0 };
  const deps = {
    hashText: (text) => `h${text.length}`,
    loadContext: async () => ({ conversation: OPEN, doNotContactReason: null, recentAutoList: false, recentListSent: false }),
    prepareList: async () => { calls.prepared += 1; return { kind: "ok", listText: "Olá, Ryan! Segue a lista...\n\n*RG*", imageUrl: "https://example.test/s/tok/documentos", message: "Olá, Ryan!" }; },
    sendText: async (args) => { calls.text.push(args); return "enviado"; },
    sendImage: async (args) => { calls.image.push(args); return "enviado"; },
    recordSent: async (args) => { calls.recorded.push(args); },
    notify: async (args) => { calls.notified.push(args); },
    ...overrides
  };
  return { deps, calls };
}

test("pedido válido: envia TEXTO e depois IMAGEM, registra 'Lista de documentos enviada' e avisa o corretor", async () => {
  const { deps, calls } = fakeDeps();
  const result = await runAutoDocumentsList({ registration: { id: ID, status: "documentation_pending" }, text: REAL_CASE, now: NOW, deps });
  assert.equal(result.outcome, "enviado");
  assert.equal(calls.text.length, 1);
  assert.match(calls.text[0].claimKey, /^docs-list-auto:9185d45e-.*:2026-10-20:h\d+:texto$/);
  assert.equal(calls.image.length, 1);
  assert.equal(calls.image[0].imageUrl, "https://example.test/s/tok/documentos");
  assert.ok(calls.image[0].claimKey.endsWith(":imagem"));
  assert.deepEqual(calls.recorded, [{ image: true }]);
  assert.deepEqual(calls.notified, [{ sent: true }]);
});

test("mesmo pedido de novo (reserva já existe): não envia de novo, não registra, não avisa", async () => {
  const { deps, calls } = fakeDeps({ sendText: async () => "ja_enviado" });
  const result = await runAutoDocumentsList({ registration: { id: ID, status: "in_service" }, text: REAL_CASE, now: NOW, deps });
  assert.equal(result.outcome, "ja_enviado");
  assert.equal(calls.image.length, 0);
  assert.equal(calls.recorded.length, 0);
  assert.equal(calls.notified.length, 0);
});

test("lista já enviada ao cadastro (ex.: o corretor mandou manualmente): nada sai", async () => {
  const { deps, calls } = fakeDeps({ loadContext: async () => ({ conversation: OPEN, recentListSent: true }) });
  const result = await runAutoDocumentsList({ registration: { id: ID, status: "in_service" }, text: REAL_CASE, now: NOW, deps });
  assert.equal(result.outcome, "lista_ja_enviada_ao_cadastro");
  assert.equal(calls.prepared + calls.text.length + calls.image.length + calls.notified.length, 0);
});

test("Não contactar: não gera nem envia; só avisa o corretor com o motivo", async () => {
  const { deps, calls } = fakeDeps();
  const result = await runAutoDocumentsList({ registration: { id: ID, status: "do_not_contact" }, text: REAL_CASE, now: NOW, deps });
  assert.equal(result.outcome, "nao_contactar");
  assert.equal(calls.text.length + calls.image.length + calls.prepared, 0);
  assert.deepEqual(calls.notified, [{ sent: false, reason: "nao_contactar" }]);
});

test("sem simulação ou falha no envio: avisa o corretor para mandar pela ficha; nada registrado", async () => {
  const noSim = fakeDeps({ prepareList: async () => ({ kind: "no_simulation" }) });
  assert.equal((await runAutoDocumentsList({ registration: { id: ID, status: "in_service" }, text: REAL_CASE, now: NOW, deps: noSim.deps })).outcome, "sem_simulacao");
  assert.deepEqual(noSim.calls.notified, [{ sent: false, reason: "sem_simulacao" }]);
  const failed = fakeDeps({ sendText: async () => "falha_envio" });
  assert.equal((await runAutoDocumentsList({ registration: { id: ID, status: "in_service" }, text: REAL_CASE, now: NOW, deps: failed.deps })).outcome, "falha_envio");
  assert.equal(failed.calls.image.length + failed.calls.recorded.length, 0);
  assert.deepEqual(failed.calls.notified, [{ sent: false, reason: "falha_envio" }]);
});

test("aviso ao corretor: enviado x pendente", () => {
  assert.match(autoDocumentsListNotice({ fullName: "Ryan Silva", sent: true }).title, /enviada automaticamente para Ryan Silva/);
  const pending = autoDocumentsListNotice({ fullName: "Ryan", sent: false, reason: "nao_contactar" });
  assert.match(pending.description, /Não contactar/);
  assert.match(pending.description, /Enviar lista de documentos/);
});

test("Fluxos: pedido da lista com código não dispara fluxo nenhum; outra mensagem com código não recebe boas-vindas/menu", () => {
  const flows = [
    { id: "boas-vindas", published_trigger: { type: "first_message" } },
    { id: "menu", published_trigger: { type: "any_message" } },
    { id: "anuncio", published_trigger: { type: "ad_referral" } },
    { id: "palavra", published_trigger: { type: "keyword", keywords: ["preço"] } }
  ];
  assert.deepEqual(filterFlowsForPostFormContact(flows, { codedContact: true, documentsListRequest: isCodedDocumentsListRequest(REAL_CASE) }), []);
  assert.deepEqual(filterFlowsForPostFormContact(flows, { codedContact: true }).map((flow) => flow.id), ["palavra"]);
  assert.equal(shouldSuppressKeywordReply({ codedContact: true }), true);
  assert.equal(filterFlowsForPostFormContact(flows, {}).length, 4, "sem código: nada muda");
});

test("ligação: webhook chama o envio automático depois do 'pare'; Fluxo sai cedo no pedido; palavra-chave respeita o código", () => {
  const master = read("lib/whatsapp-master.js");
  const optOut = master.indexOf("processOfficialOptOuts");
  const auto = master.indexOf("processAutoDocumentsListRequests(automationRows, codedContacts)");
  const flowsLoop = master.indexOf("processFlowInbound(event)");
  assert.ok(optOut > 0 && auto > optOut && flowsLoop > auto, "ordem: pare → lista → fluxos");
  assert.ok(master.includes("shouldSuppressKeywordReply({ isFormMessage, recentForm: Boolean(recentForm), codedContact })"));
  const flows = read("lib/whatsapp-flows.js");
  const early = flows.indexOf("if (documentsListRequest) {");
  assert.ok(early > 0 && early < flows.indexOf("// 1) Cliente no meio de um fluxo"), "sai antes de continuar/abrir fluxo");
  assert.ok(flows.includes("filterFlowsForPostFormContact(matching, { isFormMessage, recentForm: Boolean(recentForm), codedContact })"));
  const server = read("lib/documents-list-auto.js");
  assert.ok(server.includes("prepareDocumentsListForAutoSend(registration.id"), "mesma lista personalizada da ficha");
  assert.ok(server.includes('type: "image", image: { link: imageUrl'));
  assert.ok(read("lib/documents-forecast.js").includes("actor: resolveActorSnapshot(null)"), "atribuído ao sistema");
});

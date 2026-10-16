import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CASE_STATUS,
  COOLED_NO_RESPONSE_REASON,
  applyCaseAction,
  isNoResponseQuickReason,
  isNoResponseReasonText
} from "../lib/cooled-clients-core.mjs";

// [REGRA OFICIAL — dono, 2026-10-16] Opção pronta "Cliente não respondeu mais" na janela do motivo: escolhida, o cliente
// vai para a roleta direto, sem passar pela decisora. E: motivo escrito que dá a entender o mesmo (classificador
// conservador, sem IA) é tratado como se a opção estivesse selecionada — também para os casos já na caixinha.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const now = "2026-10-16T15:00:00.000Z";

test("classificador: frases de 'não respondeu mais' contam", () => {
  for (const text of [
    "Cliente não respondeu mais",
    "Cliente não responde.",
    "cliente nao responde mais as mensagens",
    "Não retornou as mensagens nem as ligações",
    "não retorna desde semana passada",
    "Parou de responder no WhatsApp",
    "Sumiu",
    "cliente sumiu",
    "Me deixou no vácuo",
    "Visualiza e não responde",
    "sem resposta do cliente",
    "Sem retorno",
    "Não atende as ligações",
    "não me dá retorno",
    "Nunca respondeu",
    "ainda não respondeu"
  ]) assert.equal(isNoResponseReasonText(text), true, text);
});

test("classificador: ressalvas e outros motivos NÃO contam (na dúvida fica com a decisora)", () => {
  for (const text of [
    "",
    "Respondeu mas disse que vai pensar",
    "não responde, mas vou tentar ligar amanhã",
    "Cliente pediu para falar depois",
    "Aguardando documento do cônjuge",
    "aguardando retorno do banco, cliente não responde",
    "Não tem interesse, não responde",
    "Desistiu da compra",
    "Comprou com outro corretor",
    "Está com restrição no nome",
    "Renda não comprova, não respondeu",
    "Número errado, não atende",
    "Ele já respondeu hoje",
    "Voltou a responder ontem",
    "Respondeu hoje dizendo que vai juntar a entrada",
    "Vai me retornar semana que vem",
    "Agendei visita para sábado",
    "Cliente reprovado",
    "Cliente bloqueou meu número, não responde",
    "Atendimento normal, enviei a simulação"
  ]) assert.equal(isNoResponseReasonText(text), false, text);
});

test("classificador: texto muito longo é dúvida (fica com a decisora)", () => {
  assert.equal(isNoResponseReasonText(`Não responde. ${"Tentei falar várias vezes por mensagem e ligação. ".repeat(5)}`), false);
});

test("opção pronta: chave única e motivo gravado com o rótulo", () => {
  assert.equal(isNoResponseQuickReason("no_response"), true);
  assert.equal(isNoResponseQuickReason("outra"), false);
  const row = { id: "k", status: CASE_STATUS.AWAITING_REASON };
  const patch = applyCaseAction(row, "no_response", { actorId: "b1", now });
  assert.equal(patch.status, CASE_STATUS.CLOSED);
  assert.equal(patch.first_reason, COOLED_NO_RESPONSE_REASON.label);
  assert.equal(patch.first_reason_by, "b1");
  assert.equal(patch.decision, "transferred");
  assert.equal(patch.decided_by, null); // automático: sem decisora
  assert.equal(patch.decided_at, now);
});

test("opção pronta na 2ª rodada grava o 2º motivo; texto digitado reconhecido grava o texto do corretor", () => {
  const returned = { id: "k", status: CASE_STATUS.AWAITING_REASON, returned_at: now, first_reason: "Primeiro motivo bem escrito" };
  const patch = applyCaseAction(returned, "no_response", { actorId: "b1", now });
  assert.equal(patch.second_reason, COOLED_NO_RESPONSE_REASON.label);
  assert.equal(patch.first_reason, undefined);
  const typed = applyCaseAction({ id: "k", status: CASE_STATUS.AWAITING_REASON }, "no_response", { actorId: "b1", now, text: "Cliente parou de responder" });
  assert.equal(typed.first_reason, "Cliente parou de responder");
});

test("opção pronta só vale para caso aguardando o motivo", () => {
  assert.throws(() => applyCaseAction({ id: "k", status: CASE_STATUS.AWAITING_DECISION }, "no_response", { now }));
});

test("caso na caixinha: transferência automática só com motivo de 'não respondeu mais'", () => {
  const due = { id: "k", status: CASE_STATUS.AWAITING_DECISION, first_reason: "Cliente não responde." };
  const patch = applyCaseAction(due, "auto_transfer", { now });
  assert.deepEqual({ status: patch.status, decision: patch.decision, decided_by: patch.decided_by }, { status: CASE_STATUS.CLOSED, decision: "transferred", decided_by: null });
  assert.throws(() => applyCaseAction({ ...due, first_reason: "Cliente pediu para ligar depois" }, "auto_transfer", { now }));
  // vale o motivo mais recente (2ª rodada)
  assert.throws(() => applyCaseAction({ ...due, returned_at: now, second_reason: "Aguardando documento do cônjuge" }, "auto_transfer", { now }));
  assert.throws(() => applyCaseAction({ ...due, status: CASE_STATUS.AWAITING_REASON }, "auto_transfer", { now }));
});

test("servidor: mesmo efeito do 'Transferir' (roleta, etiqueta, evento) e sem envio de mensagem", () => {
  const lib = read("lib/cooled-clients.js");
  const core = lib.slice(lib.indexOf("async function transferCaseAutomatically"), lib.indexOf("const AUTO_TRANSFER_PER_RUN"));
  assert.match(core, /autoCancelReason\(/); // aprovado alguma vez / responsável mudou etc. nunca transferem
  assert.match(core, /\.eq\("status", row\.status\)/); // reserva atômica
  assert.match(core, /returnClientToRouletteByCooledNoResponse\(row\.client_id, auth, \{ expectedResponsibleId: row\.broker_id/);
  assert.match(core, /transferred_to: roulette\.toUserId/);
  assert.match(core, /eventType: "cooled_decision"[\s\S]*automatic: true/);
  assert.match(core, /tagTransferredClient\(row\.client_id\)/);
  assert.match(core, /await revert\(\)/);
  const answer = lib.slice(lib.indexOf("export async function answerCooledCase"));
  assert.match(answer, /isNoResponseQuickReason\(quickReason\)/);
  assert.match(answer, /isNoResponseReasonText\(text\)/);
  assert.match(lib, /Object\.assign\(summary, await autoTransferNoResponseCases\(stillOpen\)\)/);
});

test("roleta: a transferência automática usa o mesmo moveClientToRoulette, conferindo o responsável do caso, sem envio", () => {
  const source = read("lib/lead-distribution.js");
  const auto = source.slice(source.indexOf("export async function returnClientToRouletteByCooledNoResponse"), source.indexOf("async function loadClientForRouletteReturn"));
  assert.match(auto, /client\.responsible_user_id !== expectedResponsibleId/);
  assert.match(auto, /moveClientToRoulette\(client, auth/);
  const manual = source.slice(source.indexOf("export async function returnClientToRoulette("), source.indexOf("export async function returnClientToRouletteByCooledNoResponse"));
  assert.match(manual, /assertGeneralAdminOrManager\(auth\)/);
  const move = source.slice(source.indexOf("async function moveClientToRoulette"));
  const body = move.slice(0, move.indexOf("\n}\n"));
  for (const pattern of [/sendIndividualMessage/, /sendChatMessage/, /sendWhatsapp/i, /deliverChatMessage/]) assert.doesNotMatch(body, pattern);
});

test("janela do motivo: opção pronta antes do texto livre", () => {
  const ui = read("components/alerts/AlertCenterGate.jsx");
  const option = ui.indexOf('data-cooled-quick-reason="no_response"');
  const textarea = ui.indexOf('data-cooled-reason="true"');
  assert.ok(option > 0 && textarea > option);
  assert.match(ui, /COOLED_NO_RESPONSE_REASON\.label/);
  assert.match(ui, /quickReason \? \{ quickReason \} : \{ text: reasonText \}/);
  assert.match(read("app/api/admin/cooled-clients/[id]/reason/route.js"), /quickReason: body\?\.quickReason/);
});

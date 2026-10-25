// Achados do Treino 9 do Henry (rodada automática real de 2026-10-25T20:30:54Z, id 5a656f56 em crm_settings
// henry_training_reports), com as falas reais do dono. Ver docs/CHANGELOG_AI.md (2026-10-25, "Henry: achados do Treino 9")
// e docs/INCIDENTES.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HENRY_BARE_COMPLAINT_REPLIES,
  henryAgreementReply,
  henryBareComplaintReply,
  henryDirectRoute,
  henryFarewellReply,
  henryMainMetric,
  henryRepeatedAfterComplaint,
  isBareHenryComplaint,
  isHenryFarewell
} from "../lib/henry-voice-turn.mjs";
import { buildHenryAwaitingReport, buildHenryFunnelReport, resolveHenryPeriod } from "../lib/henry-reports-core.mjs";
import { trimCasualOffer, trimTrailingOffer } from "../lib/henry-repetition-core.mjs";
import { analyzeHenryTraining } from "../lib/henry-training-core.mjs";

const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
const TODAY = "2026-10-25";
const route = (text, turns = []) => henryDirectRoute(text, { turns, today: TODAY });
const user = (text) => ({ role: "user", text });
const henry = (text) => ({ role: "assistant", text });

// 1. "3 vendas este mês" → "Entendi, mas não foi isso que eu perguntei." → (funil_periodo, 3 rodadas) "Este mês a gente fechou
// 3 vendas, e 20 clientes passaram pela aprovação."
test("1: reclamação sem pista = pergunta curta fixa; repetição medida pelo número + métrica principal", () => {
  const complaint = "Entendi, mas não foi isso que eu perguntei.";
  const before = "3 vendas este mês.";
  const real = "Este mês a gente fechou 3 vendas, e 20 clientes passaram pela aprovação.";
  assert.equal(henryMainMetric(before), "3:vend");
  assert.equal(henryMainMetric(real), "3:vend");
  assert.equal(henryMainMetric("Três vendas no mês."), "3:vend");
  assert.equal(henryRepeatedAfterComplaint(real, before), true);
  assert.equal(henryRepeatedAfterComplaint("No mês passaram 20 clientes pela aprovação e 8 foram aprovados.", before), false); // outra métrica principal
  assert.equal(henryRepeatedAfterComplaint("Foi mal. Você queria o quê: vendas, funil ou ranking?", before), false);
  // Sem pista → a pergunta fixa, sem ferramenta e sem o modelo.
  assert.equal(isBareHenryComplaint(complaint), true);
  assert.equal(isBareHenryComplaint("Não foi isso que eu perguntei."), true);
  assert.equal(route(complaint, [user("quantas vendas este mês?"), henry(before)]), null);
  assert.equal(henryBareComplaintReply([before]), "Foi mal. Você queria o quê: vendas, funil ou ranking?");
  assert.equal(henryBareComplaintReply([before, HENRY_BARE_COMPLAINT_REPLIES[0]]), HENRY_BARE_COMPLAINT_REPLIES[1]); // não repete
  assert.doesNotMatch(henryBareComplaintReply([]), /\d/);
  // Com pista segue o caminho de sempre (rota direta ou modelo).
  for (const clue of ["Não foi isso, quero o funil do mês.", "Não foi isso que eu perguntei, quero saber por que a gente não fecha.", "Não foi isso, e a Carol?", "Não era isso, eu perguntei do mês passado."]) {
    assert.equal(isBareHenryComplaint(clue), false, clue);
  }
  assert.match(lib, /\(lastAssistant && isBareHenryComplaint\(text\) \? henryBareComplaintReply\(saidToday\) : ""\)/);
  // O Treino também lê a repetição pelo número + métrica principal.
  const report = analyzeHenryTraining([{ owner: "quantas vendas este mês?", reply: before }, { owner: complaint, reply: real }]);
  assert.ok(report.issues.some((issue) => issue.kind === "repetiu_apos_reclamacao"));
});

// 2. "me fala do funil" → termina com "Quer que eu veja em qual etapa a gente mais perde gente?"
test("2: funil pedido = etapas + gargalo numa frase curta no fim, sem oferecer", () => {
  const turns = [user("quantas vendas a gente fez este mês?"), henry("3 vendas este mês.")];
  assert.deepEqual(route("me fala do funil", turns), { name: "funil_periodo", input: { periodo: "este_mes" }, topic: "funil", speak: true });
  assert.deepEqual(route("me fala do funil"), { name: "consultar_crm", input: { assunto: "funil", periodo: "hoje" }, topic: "funil" }); // sem período na conversa
  const range = resolveHenryPeriod({ periodo: "este_mes" }, TODAY);
  const overview = { metrics: { prospecting: 120, service: 80, simulation: 40, approvalPending: 10, approval: 8, sale: 3 }, funnel: { documentation: 15 } };
  const report = buildHenryFunnelReport({ range, overview, bottleneckLine: true });
  assert.equal(report.spoken, "Neste mês, o funil teve 120 clientes no funil, 80 atendimentos, 40 simulações, 15 em documentação, 10 enviados para aprovação, 8 aprovados e 3 vendas. O gargalo tá entre simulação e documentação, uma queda de 63%.");
  assert.doesNotMatch(report.spoken, /\?/);
  // Sem a opção, a fala de sempre.
  assert.doesNotMatch(buildHenryFunnelReport({ range, overview }).spoken, /gargalo/);
  assert.match(lib, /const funnelAsked = !plan && context\.directTopic === "funil";/);
  // A resposta do modelo numa rota direta perde a oferta do fim; a oferta de abrir tela fica.
  assert.equal(trimTrailingOffer("Hoje o funil tem 30 clientes em atendimento. Quer que eu veja em qual etapa a gente mais perde gente?", { keepOpen: true }), "Hoje o funil tem 30 clientes em atendimento.");
  assert.equal(trimTrailingOffer("São 30 clientes. Quer que eu abra a tela do funil?", { keepOpen: true }), "São 30 clientes. Quer que eu abra a tela do funil?");
});

// 3. "Beleza, Henry, por hoje é isso, pode fechar a agenda." → "Não tenho agenda pra fechar, então por aqui tá tudo tranquilo.
// Qualquer coisa, é só chamar."
test("3: despedida do fim do dia = só a despedida, fixa", () => {
  const real = "Beleza, Henry, por hoje é isso, pode fechar a agenda.";
  assert.equal(isHenryFarewell(real), true);
  assert.equal(henryFarewellReply(real, { name: "Matheus" }), "Fechado, Matheus. Bom descanso!");
  assert.equal(henryFarewellReply(real, { name: "Matheus", said: ["Fechado, Matheus. Bom descanso!"] }), "Beleza, Matheus. Até amanhã!");
  for (const bye of ["pode fechar o dia", "pode fechar tudo, Henry", "chega por hoje", "por hoje deu"]) assert.equal(isHenryFarewell(bye), true, bye);
  for (const other of ["por hoje é isso? quantas vendas?", "por hoje é isso, me fala as vendas do mês", "fecha a tela de clientes", "abre a agenda"]) assert.equal(isHenryFarewell(other), false, other);
  assert.doesNotMatch(henryFarewellReply(real), /agenda|chamar|não tenho/i);
});

// 4. "Você tem 24, a Jennyfer 23 e Ketlin 17." (Ketlin sem gênero no cadastro)
test("4: artigo em todos os nomes da lista ou em nenhum", () => {
  const names = { m: "Matheus Machado", j: "Jennyfer Souza", k: "Ketlin Alves" };
  const read = (gender) => buildHenryAwaitingReport({ brokerName: (id) => names[id], brokerGender: (id) => gender[id] || "", ownerId: "m", total: 117, late: 117, groups: [{ brokerId: "m", count: 24 }, { brokerId: "j", count: 23 }, { brokerId: "k", count: 17 }] }).spoken;
  assert.equal(read({ m: "male", j: "female", k: "female" }), "São 117 conversas esperando resposta, todas atrasadas. Você tem 24, a Jennyfer 23 e a Ketlin 17.");
  assert.equal(read({ m: "male", j: "female" }), "São 117 conversas esperando resposta, todas atrasadas. Você tem 24, Jennyfer 23 e Ketlin 17.");
  // O dono sem gênero não tira o artigo dos outros (ele é "você").
  assert.equal(read({ j: "female", k: "female" }), "São 117 conversas esperando resposta, todas atrasadas. Você tem 24, a Jennyfer 23 e a Ketlin 17.");
});

// 5. "Qualquer coisa, é só chamar." e ofertas no fim do papo ("Quer que eu dê mais uma, ou prefere saber como tá o movimento
// do CRM?", "Quer que eu deixe o CRM de lado por enquanto?").
test("5: papo casual termina sem oferta nem bordão", () => {
  assert.equal(trimCasualOffer("Por que o corretor levou uma escada pra visita? Porque o imóvel era de alto padrão! Quer que eu dê mais uma, ou prefere saber como tá o movimento do CRM?"), "Por que o corretor levou uma escada pra visita? Porque o imóvel era de alto padrão!");
  assert.equal(trimCasualOffer("Tô de boa, e você? Quer que eu deixe o CRM de lado por enquanto?"), "Tô de boa, e você?");
  assert.equal(trimCasualOffer("Tamo junto! Qualquer coisa, é só chamar."), "Tamo junto!");
  assert.equal(trimCasualOffer("Qualquer coisa, é só chamar."), "Qualquer coisa, é só chamar."); // nada sobraria
  assert.match(lib, /if \(greeting \|\| personal\) replyText = trimCasualOffer\(replyText\);/);
});

// 6. "Ah, agora sim, o número de vendas já resolve." → "Foram 3 vendas no mês até agora."
test("6: concordância = resposta curta fixa, sem número", () => {
  const real = "Ah, agora sim, o número de vendas já resolve.";
  const last = "Este mês a gente fechou 3 vendas, e 20 clientes passaram pela aprovação.";
  assert.equal(henryAgreementReply(real, last, [last]), "Beleza!");
  assert.equal(henryAgreementReply(real, last, [last, "Beleza!"]), "Show!");
  // Com pergunta dele em aberto ("É essa?") fica com o caminho de sempre.
  assert.equal(henryAgreementReply("isso", "Achei Tempo Perdido, de Legião Urbana. É essa?"), "");
  assert.equal(henryAgreementReply("quantas vendas?", last), "");
});

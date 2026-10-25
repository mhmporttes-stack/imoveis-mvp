// Achados do Treino 13 do Henry (rodada automática real de 2026-10-25T22:27:56Z, id bb866de9 em crm_settings
// henry_training_reports), com as falas reais do dono. Ver docs/CHANGELOG_AI.md (2026-10-25, "Henry: achados do Treino 13").
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  henryAgreementReply,
  henryBottleneckFollowUp,
  henryDiagnosisDeepenRequest,
  henryDirectRoute,
  henryDropRepeatedBottleneck,
  henryFarewellReply,
  henryShortenPeriod,
  henryShortenedReply,
  henryTurnHint,
  isHenryFarewell
} from "../lib/henry-voice-turn.mjs";
import { buildHenryStageReasonsReport } from "../lib/henry-reports-core.mjs";

const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
const TODAY = "2026-10-25";
const user = (text) => ({ role: "user", text });
const henry = (text) => ({ role: "assistant", text });

const ASK = "Cadê o número das vendas desse mês?";
const GARGALO = "O gargalo tá entre aprovação e venda: de 20 aprovados saíram só 3 vendas, uma queda de 85%.";
const COMPLAINT = "Eu não perguntei isso, Henry. Quero saber onde a gente perde o cliente, não o número cheio.";
const DEEPENED = "Indo mais fundo no gargalo: hoje 20 clientes continuam na etapa aprovado, esperando; os mais antigos na etapa são Ana há 40 dias, Bia há 30 dias e Caio há 20 dias.";
const SHORTER = "Henry, dá pra falar mais curto? Tô sem tempo.";
const WHY = "Ah, e por que tanto aprovado que não fecha?";
const BYE = "Beleza, Henry, já tô saindo por hoje. Boa noite.";
const REASON_ROUTE = { name: "consultar_crm", input: { assunto: "etapa", etapa: "aprovados", formato: "motivo" }, topic: "motivo", speak: "fixed" };

test("1: resumo do gargalo do MÊS não começa com 'Hoje,' — período estranho no começo sai; o certo vem da pergunta", () => {
  const turns = [user(ASK), henry(GARGALO)];
  assert.equal(henryShortenPeriod(GARGALO, turns), "este_mes");
  assert.equal(henryShortenedReply("Hoje, claro. Entre aprovado e venda, a queda é de 85%.", GARGALO, turns), "Claro. No mês, entre aprovado e venda, a queda é de 85%.");
  // Sem como saber o período: só tira o "Hoje," que a resposta resumida não tinha.
  assert.equal(henryShortenedReply("Hoje, claro. Entre aprovado e venda, a queda é de 85%.", GARGALO), "Claro. Entre aprovado e venda, a queda é de 85%.");
  // Período certo no começo fica; Treino 12 continua.
  assert.equal(henryShortenedReply("Hoje, três vendas.", "Hoje foram 3 vendas."), "Hoje, três vendas.");
  assert.equal(henryShortenedReply("Vendas? Hoje tem três, e o gargalo é depois da aprovação.", "Neste mês foram 30 atendimentos, 20 aprovados e 3 vendas."), "No mês tem três vendas, e o gargalo é depois da aprovação.");
  const hint = henryTurnHint({ text: SHORTER, lastAssistant: GARGALO, turns });
  assert.match(hint, /MESMO período \("no mês"/);
  assert.match(hint, /nunca comece com um período seguido de vírgula/);
  assert.match(lib, /henryShortenedReply\(replyText, lastAssistant, memoryTurns\.length \? memoryTurns : previous\)/);
});

test("2: 'por que tanto aprovado que não fecha?' com o gargalo já dito = o motivo pelo CRM, nunca a frase do gargalo", () => {
  const turns = [user(ASK), henry(GARGALO), user(COMPLAINT), henry(DEEPENED)];
  assert.deepEqual(henryDirectRoute(WHY, { turns, today: TODAY }), REASON_ROUTE);
  // "Por quê" logo depois do gargalo (sem a lista) também é o motivo; diagnóstico sem "por quê" (Treino 7) = o mesmo gargalo
  // pela rota de sempre (a trava da frase repetida, 2c, cuida da repetição).
  assert.deepEqual(henryBottleneckFollowUp(WHY, [user(ASK), henry(GARGALO)]), REASON_ROUTE);
  assert.equal(henryBottleneckFollowUp("não fecha", [user(ASK), henry(GARGALO)]), null);
  // Reclamação com diagnóstico depois da lista já dita → nunca a mesma lista: o motivo.
  assert.deepEqual(henryDiagnosisDeepenRequest(COMPLAINT, [user(ASK), henry(GARGALO), user("e quem são?"), henry(DEEPENED), henry(GARGALO)]).route, REASON_ROUTE);
  // Sem gargalo dito hoje, ou com período próprio → a rota do diagnóstico de sempre.
  assert.equal(henryBottleneckFollowUp(WHY, [user(ASK), henry("Foram 3 vendas no mês.")]), null);
  assert.equal(henryBottleneckFollowUp("por que não fechou nada na semana passada?", turns), null);
  assert.equal(henryDirectRoute(WHY, { turns: [user(ASK), henry("Foram 3 vendas no mês.")], today: TODAY }).topic, "diagnostico");
  assert.match(lib, /query\.formato === "motivo" && STAGE_WAITING_IDS\.has\(query\.etapa\)/);
});

test("2b: a fala do motivo — 1 frase que o CRM não registra, os 3 mais antigos e a ação do plano; sem leitura = plano", () => {
  const report = buildHenryStageReasonsReport({
    etapa: "aprovados",
    today: TODAY,
    stage: {
      total: 20,
      rows: [
        { full_name: "Ana Souza", since: "2026-09-15T12:00:00Z", broker: "Gabriel", lastEvent: { title: "Etapa alterada", when: "15/09" }, nextActivity: null },
        { full_name: "Bia Lima", since: "2026-09-25T12:00:00Z", nextActivity: { title: "Ligar", overdue: true, when: "20/10" } },
        { full_name: "Caio", since: "2026-10-05T12:00:00Z", nextActivity: { title: "Visita", overdue: false, when: "27/10 às 10:00" } }
      ]
    }
  });
  assert.equal(report.spoken, "O motivo de não fechar não fica registrado no CRM. Dos aprovados parados há mais tempo, Ana está há 40 dias na etapa, sem próxima atividade; Bia, há 30 dias, com atividade atrasada; e Caio, há 20 dias, com próxima atividade marcada. O que dá pra fazer: chamar os aprovados que ainda não compraram.");
  assert.match(report.detail.sections[0].rows[0].value, /última: Etapa alterada \(15\/09\)/);
  assert.equal(buildHenryStageReasonsReport({ etapa: "aprovados", stage: null }).spoken, "O motivo de não fechar não fica registrado no CRM. O que dá pra fazer: chamar os aprovados que ainda não compraram e levar cada um para visita ou proposta ainda esta semana.");
  assert.equal(buildHenryStageReasonsReport({ etapa: "aprovados", stage: { total: 0, rows: [] } }).spoken, "Hoje nenhum cliente continua na etapa aprovado esperando.");
});

test("2c: a mesma frase do gargalo (etapas + queda) nunca sai duas vezes no dia", () => {
  assert.equal(henryDropRepeatedBottleneck("O gargalo tá entre aprovação e venda, uma queda de 85%.", [GARGALO]), "É aquele mesmo gargalo que te falei, entre aprovação e venda.");
  assert.equal(henryDropRepeatedBottleneck("O gargalo tá entre aprovação e venda, uma queda de 85%. Vale chamar a Ana e a Bia ainda hoje.", [GARGALO]), "Vale chamar a Ana e a Bia ainda hoje.");
  // Outro gargalo, outra queda ou nada dito antes = fica.
  assert.equal(henryDropRepeatedBottleneck("O gargalo tá entre documentação e envio para aprovação, uma queda de 60%.", [GARGALO]), "O gargalo tá entre documentação e envio para aprovação, uma queda de 60%.");
  assert.equal(henryDropRepeatedBottleneck(GARGALO, []), GARGALO);
  // Plano (sem número) não é repetição da frase do gargalo.
  assert.equal(henryDropRepeatedBottleneck("O gargalo tá entre aprovação e venda. Primeiro, chamar os aprovados.", [GARGALO]), "O gargalo tá entre aprovação e venda. Primeiro, chamar os aprovados.");
  assert.match(lib, /if \(!isHenryShortenRequest\(text\)\) replyText = henryDropRepeatedBottleneck\(replyText, saidToday\);/);
});

test("3: 'já tô saindo por hoje. Boa noite.' é despedida (vence a concordância)", () => {
  assert.equal(isHenryFarewell(BYE), true);
  assert.equal(henryFarewellReply(BYE), "Boa noite, Matheus! Bom descanso.");
  assert.equal(henryFarewellReply(BYE, { said: ["Boa noite, Matheus! Bom descanso."] }), "Boa noite, Matheus! Até amanhã.");
  assert.equal(isHenryFarewell("Valeu, Henry, até amanhã."), true);
  assert.equal(isHenryFarewell("Tô indo embora, falou."), true);
  // Treino 9 continua; "boa noite" sozinho é cumprimento; com pergunta do CRM não é só despedida.
  assert.equal(henryFarewellReply("Beleza, Henry, por hoje é isso, pode fechar a agenda."), "Fechado, Matheus. Bom descanso!");
  assert.equal(isHenryFarewell("Boa noite, Henry."), false);
  assert.equal(isHenryFarewell("Tô saindo, mas me fala quantas vendas teve hoje"), false);
  // A ordem no servidor: despedida antes da concordância.
  assert.equal(henryAgreementReply(BYE, ""), "Beleza!");
  assert.match(lib, /henryFarewellReply\(text, \{ name: address \|\| HENRY_OWNER_SPOKEN_NAME, said: saidToday \}\)\s*\|\| henryAgreementReply\(/);
});

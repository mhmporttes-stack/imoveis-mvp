// Achados do Treino 4 do Henry (rodada real de 2026-10-25T17:27:37Z em crm_settings henry_training_reports, depois do
// deploy de 1e18d9c), com as falas reais do dono. Ver docs/CHANGELOG_AI.md (2026-10-25, "Henry: achados do Treino 4") e
// docs/INCIDENTES.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  henryDirectRoute,
  henryQuestionPart,
  henryRepeatedAfterComplaint,
  henryTurnHint,
  henryVolumeRequest,
  isCasualRequest,
  isHenryAgreement,
  isPreviousReference,
  numbersOf
} from "../lib/henry-voice-turn.mjs";
import { buildHenryStaticPrompt } from "../lib/henry-voice-persona.mjs";
import {
  HENRY_CACHE_MAX_AGE_MINUTES,
  buildHenryNewClientsAnswer,
  buildHenryRankingReport,
  buildHenryTeamGoalSpeech,
  henryStaleNote,
  resolveHenryPeriod
} from "../lib/henry-reports-core.mjs";
import { answerQuery, buildQuery } from "../lib/alexa-v2/router.mjs";
import { measureSentence } from "../lib/alexa-v2/medidas.mjs";
import { spotifyVolumeLine } from "../lib/henry-spotify-core.mjs";
import { MORNING_SUGGESTIONS, morningOpenChoices, morningSuggestionLine } from "../lib/henry-morning-music-core.mjs";
import { analyzeHenryTraining, duplicatedSentence } from "../lib/henry-training-core.mjs";

const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
const reports = readFileSync(new URL("../lib/henry-reports.js", import.meta.url), "utf8");
const inicioDono = readFileSync(new URL("../lib/painel-inicio-dono.js", import.meta.url), "utf8");
const TODAY = "2026-10-25";
const route = (text, turns = []) => henryDirectRoute(text, { turns, today: TODAY });
const kinds = (report) => report.issues.map((issue) => issue.kind);
const today = resolveHenryPeriod({ periodo: "hoje" }, TODAY);

// Conversa do dia na ordem da rodada real (o "ranking dessa semana" ficou ~20 trocas antes do "me fala do ranking").
const filler = Array.from({ length: 20 }, (_, index) => [
  { role: "user", text: `pergunta ${index}` },
  { role: "assistant", text: `resposta ${index}` }
]).flat();
const DAY = [
  { role: "user", text: "Henry, e aí, quantos cliente novo entrou hoje?" },
  { role: "assistant", text: "Hoje entraram 2 clientes novos." },
  { role: "user", text: "E aí, Henry, como tá o ranking dessa semana?" },
  { role: "assistant", text: "Nesta semana, quem lidera o ranking é Gabriel, com 654 pontos; depois vêm Bruna, com 397 e Jennyfer, com 375." },
  ...filler,
  { role: "user", text: "Beleza, Henry, e aí, como tá o funil desse mês?" },
  { role: "assistant", text: "Esse mês o funil já passou de 1.160 clientes, com 445 atendimentos, 147 simulações, 20 aprovados e 3 vendas." }
];

// 1. "como tá a meta do dia pra equipe?" → "Última atualização há 28 minutos. A meta da equipe está em 0 por cento. Última
//    atualização há 28 minutos. Ninguém bateu a meta ainda." e "Última atualização há 29 minutos. Ranking hoje: 1º Gabriel e 2º Bruna."
test("1: sem frase crua do cache, sem duplicar, meta e ranking ditos como gente", async () => {
  assert.equal(buildHenryTeamGoalSpeech({ percent: 0, hitters: [] }), "Ninguém bateu a meta ainda hoje; a equipe está zerada.");
  assert.equal(buildHenryTeamGoalSpeech({ percent: 45.4, hitters: [] }), "A equipe está com 45 por cento da meta de hoje, e ninguém bateu ainda.");
  assert.equal(buildHenryTeamGoalSpeech({ percent: 62, hitters: [{ name: "Gabriel Souza" }, { name: "Bruna" }] }), "A equipe está com 62 por cento da meta de hoje; Gabriel e Bruna já bateram.");
  assert.equal(buildHenryTeamGoalSpeech({ percent: 70, hitters: [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }] }), "A equipe está com 70 por cento da meta de hoje; 4 corretores já bateram.");
  assert.equal(buildHenryTeamGoalSpeech({ percent: 0, hitters: [], periodo: "ontem" }), "Ontem ninguém bateu a meta; a equipe ficou zerada.");
  assert.equal(buildHenryTeamGoalSpeech({ percent: null }), null); // leitura falhou: nunca um zero falso
  // Ranking: "Hoje, o Gabriel lidera…, a Bruna vem em segundo"
  const overview = { ranking: [{ name: "Gabriel Souza", gender: "male", points: 654 }, { name: "Bruna", gender: "female", points: 397 }, { name: "Zé", points: 0 }] };
  assert.equal(buildHenryRankingReport({ range: today, overview }).spoken, "Hoje, o Gabriel lidera o ranking, com 654 pontos; a Bruna vem em segundo, com 397.");
  // Cache velho: só acima de 1 hora, uma menção natural (nunca o "Última atualização há…" da Alexa)
  assert.equal(HENRY_CACHE_MAX_AGE_MINUTES, 60);
  assert.equal(henryStaleNote(28), "");
  assert.equal(henryStaleNote(75), "Esse número é de uma hora atrás.");
  assert.equal(henryStaleNote(200), "Esse número é de umas 3 horas atrás.");
  // Roteador da Alexa: o Henry passa deps.staleText e decide; a Alexa continua com o aviso de sempre
  const deps = { today: () => TODAY, brokers: { match: () => null }, providers: { meta: async () => ({ percent: 0, staleMinutes: 28 }) } };
  const built = buildQuery({ intent: "ConsultarIntent", slots: { assunto: { value: "meta_equipe", resolutions: { resolutionsPerAuthority: [{ status: { code: "ER_SUCCESS_MATCH" }, values: [{ value: { id: "meta_equipe", name: "meta_equipe" } }] }] } } }, ctx: null, deps });
  assert.equal(built.ok, true);
  const alexa = await answerQuery(built.q, deps);
  assert.match(alexa.text, /^Última atualização há 28 minutos\./);
  let seen = 0;
  const henry = await answerQuery(built.q, { ...deps, staleText: (minutes) => ((seen = minutes), "") });
  assert.equal(seen, 28);
  assert.doesNotMatch(henry.text, /Última atualização/);
  assert.deepEqual(henry.data, { percent: 0, staleMinutes: 28 });
  // Servidor: a meta da equipe é UMA fala montada pelo Henry, a menção do cache vem uma vez só, o ranking de hoje usa a fala do período
  assert.match(lib, /staleText: \(minutes\) => \{\n\s+context\.staleMinutes = Math\.max/);
  assert.match(lib, /buildHenryTeamGoalSpeech\(\{ percent: main\.data\.percent, hitters: who\.data\.items \|\| \[\], periodo \}\)/);
  assert.match(lib, /const note = henryStaleNote\(answer\.staleMinutes\);/);
  assert.match(lib, /if \(query\.assunto === "ranking" && !query\.corretor && query\.formato !== "lista"[^\n]*\n\s+return await runRankingPeriod\(/);
});

// 2. "ranking dessa semana" … "Me fala do ranking primeiro." → foi para HOJE (o turno estava fora da janela do modelo).
test("2: período do ranking herdado da conversa do dia inteira", () => {
  const ask = "Peraí, Henry, deixa o pipeline de lado. Me fala do ranking primeiro.";
  assert.deepEqual(route(ask, DAY), { name: "ranking_periodo", input: { periodo: "esta_semana" }, topic: "ranking", speak: true });
  assert.match(lib, /henryDirectRoute\(text, \{ turns: memoryTurns\.length \? memoryTurns : previous, today: saoPauloDateKey\(\) \}\)/);
});

// 3. "me conta uma piada aí, Henry, pra desopilar depois de tanto cliente hoje" → relatorio_do_dia (11,3 s, 3 rodadas).
test("3: pedido de piada é papo, sem ferramenta, mesmo citando cliente", () => {
  const ask = "Bora, me conta uma piada aí, Henry, pra desopilar depois de tanto cliente hoje.";
  assert.equal(isCasualRequest(ask), true);
  assert.equal(henryQuestionPart(ask), "");
  assert.equal(route(ask), null);
  assert.match(henryTurnHint({ text: ask }), /piada[\s\S]*nenhum número nem assunto do CRM/);
  assert.match(lib, /const personal = !image && !greeting && !accepted && \(isPersonalQuestion\(text\) \|\| isCasualRequest\(text\)/);
  // o Treino não acusa "pergunta ignorada" numa piada
  const report = analyzeHenryTraining([{ owner: ask, reply: "Sabe por que o corretor levou uma escada pra visita? Porque o cliente queria subir de vida!" }]);
  assert.equal(kinds(report).includes("pergunta_ignorada"), false);
  assert.equal(isCasualRequest("quantos clientes novos hoje?"), false);
});

// 4. "me mostra aquela parada aí, a que você tava falando agora pouco" → "Hoje entraram 2 clientes novos." (3 rodadas).
test("4: \"aquela parada que você tava falando\" retoma o último assunto real (ou pergunta), nunca chuta", () => {
  const ask = "Bora, me mostra aquela parada aí, a que você tava falando agora pouco.";
  assert.equal(isPreviousReference(ask), true);
  assert.equal(henryQuestionPart(ask), ""); // sem rodada extra obrigando ferramenta
  assert.equal(route(ask), null);
  const lastAssistant = "Não consigo saber qual é só pela descrição, porque não guardo as conversas de outros dias. Me fala o nome dele, mesmo que seja só o primeiro, que eu acho a situação na hora.";
  const turns = [{ role: "user", text: "Ah, o da semana passada, aquele que ligou sobre o apartamento no centro." }, { role: "assistant", text: lastAssistant }];
  const hint = henryTurnHint({ text: ask, lastAssistant, turns });
  assert.match(hint, /ÚLTIMO assunto/);
  assert.match(hint, /apartamento no centro/);
  assert.match(hint, /nunca troque de assunto/);
  for (const other of ["E aí, como ficou aquele cliente?", "me mostra aquela parada do funil", "quem tá parado há mais tempo?"]) assert.equal(isPreviousReference(other), false, other);
});

// 5. "Peraí, Henry, não era isso que eu perguntei." → "São 3 vendas fechadas no mês até agora." (antes: "Três vendas este mês…")
//    e "Agora sim, três vendas já é outra conversa." → 3 rodadas + consultar_crm.
test("5: reclamação comparada por número (dígito ou por extenso); concordância responde curto, sem ferramenta", () => {
  assert.equal(numbersOf("Três vendas este mês, bom ritmo."), "3");
  assert.equal(numbersOf("São 3 vendas fechadas no mês até agora."), "3");
  assert.equal(henryRepeatedAfterComplaint("São 3 vendas fechadas no mês até agora.", "Três vendas este mês, bom ritmo. Se quiser ver o detalhe, tá na tela de Desempenho."), true);
  assert.equal(henryRepeatedAfterComplaint("Você quis dizer as aprovações? Foram 20.", "Três vendas este mês."), false);
  const agree = "Agora sim, três vendas já é outra conversa.";
  assert.equal(isHenryAgreement(agree), true);
  assert.equal(henryQuestionPart(agree), "");
  assert.equal(route(agree), null);
  assert.match(henryTurnHint({ text: agree, lastAssistant: "Vou ser curto: três vendas no mês." }), /só concordou/);
  for (const other of ["Boa noite", "Beleza, deixa aberta mesmo. Agora me fala uma coisa do WhatsApp, chegou mensagem de cliente?", "Beleza, então volta pro funil. Onde a gente tava?", "beleza, e o ranking"]) {
    assert.equal(isHenryAgreement(other), false, other);
  }
  assert.match(lib, /isHenryAgreement\(text\) && !\/\\\?\\s\*\$\/\.test\(lastAssistant\)/);
});

// 6. "quantos atendimentos a galera já fez hoje?" → "294 clientes em atendimento… Quer que eu veja o número de atendimentos do dia?"
test("6: atendimentos feitos no dia = medida do Desempenho, direto e sem oferecer", () => {
  assert.deepEqual(route("Ei Henry, me fala aí, quantos atendimentos a galera já fez hoje?"), { name: "consultar_crm", input: { assunto: "med_atendimentos", periodo: "hoje" }, topic: "atendimentos", speak: true });
  assert.equal(route("quantos atendimentos a equipe fez ontem?")?.input.periodo, "ontem");
  assert.equal(route("quantos clientes estão em atendimento?"), null); // etapa: fica com o modelo
  assert.equal(route("quantos atendimentos a Carol fez hoje?"), null); // de um corretor
  assert.equal(measureSentence("atendimentos", 12, { periodoSpoken: "hoje" }), "A equipe iniciou 12 atendimentos hoje.");
  assert.equal(measureSentence("atendimentos", 0, { periodoSpoken: "hoje" }), "A equipe ainda não iniciou atendimento hoje.");
});

// 7. "Me passa o nome deles depois" (dos 2 clientes novos) → "estão na tela de Clientes".
test("7: até 5 clientes novos, os nomes são falados (mesma leitura da contagem do Início)", () => {
  const turns = [
    { role: "user", text: "Bota uma música mais tranquila aí, e depois me diz quantos clientes novos apareceram." },
    { role: "assistant", text: "Tranquilo na vitrola, combinado. E hoje entraram 2 clientes novos." }
  ];
  const names = { name: "consultar_crm", input: { assunto: "clientes_novos", formato: "lista", periodo: "hoje" }, topic: "clientes_novos", speak: "always" };
  assert.deepEqual(route("Valeu, Henry. Me passa o nome deles depois.", turns), names);
  assert.equal(route("Valeu, Henry. Me passa o nome deles depois.", [{ role: "assistant", text: "Tem 117 conversas aguardando." }]), null);
  assert.equal(buildHenryNewClientsAnswer({ range: today, leads: { total: 2, ad: 1, marketplace: 0, other: 1, names: ["Ana", "Bruno"] }, names: true }), "Hoje entraram Ana e Bruno.");
  assert.equal(buildHenryNewClientsAnswer({ range: today, leads: { total: 2, ad: 0, marketplace: 0, other: 2, names: ["Ana", ""] }, names: true }), "Hoje entraram Ana e um sem nome.");
  assert.equal(buildHenryNewClientsAnswer({ range: today, leads: { total: 1, ad: 0, marketplace: 0, other: 1, names: ["Ana"] }, names: true }), "Hoje entrou Ana.");
  assert.equal(buildHenryNewClientsAnswer({ range: today, leads: { total: 8, ad: 0, marketplace: 0, other: 8 }, names: true }), "Hoje entraram 8 clientes novos; os nomes estão na tela.");
  assert.match(reports, /select\("id, full_name, acquisition_context"\)/);
  assert.match(reports, /names: rows\.map\(\(row\) => clientFirstNameOf\(row\.full_name\)\)/);
  assert.match(buildHenryStaticPrompt(), /se ele pedir os NOMES e forem até 5/);
});

// 8. Volume: "Baixei o som. Se quiser, é só falar de novo que eu ajusto de novo." (2 rodadas, 2,5 s).
test("8: volume e aparelho pela rota direta, com fala fixa curta", () => {
  assert.deepEqual(route("Dá uma baixada no som, Henry."), { name: "spotify", input: { acao: "volume", ajuste: "mais_baixo" }, topic: "musica" });
  assert.deepEqual(route("aumenta o som aí"), { name: "spotify", input: { acao: "volume", ajuste: "mais_alto" }, topic: "musica" });
  assert.deepEqual(henryVolumeRequest("põe o volume em 30"), { acao: "volume", volume: 30 });
  assert.equal(henryVolumeRequest("o volume de leads baixou?"), null);
  assert.deepEqual(route("Henry, passa pra Alexa aí."), { name: "mudar_aparelho_spotify", input: { aparelho: "alexa" }, topic: "musica" });
  assert.equal(spotifyVolumeLine({ action: "volume", step: -15 }, { ok: true }), "Baixei o som.");
  assert.equal(spotifyVolumeLine({ action: "volume", step: 15 }, { ok: true, confirmed: true }), "Aumentei o som.");
  assert.equal(spotifyVolumeLine({ action: "volume", volume: 30 }, { ok: true }), "Pronto, volume em 30 por cento.");
  assert.equal(spotifyVolumeLine({ action: "volume", step: -15 }, { ok: true, confirmed: false }), ""); // não conferido: o modelo diz
  assert.equal(spotifyVolumeLine({ action: "volume", step: -15 }, { ok: false }), "");
  assert.match(lib, /else if \(context\.volumeLine && musicOnly\) replyText = context\.volumeLine;/);
  // música + pergunta clara: as duas ferramentas juntas, sem rodada do modelo
  assert.deepEqual(route("Bota uma música mais tranquila aí, e depois me diz quantos clientes novos apareceram."), {
    name: "spotify",
    input: { acao: "tocar", busca: "música tranquila" },
    topic: "musica",
    also: { name: "consultar_crm", input: { assunto: "clientes_novos", periodo: "hoje" }, topic: "clientes_novos", speak: true }
  });
});

// 9. Bom dia: "Vai um sertanejo raiz…? Ou tá na vibe de outro estilo, rock, sertanejo, pagode…"
test("9: bom dia não repete na lista o estilo que ele mesmo sugeriu", () => {
  const sertanejo = MORNING_SUGGESTIONS.find((entry) => entry.id === "estilo-sertanejo-raiz");
  for (const tail of morningOpenChoices(sertanejo)) {
    assert.doesNotMatch(tail, /sertanejo/, tail);
    assert.match(tail, /rock[\s\S]*pagode[\s\S]*MPB/, tail);
  }
  for (const r of [0, 0.5, 0.99]) {
    const line = morningSuggestionLine(sertanejo, "Matheus", { random: () => r });
    assert.equal((line.match(/sertanejo/g) || []).length, 1, line);
  }
  assert.match(morningOpenChoices(null)[0], /rock, sertanejo ou pagode/);
});

// 10. Lentidão: ranking_periodo 6,5 s e relatorio_do_dia 6,4–7,5 s recalculando o que o pré-cálculo já tinha.
test("10: pré-cálculo até 1 hora nas leituras do Henry; meta do dia do resumo do dono vem do cache", () => {
  assert.match(reports, /const usableCache = \(entry\) => Boolean\(entry\) && \(Number\(entry\.staleMinutes\) \|\| 0\) <= HENRY_CACHE_MAX_AGE_MINUTES;/);
  assert.equal((reports.match(/if \(usableCache\(entry\) && sameRange\(entry\.payload, range\)\) return entry\.payload;/g) || []).length, 2);
  assert.match(reports, /export async function loadHenryOwnerMetaToday\(auth\)/);
  assert.match(inicioDono, /typeof loadMeta === "function" \? loadMeta\(\) : getOwnerTeamDailyOverview\(\{ period: "today" \}, auth\)/);
  assert.match(lib, /getPainelInicioDono\(auth, inicioPromise, \{ loadMeta: \(\) => loadHenryOwnerMetaToday\(auth\) \}\)/);
  assert.match(lib, /const contents = await Promise\.all\(blocks\.map/);
});

// 11. Detector do Treino.
test("11: Treino acusa frase de cache crua e texto duplicado na mesma resposta", () => {
  const reply = "Última atualização há 28 minutos. A meta da equipe está em 0 por cento. Última atualização há 28 minutos. Ninguém bateu a meta ainda.";
  const report = analyzeHenryTraining([{ owner: "E aí, Henry, como tá a meta do dia pra equipe?", reply }]);
  assert.ok(kinds(report).includes("cache_cru"));
  assert.ok(kinds(report).includes("texto_duplicado"));
  assert.equal(duplicatedSentence(reply), "Última atualização há 28 minutos.");
  assert.equal(duplicatedSentence("Hoje entraram 2 clientes novos. Ok. Ok."), ""); // frase curta repetida não conta
  const clean = analyzeHenryTraining([{ owner: "como tá a meta?", reply: "Ninguém bateu a meta ainda hoje; a equipe está zerada." }]);
  assert.equal(kinds(clean).includes("cache_cru"), false);
  assert.equal(kinds(clean).includes("texto_duplicado"), false);
});

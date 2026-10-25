// Achados do Treino 7 do Henry (rodada automática real de 2026-10-25T18:49:09Z, id 7298f274 em crm_settings
// henry_training_reports), com as falas reais do dono. Ver docs/CHANGELOG_AI.md (2026-10-25, "Henry: achados do Treino 7")
// e docs/INCIDENTES.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  henryAlreadyOpenReply,
  henryDirectRoute,
  henryGreetingReply,
  henryResumeTopic,
  henrySkipAndDeviceKind,
  henryTurnHint,
  isHenryAgreement,
  isHenryDiagnosisQuestion
} from "../lib/henry-voice-turn.mjs";
import { isHenryGreeting } from "../lib/henry-voice-persona.mjs";
import { buildHenryFunnelReport, henryFunnelBottleneck, resolveHenryPeriod } from "../lib/henry-reports-core.mjs";
import { classifyMorningMusicReply } from "../lib/henry-morning-core.mjs";
import { simulatedSpotifyDeviceTool, spotifyControlLine, spotifyDeviceLine } from "../lib/henry-spotify-core.mjs";
import { OVERVIEW_CACHE_KEYS, OVERVIEW_VALID_MINUTES, ROLLING_OVERVIEW_IDS, rollingOverviewRange } from "../lib/crm-metrics/overview-core.mjs";

const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
const reports = readFileSync(new URL("../lib/henry-reports.js", import.meta.url), "utf8");
const jobs = readFileSync(new URL("../lib/crm-metrics/jobs.js", import.meta.url), "utf8");
const TODAY = "2026-10-25";
const route = (text, turns = []) => henryDirectRoute(text, { turns, today: TODAY });

// 1. "quantas simulações o Eduardo rodou nos últimos trinta dias?" → consultar_corretor 9,3 s (comparar_corretores, logo
// depois, 0,18 s com o mesmo overview).
test("1: consultar_corretor lê o mesmo overview; meta só quando a fala usa; últimos 30 dias pré-calculado", () => {
  // Mesma leitura do comparar_corretores (readOverviewFor) e a meta de 30 dias calculada na hora só quando precisa.
  assert.match(lib, /const needsGoal = !HENRY_BROKER_METRIC_IDS\.includes\(metric\) \|\| metric === "meta";/);
  assert.match(lib, /softRead\("desempenho do corretor", readOverviewFor\(auth, range\)\), needsGoal \? softRead\("meta do corretor", readTeamGoalFor\(auth, range\)\) : null/);
  assert.match(lib, /buildHenryBrokerComparison\(\{ range, overview: await softRead\("comparação dos corretores", readOverviewFor\(auth, range\)\)/);
  // Pré-cálculo da janela de 30 dias no job dos pesados (só o Desempenho), validade igual à do mês.
  assert.deepEqual(ROLLING_OVERVIEW_IDS, ["ultimos_30_dias"]);
  assert.equal(OVERVIEW_CACHE_KEYS.ultimos_30_dias, "overview:ultimos_30_dias");
  assert.equal(OVERVIEW_VALID_MINUTES.ultimos_30_dias, 45);
  const range = rollingOverviewRange("ultimos_30_dias", TODAY);
  const henry = resolveHenryPeriod({ periodo: "ultimos_30_dias" }, TODAY);
  assert.deepEqual([range.startDate, range.endDate], [henry.startDate, henry.endDate]);
  assert.deepEqual([range.startDate, range.endDate], ["2026-09-26", "2026-10-25"]);
  assert.match(jobs, /\.\.\.ROLLING_OVERVIEW_IDS\.map\(\(id\) => \(\{\n\s+key: `overview_\$\{id\}`,\n\s+cacheKey: OVERVIEW_CACHE_KEYS\[id\],\n\s+everyMinutes: 25,/);
  assert.match(reports, /CACHED_PERIODS\.has\(range\.id\) \|\| ROLLING_OVERVIEW_IDS\.includes\(range\.id\) \? range\.id/);
  // O cache só vale se for a janela de HOJE (sameRange), como os demais.
  assert.match(reports, /if \(usableCache\(entry\) && sameRange\(entry\.payload, range\)\) return entry\.payload;/);
});

// 2. Gargalo trocando a cada resposta ("entre aprovação e venda" → "entre enviados e aprovados" → "na documentação").
test("2: gargalo determinístico no montador do funil (maior queda proporcional entre etapas seguidas)", () => {
  const overview = { metrics: { service: 300, simulation: 120, approvalPending: 40, approval: 20, sale: 3, prospecting: 500 }, funnel: { documentation: 60 } };
  const funnel = { atendimento: 300, simulacao: 120, documentacao: 60, enviadosAprovacao: 40, aprovados: 20, vendas: 3, prospeccao: 500 };
  const gargalo = henryFunnelBottleneck(funnel);
  assert.equal(gargalo.etapa, "entre aprovação e venda");
  assert.deepEqual([gargalo.de_quantidade, gargalo.para_quantidade, gargalo.queda_percentual], [20, 3, 85]);
  // Mesmos números → sempre o mesmo gargalo (3 perguntas seguidas = a mesma resposta).
  for (let index = 0; index < 3; index += 1) assert.deepEqual(henryFunnelBottleneck({ ...funnel }), gargalo);
  // Prospecção não entra; etapa sem gente em cima não conta; nada cai → null.
  assert.equal(henryFunnelBottleneck({ prospeccao: 1000, atendimento: 10, simulacao: 10, documentacao: 10, enviadosAprovacao: 10, aprovados: 10, vendas: 10 }), null);
  assert.equal(henryFunnelBottleneck({ atendimento: 0, simulacao: 0, documentacao: 0, enviadosAprovacao: 0, aprovados: 0, vendas: 0 }), null);
  const range = { spoken: "neste mês", label: "Este mês" };
  const report = buildHenryFunnelReport({ range, overview, diagnosis: true });
  assert.equal(report.spoken, "Neste mês, o gargalo tá entre aprovação e venda: de 20 aprovados saíram só 3 vendas, uma queda de 85%.");
  assert.deepEqual(report.facts.gargalo, gargalo);
  assert.match(report.facts.como_usar_gargalo, /fale SÓ esse gargalo/);
  assert.equal(buildHenryFunnelReport({ range, overview: { metrics: { service: 10, simulation: 5, approvalPending: 3, approval: 2, sale: 0 }, funnel: { documentation: 4 } }, diagnosis: true }).spoken, "Neste mês, o gargalo tá entre aprovação e venda: de 2 aprovados não saiu nenhuma venda, uma queda de 100%.");
  // Funil comum continua listando as etapas; resumo positivo não leva o gargalo (queda = negativo).
  assert.match(buildHenryFunnelReport({ range, overview }).spoken, /^Neste mês, o funil teve /);
  assert.equal(buildHenryFunnelReport({ range, overview, positive: true }).facts.gargalo, undefined);
  // "não fecha / me diz onde tá travando" = diagnóstico, mesma rota, mesmo período herdado da conversa.
  for (const ask of ["Qual é o gargalo?", "Henry, me diz onde tá travando", "não fecha", "Não tá fechando venda", "onde a gente tá errando?"]) {
    assert.ok(isHenryDiagnosisQuestion(ask), ask);
    assert.equal(route(ask)?.name, "funil_periodo", ask);
  }
  const turns = [{ role: "user", text: "qual o gargalo da semana passada?" }, { role: "assistant", text: "Na semana passada, o gargalo tá entre aprovação e venda." }];
  assert.deepEqual(route("não fecha", turns).input, { periodo: "semana_passada" });
  assert.deepEqual(route("me diz onde tá travando", turns).input, { periodo: "semana_passada" });
  assert.equal(isHenryDiagnosisQuestion("fecha a tela"), false);
  assert.match(lib, /diagnosis: plan \|\| context\.directTopic === "diagnostico" \|\| isHenryDiagnosisQuestion\(context\.question\),/); // Treino 8: o plano também usa o gargalo
  assert.match(henryTurnHint({ text: "não fecha", direct: route("não fecha") }), /fale SÓ esse gargalo/);
});

// 3. Bom dia: "Pode ser sim, mas coloca um pagode antes." → relatório sem música.
test("3: \"pode ser, mas coloca X antes/primeiro\" = toca o gênero X", () => {
  for (const reply of ["Pode ser sim, mas coloca um pagode antes.", "pode ser, mas toca um pagode primeiro", "Pode ser, mas antes coloca um pagode."]) {
    const result = classifyMorningMusicReply(reply);
    assert.equal(result.kind, "genre", reply);
    assert.equal(result.genre.id, "pagode", reply);
  }
  assert.equal(classifyMorningMusicReply("pode ser, mas coloca um rock primeiro").genre.id, "rock");
  // Cantor com "mas ... antes" vira só o nome na busca.
  assert.deepEqual(classifyMorningMusicReply("pode ser, mas coloca Thiaguinho antes"), { kind: "artist", query: "Thiaguinho" });
  // O aceite puro continua tocando a sugestão; "não" continua sendo não.
  assert.equal(classifyMorningMusicReply("Pode ser sim.").kind, "yes");
  assert.equal(classifyMorningMusicReply("Não.").kind, "no");
});

// 4. "E aí, Henry, boa tarde!" → "Boa tarde, Matheus! Hoje a equipe já fez 4 atendimentos. Tá rendendo."
test("4: cumprimento puro nunca traz número nem assunto do CRM (2ª trava, depois do modelo)", () => {
  assert.ok(isHenryGreeting("E aí, Henry, boa tarde!"));
  assert.equal(henryGreetingReply("Boa tarde, Matheus! Hoje a equipe já fez 4 atendimentos. Tá rendendo.", "E aí, Henry, boa tarde!"), "Boa tarde, Matheus!");
  assert.equal(henryGreetingReply("Hoje entraram dois clientes novos.", "E aí, Henry, boa tarde!"), "Boa tarde!");
  assert.equal(henryGreetingReply("Boa noite! Tudo certo por aqui.", "boa noite"), "Boa noite! Tudo certo por aqui.");
  assert.equal(henryGreetingReply("Valeu! A meta tá em 80%.", "valeu, Henry"), "Valeu!");
  assert.equal(henryGreetingReply("", "obrigado"), "Tamo junto!");
  assert.match(lib, /if \(greeting\) replyText = henryGreetingReply\(replyText, text\);/);
});

// 5. "voltando pro assunto do cliente" → "Neste mês já entraram 989 clientes novos." (3 rodadas).
test("5: voltar ao assunto de UM cliente sem nome na conversa = pergunta o nome, sem ferramenta", () => {
  const turns = [
    { role: "user", text: "Henry, e o do apartamento, aquele que a moça veio ontem?" },
    { role: "assistant", text: "Qual cliente? Me fala o nome, mesmo que seja só o primeiro." },
    { role: "user", text: "quantos clientes novos entraram esse mês?" },
    { role: "assistant", text: "Neste mês já entraram 989 clientes novos." },
    { role: "user", text: "quantas simulações o Eduardo rodou nos últimos trinta dias?" },
    { role: "assistant", text: "Eduardo teve 12 simulações nos últimos 30 dias." }
  ];
  const ask = "voltando pro assunto do cliente";
  const resume = henryResumeTopic(ask, turns);
  assert.equal(resume.topic, "cliente");
  assert.equal(resume.needsName, true);
  assert.match(resume.previous, /apartamento/);
  const hint = henryTurnHint({ text: ask, lastAssistant: turns[5].text, turns });
  assert.match(hint, /pergunte o nome/);
  assert.match(hint, /nenhuma ferramenta, nenhum número/);
  assert.equal(route(ask, turns), null);
  // Com o nome do cliente na conversa: retoma esse cliente (não pede o nome).
  const named = [{ role: "user", text: "como tá a Jeniffer, aquela cliente?" }, { role: "assistant", text: "A Jeniffer está em aprovação." }];
  assert.equal(henryResumeTopic("voltando pro assunto da cliente", named)?.needsName ?? false, false);
  assert.equal(henryResumeTopic(ask, named).needsName, false);
  // Sem nenhuma fala de cliente: a retomada geral de sempre.
  assert.equal(henryResumeTopic(ask, []).needsName, false);
  // "clientes" (plural) continua sendo o assunto geral.
  assert.equal(henryResumeTopic("voltando pro assunto dos clientes", turns)?.needsName, undefined);
  assert.match(lib, /Boolean\(henryResumeTopic\(text, previous\)\?\.needsName\)/);
});

// 6. "troca essa música aí e coloca na Alexa" → "Não consegui trocar: o Spotify não respondeu de verdade…" (Treino).
test("6: próxima faixa + troca de aparelho pela rota direta, em sequência; Treino simula sucesso coerente", () => {
  const ask = "Henry, troca essa música aí e coloca na Alexa.";
  assert.equal(henrySkipAndDeviceKind(ask), "alexa");
  assert.deepEqual(route(ask), { name: "spotify", input: { acao: "proxima" }, topic: "musica", also: { name: "mudar_aparelho_spotify", input: { aparelho: "alexa" }, topic: "musica" }, sequential: true });
  // Só a troca de aparelho ("muda a música pra Alexa") continua sendo só o aparelho.
  assert.equal(henrySkipAndDeviceKind("muda a música pra Alexa"), "");
  assert.deepEqual(route("toca na Alexa"), { name: "mudar_aparelho_spotify", input: { aparelho: "alexa" }, topic: "musica" });
  // Treino: sucesso simulado, a mesma fala fixa do sucesso real.
  const simulated = simulatedSpotifyDeviceTool({ aparelho: "alexa" });
  assert.equal(simulated.line, "Pronto, passei pra Alexa.");
  assert.equal(simulated.result.ok, true);
  assert.doesNotMatch(simulated.text, /de verdade|não/i);
  assert.equal(simulatedSpotifyDeviceTool({ aparelho: "computador" }).line, "Voltou pro computador.");
  assert.equal(simulatedSpotifyDeviceTool({}).result, null);
  // Sem Spotify conectado (real): fala curta e clara.
  assert.equal(spotifyDeviceLine({ ok: false, reason: "not_connected", requested: "alexa" }), "O Spotify não tá conectado. Dá pra conectar na tela Alexa e Henry.");
  assert.equal(spotifyControlLine({ action: "proxima" }, { ok: true }), "Troquei a música.");
  assert.equal(spotifyControlLine({ action: "proxima" }, { ok: false }), "");
  // Servidor: em sequência quando sequential; fala fixa "Troquei a música. Pronto, passei pra Alexa."
  assert.match(lib, /if \(direct\.sequential\) for \(const block of blocks\) contents\.push\(await runTool\(block\.name, block\.input, auth, context\)\);/);
  assert.match(lib, /step\.input\?\.acao === "proxima" \? Boolean\(context\.controlLine\)/);
  assert.match(lib, /else if \(context\.deviceLine && musicOnly\) replyText = \[context\.controlLine, context\.deviceLine\]\.filter\(Boolean\)\.join\(" "\);/);
  assert.match(lib, /\? simulatedSpotifyDeviceTool\(input \|\| \{\}\)/);
});

// 7. "Beleza, pode abrir." logo depois de "A tela de Clientes já tá aberta" → "Pode ficar tranquilo."
test("7: \"pode abrir\" de tela que já está aberta = \"Tá aberta, é só olhar.\"", () => {
  assert.equal(henryAlreadyOpenReply("Beleza, pode abrir.", "A tela de Clientes já tá aberta no computador."), "Tá aberta, é só olhar.");
  assert.equal(henryAlreadyOpenReply("abre aí", "A tela de Clientes já está aberta."), "Tá aberta, é só olhar.");
  assert.equal(henryAlreadyOpenReply("Beleza, pode abrir.", "Quer que eu abra a tela de Clientes?"), "");
  assert.equal(henryAlreadyOpenReply("Beleza.", "A tela de Clientes já tá aberta."), "");
  assert.equal(isHenryAgreement("Beleza, pode abrir."), false); // pedido, não concordância
  assert.match(lib, /const fixedReply = !image && !accepted \? henryAlreadyOpenReply\(text, lastAssistant\) \|\| \(locked \? "" : henryPlaceClientReply\(text\)\) : "";/); // Treino 8: + cliente por lugar
});

// 8. "conversas no WhatsApp esperando resposta?" → 3 rodadas, 4,2 s.
test("8: conversas esperando resposta pela rota direta (conversas_aguardando, fala pronta)", () => {
  const whatsapp = { name: "conversas_aguardando", input: {}, topic: "whatsapp", speak: true };
  for (const ask of ["conversas no WhatsApp esperando resposta?", "Henry, quantas conversas no WhatsApp esperando resposta?", "tem mensagem aguardando resposta?", "quem tá esperando resposta no WhatsApp?"]) {
    assert.deepEqual(route(ask), whatsapp, ask);
  }
  // Com nome de corretor fica com o modelo (precisa do corretor); etapa esperando continua a etapa.
  assert.equal(route("conversas da Carol esperando resposta?"), null);
  assert.equal(route("quantos aprovados estão esperando?")?.input?.etapa, "aprovados");
});

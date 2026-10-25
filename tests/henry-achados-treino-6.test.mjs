// Achados do Treino 6 do Henry (rodada automática real de 2026-10-25T18:26:39Z, id 527ec7a5 em crm_settings
// henry_training_reports), com as falas reais do dono. Ver docs/CHANGELOG_AI.md (2026-10-25, "Henry: achados do Treino 6")
// e docs/INCIDENTES.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HENRY_STAGE_NOW_NOTE,
  henryClaimedActionWithoutTool,
  henryDirectRoute,
  henryTurnHint,
  henryVolumeRequest,
  isHenryAgreement
} from "../lib/henry-voice-turn.mjs";
import { isMusicRequest, henryMusicIntent } from "../lib/henry-voice-narration.mjs";
import { buildQuery } from "../lib/alexa-v2/router.mjs";
import { buildHenryFunnelReport, buildHenryStageWaitingReport, clientFromConversation, pickClientMatches } from "../lib/henry-reports-core.mjs";
import { resolveHenryPeriod } from "../lib/henry-reports-core.mjs";
import { classifyMorningMusicReply } from "../lib/henry-morning-core.mjs";
import { morningGenreTarget } from "../lib/henry-morning-music-core.mjs";
import { buildHenryStaticPrompt } from "../lib/henry-voice-persona.mjs";
import { analyzeHenryTraining } from "../lib/henry-training-core.mjs";

const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
const reports = readFileSync(new URL("../lib/henry-reports.js", import.meta.url), "utf8");
const TODAY = "2026-10-25";
const route = (text, turns = []) => henryDirectRoute(text, { turns, today: TODAY });
const kinds = (report) => report.issues.map((issue) => issue.kind);
const idSlot = (id) => ({ value: id, resolutions: { resolutionsPerAuthority: [{ status: { code: "ER_SUCCESS_MATCH" }, values: [{ value: { id, name: id } }] }] } });

// 1. "quem tá parado há mais tempo no CRM?" → "o assunto de clientes parados não tá disponível por essa via" (consultar_crm, 2 rodadas).
test("1: assunto da situação de AGORA (parados/sem contato) com período longo vira o agora, nunca a recusa de período", () => {
  // Causa: o catálogo só tem sem_contato para hoje; com período longo a recusa virava a instrução das ferramentas de período
  // (que não têm "parados") e o modelo desistia.
  const deps = { brokers: null, today: () => TODAY };
  assert.equal(buildQuery({ intent: "ListarIntent", slots: { assunto: idSlot("sem_contato"), periodo: idSlot("este_mes") }, ctx: null, deps }).ok, false);
  assert.equal(buildQuery({ intent: "ListarIntent", slots: { assunto: idSlot("sem_contato"), periodo: idSlot("hoje") }, ctx: null, deps }).ok, true);
  assert.match(lib, /const NOW_CATALOG_TOPICS = new Set\(\["etapa", "sem_contato", "sem_atendimento", "fila_roleta", "acao_pendente", "atividades_atrasadas", "reunioes_atrasadas", "atencao"\]\);/);
  assert.match(lib, /if \(NOW_CATALOG_TOPICS\.has\(query\.assunto\) && query\.periodo && query\.periodo !== "hoje" && query\.periodo !== "ontem"\) query = \{ \.\.\.query, periodo: "hoje" \};/);
  // A coerção roda ANTES da recusa (consultCatalog) e das ferramentas de período.
  assert.ok(lib.indexOf("NOW_CATALOG_TOPICS.has(query.assunto)") < lib.indexOf("const rankingPeriod = rankingPeriodFor(query, context.question);"));
  assert.match(lib, /parados\/sem contato \(sem_contato; 'quem está parado há mais tempo' = formato lista\)/);
  assert.equal(route("Henry, me fala aí quem tá parado há mais tempo no CRM?"), null); // segue com o modelo e o catálogo
});

// 2. "Baixa um pouco aí, Henry, tá muito alto." → "Já abaixei o volume." sem nenhuma ferramenta.
test("2: volume curto sem a palavra som/volume pela rota direta + barreira de ação dita sem ferramenta", () => {
  const down = { name: "spotify", input: { acao: "volume", ajuste: "mais_baixo" }, topic: "musica" };
  assert.deepEqual(route("Baixa um pouco aí, Henry, tá muito alto."), down);
  assert.deepEqual(route("tá alto demais"), down);
  assert.deepEqual(route("abaixa um pouquinho"), down);
  assert.deepEqual(henryVolumeRequest("aumenta um pouco aí"), { acao: "volume", ajuste: "mais_alto" });
  assert.deepEqual(henryVolumeRequest("sobe aí"), { acao: "volume", ajuste: "mais_alto" });
  assert.deepEqual(henryVolumeRequest("tá muito baixo, aumenta"), { acao: "volume", ajuste: "mais_alto" });
  for (const other of ["baixa o relatório", "tá baixo o número de leads", "o volume de leads baixou?", "quantos clientes novos baixaram?"]) assert.equal(henryVolumeRequest(other), null, other);

  // Barreira geral: afirmou a ação sem a ferramenta dela.
  assert.equal(henryClaimedActionWithoutTool("Já abaixei o volume.", [])?.kind, "volume");
  assert.equal(henryClaimedActionWithoutTool("Já abaixei o volume.", ["spotify"]), null);
  assert.equal(henryClaimedActionWithoutTool("Pronto, a música foi pra Alexa.", [])?.kind, "aparelho");
  assert.equal(henryClaimedActionWithoutTool("Pronto, a música foi pra Alexa.", ["mudar_aparelho_spotify"]), null);
  assert.equal(henryClaimedActionWithoutTool("Toquei um pagode pra você.", [])?.kind, "musica");
  assert.equal(henryClaimedActionWithoutTool("Abri a tela de Clientes.", [])?.kind, "tela");
  assert.equal(henryClaimedActionWithoutTool('Enviei para a Carol: "vem até a minha sala".', [])?.kind, "envio");
  for (const fine of ["Não abaixei o volume ainda.", "Vou tocar algo pra você.", "A tela de Clientes já tá aberta no computador.", "A conversão diminui quando o lead esfria."]) assert.equal(henryClaimedActionWithoutTool(fine, []), null, fine);
  assert.match(henryClaimedActionWithoutTool("Já abaixei o volume.", []).retry, /Chame AGORA a ferramenta \(spotify\)/);
  // Servidor: UMA rodada que obriga a ferramenta; continuou sem → a frase de que não fez.
  assert.match(lib, /const claimed = withTools && !claimRetried && rounds < MAX_TOOL_ROUNDS && !toolUses\.length \? henryClaimedActionWithoutTool\(replyText, context\.tools\.map\(\(tool\) => tool\.name\)\) : null;/);
  assert.match(lib, /messages\.push\(\{ role: "user", content: claimed\.retry \}\);\n\s+forceTool = true;/);
  assert.match(lib, /const stillClaimed = henryClaimedActionWithoutTool\(replyText, context\.tools\.map\(\(tool\) => tool\.name\)\);\n\s+if \(stillClaimed\) \{[\s\S]*?replyText = stillClaimed\.fail;/);
  // Treino: achado "acao_sem_ferramenta" com a troca real.
  const report = analyzeHenryTraining([{ owner: "Baixa um pouco aí, Henry, tá muito alto.", reply: "Já abaixei o volume.", toolNames: [] }]);
  assert.ok(kinds(report).includes("acao_sem_ferramenta"));
  assert.equal(kinds(analyzeHenryTraining([{ owner: "Baixa um pouco aí", reply: "Baixei o som.", toolNames: ["spotify"] }])).includes("acao_sem_ferramenta"), false);
  assert.match(buildHenryStaticPrompt(), /Nunca diga que fez uma ação \(abaixei, aumentei, toquei/);
});

// 3. "Cara, põe uma coisa mais de boa aí e depois me diz quantos cliente novo entrou hoje." → só consultar_crm.
test("3: pedido composto com clima \"de boa\" e vocativo no começo = música E clientes novos; música não reconhecida = modelo", () => {
  const ask = "Cara, põe uma coisa mais de boa aí e depois me diz quantos cliente novo entrou hoje.";
  assert.equal(isMusicRequest(ask), true);
  assert.deepEqual(route(ask), {
    name: "spotify",
    input: { acao: "tocar", busca: "música tranquila" },
    topic: "musica",
    also: { name: "consultar_crm", input: { assunto: "clientes_novos", periodo: "hoje" }, topic: "clientes_novos", speak: true }
  });
  assert.deepEqual(route("bota uma pra relaxar")?.input, { acao: "tocar", busca: "música relaxante" });
  assert.deepEqual(route("coloca uma música mais animada")?.input, { acao: "tocar", busca: "música animada" });
  assert.deepEqual(route("põe uma coisa mais tranquila")?.input, { acao: "tocar", busca: "música tranquila" });
  // Verbo de tocar no começo sem pedido de música reconhecido + outra parte: nunca a rota só da parte do CRM.
  assert.equal(route("coloca o cliente na tela e depois me diz quantos clientes novos entraram hoje"), null);
  assert.equal(isMusicRequest("Cara, quantos clientes novos entraram hoje?"), false);
});

// 4. Funil do mês "20 aprovados" x etapa "9 aprovados esperando" → "Foi mal, eu tinha errado o número."
test("4: aprovados do período x clientes na etapa agora — fala, números do funil, dica e persona", () => {
  const rows = [{ full_name: "Jeniffer Lima", since: "2026-09-07T15:00:00Z" }, { full_name: "Stephanie Reis", since: "2026-09-23T15:00:00Z" }];
  const report = buildHenryStageWaitingReport({ etapa: "aprovados", total: 9, rows, today: TODAY });
  assert.equal(report.spoken, "Hoje 9 clientes continuam na etapa aprovado, esperando; os mais antigos na etapa são Jeniffer há 48 dias e Stephanie há 32 dias.");
  assert.equal(report.facts.agora, true);
  const funnel = buildHenryFunnelReport({ range: resolveHenryPeriod({ periodo: "este_mes" }, TODAY), overview: { metrics: { prospecting: 1100, service: 445, simulation: 147, approval: 20, sale: 3 }, funnel: {} } });
  assert.match(funnel.facts.como_ler, /PASSOU por ela no período[\s\S]*Nunca chame os aprovados do período de 'esperando'/);
  const turns = [
    { role: "user", text: "Cara, e aí, quantas vendas a gente fechou esse mês?" },
    { role: "assistant", text: "Até agora este mês a gente fechou 3 vendas, e já são 20 clientes aprovados esperando a hora de virar venda." }
  ];
  const ask = "Não foi isso que eu perguntei, Henry. Eu quero saber por que esses vinte estão parados.";
  const direct = route(ask, turns);
  assert.deepEqual(direct, { name: "consultar_crm", input: { assunto: "etapa", etapa: "aprovados", formato: "lista" }, topic: "etapa", speak: "always" });
  const hint = henryTurnHint({ text: ask, lastAssistant: turns[1].text, turns, direct });
  assert.ok(hint.includes(HENRY_STAGE_NOW_NOTE));
  assert.match(hint, /No mês 20 foram aprovados; hoje 9 continuam na etapa aprovado, esperando/);
  assert.match(hint, /nunca diga que errou o número/);
  assert.match(buildHenryStaticPrompt(), /nunca diga que errou o número — diga os dois/);
});

// 5. Depois da lista dos aprovados (Jeniffer, 48 dias), "começa pela Jeniffer" → "Achei duas Jenifferes: uma arquivada e outra aprovada."
test("5: nome repetido desempata pela conversa (etapa citada) e ignora o arquivado quando há um ativo citado", () => {
  const label = (status) => ({ approved: "Cliente aprovado", archived: "Arquivado", in_service: "Em atendimento", approval_pending: "Aguardando aprovação" })[status] || status;
  const rows = [
    { id: "r", full_name: "Jeniffer Rocha", status: "archived", responsible_user_id: "b1" },
    { id: "l", full_name: "Jeniffer Lima", status: "approved", responsible_user_id: "b2" }
  ];
  const query = { kind: "name", term: "Jeniffer", label: "Jeniffer" };
  const recentText = "Combinado. Hoje a gente tem 9 aprovados esperando, e a Jeniffer é a mais antiga.";
  assert.deepEqual(pickClientMatches(query, rows, () => "", { recentText, statusLabel: label }).map((row) => row.id), ["l"]);
  // Etapa não citada, mas o nome foi falado e só um não está arquivado → ele.
  assert.equal(clientFromConversation(query, rows, { recentText: "A Jeniffer é a mais antiga.", statusLabel: label })?.id, "l");
  // Dois ativos: a etapa citada decide.
  const both = [...rows, { id: "a", full_name: "Jeniffer Alves", status: "in_service", responsible_user_id: "b3" }];
  assert.equal(clientFromConversation(query, both, { recentText, statusLabel: label })?.id, "l");
  // "aprovados" não confunde com "Aguardando aprovação".
  assert.equal(clientFromConversation(query, [{ id: "p", full_name: "Jeniffer P", status: "approval_pending" }, rows[1]], { recentText, statusLabel: label })?.id, "l");
  // Nome não falado pelo Henry ou dois ativos sem pista → continua perguntando qual.
  assert.equal(pickClientMatches(query, rows, () => "", { recentText: "Hoje entraram 2 clientes novos.", statusLabel: label }).length, 2);
  assert.equal(clientFromConversation(query, both, { recentText: "A Jeniffer é a mais antiga.", statusLabel: label }), null);
  assert.equal(pickClientMatches(query, rows).length, 2); // sem contexto: igual a antes
  assert.match(reports, /pickClientMatches\(query, found\[index\], brokerName, \{ recentText, statusLabel: clientStatusLabel \}\)/);
  assert.match(lib, /searchHenryClientsMany\(auth, queries, \{ withPhone, recentText \}\)/);
});

// 6. Bom dia: "Hoje tá de pagode mesmo, bora nessa." → "Pagode então. Vou tocar algo pra você, é só me dizer o artista…" (não tocou).
test("6: gênero do bom dia com enfeite em volta toca o gênero (mesmo caminho no app e no Treino)", () => {
  const reply = classifyMorningMusicReply("Hoje tá de pagode mesmo, bora nessa.");
  assert.equal(reply.kind, "genre");
  assert.equal(reply.genre.id, "pagode");
  assert.deepEqual(morningGenreTarget(reply.genre), { target: { query: "pagode", type: "playlist" }, choice: "genero", query: "pagode" });
  assert.equal(henryMusicIntent({ mode: "report", question: "Hoje tá de pagode mesmo, bora nessa.", morningStep: "music" }), true);
  assert.equal(classifyMorningMusicReply("hoje é dia de pagode").genre?.id, "pagode");
  assert.equal(classifyMorningMusicReply("to na vibe de pagode hoje").genre?.id, "pagode");
  assert.equal(classifyMorningMusicReply("pagode do Thiaguinho").kind, "artist");
  assert.equal(classifyMorningMusicReply("relatório do dia").kind, "other");
  assert.equal(classifyMorningMusicReply("quantos clientes novos hoje?").kind, "other");
});

// 7. "dá uma olhada no WhatsApp pra mim" → "quer saber as conversas aguardando ou de um cliente?"
test("7: olhar o WhatsApp = resumo das conversas aguardando, direto", () => {
  const whatsapp = { name: "conversas_aguardando", input: {}, topic: "whatsapp", speak: true };
  const real = "Beleza, pode deixar aberta mesmo. Ah, e antes de mexer nisso, dá uma olhada no WhatsApp pra mim.";
  assert.equal(isHenryAgreement(real), false); // antes: "Beleza…" virava concordância, sem ferramentas
  assert.deepEqual(route(real), whatsapp);
  assert.deepEqual(route("dá uma olhada no WhatsApp pra mim"), whatsapp);
  assert.deepEqual(route("como tá o WhatsApp?"), whatsapp);
  assert.equal(route("dá uma olhada no WhatsApp da Carol"), null); // de um corretor: o modelo
  assert.equal(isHenryAgreement("Beleza, valeu."), true);
});

// 8. "Tens razão, desculpa." → "Tem razão".
test("8: persona em português do Brasil (\"Tem razão\") + trava no código e achado no Treino", () => {
  assert.match(buildHenryStaticPrompt(), /"Tem razão" \(nunca "Tens razão"\)/);
  assert.match(lib, /replyText = replyText\.replace\(\/\\b\(\[Tt\]\)ens razão\\b\/g, "\$1em razão"\);/);
  assert.ok(kinds(analyzeHenryTraining([{ owner: "Cara, você tá falando a mesma coisa de novo.", reply: "Tens razão, desculpa." }])).includes("tom_portugal"));
});

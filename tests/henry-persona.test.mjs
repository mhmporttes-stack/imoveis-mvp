import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AVOID_LAST,
  HENRY_GOODBYES,
  HENRY_LISTEN_PROMPTS,
  HENRY_REPORT_INTROS,
  HENRY_WEB_SEARCH_MAX_USES,
  buildHenryDynamicPrompt,
  buildHenryStaticPrompt,
  buildHenrySystemBlocks,
  buildReportRewritePrompt,
  collectWebSources,
  henryWebSearchTool,
  looksLikeWebQuery,
  openingsFrom,
  pickVariant,
  rememberVariant,
  reportNumbersMatch,
  samplingFor,
  sourcesDetail,
  stripUrls,
  webSearchesFrom
} from "../lib/henry-voice-persona.mjs";
import {
  DAY_MEMORY_MAX_EXCHANGES,
  NOTES_MAX,
  SENSITIVE_PLACEHOLDER,
  addNote,
  appendDayTurns,
  dayTurns,
  memoryText,
  modelHistoryFromDay,
  parseMemoryCommand,
  removeNotes
} from "../lib/henry-memory-core.mjs";
import { henryWebSearchFromSetting } from "../lib/henry-voice-core.mjs";
import { elevenLabsVoiceSettings } from "../lib/henry-voice-providers.mjs";
import { detectBargeIn } from "../lib/henry-voice-conversation.mjs";
import { isSafeToSpeak } from "../lib/alexa-v2/sanitize.mjs";

const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");

// --- Personalidade --------------------------------------------------------------------------------------------------
test("prompt: assistente pessoal, jeito de amigo e TODAS as travas (somente consulta, sem CPF/telefone, números das ferramentas)", () => {
  const prompt = buildHenryStaticPrompt();
  assert.match(prompt, /assistente pessoal do Matheus Machado/);
  assert.match(prompt, /amigo próximo/);
  assert.match(prompt, /"tá", "pra", "a gente", "beleza", "olha só", "bora"/);
  assert.match(prompt, /nunca repita a mesma abertura/);
  assert.match(prompt, /sem "Segue o relatório"/);
  assert.match(prompt, /No CRM você só CONSULTA/);
  assert.match(prompt, /Nunca fale CPF, renda, salário, FGTS, telefone, e-mail/);
  assert.match(prompt, /Todo número ou nome do CRM vem SEMPRE de uma ferramenta/);
  assert.match(prompt, /Nunca leia links/);
  assert.match(prompt, /Minha Casa Minha Vida/); // conhecimento de base
  // Saudação/papo casual (dono, 2026-10-22: "ninguém fala assim"): 1 frase, espelha, sem menu, sem responder a si mesmo.
  assert.match(prompt, /Saudação e papo casual/);
  assert.match(prompt, /UMA frase curta/);
  assert.match(prompt, /"Boa noite, Matheus! E aí, como foi o dia\?"/); // exemplos variados (dono, 2026-10-23: vocabulário repetitivo)
  assert.match(prompt, /Não use sempre "tudo certo por aí"/);
  assert.match(prompt, /Nunca responda a sua própria pergunta/);
  assert.match(prompt, /nunca ofereça ajuda nem menu/);
  // A parte fixa vai para o cache de prompt; a variável traz data/hora de Brasília, lembretes, memória e variação.
  const blocks = buildHenrySystemBlocks("x");
  assert.deepEqual(blocks[0].cache_control, { type: "ephemeral" });
  assert.equal(blocks[1].text, "x");
  const dynamic = buildHenryDynamicPrompt({ now: new Date("2026-10-22T20:30:00Z"), todayKey: "2026-10-22", notes: ["reunião com a Caixa sexta"], daySummary: 'vocês já falaram de "leads".', usedOpenings: ["Opa, boa pergunta"], hint: "comece pelo número", webSearch: true });
  assert.match(dynamic, /17:30/); // Brasília
  assert.match(dynamic, /horário de Brasília/);
  assert.match(dynamic, /reunião com a Caixa sexta/);
  assert.match(dynamic, /não repita nenhuma/);
  assert.match(dynamic, /Pesquisa na internet: LIGADA/);
  assert.match(buildHenryDynamicPrompt({ webSearch: false }), /DESLIGADA/);
  // O prompt fixo fica antes das preferências de estilo (que nunca mudam as regras).
  assert.match(lib, /stylePrompt: buildHenryStylePrompt\(style\)/);
});

test("tom amigo na voz: ElevenLabs mais expressiva (estabilidade ~0,26, estilo ~0,6, speaker boost); velocidade da tela mantida", () => {
  const friend = elevenLabsVoiceSettings({ tone: "descontraido", speed: "rapido" });
  assert.ok(friend.stability >= 0.25 && friend.stability <= 0.3);
  assert.ok(friend.style >= 0.55 && friend.style <= 0.65);
  assert.equal(friend.use_speaker_boost, true);
  assert.equal(friend.speed, 1.1);
  assert.deepEqual(elevenLabsVoiceSettings({}), elevenLabsVoiceSettings({ tone: "descontraido" })); // sem tom = amigo
  assert.equal(elevenLabsVoiceSettings({ tone: "profissional" }).stability, 0.45);
});

test("variação: Haiku 5.5 sem temperature (a documentação manda omitir); outros modelos 0,9", () => {
  assert.deepEqual(samplingFor("claude-haiku-5-5"), {});
  assert.deepEqual(samplingFor("claude-sonnet-5-5"), {});
  assert.deepEqual(samplingFor("claude-haiku-4-5"), { temperature: 0.9 });
  assert.match(lib, /\.\.\.samplingFor\(HENRY_MODEL\)/);
  assert.deepEqual(openingsFrom([{ role: "assistant", text: "Opa, boa pergunta! Hoje..." }, { role: "user", text: "x" }]), ["Opa, boa pergunta! Hoje"]);
});

test("bancos de frases: 20+ cada, sorteio sem repetir as últimas 5", () => {
  for (const bank of [HENRY_REPORT_INTROS, HENRY_LISTEN_PROMPTS, HENRY_GOODBYES]) {
    assert.ok(bank.length >= 20, `${bank[0]}…: ${bank.length}`);
    assert.equal(new Set(bank).size, bank.length);
    let recent = [];
    for (let index = 0; index < 60; index += 1) {
      const choice = pickVariant(bank, recent, () => (index * 0.618) % 1);
      assert.ok(!recent.slice(-AVOID_LAST).includes(choice), `repetiu "${choice}"`);
      recent = rememberVariant(recent, choice);
    }
  }
  for (const text of [...HENRY_REPORT_INTROS, ...HENRY_GOODBYES]) {
    assert.ok(isSafeToSpeak(text), text);
    assert.doesNotMatch(text, /Segue o relatório|Prezado/);
  }
  for (const text of HENRY_GOODBYES) assert.equal(detectBargeIn(text, "").interrupt, false, text); // a própria despedida não se interrompe
});

// --- Relatório do dia gerado pelo modelo: trava de números ----------------------------------------------------------
test("relatório no jeito de amigo: todo número vem dos dados; número inventado ou por extenso cai na reserva", () => {
  const source = "Boa tarde, Matheus. Hoje você tem 89 clientes aguardando resposta e 23 atividades atrasadas. Comece por Teste, que espera há 27 dias.";
  assert.equal(reportNumbersMatch(source, "Boa tarde, Matheus! Olha, hoje tem bastante coisa: 89 clientes esperando resposta e 23 atividades atrasadas. Começa pelo Teste, que tá esperando há 27 dias."), true);
  assert.equal(reportNumbersMatch(source, "Boa tarde, Matheus! Quase 90 clientes esperando e 23 atrasadas."), true); // arredondamento honesto
  assert.equal(reportNumbersMatch(source, "Boa tarde! 95 clientes esperando."), false); // inventado
  assert.equal(reportNumbersMatch(source, "Boa tarde! 89 clientes e 4 leads novos."), false); // número que não está nos dados
  assert.equal(reportNumbersMatch(source, "Boa tarde! Oitenta e nove clientes esperando."), false); // por extenso não passa
  const prompt = buildReportRewritePrompt({ address: "Matheus", usedOpenings: ["Olha só"] });
  assert.match(prompt, /use SÓ os números do texto, em DÍGITOS/);
  assert.match(prompt, /sem "Segue o relatório"/);
  assert.match(prompt, /Não comece com nada parecido com: "Olha só"/);
  // Fluxo do servidor: modelo → trava de números → barreira da fala; falhou → reserva com abertura sorteada.
  assert.match(lib, /if \(!text \|\| !reportNumbersMatch\(factual, text\)\)/);
  assert.match(lib, /const reply = rewritten \|\| \(fallback !== HENRY_FALLBACK_REPLY \? fallback : factual\)/);
  assert.match(lib, /intro: pick\("intro", HENRY_REPORT_INTROS\)/);
});

// --- Pesquisa na internet ---------------------------------------------------------------------------------------------
test("pesquisa na internet: ferramenta oficial, no máximo 3 buscas, Marília/SP; nasce ligada; custo por busca", () => {
  assert.deepEqual(henryWebSearchTool(), {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: 3,
    user_location: { type: "approximate", city: "Marília", region: "São Paulo", country: "BR", timezone: "America/Sao_Paulo" }
  });
  assert.equal(HENRY_WEB_SEARCH_MAX_USES, 3);
  assert.equal(henryWebSearchFromSetting({}), true);
  assert.equal(henryWebSearchFromSetting(null), true);
  assert.equal(henryWebSearchFromSetting({ webSearch: false }), false);
  // A ferramenta só entra no pedido com a pesquisa ligada; cada busca vira uma linha henry_web_search.
  assert.match(lib, /return webSearch \? \[\.\.\.base, henryWebSearchTool\(\)\] : base;/); // henryToolsFor (tela de bloqueio tira as do CRM)
  assert.match(lib, /feature: "henry_web_search"/);
  assert.equal(webSearchesFrom({ server_tool_use: { web_search_requests: 2 } }), 2);
  assert.equal(webSearchesFrom({}), 0);
  assert.match(lib, /data\.stop_reason === "pause_turn"/);
  assert.equal(looksLikeWebQuery("Henry, pesquisa o preço do dólar"), true);
  assert.equal(looksLikeWebQuery("vai chover hoje em Marília?"), true);
  assert.equal(looksLikeWebQuery("quantos leads hoje?"), false);
});

test("fontes: só na tela (https), nunca link na voz", () => {
  const blocks = [
    { type: "text", text: "Segundo o G1, ", citations: [{ url: "https://g1.globo.com/sp/x", title: "G1 notícia" }, { url: "javascript:alert(1)", title: "ruim" }] },
    { type: "text", text: "veja www.exemplo.com.br e https://a.b/c agora." }
  ];
  const sources = collectWebSources(blocks);
  assert.deepEqual(sources, [{ title: "G1 notícia", host: "g1.globo.com", url: "https://g1.globo.com/sp/x" }]);
  assert.equal(sourcesDetail(sources).sections[0].rows[0].href, "https://g1.globo.com/sp/x");
  assert.equal(stripUrls("veja www.exemplo.com.br e https://a.b/c agora."), "veja e agora.");
  assert.match(lib, /safeHenryReply\(stripUrls\(replyText\) \|\| fallback[,)]/);
});

// --- Memória do dia (REGRA OFICIAL, dono 2026-10-22) -------------------------------------------------------------------
test("memória do dia: virada do dia zera, limite de 40 trocas e 200 caracteres, nunca dado sensível", () => {
  const stored = appendDayTurns(null, "2026-10-22", [{ role: "user", text: "quantos leads?" }, { role: "assistant", text: "Entraram 4 leads." }]);
  assert.equal(stored.date, "2026-10-22");
  assert.equal(dayTurns(stored, "2026-10-22").length, 2);
  assert.deepEqual(dayTurns(stored, "2026-10-23"), []); // meia-noite de Brasília: outro dia, memória vazia
  assert.equal(appendDayTurns(stored, "2026-10-23", [{ role: "user", text: "oi" }]).turns.length, 1);
  let big = null;
  for (let index = 0; index < 60; index += 1) big = appendDayTurns(big, "2026-10-22", [{ role: "user", text: `p${index}` }, { role: "assistant", text: `r${index}` }]);
  assert.equal(big.turns.length, DAY_MEMORY_MAX_EXCHANGES * 2);
  assert.equal(big.turns[0].text, "p20"); // as mais antigas saem
  assert.ok(memoryText("x".repeat(500)).length <= 200);
  assert.equal(memoryText("o CPF dela é 123.456.789-00"), SENSITIVE_PLACEHOLDER);
  assert.equal(memoryText("liga no (14) 99840-7380"), SENSITIVE_PLACEHOLDER);
  const { history, summary } = modelHistoryFromDay(big.turns);
  assert.equal(history.length, 16); // ~8 trocas vão ao modelo
  assert.equal(history[0].role, "user");
  assert.match(summary, /vocês já falaram de/);
  assert.deepEqual(modelHistoryFromDay([]), { history: [], summary: "" });
  // Gravada DEPOIS da resposta (background), só texto.
  assert.match(lib, /function rememberExchange\(auth, question, reply, plan = null\) \{\n  if \(!question && !reply\) return;\n  background\(/);
});

test("comandos de memória: lembrar, esquecer lembrete e esquecer a conversa de hoje", () => {
  assert.deepEqual(parseMemoryCommand("Henry, lembre que a reunião com a Caixa é sexta"), { kind: "remember", note: "a reunião com a Caixa é sexta" });
  assert.deepEqual(parseMemoryCommand("anota que o Pedro prefere manhã."), { kind: "remember", note: "o Pedro prefere manhã" });
  assert.deepEqual(parseMemoryCommand("esquece o lembrete da Caixa"), { kind: "forget", term: "Caixa" });
  assert.deepEqual(parseMemoryCommand("Henry, esquece a conversa de hoje"), { kind: "forget_today" });
  assert.deepEqual(parseMemoryCommand("apaga a memória de hoje"), { kind: "forget_today" });
  assert.equal(parseMemoryCommand("quantos leads hoje?"), null);
  assert.equal(parseMemoryCommand("lembra quantos leads tinha ontem?"), null); // pergunta, não comando
  let notes = { items: [] };
  for (let index = 0; index < 35; index += 1) notes = { items: addNote(notes, `lembrete ${index}`).items };
  assert.equal(notes.items.length, NOTES_MAX);
  assert.equal(addNote(notes, "o telefone dele é 14998407380").ok, false); // sensível: não guarda
  const removed = removeNotes({ items: [{ text: "Reunião com a Caixa sexta" }, { text: "Ligar pro Pedro" }] }, "caixa");
  assert.equal(removed.removed, 1);
  assert.deepEqual(removed.items.map((item) => item.text), ["Ligar pro Pedro"]);
  // Só o dono (rota) e resolvido sem o modelo.
  assert.match(lib, /const command = await runMemoryCommand\(auth, text\);/);
  const route = readFileSync(new URL("../app/api/admin/henry/route.js", import.meta.url), "utf8");
  assert.match(route, /dayTurns: enabled && !lock\.locked \? dayTurns : \[\]/); // bloqueado (HENRY-LOCK) = nada
  assert.ok(route.indexOf("requireHenryOwner(request)") < route.indexOf("readHenryDayTurns()"));
});

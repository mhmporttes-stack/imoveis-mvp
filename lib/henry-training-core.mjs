// Modo treino do Henry (pedido do dono, 2026-10-24: "Montar um agente ou algo que fique conversando com Henry para treinar
// as respostas (use a voz gratuita para não gastar a ElevenLabs). A ideia é ver repetições, falas erradas, melhorar e
// deixar mais fluido." — docs/BUSINESS_RULES.md HENRY-1 "Modo treino", PENDENTE DE VALIDAÇÃO). Núcleo PURO (sem rede):
//   - HENRY_TRAINING_SCENARIOS: o roteiro de conversas (cumprimentos, papo, CRM, música, ambíguos, frustração,
//     interrupções, dia inteiro). Cada passo é uma fala fixa (`say`), uma fala a variar pelo "dono simulado" (`vary`) ou
//     uma continuação que o dono simulado escreve olhando a última resposta do Henry (`reply`); sem o dono simulado,
//     vale o texto-base (`say`) — a rodada roda igual, só sem variação.
//   - estimateHenryTrainingCostUsd: custo estimado ANTES de rodar (mostrado na tela).
//   - analyzeHenryTraining: o relatório da rodada (repetições, fala longa para voz, fala barrada, "não tenho acesso",
//     espera em cumprimento puro, tom errado). As regras de barreira são as MESMAS do Henry (safeHenryReply/isSafeToSpeak,
//     isHenryGreeting, openingsFrom/closingsFrom, HENRY_WAIT_PHRASES) — nada de critério paralelo.
// As respostas do Henry saem do MESMO cérebro (answerHenry em lib/henry-voice.js), com memória do dia isolada da rodada.

import { HENRY_FALLBACK_REPLY, HENRY_PRICE_INPUT_PER_MTOK, HENRY_PRICE_OUTPUT_PER_MTOK, HENRY_SCREEN_REPLY, isCrmQuestion, normalizeSpeechText } from "./henry-voice-core.mjs";
import { isSafeToSpeak } from "./alexa-v2/sanitize.mjs";
import { closingsFrom, isHenryGreeting, openingsFrom } from "./henry-voice-persona.mjs";
import { HENRY_WAIT_PHRASES } from "./henry-voice-narration.mjs";
import { groupSimilar } from "./henry-repetition-core.mjs";
import { henryClaimedActionWithoutTool, henryClaimedLookupWithoutTool, henryInternalTalk, henryDirectRoute, henryPromisedAction, isBrokerComparisonQuestion, henryQuestionPart, henryRepeatedAfterComplaint, isHenryComplaint, replyAnswersQuestion } from "./henry-voice-turn.mjs";

export const HENRY_TRAINING_FEATURE = "henry_training"; // origem em ai_usage_log ("Gastos de IA")
export const HENRY_TRAINING_MAX_EXCHANGES = 50; // teto de trocas por rodada (dono simulado + Henry); 40 → 42 com o cenário "comparacao" (2026-10-25); 42 → 50 com "areas" (2026-10-26)
export const HENRY_TRAINING_LINE_MAX = 200; // fala do dono simulado
export const HENRY_TRAINING_VOICE_MAX_CHARS = 300; // acima disso a resposta cansa na voz (pergunta comum)
export const HENRY_TRAINING_VOICE_MAX_SENTENCES = 3;
export const HENRY_TRAINING_REPORT_MAX_CHARS = 700; // relatório do dia (bom dia): 3 a 5 frases
export const HENRY_TRAINING_REPORT_MAX_SENTENCES = 5;
export const HENRY_TRAINING_SLOW_MS = 6000; // resposta acima disso = achado "resposta_lenta" (Treino 3, 2026-10-25)

const step = (say, extra = {}) => Object.freeze({ say, ...extra });

// Roteiro. `vary` = o dono simulado reescreve `say` com outras palavras (mesma intenção); `reply` = intenção da
// continuação depois da resposta do Henry (o `say` é a reserva sem o dono simulado). mode "report" = "bom dia, Henry".
export const HENRY_TRAINING_SCENARIOS = Object.freeze([
  Object.freeze({
    id: "cumprimentos",
    label: "Cumprimentos e cortesia",
    steps: [
      step("Boa tarde, Henry", { vary: true }),
      step("Tudo bem com você?", { vary: true }),
      step("Valeu, Henry", { vary: true }),
      step("Boa noite", { vary: true }),
      step("Tchau, até amanhã", { vary: true })
    ]
  }),
  Object.freeze({
    id: "papo",
    label: "Papo casual",
    steps: [
      step("E aí, como foi teu dia?", { vary: true }),
      step("Me conta uma piada", { vary: true }),
      step("Haha, boa", { reply: "reage à piada de forma curta e natural" }),
      step("Tô cansado hoje", { vary: true }),
      step("Obrigado pela força", { reply: "agradece de forma curta" })
    ]
  }),
  Object.freeze({
    id: "crm",
    label: "Perguntas do CRM",
    steps: [
      step("Quantos clientes novos entraram hoje?", { vary: true }),
      step("E como está o ranking da semana?", { vary: true }),
      step("Quem está parado há mais tempo?", { vary: true }),
      step("Tem conversa esperando resposta no WhatsApp?", { vary: true }),
      step("E a Meta Diária da equipe?", { vary: true })
    ]
  }),
  // Comparação entre corretores (dono, 2026-10-25: "quantas simulações o Eduardo fez nos últimos 30 dias?" foi respondida,
  // "qual corretor mais realizou simulações?" não) — a 2ª fala herda a métrica e o período da 1ª.
  Object.freeze({
    id: "comparacao",
    label: "Comparação entre corretores",
    steps: [
      step("Quantas simulações o Eduardo fez nos últimos 30 dias?", { vary: true }),
      step("E quem mais fez?", { reply: "pergunta curta qual corretor mais fez, sem repetir a métrica nem o período" })
    ]
  }),
  // Acesso total (dono, 2026-10-26: "ele deve ter acesso a tudo e todas as informações"): uma pergunta curta por área nova
  // (consultar_area). Nenhuma resposta pode ser "não tenho acesso".
  Object.freeze({
    id: "areas",
    label: "Outras áreas do CRM",
    steps: [
      step("O que tem na agenda da equipe amanhã?", { vary: true }),
      step("Quantos clientes estão enviados pra CCA?", { vary: true }),
      step("Quanto a gente gastou nos anúncios essa semana?", { vary: true }),
      step("Como tá o Marketplace hoje?", { vary: true }),
      step("Quem recebeu cliente da roleta hoje?", { vary: true }),
      step("Quantos arquivados a gente tem?", { vary: true }),
      step("Quem é a gestora do Gabriel?", { vary: true }),
      step("Quais automações estão ligadas?", { vary: true })
    ]
  }),
  Object.freeze({
    id: "musica",
    label: "Música",
    steps: [
      step("Toca um rock aí", { vary: true }),
      step("Abaixa um pouco o volume", { vary: true }),
      step("Passa pra Alexa", { vary: true }),
      step("Toca alguma coisa mais calma e depois me fala quantos clientes novos entraram", { vary: true }),
      step("Valeu", { reply: "agradece curto" })
    ]
  }),
  Object.freeze({
    id: "ambiguos",
    label: "Pedidos ambíguos",
    steps: [
      step("E aquele cliente?", { vary: true }),
      step("O da semana passada", { reply: "responde vago à pergunta dele, sem dar nome" }),
      step("Me mostra aquilo", { vary: true }),
      step("Como estão as coisas?", { vary: true }),
      step("E ela?", { vary: true })
    ]
  }),
  Object.freeze({
    id: "frustracao",
    label: "Frustração",
    steps: [
      step("Quantas vendas a gente fez esse mês?", { vary: true }),
      step("Não foi isso que eu perguntei", { reply: "reclama que a resposta não era o que pediu, irritado mas educado" }),
      step("Você tá repetindo a mesma coisa", { vary: true }),
      step("Fala mais curto, por favor", { vary: true }),
      step("Agora sim", { reply: "aprova curto se a resposta melhorou; senão reclama de novo, curto" })
    ]
  }),
  Object.freeze({
    id: "interrupcoes",
    label: "Interrupções e troca de assunto",
    steps: [
      step("Me fala do funil do mês", { vary: true }),
      step("Não, espera, me fala do ranking primeiro", { vary: true }),
      step("Esquece, abre a tela de clientes", { vary: true }),
      step("Sim, pode abrir", { reply: "aceita curto o que ele ofereceu; se ele não ofereceu nada, muda de assunto para o WhatsApp" }),
      step("Volta pro funil agora", { vary: true })
    ]
  }),
  Object.freeze({
    id: "dia",
    label: "Dia inteiro (manhã à noite)",
    steps: [
      step("Bom dia, Henry", { mode: "report" }),
      // Bom dia (dono, 2026-10-25): oferece "um som no clima de Suits de fundo" → "Pode" toca uma playlist do estilo.
      step("Pode", { reply: "responde à pergunta do bom dia (música de fundo no clima de Suits, ou aniversário) de forma curta" }),
      step("Quantos atendimentos a equipe fez até agora?", { vary: true }),
      step("Boa tarde, Henry", { vary: true }),
      step("Boa noite, fechando por hoje", { vary: true })
    ]
  })
]);

export function henryTrainingScenario(id) {
  return HENRY_TRAINING_SCENARIOS.find((scenario) => scenario.id === id) || null;
}

export function henryTrainingTotalSteps(ids = HENRY_TRAINING_SCENARIOS.map((scenario) => scenario.id)) {
  return ids.reduce((total, id) => total + (henryTrainingScenario(id)?.steps.length || 0), 0);
}

// Cabe mais um cenário na rodada sem passar do teto?
export function henryTrainingFits(usedExchanges, scenarioId) {
  const scenario = henryTrainingScenario(scenarioId);
  if (!scenario) return false;
  return (Number(usedExchanges) || 0) + scenario.steps.length <= HENRY_TRAINING_MAX_EXCHANGES;
}

// --- Custo estimado (antes de rodar) ------------------------------------------------------------------------------------
// Por troca, com folga: Henry ~1,6 rodada (ferramentas) × (parte fixa ~6 mil tokens lida do cache a 10% + ~2,5 mil sem
// cache) + ~150 de saída por rodada; dono simulado ~700 de entrada e ~40 de saída. Primeira chamada grava o cache (×1,25).
export const HENRY_TRAINING_TOKENS = Object.freeze({ cachedPrompt: 6000, uncachedPrompt: 2500, rounds: 1.6, replyOut: 150, ownerIn: 700, ownerOut: 40 });
export function estimateHenryTrainingCostUsd(exchanges, { simulateOwner = true } = {}) {
  const count = Math.max(0, Math.min(HENRY_TRAINING_MAX_EXCHANGES, Number(exchanges) || 0));
  if (!count) return 0;
  const t = HENRY_TRAINING_TOKENS;
  const perRoundIn = t.cachedPrompt * 0.1 + t.uncachedPrompt;
  const henryIn = count * t.rounds * perRoundIn + t.cachedPrompt * 1.25;
  const henryOut = count * t.rounds * t.replyOut;
  const ownerIn = simulateOwner ? count * t.ownerIn : 0;
  const ownerOut = simulateOwner ? count * t.ownerOut : 0;
  return ((henryIn + ownerIn) / 1e6) * HENRY_PRICE_INPUT_PER_MTOK + ((henryOut + ownerOut) / 1e6) * HENRY_PRICE_OUTPUT_PER_MTOK;
}

// --- Dono simulado ------------------------------------------------------------------------------------------------------
// Prompt do modelo barato que faz o papel do Matheus. Não é o prompt do Henry (esse continua só em henry-voice-persona.mjs).
export function buildTrainingOwnerPrompt({ scenarioLabel = "", step: current = {}, lastReply = "" } = {}) {
  const system = [
    "Você faz o papel do Matheus, corretor de imóveis dono de uma imobiliária em Marília (SP), falando por VOZ com o assistente dele, o Henry.",
    "Escreva SÓ a próxima fala do Matheus, como sairia transcrita do microfone: português do Brasil coloquial, curta (2 a 15 palavras), sem aspas, sem emoji, sem explicação.",
    "Nunca invente telefone, CPF, e-mail ou valor em dinheiro. Pode citar primeiro nome genérico de corretor ou cliente só se a intenção pedir.",
    "Não chame o assistente de outro nome. Não responda pelo Henry."
  ].join(" ");
  const parts = [`Cena do treino: ${scenarioLabel || "conversa"}.`];
  if (current.reply) {
    parts.push(`Última fala do Henry: "${String(lastReply || "").slice(0, 400)}".`);
    parts.push(`Intenção da sua próxima fala: ${current.reply}. Exemplo do jeito: "${current.say}".`);
  } else {
    parts.push(`Diga isto com OUTRAS palavras, mesma intenção, natural como na vida real: "${current.say}".`);
  }
  return { system, user: parts.join("\n") };
}

// Limpa a fala do dono simulado: uma linha, sem aspas, ≤ HENRY_TRAINING_LINE_MAX. Vazia/estranha → o texto-base.
export function cleanTrainingOwnerLine(text, fallback = "") {
  const line = String(text || "")
    .split(/\n+/)
    .map((part) => part.trim())
    .find(Boolean) || "";
  const clean = line.replace(/^(matheus|dono|eu)\s*:\s*/i, "").replace(/^["'“”]+|["'“”]+$/g, "").replace(/\s+/g, " ").trim().slice(0, HENRY_TRAINING_LINE_MAX);
  return clean.length >= 2 ? clean : String(fallback || "").trim();
}

// --- Memória isolada da rodada (sandbox) --------------------------------------------------------------------------------
// O que pode voltar do navegador entre um cenário e outro: só as chaves de memória do Henry, cada uma objeto JSON pequeno.
export const HENRY_TRAINING_SANDBOX_KEYS = Object.freeze(["henry_day_memory", "henry_notes", "henry_morning_music", "henry_voice_compliments"]);
export const HENRY_TRAINING_SANDBOX_MAX_CHARS = 60000;
export function parseTrainingSandbox(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const key of HENRY_TRAINING_SANDBOX_KEYS) {
    const value = raw[key];
    if (value && typeof value === "object" && !Array.isArray(value)) out[key] = value;
  }
  try {
    if (JSON.stringify(out).length > HENRY_TRAINING_SANDBOX_MAX_CHARS) return {};
  } catch {
    return {};
  }
  return out;
}

// --- Relatório da rodada ------------------------------------------------------------------------------------------------
const sentencesOf = (text) => String(text || "").split(/(?<=[.!?…])\s+/).map((part) => part.trim()).filter(Boolean);
const wordsOf = (text) => normalizeSpeechText(text).split(" ").filter(Boolean);
const NO_ACCESS = /\b(nao tenho acesso|nao consigo acessar|sem acesso a|nao tenho como (ver|acessar|saber)|nao consigo ver (isso|esse|essa|os|as))\b/;
const WAIT_TALK = /\b(vou (verificar|analisar|conferir|checar|olhar|puxar)|deixa eu (ver|conferir|olhar|checar|puxar)|so um (instante|minutinho|segundo)|(to|estou) (analisando|verificando|conferindo|puxando))\b/;
// Achados do Treino de 2026-10-25 que o relatório não apontou ("Nenhuma delas", "Suspense: são 116...", "a Sem",
// "eu já deixo a agenda de amanhã pronta"):
// - rótulo no começo da fala: uma palavra e dois-pontos ("Suspense:", "Resumo:") — hora ("10:30") não conta;
// Treino 10: "Vendas de agora: 3." (rótulo de várias palavras com período) também é rótulo.
const LABEL_PREFIX = /^\s*(?:\p{L}+|\p{L}+(?:\s+\p{L}+){0,2}\s+(?:de|do|da|até|ate)\s+\p{L}+)\s*:\s/u;
// - nome falado suspeito: cliente sem nome virando nome ("a Sem", "o Cliente", "a Sem nome") ou nome vazio (", ,");
const SUSPECT_NAME = /\b[aoAO] (Sem|Cliente|Contato|Lead)\b(?! (novo|nova|novos|novas|frio|fria|aguardando|com|que|do|da|de|no|na)\b)|\b[ao] sem nome\b|,\s*,|\b[ao] ,/;
// - oferta de ação que o Henry não faz (ele só consulta, abre tela, toca música, pesquisa e guarda lembrete).
const OFFER = /\b(se quiser|quer que eu|posso|eu ja|ja ja|deixa que eu|deixa comigo)\b/;
const UNDOABLE = /\b(deix\w* [^.?!]*\bpront\w*|prepar(o|ar|e)|organiz(o|ar|e)|agend(o|ar|e)|marc(o|ar|e) (a|o|uma|um)|mand(o|ar|e) (a|uma|um|mensagem)|envi(o|ar|e)|dispar(o|ar|e)|transfir(o|a)|transferir|cadastr(o|ar|e)|atualiz(o|ar|e)|ligo|ligar|respond(o|er) (o|a|ele|ela|pra|para))\b/;
export function offersUndoableAction(text) {
  return String(text || "")
    .split(/(?<=[.!?…])\s+/)
    .map((sentence) => normalizeSpeechText(sentence))
    .some((plain) => OFFER.test(plain) && UNDOABLE.test(plain.slice(plain.search(OFFER))));
}
// Treino 4 (2026-10-25): frase do cache da Alexa crua na fala do Henry e a mesma frase (3+ palavras) duas vezes na resposta.
const CACHE_RAW = /\bultima atualizacao ha\b/;
// Treino 5 (2026-10-25): "Esse número eu só consigo ver de hoje e de ontem" — o Henry tem ferramentas de período
// (funil_periodo, ranking_periodo, relatorio_periodo, consultar_corretor); a limitação não existe mais.
const PERIOD_LIMIT = /\bso (?:consigo|sei|tenho|vejo)\b.*\b(?:hoje|ontem)\b|\bso\b.{0,50}\bhoje (?:e|ou) (?:de |o de |para |pra )?ontem\b/;
// "Não consigo comparar os corretores" / "não consegui ver quem mais fez" (2026-10-25: há comparar_corretores).
const CANT_COMPARE = /\bnao (?:consigo|consegui|da pra|tenho como)\b(?: \w+){0,4}? (?:compar\w*|(?:ver|dizer|saber|identificar) quem)\b/;
export function duplicatedSentence(text) {
  const seen = new Set();
  for (const sentence of sentencesOf(text)) {
    const key = wordsOf(sentence).join(" ");
    if (key.split(" ").length < 3) continue;
    if (seen.has(key)) return sentence;
    seen.add(key);
  }
  return "";
}
const WAIT_TEXTS = new Set(HENRY_WAIT_PHRASES.map((phrase) => normalizeSpeechText(phrase.text)));
const TONE_RULES = Object.freeze([
  { id: "markdown", label: "formatação de texto (markdown/lista) numa fala", test: (raw) => /[*#`_]{1,}|^\s*[-•]\s|\n\s*\d+[.)]\s/m.test(raw) },
  { id: "emoji", label: "emoji numa fala", test: (raw) => /\p{Extended_Pictographic}/u.test(raw) },
  { id: "risada", label: "risada que a voz lê mal (kkk/rsrs)", test: (_raw, plain) => /\bk{3,}\b|\brsrs\b/.test(plain) },
  { id: "robo", label: "fala de robô (\"como assistente/IA\")", test: (_raw, plain) => /\bcomo (uma |um )?(ia|inteligencia artificial|assistente virtual|modelo de linguagem)\b/.test(plain) },
  { id: "portugal", label: "forma de Portugal (\"tens razão\") — diga \"tem razão\"", test: (_raw, plain) => /\btens\b/.test(plain) },
  { id: "desculpa", label: "pedido de desculpas em excesso", test: (_raw, plain) => (plain.match(/\b(desculp\w*|perdao)\b/g) || []).length >= 2 }
]);

function ngramsOf(text, size) {
  const words = wordsOf(text);
  const grams = new Set();
  for (let index = 0; index + size <= words.length; index += 1) grams.add(words.slice(index, index + size).join(" "));
  return grams;
}

// Repetição por SEMELHANÇA (dono, 2026-10-25: "muda uma palavra e fala a mesma frase"): a mesma medida do Henry ao vivo
// (groupSimilar, lib/henry-repetition-core.mjs) — "Ok, vou olhar" e "Beleza, vou olhar" contam como a mesma abertura.
function countRepeats(items) {
  return groupSimilar(items.filter((item) => normalizeSpeechText(item)))
    .filter((entry) => entry.count >= 2)
    .map(({ text, count }) => ({ text, count }))
    .sort((a, b) => b.count - a.count);
}

// exchanges = [{ owner, reply, mode?, scenarioId?, error? }] na ordem da rodada (a rodada é "um dia").
// Devolve { exchanges, issues: [{ kind, label, index?, text? }], repeats: { replies, openings, closings, ngrams }, totals }.
export function analyzeHenryTraining(exchanges = [], { ngramSize = 4, ngramMin = 3 } = {}) {
  const list = (Array.isArray(exchanges) ? exchanges : []).filter((item) => item && typeof item === "object");
  const issues = [];
  const push = (kind, label, index, text = "") => issues.push({ kind, label, index, ...(text ? { text } : {}) });
  list.forEach((item, index) => {
    const reply = String(item.reply || "");
    const plain = normalizeSpeechText(reply);
    if (item.error) {
      push("erro", "a pergunta falhou (erro do servidor)", index, String(item.error).slice(0, 120));
      return;
    }
    if (!reply.trim()) {
      push("vazia", "resposta vazia", index);
      return;
    }
    if (reply === HENRY_FALLBACK_REPLY || !isSafeToSpeak(reply)) push("barrada", "fala barrada pela barreira da voz (número/palavra sensível)", index);
    else if (reply === HENRY_SCREEN_REPLY) push("so_tela", "resposta barrada na voz; só os detalhes na tela", index);
    if (/^nao consegui responder agora/.test(plain)) push("sem_resposta", "o Henry não conseguiu responder", index);
    if (NO_ACCESS.test(plain)) push("sem_acesso", "disse que não tem acesso (regra: lê todo o CRM)", index, reply);
    const report = item.mode === "report";
    const maxChars = report ? HENRY_TRAINING_REPORT_MAX_CHARS : HENRY_TRAINING_VOICE_MAX_CHARS;
    const maxSentences = report ? HENRY_TRAINING_REPORT_MAX_SENTENCES : HENRY_TRAINING_VOICE_MAX_SENTENCES;
    const sentences = sentencesOf(reply).length;
    if (reply.length > maxChars || sentences > maxSentences) push("longa", `longa demais para voz (${reply.length} caracteres, ${sentences} frases)`, index);
    if (isHenryGreeting(item.owner)) {
      if (WAIT_TEXTS.has(plain) || WAIT_TALK.test(plain)) push("espera_cumprimento", "cumprimento puro virou \"vou verificar\"", index, reply);
      if (/\d/.test(reply)) push("numero_cumprimento", "cumprimento puro respondido com números do CRM", index, reply);
    }
    for (const rule of TONE_RULES) if (rule.test(reply, plain)) push(`tom_${rule.id}`, rule.label, index);
    const words = plain.split(" ").filter(Boolean).length;
    const fragment = !report && isCrmQuestion(item.owner) && !isHenryGreeting(item.owner) && words < 4 && !/\d/.test(reply);
    if (fragment) push("fragmento", "resposta curta demais/cortada para pergunta do CRM (sem número)", index, reply);
    // Treino 2 (2026-10-25): pergunta do CRM (também a que vem junto de música ou de um cumprimento) respondida sem número
    // nem conteúdo — mesma leitura do Henry ao vivo (henryQuestionPart/replyAnswersQuestion, lib/henry-voice-turn.mjs).
    else if (!report && !isHenryComplaint(item.owner) && henryQuestionPart(item.owner) && reply !== HENRY_SCREEN_REPLY && !replyAnswersQuestion(reply)) push("pergunta_ignorada", "pergunta do CRM sem resposta (sem número nem conteúdo)", index, reply);
    // ... e "não foi isso que eu perguntei" respondido com a mesma resposta de antes.
    // Pergunta nova e clara na mesma fala da reclamação (rota direta, ex.: "quanto falta pra fechar essas vendas", Treino 5):
    // os mesmos números são a resposta certa, não repetição.
    if (index > 0 && isHenryComplaint(item.owner) && !henryDirectRoute(item.owner) && henryRepeatedAfterComplaint(reply, list[index - 1]?.reply)) push("repetiu_apos_reclamacao", "repetiu a resposta depois de ele reclamar (\"não foi isso\")", index, reply);
    if (LABEL_PREFIX.test(reply)) push("rotulo_inicio", "rótulo com dois-pontos no começo da fala (ex.: \"Suspense:\")", index, reply.slice(0, 60));
    if (SUSPECT_NAME.test(reply)) push("nome_suspeito", "nome falado suspeito (cliente sem nome virou nome, ex.: \"a Sem\")", index, reply);
    if (offersUndoableAction(reply)) push("oferta_indevida", "ofereceu uma ação que o Henry não faz (ele só consulta)", index, reply);
    // Treino 3 (2026-10-25): "vou puxar/já te mostro/se quiser eu puxo" sem trazer o resultado (mesma leitura do Henry ao vivo,
    // henryPromisedAction) e resposta lenta (> 6 s), com onde foi o tempo quando a rodada guardou.
    // Treino 6 (2026-10-25): "Já abaixei o volume." sem nenhuma ferramenta (mesma leitura do Henry ao vivo).
    if (Array.isArray(item.toolNames) && item.mode !== "report" && henryClaimedActionWithoutTool(reply, item.toolNames)) push("acao_sem_ferramenta", "disse que fez uma ação (volume, música, aparelho, tela, recado) sem a ferramenta", index, reply);
    // Treino 8 (2026-10-25): "Não achei nenhum cliente chamado Joana" sem nenhuma ferramenta e "A ferramenta não entendeu essa
    // consulta" — mesma leitura do Henry ao vivo (henryClaimedLookupWithoutTool / henryInternalTalk).
    if (Array.isArray(item.toolNames) && item.mode !== "report" && henryClaimedLookupWithoutTool(reply, item.toolNames)) push("busca_sem_ferramenta", "disse que procurou/não achou sem chamar nenhuma ferramenta de leitura", index, reply);
    if (henryInternalTalk(reply)) push("vazamento_interno", "falou de ferramenta/consulta/sistema para o dono", index, reply);
    if (henryPromisedAction(reply)) push("promessa_sem_acao", "prometeu buscar e não trouxe o resultado (sem ferramenta)", index, reply);
    // Treino 4 (2026-10-25): frase crua do cache da Alexa ("Última atualização há 28 minutos.") e a mesma frase duas vezes na
    // mesma resposta.
    // Comparação entre corretores (2026-10-25): "quem mais fez?" sem número/nome na resposta ou "não consigo comparar".
    if (!report && isBrokerComparisonQuestion(item.owner) && (CANT_COMPARE.test(plain) || !replyAnswersQuestion(reply))) push("comparacao_sem_resposta", "não respondeu quem mais/menos fez entre os corretores (há comparar_corretores)", index, reply);
    if (PERIOD_LIMIT.test(plain)) push("limitacao_periodo", "disse que só consegue ver hoje/ontem (há ferramentas de período)", index, reply);
    if (CACHE_RAW.test(plain)) push("cache_cru", "frase de cache crua (\"Última atualização há…\")", index, reply);
    const duplicated = duplicatedSentence(reply);
    if (duplicated) push("texto_duplicado", "texto duplicado na mesma resposta", index, duplicated);
    const ms = Number(item.ms) || 0;
    if (ms > HENRY_TRAINING_SLOW_MS) {
      const where = Number.isFinite(item.modelMs) || Number.isFinite(item.toolsMs) ? ` — modelo ${(Number(item.modelMs) || 0) / 1000} s em ${Number(item.rounds) || 0} rodada(s), ferramentas ${(Number(item.toolsMs) || 0) / 1000} s${item.toolNames?.length ? ` (${item.toolNames.join(", ")})` : ""}${Number.isFinite(item.firstTokenMs) ? `, 1º texto em ${item.firstTokenMs / 1000} s` : ""}` : "";
      push("resposta_lenta", `resposta lenta (${(ms / 1000).toFixed(1)} s)${where}`, index, reply);
    }
  });

  const replies = list.map((item) => String(item.reply || "")).filter((reply) => reply && reply !== HENRY_FALLBACK_REPLY);
  const turns = replies.map((text) => ({ role: "assistant", text }));
  const repeatedReplies = countRepeats(replies);
  const repeatedOpenings = countRepeats(openingsFrom(turns, Infinity));
  const repeatedClosings = countRepeats(closingsFrom(turns, Infinity));
  const gramCounts = new Map();
  for (const reply of replies) for (const gram of ngramsOf(reply, ngramSize)) gramCounts.set(gram, (gramCounts.get(gram) || 0) + 1);
  const repeatedNgrams = [...gramCounts.entries()].filter(([, count]) => count >= ngramMin).map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count).slice(0, 15);
  for (const entry of repeatedReplies) push("repeticao_resposta", `mesma resposta ${entry.count}x no dia`, undefined, entry.text);
  for (const entry of repeatedOpenings) push("repeticao_abertura", `mesma abertura ${entry.count}x no dia`, undefined, entry.text);
  for (const entry of repeatedClosings) push("repeticao_fechamento", `mesmo fechamento ${entry.count}x no dia`, undefined, entry.text);
  for (const entry of repeatedNgrams) push("repeticao_trecho", `mesmo trecho em ${entry.count} respostas`, undefined, entry.text);

  const lengths = replies.map((reply) => reply.length);
  return {
    issues,
    repeats: { replies: repeatedReplies, openings: repeatedOpenings, closings: repeatedClosings, ngrams: repeatedNgrams },
    totals: {
      exchanges: list.length,
      issues: issues.length,
      averageChars: lengths.length ? Math.round(lengths.reduce((sum, value) => sum + value, 0) / lengths.length) : 0,
      longest: lengths.length ? Math.max(...lengths) : 0
    }
  };
}

// --- Treinos anteriores (dono, 2026-10-25: "Eu não encontro onde fica o resultado do treinamento") ------------------------
// Cada rodada fica guardada em crm_settings `henry_training_reports` (só texto: cenários, trocas dono↔Henry, contagem dos
// achados por tipo, custo, data) — as últimas HENRY_TRAINING_HISTORY_LIMIT. Sem áudio. As falas do Henry já passaram pela
// barreira da voz (safeHenryReply) dentro de answerHenry; aqui só se corta o tamanho. Os achados completos são recalculados
// por analyzeHenryTraining ao abrir (mesma regra da tela da rodada); `issueCounts` guarda o resumo para a lista.
export const HENRY_TRAINING_REPORTS_SETTING_ID = "henry_training_reports";
export const HENRY_TRAINING_HISTORY_LIMIT = 20;
export const HENRY_TRAINING_STORED_REPLY_MAX = 1500;
const ROUND_ID = /^[a-z0-9-]{8,64}$/i;
const cut = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");

export function isTrainingRoundId(value) {
  return typeof value === "string" && ROUND_ID.test(value);
}

function storedExchange(item = {}, label = "") {
  const out = {
    scenarioId: cut(item.scenarioId, 40),
    label: cut(item.label || label, 80),
    owner: cut(item.owner, HENRY_TRAINING_LINE_MAX),
    reply: cut(item.reply, HENRY_TRAINING_STORED_REPLY_MAX),
    mode: cut(item.mode, 20),
    ms: Math.max(0, Math.round(Number(item.ms) || 0))
  };
  if (item.tools === true) out.tools = true;
  if (Array.isArray(item.toolNames)) out.toolNames = item.toolNames.filter((name) => typeof name === "string" && /^[a-z_]{1,40}$/.test(name)).slice(0, 8);
  // Treino 11: 1º pedaço de texto do modelo (firstTokenMs) — separa demora do provedor de resposta longa.
  for (const key of ["rounds", "modelMs", "toolsMs", "firstTokenMs"]) if (Number.isFinite(Number(item[key])) && item[key] !== null && item[key] !== undefined) out[key] = Math.max(0, Math.round(Number(item[key])));
  if (item.navigate) out.navigate = cut(item.navigate, 80);
  // Treino 10: a música que o bom dia tocou (simulada) ficava fora do relatório guardado — "não tocou" sem como conferir.
  if (item.music) out.music = cut(item.music, 80);
  if (item.detail) out.detail = cut(item.detail, 120);
  if (item.error) out.error = cut(item.error, 160);
  return out;
}

// Contagem dos achados por tipo ({ kind, label, count }), na ordem da primeira ocorrência. Agrupa pelo tipo, com o
// rótulo do primeiro achado (o de repetição traz o número de vezes, ex.: "mesma abertura 3x no dia").
export function countTrainingIssues(issues = []) {
  const byKind = new Map();
  for (const issue of Array.isArray(issues) ? issues : []) {
    if (!issue?.kind) continue;
    const entry = byKind.get(issue.kind) || { kind: issue.kind, label: String(issue.label || issue.kind), count: 0 };
    entry.count += 1;
    byKind.set(issue.kind, entry);
  }
  return [...byKind.values()];
}

function parseRound(raw) {
  if (!raw || typeof raw !== "object" || !isTrainingRoundId(raw.id)) return null;
  return {
    id: raw.id,
    startedAt: cut(raw.startedAt, 40),
    updatedAt: cut(raw.updatedAt, 40),
    simulateOwner: raw.simulateOwner !== false,
    ...(raw.auto === true ? { auto: true } : {}),
    scenarios: (Array.isArray(raw.scenarios) ? raw.scenarios : []).map((item) => cut(item, 80)).filter(Boolean),
    exchanges: (Array.isArray(raw.exchanges) ? raw.exchanges : []).slice(0, HENRY_TRAINING_MAX_EXCHANGES).map((item) => storedExchange(item)),
    costUsd: Math.max(0, Number(raw.costUsd) || 0),
    issueCounts: (Array.isArray(raw.issueCounts) ? raw.issueCounts : [])
      .filter((entry) => entry?.kind)
      .map((entry) => ({ kind: cut(entry.kind, 40), label: cut(entry.label, 120), count: Math.max(0, Math.round(Number(entry.count) || 0)) }))
  };
}

// Valor guardado (jsonb { rounds }) → rodadas válidas, mais nova primeiro, no máximo o limite.
export function parseTrainingRounds(raw) {
  const list = Array.isArray(raw?.rounds) ? raw.rounds : [];
  return list.map(parseRound).filter(Boolean).slice(0, HENRY_TRAINING_HISTORY_LIMIT);
}

// Junta um cenário recém-rodado à rodada `roundId` (cria no topo se for nova) e devolve { rounds, round }; o valor a
// gravar é { rounds }. Mantém só as últimas HENRY_TRAINING_HISTORY_LIMIT rodadas.
export function appendTrainingScenario(rounds, { roundId, scenarioLabel = "", exchanges = [], costUsd = 0, simulateOwner = true, auto = false, now = new Date().toISOString() } = {}) {
  if (!isTrainingRoundId(roundId)) throw new Error("Identificador de rodada inválido.");
  const list = Array.isArray(rounds) ? rounds : [];
  const previous = list.find((item) => item.id === roundId);
  const merged = [...(previous?.exchanges || []), ...(Array.isArray(exchanges) ? exchanges : []).map((item) => storedExchange(item, scenarioLabel))].slice(0, HENRY_TRAINING_MAX_EXCHANGES);
  const round = {
    id: roundId,
    startedAt: previous?.startedAt || now,
    updatedAt: now,
    simulateOwner: previous ? previous.simulateOwner : simulateOwner !== false,
    ...((previous ? previous.auto : auto) === true ? { auto: true } : {}), // rodada do treino automático (cron)
    scenarios: [...(previous?.scenarios || []), ...(scenarioLabel ? [cut(scenarioLabel, 80)] : [])],
    exchanges: merged,
    costUsd: Math.round(((previous?.costUsd || 0) + Math.max(0, Number(costUsd) || 0)) * 1e6) / 1e6,
    issueCounts: countTrainingIssues(analyzeHenryTraining(merged).issues)
  };
  return { rounds: [round, ...list.filter((item) => item.id !== roundId)].slice(0, HENRY_TRAINING_HISTORY_LIMIT), round };
}

// Resumo para a lista "Treinos anteriores" (sem as trocas).
export function summarizeTrainingRound(round) {
  return {
    id: round.id,
    startedAt: round.startedAt,
    updatedAt: round.updatedAt,
    ...(round.auto === true ? { auto: true } : {}),
    scenarios: round.scenarios || [],
    exchanges: (round.exchanges || []).length,
    costUsd: round.costUsd || 0,
    issues: (round.issueCounts || []).reduce((sum, entry) => sum + (Number(entry.count) || 0), 0),
    issueCounts: round.issueCounts || []
  };
}

// --- Treino automático (dono, 2026-10-25: "Tem como você executar esses testes sozinho e já ir corrigindo? Gaste até
// 10,00" — R$ 10 ≈ US$ 1,80; docs/BUSINESS_RULES.md HENRY-1 "Modo treino") ------------------------------------------------
// /api/cron/henry-treino roda UMA rodada completa no servidor. Antes, duas travas (regras puras aqui):
//   - teto de gasto: soma de ai_usage_log origem henry_training desde HENRY_AUTO_TRAINING_SINCE (rodadas da tela também
//     contam) + o custo estimado da rodada nova não pode passar do teto (env HENRY_AUTO_TRAINING_BUDGET_USD, padrão 1,8);
//   - uma rodada automática por vez: trava em crm_settings `henry_auto_training_lock` que vence sozinha em 10 min.
export const HENRY_AUTO_TRAINING_SINCE = "2026-10-25T17:30:00.000Z";
export const HENRY_AUTO_TRAINING_DEFAULT_BUDGET_USD = 1.8; // R$ 10 ≈ US$ 1,80
export const HENRY_AUTO_TRAINING_LOCK_SETTING_ID = "henry_auto_training_lock";
export const HENRY_AUTO_TRAINING_LOCK_MS = 10 * 60 * 1000;

export function henryAutoTrainingBudgetUsd(raw) {
  const value = Number(String(raw ?? "").replace(",", "."));
  return String(raw ?? "").trim() && Number.isFinite(value) && value > 0 ? value : HENRY_AUTO_TRAINING_DEFAULT_BUDGET_USD;
}

// Trava ativa? (lock = setting_value { until: ISO, roundId }). Sem data válida = livre.
export function isHenryAutoTrainingLocked(lock, now = Date.now()) {
  const until = Date.parse(lock?.until || "");
  return Number.isFinite(until) && until > now;
}

// Decide se uma rodada automática pode começar. → { ok: true } | { ok: false, status: 409, reason, error }.
export function decideHenryAutoTraining({ spentUsd = 0, budgetUsd = HENRY_AUTO_TRAINING_DEFAULT_BUDGET_USD, estimateUsd = 0, lock = null, now = Date.now() } = {}) {
  if (isHenryAutoTrainingLocked(lock, now)) return { ok: false, status: 409, reason: "running", error: "Já tem um treino automático rodando." };
  const spent = Math.max(0, Number(spentUsd) || 0);
  const estimate = Math.max(0, Number(estimateUsd) || 0);
  if (spent + estimate > budgetUsd) return { ok: false, status: 409, reason: "budget", error: "Teto de gasto do treino automático atingido." };
  return { ok: true };
}

// No meio da rodada: começa o próximo cenário só se o gasto (antes + desta rodada + estimativa do cenário) cabe no teto.
export function henryAutoTrainingCanContinue({ spentBeforeUsd = 0, roundUsd = 0, nextEstimateUsd = 0, budgetUsd = HENRY_AUTO_TRAINING_DEFAULT_BUDGET_USD } = {}) {
  return (Number(spentBeforeUsd) || 0) + (Number(roundUsd) || 0) + (Number(nextEstimateUsd) || 0) <= budgetUsd;
}

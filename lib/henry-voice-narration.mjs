// Narração de espera do Henry (pedido do dono, 2026-10-22: "remova os silêncios: enquanto ele pensa, procura ou carrega
// os dados, ele continua falando, tipo 'estou analisando seus arquivos'"). Regras PURAS (testáveis):
//   - eventos de progresso do stream (qual ferramenta o modelo chamou → chave, assunto da cena e legenda);
//   - conjunto FIXO de frases de espera (sintetizadas UMA vez por voz+estilo e guardadas em cache — não custa uma
//     chamada de voz por frase);
//   - quando tocar: só depois de ~0,8 s sem resposta, no máximo 1 frase a cada ~2,5 s, nunca a mesma frase seguida.
// A voz é SEMPRE a do Henry (servidor). Sem voz do servidor, fica em silêncio: nunca a voz do navegador (o dono removeu o
// "Deixa eu ver…" antigo justamente porque saía em outra voz).

export const NARRATION_FIRST_DELAY_MS = 800;
export const NARRATION_MIN_GAP_MS = 2500;

export const HENRY_SCENE_TOPICS = ["geral", "relatorio", "funil", "ranking", "clientes", "corretor", "meta", "whatsapp", "internet"];

// id estável (cache do navegador) · texto curto e natural · assuntos em que cabe. Banco grande (dono, 2026-10-22: "ele fala
// sempre a mesma coisa"): sorteio sem repetir as últimas 5 (RECENT_PHRASES_TO_AVOID).
const ALL = ["geral", "relatorio", "funil", "ranking", "clientes", "corretor", "meta", "whatsapp"];
export const HENRY_WAIT_PHRASES = Object.freeze([
  { id: "w1", text: "Só um instante, tô analisando seus dados.", topics: ["geral", "relatorio", "funil", "meta"] },
  { id: "w2", text: "Deixa eu conferir no CRM.", topics: ["geral", "clientes", "corretor", "whatsapp"] },
  { id: "w3", text: "Tô puxando os números do período.", topics: ["relatorio", "funil", "meta"] },
  { id: "w4", text: "Tô montando o relatório pra você.", topics: ["relatorio"] },
  { id: "w5", text: "Analisando o funil agora.", topics: ["funil", "relatorio"] },
  { id: "w6", text: "Conferindo o ranking da equipe.", topics: ["ranking", "relatorio", "corretor"] },
  { id: "w7", text: "Procurando esse cliente aqui.", topics: ["clientes"] },
  { id: "w8", text: "Buscando os dados da equipe.", topics: ["corretor", "meta", "ranking", "geral"] },
  { id: "w9", text: "Cruzando com o período anterior.", topics: ["relatorio"] },
  { id: "w10", text: "Olhando a Meta Diária da galera.", topics: ["meta", "relatorio"] },
  { id: "w11", text: "Conferindo os WhatsApps da equipe.", topics: ["whatsapp"] },
  { id: "w12", text: "Quase lá, só mais um pouquinho.", topics: ALL },
  { id: "w13", text: "Já te falo, só um minutinho.", topics: ALL },
  { id: "w14", text: "Hum, deixa eu ver isso direitinho.", topics: ["geral", "clientes", "corretor", "funil"] },
  { id: "w15", text: "Tô somando tudo aqui.", topics: ["relatorio", "funil", "ranking", "meta"] },
  { id: "w16", text: "Bora ver o que o CRM diz.", topics: ["geral", "relatorio", "clientes"] },
  { id: "w17", text: "Abrindo as fichas aqui.", topics: ["clientes", "corretor"] },
  { id: "w18", text: "Tô passando os olhos nos números.", topics: ["relatorio", "funil", "ranking", "meta", "geral"] },
  { id: "w19", text: "Já tô quase com tudo na mão.", topics: ALL },
  { id: "w20", text: "Separando o que importa pra você.", topics: ["relatorio", "geral", "clientes"] },
  { id: "w21", text: "Olha, tá vindo bastante coisa, só um segundo.", topics: ["relatorio", "funil", "geral"] },
  { id: "w22", text: "Conferindo os pontos de cada um.", topics: ["ranking", "corretor"] },
  { id: "w23", text: "Dando uma olhada no histórico.", topics: ["clientes", "corretor", "relatorio"] },
  { id: "w24", text: "Fechando a conta aqui rapidinho.", topics: ["relatorio", "meta", "funil"] },
  { id: "w25", text: "Tô pesquisando na internet.", topics: ["internet"] },
  { id: "w26", text: "Dando uma olhada na internet pra você.", topics: ["internet"] },
  { id: "w27", text: "Buscando isso na internet, um segundo.", topics: ["internet"] },
  { id: "w28", text: "Conferindo as fontes aqui.", topics: ["internet"] }
]);
export const RECENT_PHRASES_TO_AVOID = 5;

const FUNIL_TOPICS = new Set(["funil", "etapa", "movimento", "vendas", "aprovacoes", "conversao", "desempenho"]);
const RANKING_TOPICS = new Set(["ranking", "pontos", "melhor_dia", "campeao_semana", "posicao_ranking"]);
const META_TOPICS = new Set(["meta_equipe", "meta_bateram", "meta_faltam", "meta_cada", "meta_corretor", "meta_lider", "meta_bateu", "prospeccao_equipe", "prospeccao_ranking", "prospeccao_vs_meta", "prospeccao_corretor", "sem_prospeccao", "prospeccao_faltam"]);
const CLIENT_TOPICS = new Set(["sem_atendimento", "pendencias", "pendencias_ranking", "sem_contato", "fila_roleta", "clientes_novos", "atividades_atrasadas", "acao_pendente"]);

function firstName(value) {
  return String(value || "").trim().split(/\s+/)[0] || "";
}

// "Consultando a Carol" / "o Eduardo" / sem gênero: só o nome.
export function brokerWithArticle(name, gender = "") {
  const first = firstName(name);
  if (!first) return "o corretor";
  if (gender === "female") return `a ${first}`;
  if (gender === "male") return `o ${first}`;
  return first;
}

// Evento inicial (logo ao receber o pedido).
export function henryInitialProgress(mode = "question") {
  return mode === "report" ? { progress: "relatorio_do_dia", topic: "relatorio", label: "Puxando o relatório do dia…" } : { progress: "inicio", topic: "geral", label: "Só um instante…" };
}

// Ferramenta chamada pelo modelo → { progress, topic, label, say? } (say = frase curta com o nome do corretor, sintetizada
// na hora). broker = { name, gender } já reconhecido pelo matcher. Ferramenta sem espera (abrir tela) → null.
export function henryProgressFor(name, input = {}, broker = null) {
  if (name === "abrir_tela" || name === "spotify") return null; // música não é busca no CRM: sem cena de dados nem frase de espera
  if (broker?.name) {
    const who = brokerWithArticle(broker.name, broker.gender);
    return { progress: "corretor", topic: "corretor", label: `Consultando ${who}…`, say: `Consultando ${who}.` };
  }
  if (name === "relatorio_periodo") {
    const kind = input?.tipo === "semanal" ? "da semana" : input?.tipo === "mensal" ? "do mês" : "do período";
    return { progress: "relatorio", topic: "relatorio", label: `Montando o relatório ${kind}…` };
  }
  if (name === "consultar_corretor") return { progress: "corretor", topic: "corretor", label: "Procurando o corretor…" };
  if (name === "buscar_cliente") return { progress: "clientes", topic: "clientes", label: "Procurando o cliente…" };
  if (name === "relatorio_do_dia") return { progress: "relatorio_do_dia", topic: "relatorio", label: "Puxando o relatório do dia…" };
  if (name === "clientes_esfriados_pendentes") return { progress: "clientes", topic: "clientes", label: "Conferindo os clientes esfriados…" };
  if (name === "whatsapp_dos_corretores") return { progress: "whatsapp", topic: "whatsapp", label: "Conferindo os WhatsApps da equipe…" };
  if (name === "consultar_crm") {
    const assunto = String(input?.assunto || "");
    if (FUNIL_TOPICS.has(assunto)) return { progress: "funil", topic: "funil", label: "Analisando o funil…" };
    if (RANKING_TOPICS.has(assunto)) return { progress: "ranking", topic: "ranking", label: "Conferindo o ranking…" };
    if (META_TOPICS.has(assunto)) return { progress: "meta", topic: "meta", label: "Olhando a Meta Diária…" };
    if (CLIENT_TOPICS.has(assunto)) return { progress: "clientes", topic: "clientes", label: "Conferindo os clientes…" };
    return { progress: "crm", topic: "geral", label: "Consultando o CRM…" };
  }
  return { progress: "crm", topic: "geral", label: "Consultando o CRM…" };
}

// Próxima frase de espera: do assunto atual e fora das últimas 5 faladas (recentIds, de todos os pedidos); acabaram as do
// assunto → as gerais/qualquer outra fora das recentes; nunca repete a anterior. available = ids com áudio pronto.
export function pickWaitPhrase({ topic = "geral", recentIds = [], available = null, random = Math.random, phrases = HENRY_WAIT_PHRASES, avoid = RECENT_PHRASES_TO_AVOID } = {}) {
  const lastId = recentIds[recentIds.length - 1] || "";
  const ready = phrases.filter((phrase) => phrase.id !== lastId && (!available || available.includes(phrase.id)));
  if (!ready.length) return null;
  const recent = new Set(recentIds.slice(-avoid));
  const pools = [
    ready.filter((phrase) => phrase.topics.includes(topic) && !recent.has(phrase.id)),
    ready.filter((phrase) => phrase.topics.includes("geral") && !recent.has(phrase.id)),
    ready.filter((phrase) => !recent.has(phrase.id)),
    ready
  ];
  const pool = pools.find((list) => list.length) || ready;
  const index = Math.min(pool.length - 1, Math.floor(Math.max(0, Math.min(0.9999, Number(random()) || 0)) * pool.length));
  return pool[index];
}

// Lista das últimas frases faladas (para não repetir): acrescenta e guarda só as últimas `keep`.
export function rememberPhrase(recentIds = [], id, keep = 10) {
  return [...recentIds.filter((value) => value !== id), id].slice(-keep);
}

// Toca uma frase agora? Só esperando a resposta, sem outra frase tocando, depois de ~0,8 s do pedido e ~2,5 s da frase
// anterior, e só com áudio da voz do Henry pronto.
export function shouldNarrate({ now = Date.now(), startedAt = 0, lastNarrationAt = 0, playing = false, replied = false, hasAudio = false } = {}) {
  if (replied || playing || !hasAudio || !startedAt) return false;
  if (now - startedAt < NARRATION_FIRST_DELAY_MS) return false;
  if (lastNarrationAt && now - lastNarrationAt < NARRATION_MIN_GAP_MS) return false;
  return true;
}

// Chave do cache das frases: a mesma voz/estilo = os mesmos áudios (servidor e navegador).
export function narrationVoiceKey(style = {}, provider = "") {
  const parts = [provider, style?.elevenVoice || "", style?.voice || "", style?.tone || "", style?.speed || "", String(style?.details || "").slice(0, 200)];
  let hash = 0;
  for (const char of parts.join("|")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `${provider || "none"}-${hash.toString(36)}`;
}

// --- Cena da resposta (dono, 2026-10-22: "cenas diferentes por tipo de pergunta") -----------------------------------------
// Escolhida pelo que o servidor JÁ sabe (ferramentas chamadas, comando de memória, pesquisa na internet), sem chamada extra
// de IA. Vai na linha { reply, scene } do stream; a tela (components/henry/HenryAnswerScenes.jsx) desenha cada uma.
//   corretor    → card do corretor (foto + posição) — a cena de busca de sempre;
//   numeros     → contadores grandes (números do dia, Meta, prospecção, "bom dia, Henry");
//   comparativo → barras lado a lado (período x anterior; semana/mês; comparar);
//   cliente     → ficha/busca (cliente pelo nome, abrir ficha ou tela);
//   web         → globo (pesquisa na internet);
//   memoria     → nota (lembrete anotado/apagado);
//   conversa    → só o anel com ondas reagindo à voz (papo, piada, elogio).
export const HENRY_ANSWER_SCENES = Object.freeze(["corretor", "numeros", "comparativo", "cliente", "web", "memoria", "conversa"]);
const LONG_PERIODS = new Set(["esta_semana", "semana_passada", "este_mes", "mes_passado"]);
const CLIENT_TOOLS = new Set(["buscar_cliente", "abrir_cliente", "abrir_tela"]);

export function pickHenryAnswerScene({ mode = "question", memory = false, tools = [], webSearches = 0 } = {}) {
  if (memory) return "memoria";
  if (mode === "report") return "numeros";
  if (Number(webSearches) > 0) return "web";
  const list = (Array.isArray(tools) ? tools : []).filter((tool) => tool && typeof tool.name === "string");
  const crm = list.filter((tool) => tool.name === "consultar_crm");
  if (list.some((tool) => tool.name === "consultar_corretor") || crm.some((tool) => tool.input?.corretor || RANKING_TOPICS.has(tool.input?.assunto))) return "corretor";
  if (list.some((tool) => tool.name === "relatorio_periodo") || crm.some((tool) => tool.input?.assunto === "comparar" || LONG_PERIODS.has(tool.input?.periodo))) return "comparativo";
  if (list.some((tool) => CLIENT_TOOLS.has(tool.name))) return "cliente";
  return list.some((tool) => tool.name !== "spotify") ? "numeros" : "conversa"; // só música (Spotify) = ondas
}

// Números que o Henry FALOU (a resposta já passou pela barreira da fala) → até `max` pares { value, label } para os
// contadores/barras quando o servidor não manda um gráfico pronto. Ignora hora, data, ano e posição ("2º"); o rótulo são as
// 1–2 palavras seguintes ("12 leads", "5 clientes aguardando"). Nunca inventa: sem número na fala → lista vazia.
const FIGURE_SKIP_BEFORE = new Set(["dia", "às", "as", "desde", "ano"]);
const FIGURE_SKIP_AFTER = /^(h|hs|hora|horas|min|minuto|minutos|de\s+(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro))\b/i;
const FIGURE_LABEL_STOP = new Set(["e", "ou", "mas", "que", "com", "pra", "para", "no", "na", "nos", "nas", "hoje", "ontem", "agora", "já", "ja", "também", "tambem"]);
const FIGURE_LINKERS = new Set(["de", "do", "da", "dos", "das", "em", "sem", "aguardando", "esperando"]);

export function extractSpokenFigures(text, max = 3) {
  const source = String(text || "");
  const out = [];
  const pattern = /(?<![\w,.])(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?(\s*%|\s+por\s+cento)?(?![\wº°ª])/g;
  let match;
  while ((match = pattern.exec(source)) && out.length < max) {
    const before = source.slice(0, match.index).trim().split(/\s+/).pop()?.toLowerCase().replace(/[^\p{L}]/gu, "") || "";
    const after = source.slice(match.index + match[0].length).replace(/^[\s]+/, "");
    const digits = match[1].replace(/\./g, "");
    const number = Number(match[2] ? `${digits}.${match[2]}` : digits);
    if (!Number.isFinite(number)) continue;
    if (FIGURE_SKIP_BEFORE.has(before) || FIGURE_SKIP_AFTER.test(after)) continue;
    if (!match[3] && /^(19|20)\d{2}$/.test(digits)) continue; // ano
    if (/^[:/h]/i.test(source.slice(match.index + match[0].length))) continue; // 14:30, 22/10, 14h
    // Rótulo: 1ª palavra; a 2ª/3ª só ligadas por "de/da/aguardando…" ("clientes aguardando resposta", "da meta").
    const words = [];
    const isLinker = (word) => FIGURE_LINKERS.has(String(word || "").toLowerCase());
    for (const raw of after.split(/\s+/).slice(0, 3)) {
      const word = raw.replace(/[^\p{L}-]/gu, "");
      if (!word || FIGURE_LABEL_STOP.has(word.toLowerCase())) break;
      if (words.length === 1 && !isLinker(words[0]) && !isLinker(word)) break;
      if (words.length === 2 && !isLinker(words[1])) break;
      words.push(word);
      if (/[.,;:!?]$/.test(raw)) break;
    }
    while (words.length > 1 && isLinker(words[words.length - 1])) words.pop();
    const percent = Boolean(match[3]);
    out.push({ value: number, decimals: match[2] ? match[2].length : 0, suffix: percent ? "%" : "", label: words.join(" ").slice(0, 28) });
  }
  return out;
}

// Cena que chegou do servidor → só o que a tela sabe desenhar (tipo conhecido; gráfico com até 5 linhas numéricas).
export function normalizeHenryScene(value) {
  const kind = HENRY_ANSWER_SCENES.includes(value?.kind) ? value.kind : "";
  if (!kind) return null;
  const rows = (Array.isArray(value?.chart?.rows) ? value.chart.rows : [])
    .filter((row) => Number.isFinite(Number(row?.current)) && Number.isFinite(Number(row?.previous)))
    .slice(0, 5)
    .map((row) => ({ label: String(row.label || "").slice(0, 24), current: Math.max(0, Number(row.current)), previous: Math.max(0, Number(row.previous)) }));
  if (kind !== "comparativo" || !rows.length) return { kind };
  return { kind, chart: { currentLabel: String(value.chart.currentLabel || "Agora").slice(0, 40), previousLabel: String(value.chart.previousLabel || "Antes").slice(0, 40), rows } };
}

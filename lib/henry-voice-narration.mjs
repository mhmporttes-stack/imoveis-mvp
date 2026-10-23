// Narração de espera do Henry (pedido do dono, 2026-10-22: "remova os silêncios: enquanto ele pensa, procura ou carrega
// os dados, ele continua falando, tipo 'estou analisando seus arquivos'"). Regras PURAS (testáveis):
//   - eventos de progresso do stream (qual ferramenta o modelo chamou → chave, assunto da cena e legenda);
//   - conjunto FIXO de frases de espera (sintetizadas UMA vez por voz+estilo e guardadas em cache — não custa uma
//     chamada de voz por frase);
//   - quando tocar: só depois de ~0,8 s sem resposta, no máximo 1 frase a cada ~2,5 s, nunca a mesma frase seguida.
// A voz é SEMPRE a do Henry (servidor). Sem voz do servidor, fica em silêncio: nunca a voz do navegador (o dono removeu o
// "Deixa eu ver…" antigo justamente porque saía em outra voz).

import { normalizeSpeechText } from "./henry-voice-core.mjs";
import { classifyMorningMusicAnswer, classifyMorningStyle } from "./henry-morning-core.mjs";
import { spotifyDeviceKindFromText } from "./henry-spotify-core.mjs";

export const NARRATION_FIRST_DELAY_MS = 800;
export const NARRATION_MIN_GAP_MS = 2500;

export const HENRY_SCENE_TOPICS = ["geral", "relatorio", "funil", "ranking", "clientes", "corretor", "meta", "whatsapp", "internet", "music"];

// id estável (cache do navegador) · texto curto e natural · assuntos em que cabe. Banco grande (dono, 2026-10-22: "ele fala
// sempre a mesma coisa"): sorteio sem repetir no dia (pickWaitPhrase).
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
  { id: "w28", text: "Conferindo as fontes aqui.", topics: ["internet"] },
  // Mais variação (dono, 2026-10-23: "vocabulário muito repetitivo"): a tela não repete nenhuma no mesmo dia até o banco acabar.
  { id: "w29", text: "Deixa eu juntar as peças aqui.", topics: ["geral", "relatorio", "funil", "meta"] },
  { id: "w30", text: "Tô dando aquela garimpada aqui.", topics: ["geral", "clientes", "corretor"] },
  { id: "w31", text: "Um instantinho, tô lendo tudo direitinho.", topics: ALL },
  { id: "w32", text: "Tô conferindo linha por linha.", topics: ["relatorio", "funil", "meta", "ranking"] },
  { id: "w33", text: "Só confirmando pra não te passar nada errado.", topics: ALL },
  { id: "w34", text: "Tô vendo o que cada um fez.", topics: ["corretor", "ranking", "meta"] },
  { id: "w35", text: "Buscando a ficha certinha.", topics: ["clientes"] },
  { id: "w36", text: "Tô organizando os números pra te contar.", topics: ["relatorio", "funil", "meta", "ranking", "geral"] },
  { id: "w37", text: "Vasculhando o CRM aqui rapidinho.", topics: ["geral", "clientes", "corretor", "whatsapp"] },
  { id: "w38", text: "Tô quase fechando a conta.", topics: ["relatorio", "meta", "funil", "ranking"] },
  { id: "w39", text: "Dá um segundinho que já vem.", topics: ALL },
  { id: "w40", text: "Tô lendo as notícias aqui.", topics: ["internet"] },
  // Mais variação nos números/relatório (dono, 2026-10-23: "repete muito 'Tô passando os olhos nos números'"). Sem número
  // no texto e sem palavra de parada (detectBargeIn: "para", "espera", "calma"…): a fala dele nunca se interrompe sozinha.
  { id: "w41", text: "Deixa eu dar uma conferida nesses números.", topics: ["relatorio", "funil", "meta", "ranking"] },
  { id: "w42", text: "Tô fazendo as contas aqui, rapidinho.", topics: ["relatorio", "meta", "funil"] },
  { id: "w43", text: "O relatório tá quase saindo do forno.", topics: ["relatorio"] },
  { id: "w44", text: "Tô botando tudo na ponta do lápis.", topics: ["relatorio", "meta", "funil", "ranking"] },
  { id: "w45", text: "Repassando os resultados aqui, com atenção.", topics: ["relatorio", "funil", "meta"] },
  { id: "w46", text: "Tô juntando os dados da galera.", topics: ["relatorio", "meta", "ranking", "corretor"] },
  { id: "w47", text: "Já tô com o relatório quase pronto.", topics: ["relatorio"] },
  { id: "w48", text: "Dando aquela revisada nos resultados.", topics: ["relatorio", "funil", "meta", "ranking"] },
  // Música (dono, 2026-10-23: "quando eu peço uma playlist, ele fala que vai analisar o CRM"): só falam de Spotify e
  // nunca caem nas frases do CRM (pickWaitPhrase: MUSIC_ONLY).
  { id: "m1", text: "Bora, vou achar aqui no Spotify…", topics: ["music"] },
  { id: "m2", text: "Deixa comigo, procurando essa playlist…", topics: ["music"] },
  { id: "m3", text: "Já vai tocar, patrão…", topics: ["music"] },
  { id: "m4", text: "Abrindo o Spotify aqui.", topics: ["music"] },
  { id: "m5", text: "Achando o som certo pra você.", topics: ["music"] },
  { id: "m6", text: "Só um segundo, tô no Spotify.", topics: ["music"] },
  { id: "m7", text: "Separando a trilha sonora, rapidinho.", topics: ["music"] },
  { id: "m8", text: "Tô escolhendo a faixa, já começa.", topics: ["music"] },
  { id: "m9", text: "Procurando essa aqui pra você.", topics: ["music"] },
  { id: "m10", text: "Achando a música certinha.", topics: ["music"] },
  { id: "m11", text: "Um segundo, tô no Spotify procurando.", topics: ["music"] },
  { id: "m12", text: "Conferindo se é essa mesma.", topics: ["music"] }
]);
export const MUSIC_TOPIC = "music";
export const RECENT_PHRASES_TO_AVOID = 10; // repetição só depois de o banco do dia acabar, e nunca uma das últimas 10
const MUSIC_ONLY = new Set(["music"]);

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

// --- Pedido de música (dono, 2026-10-23) ----------------------------------------------------------------------------
// A ferramenta `spotify` só é escolhida depois que o modelo responde; para a narração e a cena já começarem certas, a
// intenção é lida do TEXTO do pedido (regras simples, sem IA). "próxima semana", "período anterior" e "volume de leads"
// NÃO são música (só "próxima música/faixa", "aumenta o som/volume"...).
const MUSIC_PATTERNS = [
  /\bspotify\b/,
  /\bplaylists?\b/,
  /\bmusicas?\b/,
  /\bfaixas?\b/,
  /\b(o que|que) (esta|ta) tocando\b/,
  /^(pode |manda )?(toca|tocar|toque)\b/,
  /\b(pra|para) tocar\b/,
  /\b(bota|coloca|poe|solta) (um|o|uma) (som|sonzinho)\b/,
  // "coloca Racionais", "põe a do Zeca", "bota aquela do Legião" (dono, 2026-10-23: a cena da música não rodou) — menos
  // quando o resto fala de coisa do CRM ("coloca na agenda", "põe o cliente na tela").
  /^(coloca|coloque|poe|ponha|bota|bote|solta|solte)\b(?!.*\b(agenda|lembrete|lembra|nota|tela|cliente|clientes|corretor|corretora|lista|status|etapa|meta|planilha|relatorio)\b)/,
  /^(pausa|pausar|pause|despausa|proxima|pula|pular)$/,
  /^(pausa|pausar|pause|continua|continuar|despausa|pula|pular) (o som|a musica|essa|isso|ai|a faixa)\b/,
  /\b(aumenta|abaixa|baixa|sobe|diminui|aumentar|abaixar)\b.*\b(som|volume)\b/
];
// Troca de aparelho (dono, 2026-10-23): "toca na Alexa", "passa pra Alexa", "joga pro Echo", "volta pro computador",
// "toca no celular", "toca na caixa da sala". Verbo + (a música/o som/isso)? + preposição + aparelho, no começo do pedido
// ("manda o relatório pro celular" NÃO é música).
const DEVICE_REQUEST = /^(pode )?(toca|tocar|toque|passa|passar|joga|jogar|muda|mudar|volta|voltar|transfere|transferir|leva|levar|manda|coloca|bota|poe)( (a musica|o som|o spotify|isso|ela|essa|tudo|ai))? (na|no|pra|pro|para|para a|para o|pra a|pro o|pela|pelo) (alexa|echo|eco|computador|pc|notebook|celular|telefone|iphone|caixa|caixinha)\b/;
const musicWords = (text) => normalizeSpeechText(text).replace(/^(ei |e ai |oi |ola )?(henry|henri)\b\s*/, "").replace(/\b(por favor|ai)$/, "").trim();

export function isMusicRequest(text) {
  const value = musicWords(text);
  return Boolean(value) && (MUSIC_PATTERNS.some((pattern) => pattern.test(value)) || DEVICE_REQUEST.test(value));
}

// Pedido de trocar o aparelho do Spotify → tipo pedido (alexa/computador/celular/caixa) ou "" (não é troca).
export function spotifyDeviceRequestKind(text) {
  const value = musicWords(text);
  return value && DEVICE_REQUEST.test(value) ? spotifyDeviceKindFromText(value) : "";
}

// O que ele pediu para ouvir ("toca Jorge e Mateus" → "Jorge e Mateus"; "coloca a playlist sertanejo raiz" →
// "sertanejo raiz") — só para o campo de busca da cena começar a digitar; a busca de verdade é a da ferramenta.
export function musicQueryFromText(text) {
  const original = String(text || "").replace(/^\s*(ei,?\s*|oi,?\s*)?henr[yi][,!.]?\s*/i, "").trim();
  const match = /^(?:pode\s+|bota\s+pra\s+|coloca\s+pra\s+|manda\s+)?(?:toca|tocar|toque|solta|solte|bota|bote|coloca|coloque|põe|poe|ponha)\s+(?:pra\s+tocar\s+|para\s+tocar\s+)?(?:aí\s+|ai\s+)?(?:(?:uma|a|o|um|umas|as|os)\s+)?(?:(?:playlist|músicas|musicas|música|musica|álbum|album|som|sonzinho)\s*)?(?:d[aoe]s?\s+)?(.*)$/i.exec(original);
  const query = (match ? match[1] : "").replace(/^(aí|ai)\b\s*/i, "").replace(/\s+(no|pelo)\s+spotify\b.*$/i, "").replace(/\s+(pra|para)\s+tocar\b.*$/i, "").replace(/\s+e\s+(depois|em seguida|também|tambem|me|ai|aí|já|ja)\b.*$/i, "").replace(/,\s*(depois|e)\b.*$/i, "").replace(/[.!?…,]+$/, "").replace(/\s*,?\s*(por favor|aí|ai)$/i, "").trim();
  return query.slice(0, 60);
}

// Pedido de música desde o 1º evento: texto do pedido OU resposta à pergunta da música/estilo do bom dia
// (classifyMorning*: "rock", "sertanejo", "sim" = vai tocar; "não"/outra pergunta = segue o fluxo de sempre).
export function henryMusicIntent({ mode = "question", question = "", morningStep = "" } = {}) {
  if (morningStep === "music") return !["no", "other"].includes(classifyMorningMusicAnswer(question));
  if (morningStep === "style") return !["no", "other"].includes(classifyMorningStyle(question));
  return mode !== "report" && isMusicRequest(question);
}

// Evento inicial (logo ao receber o pedido). Música: tópico "music" (narração e cena do Spotify, nunca a do CRM).
export function henryInitialProgress(mode = "question", { question = "", morningStep = "" } = {}) {
  if (henryMusicIntent({ mode, question, morningStep })) {
    const device = morningStep ? "" : spotifyDeviceRequestKind(question);
    if (device) return { progress: "musica_aparelho", topic: MUSIC_TOPIC, label: "Trocando o aparelho…", music: { stage: "device", device } };
    const query = morningStep ? "" : musicQueryFromText(question);
    return { progress: "musica", topic: MUSIC_TOPIC, label: "Abrindo o Spotify…", music: { stage: "connect", ...(query ? { query } : {}) } };
  }
  return mode === "report" ? { progress: "relatorio_do_dia", topic: "relatorio", label: "Puxando o relatório do dia…" } : { progress: "inicio", topic: "geral", label: "Só um instante…" };
}

// Estados da cena de música, sincronizados com os eventos reais: connect (pedido recebido) → search (busca enviada) →
// found (item achado, com a capa quando o Spotify devolve) → opening (abrindo o app) → playing (play confirmado) | error.
// device = troca de aparelho (device = tipo, deviceName = nome no Spotify, moved = trocou).
export const HENRY_MUSIC_STAGES = Object.freeze(["connect", "search", "found", "opening", "playing", "control", "device", "error"]);
const MUSIC_DEVICE_KINDS = new Set(["alexa", "computador", "celular", "caixa"]);
const MUSIC_CONTROL_LABELS = { pausar: "Pausando…", continuar: "Continuando…", proxima: "Próxima faixa…", anterior: "Voltando a faixa…", volume: "Ajustando o volume…", tocando: "Vendo o que está tocando…" };

// Ferramenta `spotify` chamada → evento da cena (busca enviada ou comando de player).
export function henryMusicProgress(input = {}) {
  const query = String(input?.busca || "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (input?.acao === "tocar" && query) return { progress: "musica_busca", topic: MUSIC_TOPIC, label: `Procurando “${query}” no Spotify…`, music: { stage: "search", query } };
  return { progress: "musica", topic: MUSIC_TOPIC, label: MUSIC_CONTROL_LABELS[input?.acao] || "No Spotify…", music: { stage: "control", action: String(input?.acao || "") } };
}

// Frase curta do erro na cena (sem aparelho, sem conexão…).
export function henryMusicErrorText(reason = "") {
  return {
    no_device: "Nenhum aparelho com o Spotify aberto.",
    not_found: "Não achei isso no Spotify.",
    premium: "O Spotify pede conta Premium.",
    not_connected: "Spotify não conectado.",
    rate_limited: "O Spotify pediu um tempinho."
  }[reason] || "O Spotify não respondeu agora.";
}

// Resultado da ferramenta/do play → evento da cena (found/opening/playing/error). playing = { name, artists, image }.
export function henryMusicResult(command = {}, result = {}) {
  const item = result?.playing || null;
  const base = { ...(command?.query ? { query: String(command.query).slice(0, 60) } : {}), ...(item?.name ? { name: item.name } : {}), ...(item?.artists ? { artists: item.artists } : {}), ...(item?.image ? { image: item.image } : {}) };
  if (result?.ok) return { progress: "musica_tocando", topic: MUSIC_TOPIC, label: "Tocando no Spotify", music: { ...base, stage: command?.action === "tocar" || !command?.action ? "playing" : "control" } };
  if (result?.uri) return { progress: "musica_achou", topic: MUSIC_TOPIC, label: "Abrindo o Spotify…", music: { ...base, stage: "opening" } };
  return { progress: "musica_erro", topic: MUSIC_TOPIC, label: henryMusicErrorText(result?.reason), music: { ...base, stage: "error", error: henryMusicErrorText(result?.reason) } };
}

// Troca de aparelho → evento da cena (ícone do aparelho + nome; erro = texto curto da mesma fala).
export function henryDeviceResult(result = {}) {
  const device = result?.device?.kind || result?.requested || "";
  const base = { stage: "device", ...(MUSIC_DEVICE_KINDS.has(device) ? { device } : {}), ...(result?.device?.name ? { deviceName: String(result.device.name).slice(0, 40) } : {}) };
  if (result?.ok) return { progress: "musica_aparelho", topic: MUSIC_TOPIC, label: result.already ? "Já está tocando aí" : "Música no outro aparelho", music: { ...base, moved: true } };
  if (result?.reason === "ask") return { progress: "musica_aparelho", topic: MUSIC_TOPIC, label: "Qual aparelho?", music: base };
  const error = result?.reason === "no_device" ? (device === "alexa" ? "A Alexa não apareceu no Spotify." : "Aparelho não apareceu no Spotify.") : henryMusicErrorText(result?.reason);
  return { progress: "musica_erro", topic: MUSIC_TOPIC, label: error, music: { ...base, stage: "error", error } };
}

// "Pronto, tá tocando!" + o nome do que veio da busca (dono, 2026-10-23).
// opener = começo sorteado no servidor (pickMusicPlayingOpener), para não repetir "Pronto, tá tocando!" o dia todo.
export const MUSIC_PLAYING_OPENERS = Object.freeze(["Pronto, tá tocando!", "Som na caixa!", "Tá na mão!", "Prontinho, já começou!", "Lá vai!", "Feito, já tá rolando!", "Começou!", "Música no ar!"]);
export function pickMusicPlayingOpener(avoid = [], random = Math.random) {
  const used = new Set((avoid || []).map((item) => normalizeSpeechText(item)));
  const fresh = MUSIC_PLAYING_OPENERS.filter((opener) => !used.has(normalizeSpeechText(opener.split(/\s+/).slice(0, 4).join(" "))));
  const list = fresh.length ? fresh : MUSIC_PLAYING_OPENERS;
  return list[Math.min(list.length - 1, Math.floor(Math.max(0, Math.min(0.9999, Number(random()) || 0)) * list.length))];
}
export function musicPlayingLine(item = {}, { opener = MUSIC_PLAYING_OPENERS[0] } = {}) {
  const name = String(item?.name || "").replace(/\s+/g, " ").trim().slice(0, 70);
  const artists = String(item?.artists || "").replace(/\s+/g, " ").trim().slice(0, 50);
  const lead = MUSIC_PLAYING_OPENERS.includes(opener) ? opener : MUSIC_PLAYING_OPENERS[0];
  if (!name) return lead;
  return artists && artists !== "playlist" && !name.toLowerCase().includes(artists.toLowerCase()) ? `${lead} ${name}, de ${artists}.` : `${lead} ${name}.`;
}

// Imagem de capa que pode ir para a tela: só https dos servidores de imagem do Spotify.
export function isSpotifyImageUrl(url) {
  return typeof url === "string" && url.length <= 300 && /^https:\/\/([a-z0-9-]+\.)*(scdn\.co|spotifycdn\.com)\/[^\s"'<>]+$/i.test(url);
}

// Estado da cena de música vindo do servidor → só campos conhecidos e curtos (nunca HTML/URL fora do Spotify).
export function normalizeHenryMusic(value) {
  if (!value || typeof value !== "object") return null;
  const stage = HENRY_MUSIC_STAGES.includes(value.stage) ? value.stage : "";
  if (!stage) return null;
  const text = (input, max) => String(input || "").replace(/\s+/g, " ").trim().slice(0, max);
  const out = { stage };
  for (const [key, max] of [["query", 60], ["name", 80], ["artists", 60], ["error", 80], ["action", 20]]) {
    const clean = text(value[key], max);
    if (clean) out[key] = clean;
  }
  if (isSpotifyImageUrl(value.image)) out.image = value.image;
  if (MUSIC_DEVICE_KINDS.has(value.device)) out.device = value.device;
  const deviceName = text(value.deviceName, 40);
  if (deviceName) out.deviceName = deviceName;
  if (value.moved === true) out.moved = true;
  return out;
}

// Junta o novo estado ao anterior (a busca não apaga o que já foi digitado; o resultado mantém a busca).
export function mergeHenryMusic(current, next) {
  const clean = normalizeHenryMusic(next);
  if (!clean) return current || null;
  return { ...(current || {}), ...clean, ...(clean.stage !== "error" ? { error: undefined } : {}), ...(current?.moved && clean.stage !== "device" && clean.stage !== "error" ? { moved: undefined } : {}) };
}

// Ferramenta chamada pelo modelo → { progress, topic, label, say? } (say = frase curta com o nome do corretor, sintetizada
// na hora). broker = { name, gender } já reconhecido pelo matcher. Ferramenta sem espera (abrir tela) → null.
export function henryProgressFor(name, input = {}, broker = null) {
  if (name === "spotify") return henryMusicProgress(input); // música não é busca no CRM: cena e frases do Spotify
  if (name === "mudar_aparelho_spotify") {
    const device = spotifyDeviceKindFromText(input?.aparelho);
    return { progress: "musica_aparelho", topic: MUSIC_TOPIC, label: "Trocando o aparelho…", music: { stage: "device", ...(device ? { device } : {}) } };
  }
  if (name === "abrir_tela") return null;
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

// Próxima frase de espera (dono, 2026-10-23: "repete muito 'Tô passando os olhos nos números'"). Regras:
//   1. escopo: música → só as do Spotify; resto → as do assunto + as gerais (nunca uma do Spotify nem de outro assunto);
//   2. nenhuma repete no MESMO DIA enquanto houver outra do escopo ainda não usada hoje (usedToday; padrão = recentIds):
//      primeiro as do assunto, depois as gerais — só entre as que já têm áudio pronto (available = ids com áudio;
//      null = todas);
//   3. sobrou frase não usada hoje mas SEM áudio → null (silêncio; a tela pede a síntese por waitPhrasesToSynthesize);
//   4. todas do escopo já usadas hoje → pode repetir, mas nunca uma das últimas `avoid` (10) faladas (recentIds, em ordem).
export function pickWaitPhrase({ topic = "geral", recentIds = [], usedToday = null, available = null, random = Math.random, phrases = HENRY_WAIT_PHRASES, avoid = RECENT_PHRASES_TO_AVOID } = {}) {
  const used = new Set(usedToday || recentIds);
  const scope = waitPhraseScope(phrases, topic);
  const isReady = (phrase) => !available || available.includes(phrase.id);
  const fresh = scope.filter((phrase) => !used.has(phrase.id));
  const pick = (list) => list[Math.min(list.length - 1, Math.floor(Math.max(0, Math.min(0.9999, Number(random()) || 0)) * list.length))];
  if (fresh.length) {
    const ready = fresh.filter(isReady);
    const own = ready.filter((phrase) => phrase.topics.includes(topic));
    const list = own.length ? own : ready;
    return list.length ? pick(list) : null;
  }
  const recent = new Set(recentIds.slice(-Math.max(1, avoid)));
  const again = scope.filter((phrase) => isReady(phrase) && !recent.has(phrase.id));
  return again.length ? pick(again) : null;
}

// Escopo da frase de espera: música → só as do Spotify; resto → assunto + gerais, nunca as do Spotify.
function waitPhraseScope(phrases, topic) {
  if (MUSIC_ONLY.has(topic)) return phrases.filter((phrase) => phrase.topics?.includes(topic));
  return phrases.filter((phrase) => !phrase.topics?.includes(MUSIC_TOPIC) && (phrase.topics?.includes(topic) || phrase.topics?.includes("geral")));
}

// Frases do escopo ainda não usadas hoje e sem áudio pronto (até `max`), do assunto primeiro: o que pedir ao servidor
// quando pickWaitPhrase devolve null (fica em silêncio enquanto isso; a próxima já sai com o áudio em cache).
export function waitPhrasesToSynthesize({ topic = "geral", usedToday = [], available = [], phrases = HENRY_WAIT_PHRASES, max = 2 } = {}) {
  const used = new Set(usedToday);
  const ready = new Set(available || []);
  const missing = waitPhraseScope(phrases, topic).filter((phrase) => !used.has(phrase.id) && !ready.has(phrase.id));
  const own = missing.filter((phrase) => phrase.topics.includes(topic));
  return [...own, ...missing.filter((phrase) => !own.includes(phrase))].slice(0, Math.max(0, max)).map((phrase) => phrase.id);
}

// Pré-aquecimento (ao abrir o Henry): ids do banco (frases de espera + confirmações) que ainda não têm áudio, em lotes de
// `size` — só o que falta, nunca sintetiza de novo o que já está no cache.
export function narrationWarmBatches({ readyIds = [], ids = [...HENRY_ACK_ITEMS, ...HENRY_WAIT_PHRASES].map((phrase) => phrase.id), size = 4 } = {}) {
  const ready = new Set(readyIds);
  const missing = ids.filter((id) => !ready.has(id));
  const batches = [];
  for (let index = 0; index < missing.length; index += size) batches.push(missing.slice(index, index + size));
  return batches;
}

// Lista das últimas frases faladas (para não repetir): acrescenta e guarda só as últimas `keep`.
export function rememberPhrase(recentIds = [], id, keep = 10) {
  return [...recentIds.filter((value) => value !== id), id].slice(-keep);
}

// Toca uma frase agora? Só esperando a resposta, sem outra frase tocando, depois de ~0,8 s do pedido e ~2,5 s da frase
// anterior, e só com áudio da voz do Henry pronto. Confirmação de escuta neste pedido (acked): a 1ª frase de espera só
// entra se a resposta demorar mais de ~2,5 s DEPOIS da confirmação E do começo do pedido (dono, 2026-10-23) — na gravação
// a confirmação toca antes da transcrição; contar só do fim dela fazia a frase entrar logo depois que o pedido saía.
export function shouldNarrate({ now = Date.now(), startedAt = 0, lastNarrationAt = 0, playing = false, replied = false, hasAudio = false, ackEndedAt = 0, acked = false } = {}) {
  if (replied || playing || !hasAudio || !startedAt) return false;
  if (now - startedAt < NARRATION_FIRST_DELAY_MS) return false;
  if (lastNarrationAt && now - lastNarrationAt < NARRATION_MIN_GAP_MS) return false;
  if (ackEndedAt && now - ackEndedAt < NARRATION_AFTER_ACK_MS) return false;
  if (acked && !lastNarrationAt && now - Math.max(startedAt, ackEndedAt || 0) < NARRATION_AFTER_ACK_MS) return false;
  return true;
}

// --- Confirmação de escuta (dono, 2026-10-23: "quero que ele fale alguma coisa nesse meio tempo, do tipo 'blz, já estou
// verificando', mas não pode ser sempre a mesma coisa"; "às vezes ele nem precisa falar, só fazer um som que entendeu") ---
// Logo depois do fim da fala, ANTES da transcrição/IA: (a) som curto de "entendi" (WebAudio, sem arquivo), (b) interjeição
// curtíssima ou (c) frase curta de verificação, na voz do Henry (sintetizadas uma vez com as frases de espera; sem voz do
// servidor → o som, nunca a voz do navegador).
export const NARRATION_AFTER_ACK_MS = 2500;
export const HENRY_ACK_WEIGHTS = Object.freeze({ tone: 0.4, word: 0.35, phrase: 0.25 });
// Notas em Hz e duração em ms; "hum" = duas notas graves e suaves (o "hm-hm"). Variações pequenas de tom.
export const HENRY_ACK_TONES = Object.freeze([
  { id: "t1", wave: "sine", notes: [[660, 90], [880, 120]] },
  { id: "t2", wave: "sine", notes: [[587, 90], [784, 120]] },
  { id: "t3", wave: "sine", notes: [[698, 80], [932, 110]] },
  { id: "t4", wave: "triangle", notes: [[262, 130], [330, 160]] },
  { id: "t5", wave: "triangle", notes: [[294, 120], [247, 170]] }
]);
export const HENRY_ACK_ITEMS = Object.freeze([
  { id: "k1", text: "Hum…", topics: ["ack_word"] },
  { id: "k2", text: "Opa.", topics: ["ack_word"] },
  { id: "k3", text: "Uhum.", topics: ["ack_word"] },
  { id: "k4", text: "Beleza.", topics: ["ack_word"] },
  { id: "k5", text: "Certo.", topics: ["ack_word"] },
  { id: "k6", text: "Show.", topics: ["ack_word"] },
  { id: "k7", text: "Fechou.", topics: ["ack_word"] },
  { id: "c1", text: "Beleza, já tô vendo.", topics: ["ack_phrase"] },
  { id: "c2", text: "Peraí que eu confiro.", topics: ["ack_phrase"] },
  { id: "c3", text: "Já te falo.", topics: ["ack_phrase"] },
  { id: "c4", text: "Deixa comigo.", topics: ["ack_phrase"] },
  { id: "c5", text: "Tô olhando aqui.", topics: ["ack_phrase"] },
  { id: "c6", text: "Um segundinho.", topics: ["ack_phrase"] }
]);
export const isAckPhrase = (phrase) => Boolean(phrase?.topics?.some((topic) => topic === "ack_word" || topic === "ack_phrase"));

// Pedido de dados ou que demora (relatório, corretor, período) → frase; papo rápido → som ou interjeição; sem texto ainda
// (gravação antes da transcrição) → sorteio ponderado.
const ACK_SLOW = /\b(relatorio|resumo|corretor|corretora|equipe|semana|semanal|mes|mensal|periodo|ontem|hoje|dias|ranking|pontos|funil|meta|clientes?|leads?|vendas|atendimentos?|prospeccao|numeros?|quantos?|quantas?|compar\w*|pesquis\w*|internet|toca|tocar|playlist|musica)\b/;
export function henryAckContext({ mode = "question", question = "" } = {}) {
  if (mode === "report") return "data";
  const value = normalizeSpeechText(question);
  if (!value) return "unknown";
  if (ACK_SLOW.test(value) || value.split(" ").length > 8) return "data";
  return "chat";
}

// Confirma agora? Nunca: desligado, mudo, sem fala, resposta a uma pergunta dele (aviso "pode falar", "rock" do bom dia)
// ou resposta já pronta para tocar (comando resolvido na hora, outra fala tocando).
export function shouldAcknowledgeHeard({ enabled = true, muted = false, heard = false, awaitingReply = false, instant = false, speaking = false } = {}) {
  return Boolean(enabled && !muted && heard && !awaitingReply && !instant && !speaking);
}

function weightedKind(kinds, random) {
  const total = kinds.reduce((sum, kind) => sum + HENRY_ACK_WEIGHTS[kind], 0);
  let roll = Math.max(0, Math.min(0.9999, Number(random()) || 0)) * total;
  for (const kind of kinds) {
    roll -= HENRY_ACK_WEIGHTS[kind];
    if (roll < 0) return kind;
  }
  return kinds[kinds.length - 1];
}

// Escolhe a confirmação: tipo pelo pedido (dados → frase; papo → som/interjeição; sem texto → 40/35/25), item nunca igual
// ao anterior e, entre as faladas, fora das já usadas hoje (usedToday; acabou o banco → qualquer uma menos a anterior).
// phrases = frases com áudio pronto (cache da narração). Sem áudio do tipo sorteado → o som.
export function pickListenAck({ context = "unknown", lastId = "", usedToday = [], phrases = [], random = Math.random, tones = HENRY_ACK_TONES } = {}) {
  const pool = (topic) => phrases.filter((phrase) => phrase?.topics?.includes(topic) && phrase.id !== lastId && phrase.audio?.base64);
  const kinds = context === "data" ? ["phrase"] : context === "chat" ? ["tone", "word"] : ["tone", "word", "phrase"];
  const kind = weightedKind(kinds, random);
  const pick = (list) => list[Math.min(list.length - 1, Math.floor(Math.max(0, Math.min(0.9999, Number(random()) || 0)) * list.length))];
  if (kind !== "tone") {
    const ready = pool(kind === "word" ? "ack_word" : "ack_phrase");
    const used = new Set(usedToday);
    const fresh = ready.filter((phrase) => !used.has(phrase.id));
    const list = fresh.length ? fresh : ready;
    if (list.length) {
      const phrase = pick(list);
      return { kind, id: phrase.id, text: phrase.text, audio: phrase.audio };
    }
  }
  const tonePool = tones.filter((tone) => tone.id !== lastId);
  const tone = pick(tonePool.length ? tonePool : tones);
  return tone ? { kind: "tone", id: tone.id, tone } : null;
}

// Duração do som (ms), para a fila saber quando ele termina.
export const ackToneDurationMs = (tone) => (tone?.notes || []).reduce((sum, [, ms]) => sum + ms, 0) + 60;

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
//   conversa    → só o anel com ondas reagindo à voz (papo, piada, elogio);
//   musica      → a cena do Spotify (conexão → busca → resultado → play), nunca números (dono, 2026-10-23).
export const HENRY_ANSWER_SCENES = Object.freeze(["corretor", "numeros", "comparativo", "cliente", "web", "memoria", "conversa", "musica"]);
const LONG_PERIODS = new Set(["esta_semana", "semana_passada", "este_mes", "mes_passado"]);
const CLIENT_TOOLS = new Set(["buscar_cliente", "abrir_cliente", "abrir_tela"]);
const SPOTIFY_TOOLS = new Set(["spotify", "mudar_aparelho_spotify"]);

export function pickHenryAnswerScene({ mode = "question", memory = false, tools = [], webSearches = 0 } = {}) {
  if (memory) return "memoria";
  if (mode === "report") return "numeros";
  if (Number(webSearches) > 0) return "web";
  const list = (Array.isArray(tools) ? tools : []).filter((tool) => tool && typeof tool.name === "string");
  const crm = list.filter((tool) => tool.name === "consultar_crm");
  if (list.some((tool) => tool.name === "consultar_corretor") || crm.some((tool) => tool.input?.corretor || RANKING_TOPICS.has(tool.input?.assunto))) return "corretor";
  if (list.some((tool) => tool.name === "relatorio_periodo") || crm.some((tool) => tool.input?.assunto === "comparar" || LONG_PERIODS.has(tool.input?.periodo))) return "comparativo";
  if (list.some((tool) => CLIENT_TOOLS.has(tool.name))) return "cliente";
  if (list.some((tool) => !SPOTIFY_TOOLS.has(tool.name))) return "numeros";
  return list.length ? "musica" : "conversa"; // só música (Spotify) = cena do Spotify; sem ferramenta = ondas
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
  if (kind === "musica") {
    const music = normalizeHenryMusic(value?.music);
    return music ? { kind, music } : { kind };
  }
  if (kind !== "comparativo" || !rows.length) return { kind };
  return { kind, chart: { currentLabel: String(value.chart.currentLabel || "Agora").slice(0, 40), previousLabel: String(value.chart.previousLabel || "Antes").slice(0, 40), rows } };
}

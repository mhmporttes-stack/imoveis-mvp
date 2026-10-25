// Narração de espera do Henry (pedido do dono, 2026-10-22: "remova os silêncios: enquanto ele pensa, procura ou carrega
// os dados, ele continua falando, tipo 'estou analisando seus arquivos'"). Regras PURAS (testáveis):
//   - eventos de progresso do stream (qual ferramenta o modelo chamou → chave, assunto da cena e legenda);
//   - conjunto FIXO de frases de espera (sintetizadas UMA vez por voz+estilo e guardadas em cache — não custa uma
//     chamada de voz por frase);
//   - quando tocar: só depois de ~0,8 s sem resposta, no máximo 1 frase a cada ~2,5 s, nunca a mesma frase seguida.
// A voz é SEMPRE a do Henry (servidor). Sem voz do servidor, fica em silêncio: nunca a voz do navegador (o dono removeu o
// "Deixa eu ver…" antigo justamente porque saía em outra voz).

import { normalizeSpeechText } from "./henry-voice-core.mjs";
import { MORNING_GENRES, classifyMorningMusicReply, classifyMorningStyle, classifyYesNo } from "./henry-morning-core.mjs";
import { spotifyDeviceKindFromText } from "./henry-spotify-core.mjs";
import { isSimilarToAny } from "./henry-repetition-core.mjs";

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
  // Banco maior e com estruturas diferentes (dono, 2026-10-25: "é tudo a mesma coisa [...] teria que ter um vocabulário
  // bem extenso"): menos "vou olhar/deixa eu ver" e mais reação, capricho, lugar no processo. Repetição medida por
  // SEMELHANÇA (lib/henry-repetition-core.mjs); travas do banco em tests/henry-lexicon.test.mjs.
  { id: "w49", text: "Essa vale caprichar, já já sai.", topics: ALL },
  { id: "w50", text: "Tá vindo, segura comigo.", topics: ALL },
  { id: "w51", text: "O CRM tá cooperando, falta pouco.", topics: ["geral", "relatorio", "funil", "meta", "ranking"] },
  { id: "w52", text: "Quase pronto, só fechando o raciocínio.", topics: ALL },
  { id: "w53", text: "Hum, tem coisa boa aqui.", topics: ["relatorio", "funil", "meta", "ranking", "geral"] },
  { id: "w54", text: "Essa resposta tá saindo do forno.", topics: ALL },
  { id: "w55", text: "Já tô chegando na parte boa.", topics: ["relatorio", "funil", "meta", "ranking", "geral"] },
  { id: "w56", text: "Montando o quadro pra você.", topics: ["relatorio", "funil", "meta"] },
  { id: "w57", text: "Tô cruzando uma coisa com a outra.", topics: ["relatorio", "funil", "corretor", "geral"] },
  { id: "w58", text: "Mais um tiquinho e pronto.", topics: ALL },
  { id: "w59", text: "Boa pergunta, tô caprichando na resposta.", topics: ALL },
  { id: "w60", text: "Peguei o fio da meada, já vem.", topics: ["geral", "clientes", "corretor", "relatorio"] },
  { id: "w61", text: "Tá tudo batendo, só finalizando.", topics: ["relatorio", "funil", "meta", "ranking"] },
  { id: "w62", text: "Calculando o placar da galera.", topics: ["ranking", "meta", "corretor"] },
  { id: "w63", text: "Vendo quem tá na frente.", topics: ["ranking", "corretor", "meta"] },
  { id: "w64", text: "Comparando semana com semana.", topics: ["relatorio"] },
  { id: "w65", text: "Colocando lado a lado com o período passado.", topics: ["relatorio"] },
  { id: "w66", text: "Tem bastante movimento, tô organizando.", topics: ["relatorio", "funil", "geral"] },
  { id: "w67", text: "Achei a ficha, tô lendo o histórico.", topics: ["clientes"] },
  { id: "w68", text: "Encontrei, só pegando os detalhes.", topics: ["clientes", "corretor"] },
  { id: "w69", text: "Esse nome tem mais de um, tô separando.", topics: ["clientes"] },
  { id: "w70", text: "Seguindo o rastro desse cliente.", topics: ["clientes"] },
  { id: "w71", text: "Pegando a etapa de cada um.", topics: ["clientes", "corretor", "funil"] },
  { id: "w72", text: "A conversa tá aqui, só um olhar rápido.", topics: ["whatsapp", "clientes"] },
  { id: "w73", text: "Vendo quem respondeu por último.", topics: ["whatsapp", "clientes"] },
  { id: "w74", text: "Abrindo as conversas da turma.", topics: ["whatsapp"] },
  { id: "w75", text: "Conferindo quem tá esperando resposta.", topics: ["whatsapp"] },
  { id: "w76", text: "Tô lendo o que saiu de novidade.", topics: ["internet"] },
  { id: "w77", text: "Achei umas fontes, tô filtrando.", topics: ["internet"] },
  { id: "w78", text: "Tô vendo o que a internet diz disso.", topics: ["internet"] },
  { id: "w79", text: "Separando o que é confiável.", topics: ["internet"] },
  { id: "w80", text: "Pesquisando em mais de um lugar.", topics: ["internet"] },
  { id: "w81", text: "Meta Diária na tela, tô calculando.", topics: ["meta"] },
  { id: "w82", text: "Vendo quem já bateu a meta.", topics: ["meta", "corretor"] },
  { id: "w83", text: "Tô medindo o ritmo de cada um.", topics: ["meta", "corretor", "ranking"] },
  { id: "w84", text: "O funil tá na minha frente, já explico.", topics: ["funil"] },
  { id: "w85", text: "Acompanhando etapa por etapa.", topics: ["funil", "relatorio"] },
  { id: "w86", text: "Deixando redondinho pra você.", topics: ALL },
  { id: "w87", text: "Ajeitando os detalhes finais.", topics: ALL },
  { id: "w88", text: "Falta só amarrar as pontas.", topics: ALL },
  { id: "w89", text: "Hum, interessante isso aqui.", topics: ["geral", "relatorio", "clientes", "corretor"] },
  { id: "w90", text: "Já tenho quase tudo.", topics: ALL },
  { id: "w91", text: "Opa, apareceu coisa boa.", topics: ["relatorio", "funil", "meta", "ranking"] },
  { id: "w92", text: "Pensando no melhor jeito de te contar.", topics: ALL },
  { id: "w93", text: "Escolhendo o que mais importa.", topics: ["relatorio", "geral", "funil"] },
  { id: "w94", text: "Resumindo pra não ficar comprido.", topics: ["relatorio", "geral"] },
  { id: "w95", text: "Tá quase, tô só no capricho.", topics: ALL },
  { id: "w96", text: "Hoje o sistema tá ligeiro, já vem.", topics: ALL },
  { id: "w97", text: "Aguenta firme que já sai.", topics: ALL },
  { id: "w98", text: "Pegando o desempenho do corretor.", topics: ["corretor"] },
  { id: "w99", text: "Lendo a agenda dele.", topics: ["corretor", "clientes"] },
  { id: "w100", text: "Vendo os atendimentos de cada um.", topics: ["corretor", "relatorio"] },
  { id: "w101", text: "Somando os pontos do pessoal.", topics: ["ranking"] },
  { id: "w102", text: "O pódio tá se formando aqui.", topics: ["ranking"] },
  { id: "w103", text: "Medindo a temperatura do mês.", topics: ["relatorio"] },
  { id: "w104", text: "Recortando o período certinho.", topics: ["relatorio"] },
  { id: "w105", text: "Tô botando ordem na casa.", topics: ["relatorio", "geral", "funil"] },
  { id: "w106", text: "Isso aqui rende, já te resumo.", topics: ["relatorio", "geral", "funil"] },
  { id: "w107", text: "Tô costurando as informações.", topics: ["relatorio", "geral", "clientes"] },
  { id: "w108", text: "Já já te dou o panorama.", topics: ["relatorio", "geral"] },
  { id: "w109", text: "Pescando o que você pediu.", topics: ["geral", "clientes", "corretor"] },
  { id: "w110", text: "Tô na trilha, quase chegando.", topics: ALL },
  { id: "w111", text: "Encaixando as peças, falta pouquinho.", topics: ALL },
  { id: "w112", text: "Hum, deixa eu caprichar nessa.", topics: ALL },
  { id: "w113", text: "Já, já, segura o café.", topics: ALL },
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
  { id: "m12", text: "Conferindo se é essa mesma.", topics: ["music"] },
  { id: "m13", text: "Sintonizando aqui.", topics: ["music"] },
  { id: "m14", text: "Escolhendo o som certo.", topics: ["music"] },
  { id: "m15", text: "Já começa, só achando a faixa.", topics: ["music"] },
  { id: "m16", text: "Abrindo o som pra você.", topics: ["music"] },
  { id: "m17", text: "Tô na fila do Spotify, já vai.", topics: ["music"] },
  { id: "m18", text: "Aumenta o coração que a música já vem.", topics: ["music"] },
  { id: "m19", text: "Achei umas opções, escolhendo a melhor.", topics: ["music"] },
  { id: "m20", text: "Trilha sonora a caminho.", topics: ["music"] },
  { id: "m21", text: "Preparando o play.", topics: ["music"] },
  { id: "m22", text: "Hum, boa escolha, já procuro.", topics: ["music"] },
  { id: "m23", text: "Tô garimpando essa faixa.", topics: ["music"] },
  { id: "m24", text: "Ajeitando o som, rapidinho.", topics: ["music"] },
  { id: "m25", text: "Caçando essa no Spotify.", topics: ["music"] },
  { id: "m26", text: "Deixa que o DJ aqui resolve.", topics: ["music"] },
  { id: "m27", text: "Já tá quase no ar.", topics: ["music"] },
  { id: "m28", text: "Conectando no seu Spotify.", topics: ["music"] }
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
  /^(coloca|coloque|colocar|poe|ponha|bota|bote|botar|solta|solte|soltar)\b(?!.*\b(agenda|lembrete|lembra|nota|tela|cliente|clientes|corretor|corretora|lista|status|etapa|meta|planilha|relatorio)\b)/,
  /^(pausa|pausar|pause|despausa|proxima|pula|pular)$/,
  /^(pausa|pausar|pause|continua|continuar|despausa|pula|pular) (o som|a musica|essa|isso|ai|a faixa)\b/,
  /\b(aumenta|abaixa|baixa|sobe|diminui|aumentar|abaixar)\b.*\b(som|volume)\b/
];
// Troca de aparelho (dono, 2026-10-23): "toca na Alexa", "passa pra Alexa", "joga pro Echo", "volta pro computador",
// "toca no celular", "toca na caixa da sala". Verbo + (a música/o som/isso)? + preposição + aparelho, no começo do pedido
// ("manda o relatório pro celular" NÃO é música).
const DEVICE_REQUEST = /^(pode )?(toca|tocar|toque|passa|passar|joga|jogar|muda|mudar|volta|voltar|transfere|transferir|leva|levar|manda|coloca|bota|poe)( (a musica|o som|o spotify|isso|ela|essa|tudo|ai))? (na|no|pra|pro|para|para a|para o|pra a|pro o|pela|pelo) (alexa|echo|eco|computador|pc|notebook|celular|telefone|iphone|caixa|caixinha)\b/;
// Pedidos que ficavam de fora e caíam no tópico padrão — frases de espera "do CRM" num pedido de música (dono,
// 2026-10-24: "quando eu peço uma música, ele fala 'estou consultando os dados'"): "quero ouvir X", "manda um pagode",
// "dá um play", "volta a tocar" e o nome transcrito como "Henrique"/"Enri" ou com cortesia antes ("por favor toca…").
const MUSIC_GENRE_WORDS = [...new Set(MORNING_GENRES.flatMap((item) => item.words))].sort((a, b) => b.length - a.length).map((word) => word.replace(/ /g, "\\s"));
const EXTRA_MUSIC_PATTERNS = [
  // "quero ouvir Legião", "bora escutar um rock" — menos o que é do CRM/aviso ("quero ouvir o relatório", "os avisos").
  /^(quero|queria|vamos|bora|deixa eu|me deixa) (ouvir|escutar)\b(?!.*\b(relatorio|resumo|aviso|avisos|noticia|noticias|numero|numeros|recado|recados|mensagem|mensagens|audio|audios|cliente|clientes|corretor|corretora|ranking|meta|funil|agenda)\b)/,
  /^(da|de|dar|aperta|aperte) (um |o )?play\b/,
  /^play$/,
  /^(volta|voltar|continua|continuar) (a )?(tocar|tocando)\b/,
  new RegExp(`^(manda|mande|toca|toque|bota|bote|coloca|coloque|poe|ponha|solta|solte|quero|bora|vamos de|vai de) (um |uma |uns |umas |o |a |os |as )?(${MUSIC_GENRE_WORDS.join("|")})\\b`)
];
// Pergunta de contagem ("quantas músicas…") não é pedido para tocar.
const MUSIC_COUNT_QUESTION = /^(quanto|quantos|quanta|quantas)\b/;
const MUSIC_COURTESY = /^((por favor|voce pode|vc pode|voce consegue|consegue|pode|da pra|faz um favor|me faz um favor) )+/;
const musicWords = (text) => normalizeSpeechText(text).replace(/^(ei |e ai |oi |ola |o |fala )?(henry|henri|henrique|enri)\b\s*/, "").replace(/\b(por favor|ai)$/, "").trim().replace(MUSIC_COURTESY, "").trim();

// Pedido composto ("bota alguma coisa mais tranquila aí e depois me diz quantos clientes novos entraram", Treino 2 do
// Henry, 2026-10-25): a parte da música é a que vem ANTES do conector — o "cliente" da 2ª parte não pode desfazer o pedido
// de música (a trava "coloca o cliente na tela" continua valendo para a 1ª parte). Mesmo conector em musicRequestRest
// (lib/henry-voice-turn.mjs).
export const MUSIC_REQUEST_CONNECTOR = /\s(?:e depois|depois|e em seguida|em seguida|e tambem|e enquanto isso|enquanto isso|e me|e ja|e ai me)\b/;
const musicHead = (value) => {
  const at = value.search(MUSIC_REQUEST_CONNECTOR);
  return at > 0 ? value.slice(0, at).replace(/\s(por favor|ai)$/, "").trim() : value;
};
export function isMusicRequest(text) {
  const value = musicWords(text);
  if (!value || MUSIC_COUNT_QUESTION.test(value)) return false;
  const head = musicHead(value);
  const matches = (item) => MUSIC_PATTERNS.some((pattern) => pattern.test(item)) || EXTRA_MUSIC_PATTERNS.some((pattern) => pattern.test(item)) || DEVICE_REQUEST.test(item);
  return matches(value) || (head !== value && matches(head));
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
// (classifyMorningMusicReply: aceite, estilo ou cantor = vai tocar; "não"/outra pergunta = segue o fluxo de sempre;
// "É essa?" do cantor = sim).
export function henryMusicIntent({ mode = "question", question = "", morningStep = "" } = {}) {
  if (morningStep === "music") return !["no", "other"].includes(classifyMorningMusicReply(question).kind);
  if (morningStep === "style") return ["genre", "artist"].includes(classifyMorningMusicReply(question).kind) || !["no", "other"].includes(classifyMorningStyle(question));
  if (morningStep === "music_confirm") return classifyYesNo(question) === "yes";
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
  // Nada bateu (cantor do bom dia): mostra o mais parecido, sem tocar — ele confirma ("Achei X, de Y. É essa?").
  if (result?.reason === "confirm" && result?.candidate?.name) return { progress: "musica_achou", topic: MUSIC_TOPIC, label: "Achei algo parecido…", music: { ...base, name: String(result.candidate.name).slice(0, 60), ...(result.candidate.artists && result.candidate.artists !== "playlist" ? { artists: String(result.candidate.artists).slice(0, 60) } : {}), stage: "found" } };
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
// Sem o nome da faixa (só o que ele PEDIU: "rock", "alguma coisa mais tranquila" — Treino 2, 2026-10-25: "Prontinho, já
// começou! rock."): o pedido entra DENTRO da frase ("Pronto, tocando rock.", "Lá vai uma música mais tranquila."), com o
// mesmo sorteio de começo (o índice do opener escolhe o molde).
const MUSIC_REQUEST_LINES = Object.freeze([(q) => `Pronto, tocando ${q}.`, (q) => `Lá vai ${q}.`, (q) => `Som na caixa com ${q}.`]);
export function musicRequestPhrase(query) {
  const value = String(query || "").replace(/\s+/g, " ").replace(/[.!?…,;:]+$/, "").trim().slice(0, 60);
  if (!value) return "";
  const vague = /^(?:alguma coisa|algo|uma coisa|um som|uns sons|um sonzinho|som|sonzinho)\b\s*(.*)$/i.exec(value);
  if (vague) return `uma música${vague[1] ? ` ${vague[1]}` : ""}`;
  const song = /^(?:uma |a )?(m[uú]sica)\b\s*(.*)$/i.exec(value);
  if (song) return `uma música${song[2] ? ` ${song[2]}` : ""}`;
  const songs = /^(?:umas |as )?(m[uú]sicas)\b\s*(.*)$/i.exec(value);
  if (songs) return `umas músicas${songs[2] ? ` ${songs[2]}` : ""}`;
  return value;
}
export function musicPlayingLine(item = {}, { opener = MUSIC_PLAYING_OPENERS[0] } = {}) {
  const name = String(item?.name || "").replace(/\s+/g, " ").trim().slice(0, 70);
  const artists = String(item?.artists || "").replace(/\s+/g, " ").trim().slice(0, 50);
  const lead = MUSIC_PLAYING_OPENERS.includes(opener) ? opener : MUSIC_PLAYING_OPENERS[0];
  if (!name) {
    const asked = musicRequestPhrase(item?.query);
    if (!asked) return lead;
    return MUSIC_REQUEST_LINES[Math.max(0, MUSIC_PLAYING_OPENERS.indexOf(lead)) % MUSIC_REQUEST_LINES.length](asked);
  }
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
  if (name === "ranking_periodo") return { progress: "ranking", topic: "ranking", label: "Conferindo o ranking…" };
  if (name === "funil_periodo") return { progress: "funil", topic: "funil", label: "Analisando o funil…" };
  if (name === "buscar_imoveis") return { progress: "crm", topic: "geral", label: "Procurando o imóvel…" };
  if (name === "consultar_corretor") return { progress: "corretor", topic: "corretor", label: "Procurando o corretor…" };
  if (name === "buscar_cliente") return { progress: "clientes", topic: "clientes", label: "Procurando o cliente…" };
  if (name === "buscar_clientes") return { progress: "clientes", topic: "clientes", label: Array.isArray(input?.clientes) && input.clientes.length > 1 ? "Procurando os clientes…" : "Procurando o cliente…" };
  if (name === "conversas_aguardando") return { progress: "clientes", topic: "clientes", label: input?.cliente ? "Abrindo a conversa do cliente…" : "Conferindo as conversas do Chat…" };
  if (name === "financeiro_resumo") return { progress: "financeiro", topic: "geral", label: "Conferindo o financeiro…" };
  if (name === "presenca_hoje") return { progress: "presenca", topic: "geral", label: "Vendo quem está na imobiliária…" };
  if (name === "relatorio_do_dia") return { progress: "relatorio_do_dia", topic: "relatorio", label: "Puxando o relatório do dia…" };
  if (name === "clientes_esfriados_pendentes") return { progress: "clientes", topic: "clientes", label: "Conferindo os clientes frios…" };
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
//   5. (dono, 2026-10-25: "muda uma palavra e fala a mesma frase") "não usada hoje" = nem ela nem uma PARECIDA
//      (isSimilarToAny, lib/henry-repetition-core.mjs) com o que já foi falado hoje — confirmações de escuta incluídas
//      (o aparelho guarda as duas na mesma lista).
export function pickWaitPhrase({ topic = "geral", recentIds = [], usedToday = null, available = null, random = Math.random, phrases = HENRY_WAIT_PHRASES, avoid = RECENT_PHRASES_TO_AVOID } = {}) {
  const used = new Set(usedToday || recentIds);
  const saidTexts = spokenTextsOf(used, phrases);
  const scope = waitPhraseScope(phrases, topic);
  const isReady = (phrase) => !available || available.includes(phrase.id);
  const fresh = scope.filter((phrase) => !used.has(phrase.id) && !isSimilarToAny(phrase.text, saidTexts));
  const pick = (list) => list[Math.min(list.length - 1, Math.floor(Math.max(0, Math.min(0.9999, Number(random()) || 0)) * list.length))];
  if (fresh.length) {
    const ready = fresh.filter(isReady);
    const own = ready.filter((phrase) => phrase.topics.includes(topic));
    const list = own.length ? own : ready;
    return list.length ? pick(list) : null;
  }
  const recent = new Set(recentIds.slice(-Math.max(1, avoid)));
  const recentTexts = spokenTextsOf(recent, phrases);
  const again = scope.filter((phrase) => isReady(phrase) && !recent.has(phrase.id));
  const distinct = again.filter((phrase) => !isSimilarToAny(phrase.text, recentTexts));
  const list = distinct.length ? distinct : again;
  return list.length ? pick(list) : null;
}

// Textos das frases já faladas (ids → texto), procurando no banco passado, nas frases de espera e nas confirmações.
function spokenTextsOf(ids, phrases = []) {
  const texts = [];
  for (const id of ids) {
    const phrase = phrases.find((item) => item.id === id) || PHRASE_BY_ID.get(id);
    if (phrase?.text) texts.push(phrase.text);
  }
  return texts;
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
  const saidTexts = spokenTextsOf(used, phrases);
  const ready = new Set(available || []);
  const missing = waitPhraseScope(phrases, topic).filter((phrase) => !used.has(phrase.id) && !ready.has(phrase.id) && !isSimilarToAny(phrase.text, saidTexts));
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
// quiet = saudação/cortesia pura (isHenryGreeting, dono 2026-10-24: "só falei boa noite") → nunca frase de espera.
export function shouldNarrate({ now = Date.now(), startedAt = 0, lastNarrationAt = 0, playing = false, replied = false, hasAudio = false, ackEndedAt = 0, acked = false, quiet = false } = {}) {
  if (quiet || replied || playing || !hasAudio || !startedAt) return false;
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
  { id: "c3", text: "Já te falo.", topics: ["ack_phrase"], neutral: true },
  { id: "c4", text: "Deixa comigo.", topics: ["ack_phrase"], neutral: true },
  { id: "c5", text: "Tô olhando aqui.", topics: ["ack_phrase"] },
  { id: "c6", text: "Um segundinho.", topics: ["ack_phrase"], neutral: true },
  // Banco maior e variado (dono, 2026-10-25: "é tudo a mesma coisa"): semelhança com o já falado hoje bloqueia a frase.
  { id: "k8", text: "Aham.", topics: ["ack_word"] },
  { id: "k9", text: "Tá.", topics: ["ack_word"] },
  { id: "k10", text: "Ok.", topics: ["ack_word"] },
  { id: "k11", text: "Saquei.", topics: ["ack_word"] },
  { id: "k12", text: "Entendi.", topics: ["ack_word"] },
  { id: "k13", text: "Anotado.", topics: ["ack_word"] },
  { id: "k14", text: "Hum, tá.", topics: ["ack_word"] },
  { id: "k15", text: "Ah, tá.", topics: ["ack_word"] },
  { id: "k16", text: "Ótimo.", topics: ["ack_word"] },
  { id: "k17", text: "Bacana.", topics: ["ack_word"] },
  { id: "k18", text: "Firmeza.", topics: ["ack_word"] },
  { id: "k19", text: "Tranquilo.", topics: ["ack_word"] },
  { id: "k20", text: "Positivo.", topics: ["ack_word"] },
  { id: "k21", text: "Uhum, entendi.", topics: ["ack_word"] },
  { id: "k22", text: "Opa, beleza.", topics: ["ack_word"] },
  { id: "c7", text: "Anotado, já vem.", topics: ["ack_phrase"], neutral: true },
  { id: "c8", text: "Pode deixar.", topics: ["ack_phrase"], neutral: true },
  { id: "c9", text: "É pra já.", topics: ["ack_phrase"], neutral: true },
  { id: "c10", text: "Na hora.", topics: ["ack_phrase"], neutral: true },
  { id: "c11", text: "Já cuido disso.", topics: ["ack_phrase"], neutral: true },
  { id: "c12", text: "Entendido, já te respondo.", topics: ["ack_phrase"], neutral: true },
  { id: "c13", text: "Tá comigo.", topics: ["ack_phrase"], neutral: true },
  { id: "c14", text: "Saquei, um instantinho.", topics: ["ack_phrase"], neutral: true },
  { id: "c15", text: "Boa, já resolvo.", topics: ["ack_phrase"], neutral: true },
  { id: "c16", text: "Recebido.", topics: ["ack_phrase"], neutral: true },
  { id: "c17", text: "Fechou, deixa rolar.", topics: ["ack_phrase"], neutral: true },
  { id: "c18", text: "Certo, tô nessa.", topics: ["ack_phrase"], neutral: true },
  { id: "c19", text: "Ouvi, já volto.", topics: ["ack_phrase"], neutral: true },
  { id: "c20", text: "Missão dada.", topics: ["ack_phrase"], neutral: true },
  { id: "c21", text: "Essa eu acho rapidinho.", topics: ["ack_phrase"] },
  { id: "c22", text: "Boa, sei onde procurar.", topics: ["ack_phrase"] },
  { id: "c23", text: "Hum, interessante, já vejo.", topics: ["ack_phrase"] },
  { id: "c24", text: "Isso eu resolvo rapidinho.", topics: ["ack_phrase"] },
  { id: "c25", text: "Bora descobrir.", topics: ["ack_phrase"] },
  { id: "c26", text: "Já tô no CRM.", topics: ["ack_phrase"] },
  { id: "c27", text: "Opa, essa é boa.", topics: ["ack_phrase"] },
  { id: "c28", text: "Tá, abrindo aqui.", topics: ["ack_phrase"] },
  { id: "c29", text: "Partiu descobrir.", topics: ["ack_phrase"] },
  { id: "c30", text: "Já tô de olho.", topics: ["ack_phrase"] },
  { id: "c31", text: "Hum, curioso, já respondo.", topics: ["ack_phrase"] },
  { id: "c32", text: "Boa pergunta, já busco.", topics: ["ack_phrase"] },
  { id: "c33", text: "Show, saindo já.", topics: ["ack_phrase"] },
  { id: "c34", text: "Entendi a pergunta.", topics: ["ack_phrase"] },
  { id: "c35", text: "Corre não, já sai.", topics: ["ack_phrase"] },
  { id: "c36", text: "Tá na mão em segundos.", topics: ["ack_phrase"] },
  { id: "c37", text: "Bora pros números.", topics: ["ack_phrase"] },
  { id: "c38", text: "Já vou atrás.", topics: ["ack_phrase"] },
  { id: "c39", text: "Perfeito, conferindo.", topics: ["ack_phrase"] },
  { id: "c40", text: "Questão anotada, já sai.", topics: ["ack_phrase"] }
]);
// Todas as frases faladas do banco (espera + confirmações), por id — textos do que já foi falado hoje (semelhança).
const PHRASE_BY_ID = new Map([...HENRY_WAIT_PHRASES, ...HENRY_ACK_ITEMS].map((phrase) => [phrase.id, phrase]));
// Pelo id do banco (o áudio vem do servidor/cache só com id, texto, tópicos e áudio).
const NEUTRAL_ACK_IDS = new Set(HENRY_ACK_ITEMS.filter((item) => item.neutral).map((item) => item.id));
export const isAckPhrase = (phrase) => Boolean(phrase?.topics?.some((topic) => topic === "ack_word" || topic === "ack_phrase"));

// Pedido de dados ou que demora (relatório, corretor, período) → frase; papo rápido → som ou interjeição; sem texto ainda
// (gravação antes da transcrição) → sorteio ponderado.
// Música (dono, 2026-10-24: "pedi uma música e ele falou 'dando uma olhadinha'") → "music": só som ou interjeição, nunca
// frase de verificação de dados. Lida pelo texto ANTES da regra de dados ("toca"/"playlist" não são mais "dados").
const ACK_SLOW = /\b(relatorio|resumo|corretor|corretora|equipe|semana|semanal|mes|mensal|periodo|ontem|hoje|dias|ranking|pontos|funil|meta|clientes?|leads?|vendas|atendimentos?|prospeccao|numeros?|quantos?|quantas?|compar\w*|pesquis\w*|internet)\b/;
export function henryAckContext({ mode = "question", question = "" } = {}) {
  if (mode === "report") return "data";
  const value = normalizeSpeechText(question);
  if (!value) return "unknown";
  if (isMusicRequest(question)) return "music";
  if (ACK_SLOW.test(value) || value.split(" ").length > 8) return "data";
  return "chat";
}

// Confirma agora? Nunca: desligado, mudo, sem fala, resposta a uma pergunta dele (aviso "pode falar", "rock" do bom dia)
// ou resposta já pronta para tocar (comando resolvido na hora, outra fala tocando).
// greeting = saudação/cortesia pura já transcrita: a resposta é só o cumprimento, sem "Certo."/som antes (dono, 2026-10-24).
export function shouldAcknowledgeHeard({ enabled = true, muted = false, heard = false, awaitingReply = false, instant = false, speaking = false, greeting = false } = {}) {
  return Boolean(enabled && !muted && heard && !awaitingReply && !instant && !speaking && !greeting);
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

// Escolhe a confirmação: tipo pelo pedido (dados → frase; papo/música → som/interjeição; sem texto → 40/35/25, frase só
// neutra), item nunca igual ao anterior e, entre as faladas, fora das já usadas hoje (usedToday; acabou o banco → qualquer uma menos a anterior).
// phrases = frases com áudio pronto (cache da narração). Sem áudio do tipo sorteado → o som.
export function pickListenAck({ context = "unknown", lastId = "", usedToday = [], phrases = [], random = Math.random, tones = HENRY_ACK_TONES } = {}) {
  const pool = (topic) => phrases.filter((phrase) => phrase?.topics?.includes(topic) && phrase.id !== lastId && phrase.audio?.base64);
  const kinds = context === "data" ? ["phrase"] : context === "chat" || context === "music" ? ["tone", "word"] : ["tone", "word", "phrase"];
  const kind = weightedKind(kinds, random);
  const pick = (list) => list[Math.min(list.length - 1, Math.floor(Math.max(0, Math.min(0.9999, Number(random()) || 0)) * list.length))];
  if (kind !== "tone") {
    // Sem texto (gravação, antes da transcrição) o pedido pode ser música: só as frases neutras ("Já te falo."), nunca as
    // de verificação ("Peraí que eu confiro.", "Tô olhando aqui.").
    const ready = pool(kind === "word" ? "ack_word" : "ack_phrase").filter((phrase) => kind === "word" || context === "data" || NEUTRAL_ACK_IDS.has(phrase.id));
    const used = new Set(usedToday);
    // Fora das usadas hoje e das PARECIDAS com o que já foi falado hoje (confirmações e frases de espera; dono, 2026-10-25).
    const saidTexts = spokenTextsOf(used, phrases);
    const fresh = ready.filter((phrase) => !used.has(phrase.id) && !isSimilarToAny(phrase.text, saidTexts));
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
const CLIENT_TOOLS = new Set(["buscar_cliente", "buscar_clientes", "abrir_cliente", "abrir_tela"]);
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

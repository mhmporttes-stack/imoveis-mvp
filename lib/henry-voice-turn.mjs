// Leitura do pedido do dono ANTES e DEPOIS do modelo (Treino 2 do Henry, rodada de 2026-10-25 em crm_settings
// henry_training_reports — docs/BUSINESS_RULES.md HENRY-1, docs/INCIDENTES.md). Núcleo PURO (sem rede), usado por
// lib/henry-voice.js (dica da resposta, rodada extra, troca da resposta repetida) e lib/henry-training-core.mjs (achados
// "pergunta_ignorada" e "repetiu_apos_reclamacao") — a mesma regra nos dois, nada de critério paralelo:
//   - henryQuestionPart: a parte do pedido que é pergunta do CRM ("bota uma música tranquila e depois me diz quantos
//     clientes novos" → "me diz quantos clientes novos"; "e aí, beleza? como tá o movimento hoje?" → a pergunta);
//   - replyAnswersQuestion: a resposta tem conteúdo (número, "nenhum/ninguém", "na tela", falha dita, pergunta de qual);
//   - isHenryComplaint / henryRepeatedAfterComplaint: "não foi isso que eu perguntei" e a resposta repetida depois dela;
//   - henryResumeTopic: "bora voltar pro funil" → o assunto e a pergunta dele de antes sobre ele;
//   - henryTurnHint: a instrução "Nesta resposta: …" que vai ao modelo.
// Treino 3 (rodada de 2026-10-25T16:42Z): henryDirectRoute (pergunta clara → a ferramenta roda ANTES do modelo, sem depender
// dele escolher), henryPromisedAction ("vou puxar…" sem número → rodada que obriga a ferramenta) e isPersonalQuestion
// ("como foi teu dia?" é papo com o Henry, não pergunta do CRM).
// Treino 4 (rodada de 2026-10-25T17:27Z): isCasualRequest (piada = papo, mesmo citando "cliente"), isHenryAgreement ("agora
// sim, três vendas…" = concordância, sem ferramenta), isPreviousReference ("aquela parada que você tava falando" = o último
// assunto da conversa, nunca um chute), reclamação comparada por NÚMERO (dígito ou por extenso) e rota direta para
// atendimentos do dia, nomes dos clientes novos, volume, aparelho e música + pergunta.
// Treino 5 (rodada automática de 2026-10-25T18:02Z): rota direta para o tamanho da Meta Diária ("quanto a equipe precisa
// fechar por dia"), falta de vendas (sem meta de vendas no CRM → funil do período) e clientes esperando numa etapa ("e os
// vinte esperando?"); isVagueClientReference ("aquele cliente" sem nome = pergunta o nome); volume no infinitivo; e
// stripSpeechLabel ("Feito:" no começo da fala).

import { isCrmQuestion, normalizeSpeechText } from "./henry-voice-core.mjs";
import { MUSIC_REQUEST_CONNECTOR, isMusicRequest, musicQueryFromText, spotifyDeviceRequestKind } from "./henry-voice-narration.mjs";
import { henryPeriodFromText } from "./henry-reports-core.mjs";
import { HENRY_COMPLAINT_REPLIES, isHenryGreeting } from "./henry-voice-persona.mjs";
import { isSimilarPhrase, isSimilarToAny } from "./henry-repetition-core.mjs";
import { isTeamAlertRequest } from "./henry-team-alert-core.mjs";

const plain = (text) => normalizeSpeechText(text).replace(/\b(henry|henri|enri)\b/g, " ").replace(/\s+/g, " ").trim();
const quote = (text, max = 160) => String(text || "").replace(/\s+/g, " ").replace(/"/g, "'").trim().slice(0, max);

// --- Partes do pedido ------------------------------------------------------------------------------------------------
// Música + outra coisa: o que vem depois do conector ("e depois", "e me diz", "e já"...).
export function musicRequestRest(text) {
  const value = plain(text);
  const match = MUSIC_REQUEST_CONNECTOR.exec(value);
  return match ? value.slice(match.index + match[0].length).trim() : "";
}

// Cumprimento no começo ("e aí, beleza?", "bom dia", "oi, tudo bem?") → tira para sobrar a pergunta.
const GREETING_HEAD = /^(?:(?:oi|ola|opa|e ai|eai|fala|salve|bom dia|boa tarde|boa noite|beleza|blz|suave|tudo (?:bem|bom|certo|joia|tranquilo|em ordem)|como (?:voce )?(?:esta|vai)|e voce|meu (?:querido|amigo|parceiro)|chefe|patrao)\b\s*)+/;
export function stripGreetingHead(text) {
  return plain(text).replace(GREETING_HEAD, "").trim();
}

export function startsWithGreeting(text) {
  const value = plain(text);
  return Boolean(value) && GREETING_HEAD.test(value) && value.replace(GREETING_HEAD, "").trim().length > 0;
}

// A parte que é pergunta do CRM ("" = não há): saudação pura não tem; música só a parte depois do conector.
export function henryQuestionPart(text) {
  const value = plain(text);
  if (!value || isHenryGreeting(text) || isCasualRequest(text) || isHenryAgreement(text) || isPreviousReference(text) || isVagueClientReference(text)) return "";
  if (isMusicRequest(text)) {
    const rest = musicRequestRest(value);
    return rest && isCrmQuestion(rest) ? rest : "";
  }
  const question = stripGreetingHead(value) || value;
  return isCrmQuestion(question) ? question : "";
}

// --- A resposta respondeu? -------------------------------------------------------------------------------------------
// Conteúdo = número; contagem por extenso; "nenhum/ninguém/todos/zerado"; detalhes na tela; falha dita ("não consegui");
// ou pergunta de esclarecimento ("qual deles?"). "Quer que eu traga o número?" NÃO é esclarecimento.
const ANSWER_WORDS = /\b(nenhum|nenhuma|ninguem|zero|zerad[oa]s?|todos|todas|todo mundo|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|na tela|nao consegui|nao achei|nao tem|vazio)\b/;
const ONE_COUNT = /\b(um|uma) (client|simulac|vend|atendiment|aprovad|corretor|lead|document|convers|visit|reuni|imove|empreendiment)/;
const CLARIFY = /\b(qual|quais|de qual|qual deles|qual delas|quem|de quem|que periodo|qual periodo|voce quer dizer|seria (o|a|do|da))\b/;
export function isClarifyingQuestion(reply) {
  return String(reply || "")
    .split(/(?<=[.!?…])\s+/)
    .filter((sentence) => /\?\s*["”')]*$/.test(sentence.trim()))
    .map((sentence) => normalizeSpeechText(sentence))
    .some((value) => CLARIFY.test(value) && !/\bquer que eu\b/.test(value));
}
export function replyAnswersQuestion(reply) {
  const raw = String(reply || "").trim();
  if (!raw) return false;
  if (/\d/.test(raw)) return true;
  const value = normalizeSpeechText(raw);
  return ANSWER_WORDS.test(value) || ONE_COUNT.test(value) || isClarifyingQuestion(raw);
}

// Instrução da rodada extra quando a parte-pergunta do pedido ficou sem resposta (uma vez por pedido).
export function henryUnansweredRetry(part) {
  return `[Sistema] Ainda falta responder esta parte do pedido dele: "${quote(part)}". Use agora a ferramenta certa e responda SÓ essa parte, com o número, numa frase curta — sem repetir o que você já disse e sem perguntar se ele quer o número.`;
}

// --- Reclamação ------------------------------------------------------------------------------------------------------
const COMPLAINT = /\b(nao (?:foi|e|era) (?:bem )?(?:isso|essa|esse|o que eu (?:perguntei|pedi|quis|queria))|nao perguntei (?:isso|isso ai)|nao pedi isso|nao era bem isso|(?:ta|esta|voce ta|voce esta|tu ta) repetindo|repetiu (?:a mesma coisa|de novo)|mesma coisa de novo|errou de novo|nao entendeu|entendeu errado|ta errado|resposta errada)\b/;
export function isHenryComplaint(text) {
  return COMPLAINT.test(normalizeSpeechText(text));
}

// Números da fala, em dígito OU por extenso (Treino 4, 2026-10-25: "Três vendas este mês…" → "São 3 vendas fechadas no mês"
// passou pela comparação só de dígitos). "um/uma" ficam de fora (são artigo na maioria das falas).
const SPOKEN_NUMBERS = { dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20 };
export function numbersOf(text) {
  const raw = String(text || "");
  const found = (raw.match(/\d+(?:[.,]\d+)?/g) || []).map((value) => value.replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  for (const word of normalizeSpeechText(raw).split(" ")) if (SPOKEN_NUMBERS[word]) found.push(String(SPOKEN_NUMBERS[word]));
  return [...new Set(found.map((value) => String(Number(value))))].sort().join(" ");
}
// Resposta à reclamação parecida com a anterior: mesma frase (semelhança, lib/henry-repetition-core.mjs) ou os mesmos
// números sem pergunta nenhuma ("Foram 3 vendas" → "Então, foram três vendas este mês.").
export function henryRepeatedAfterComplaint(reply, previous) {
  const now = String(reply || "").trim();
  const before = String(previous || "").trim();
  if (!now || !before) return false;
  if (isSimilarPhrase(now, before)) return true;
  const numbers = numbersOf(now);
  return Boolean(numbers) && numbers === numbersOf(before) && !/\?/.test(now);
}

// Troca da resposta repetida: uma das frases de reconhecimento, fora das parecidas com as de hoje.
export function pickComplaintReply(said = [], random = Math.random) {
  const fresh = HENRY_COMPLAINT_REPLIES.filter((reply) => !isSimilarToAny(reply, said));
  const list = fresh.length ? fresh : HENRY_COMPLAINT_REPLIES;
  return list[Math.min(list.length - 1, Math.floor(Math.max(0, Math.min(0.9999, Number(random()) || 0)) * list.length))];
}

// --- Retomar um assunto ----------------------------------------------------------------------------------------------
const TOPICS = "funil|ranking|meta diaria|meta|agenda|clientes|cliente|whatsapp|chat|vendas|venda|financeiro|relatorio|simulacoes|simulacao|documentacao|corretores|corretor|pontuacao|imoveis|imovel|empreendimentos|empreendimento";
const RESUME = new RegExp(`\\b(?:volt\\w*|retom\\w*|de volta)\\b(?: \\w+){0,2}? (?:pro|pra|para o|para a|ao|a|o|no|na|com o|com a|aquele|aquela) (?:assunto (?:do|da|de) )?(${TOPICS})\\b`);
export function henryResumeTopic(text, turns = []) {
  const match = RESUME.exec(plain(text));
  if (!match) return null;
  const topic = match[1];
  const stem = topic.split(" ")[0].slice(0, 5);
  const own = plain(text);
  const previous = [...(Array.isArray(turns) ? turns : [])]
    .reverse()
    .find((turn) => turn?.role === "user" && turn.text && plain(turn.text) !== own && plain(turn.text).includes(stem) && !RESUME.test(plain(turn.text)));
  return { topic, previous: previous ? quote(previous.text) : "" };
}

// --- Pergunta pessoal ao Henry (Treino 3: "E aí, como é que foi teu dia hoje?" → "…Entraram 2 clientes novos hoje…") ---
// Pergunta sobre ELE (o dia dele, como ele está) é papo, não CRM: sem ferramentas e sem número. Se a fala também cita um
// assunto do CRM ("como tá você e a meta?"), não é só pessoal.
const PERSONAL = /\b(?:como (?:e que )?(?:foi|ta|esta|anda|vai|tem sido) (?:o )?(?:teu|seu) dia|(?:o )?(?:teu|seu) dia (?:foi|ta|esta|rendeu)|como (?:voce|vc|tu|ce) (?:ta|esta|vai|anda|foi|tem passado)|(?:voce|vc|tu) (?:ta|esta) bem)\b/;
export function isPersonalQuestion(text) {
  const value = plain(text);
  return Boolean(value) && PERSONAL.test(value) && !isCrmQuestion(value);
}

// --- Papo pedido (Treino 4: "me conta uma piada aí, Henry, pra desopilar depois de tanto cliente hoje" → relatorio_do_dia,
// 11,3 s, "Hoje já entraram 2 clientes novos…") -----------------------------------------------------------------------------
// Pedido de piada/descontração é papo, mesmo citando "cliente": sem ferramentas e sem número.
const CASUAL = /\b(?:piada|piadinha|piadas|charada|anedota|me faz(?:er)? rir|desopilar|descontrair)\b/;
export function isCasualRequest(text) {
  return CASUAL.test(plain(text));
}

// --- Concordância (Treino 4: "Agora sim, três vendas já é outra conversa." → 3 rodadas + consultar_crm) -----------------
// Comentário que só concorda/comenta o que ele acabou de ouvir, sem pedir nada: resposta curta, sem ferramenta.
const AGREE_HEAD = /^(?:agora sim|ah agora sim|isso(?: ai| mesmo)?|exato|exatamente|perfeito|show|boa|beleza|massa|top|ah bom|entendi|ok|certo|fechou|otimo|legal|maravilha|demais|que bom|bacana)\b/;
const ASKS = /\b(?:quant\w*|qual|quais|quem|como|onde|quando|por que|porque|me (?:diz|diga|fala|fale|mostra|mostre|passa|passe|conta|conte|manda|traz)|mostra|abre|abra|toca|bota|poe|coloca|veja|busca|puxa|confere|verifica|e (?:o|a|os|as|do|da|no|na) \w+|tem (?:algum|alguma|mais)|quero|preciso|volta\w*|deixa|olha|olhe|olhada|olhadinha|espiada|checa|cheque|checada|conferida)\b/;
export function isHenryAgreement(text) {
  if (/\?/.test(String(text || "")) || isHenryGreeting(text)) return false;
  const value = plain(text);
  return Boolean(value) && AGREE_HEAD.test(value) && !ASKS.test(value) && !isHenryComplaint(text);
}

// --- "Aquela parada que você tava falando" (Treino 4: virou "Hoje entraram 2 clientes novos.", 3 rodadas) ---------------
// Referência ao último assunto da conversa, sem dizer qual: o Henry retoma ESSE assunto (ou pergunta), nunca chuta outro.
// Com um assunto do CRM dito na mesma fala ("aquela parada do funil"), não é só referência.
const REFERENCE = /\b(?:(?:aquel[ae]s?|aquilo|ess[ae]s?|isso)(?: \w+){0,3}? que (?:voce|vc|tu|ce) (?:(?:tava|estava|ta|esta|tinha|tinha me) (?:falando|dizendo|comentando|contando|perguntando|mostrando)|falou|disse|comentou|mencionou|citou|perguntou)|(?:aquela|essa) (?:parada|coisa|historia|questao|situacao|lance|fita|treta)|(?:aquele|esse) (?:lance|assunto|negocio|trem|treco)|o que (?:voce|vc|tu|ce) (?:tava|estava) (?:falando|dizendo))\b/;
export function isPreviousReference(text) {
  const value = plain(text);
  if (!value || !REFERENCE.test(value)) return false;
  return !isCrmQuestion(value.replace(REFERENCE, " ").replace(/\bparad\w*/g, " "));
}

// --- "Aquele cliente, como é que tá?" sem nome (Treino 5: relatorio_do_dia, 3 rodadas, 4,8 s, "entraram 2 clientes novos")
// Cliente citado só por "aquele/aquela/esse/essa" sem nome = perguntar o nome direto, sem ferramenta. Nome na fala ("aquele
// cliente, o Bruno") não é vago.
const VAGUE_CLIENT = /\b(?:aquel[ae]|ess[ae]|daquel[ae]|dess[ae]|naquel[ae]) (?:client[ea]|clientezinh[oa]|moc[oa]|senhor[a]?|cara|mulher|rapaz|menin[oa]|lead)\b/;
export function isVagueClientReference(text) {
  const value = plain(text);
  if (!value || !VAGUE_CLIENT.test(value)) return false;
  return !mentionsProperName(text) && !numbersOf(text);
}

// --- Promessa sem ação (Treino 3: "Vou puxar o funil deste mês agora e te mostrar…" sem ferramenta; "Pergunta de novo
// que eu busco agora.") ---------------------------------------------------------------------------------------------------
// Resposta que diz que vai buscar/mostrar (ou oferece "se quiser, eu puxo") e não traz conteúdo. Pedido de informação a ele
// ("me diz o nome que eu verifico", "qual cliente?") NÃO é promessa: falta um dado dele, não uma busca.
const PROMISE = /\b(?:vou (?:ja )?(?:puxar|buscar|trazer|ver|verificar|conferir|checar|olhar|consultar|levantar|pegar|mostrar|te mostrar|te trazer|te falar|te passar)|ja (?:te )?(?:mostro|trago|falo|digo|puxo|busco|vejo|passo|confiro)|te (?:mostro|trago|falo|passo) ja|deixa (?:eu|que eu) (?:puxar|buscar|ver|conferir|checar|olhar|consultar)|(?:eu|que eu) (?:puxo|busco|trago|levanto|consulto|confiro|verifico)|(?:pergunta|pede|fala) de novo que eu|um (?:instante|minutinho|segundo) que eu)\b/;
const ASKS_HIM = /\b(?:me (?:diz|diga|fala|fale|passa|passe|conta|conte|manda)|(?:qual|quais|de qual) (?:cliente|clientes|corretor|corretora|imovel|imoveis|deles|delas|nome|tela|periodo|dia)|de quem|se (?:voce|vc) (?:me )?(?:disser|falar|passar))\b/;
export function henryPromisedAction(reply) {
  const value = normalizeSpeechText(reply);
  if (!value || !PROMISE.test(value) || ASKS_HIM.test(value)) return false;
  return !replyAnswersQuestion(reply);
}
export function henryPromiseRetry() {
  return "[Sistema] Você disse que ia buscar/mostrar, mas não buscou. Busque AGORA com a ferramenta certa e responda com o resultado, numa frase curta — sem prometer de novo e sem perguntar se ele quer.";
}

// --- Rota direta (Treino 3, 2026-10-25) -------------------------------------------------------------------------------
// Pergunta clara cuja ferramenta é uma só: o servidor roda a ferramenta ANTES do modelo (o modelo só fala o resultado) —
// "como tá a meta do dia pra equipe?" ficou 3 treinos seguidos sem ferramenta ("Ainda não tenho o número…"). Também poupa
// uma rodada do modelo (~1 s). Na dúvida (nome de corretor, dois assuntos, lista, período que a ferramenta não tem) → null
// e o modelo decide como sempre. Período sem estar na fala = o último período falado sobre o MESMO assunto hoje ("ranking
// dessa semana" … "me fala do ranking primeiro" = a semana); sem nenhum, hoje.
// speak = a frase da ferramenta já é a resposta (o modelo não precisa reescrever).
const NAME_OK = new Set(["henry", "henri", "henrique", "enri", "crm", "meta", "metas", "diaria", "whatsapp", "alexa", "spotify", "marketplace", "instagram", "facebook", "ok", "pix"]);
// Nome próprio no meio da fala ("quantos clientes novos a Carol recebeu?") = pergunta de um corretor: fica com o modelo.
export function mentionsProperName(text) {
  const tokens = String(text || "").split(/\s+/).filter(Boolean);
  return tokens.some((token, index) => {
    const word = token.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    if (!word || index === 0 || /[.!?…]["”')]*$/.test(tokens[index - 1])) return false;
    return /^\p{Lu}\p{Ll}+/u.test(word) && !NAME_OK.has(normalizeSpeechText(word));
  });
}
const RANKING = /\b(ranking|quem (?:ta|esta) (?:na frente|liderando|ganhando|em primeiro))\b/;
const FUNIL = /\bfunil\b/;
const DIAGNOSIS = /\b(?:onde (?:(?:e que )?(?:a gente|nos|nois|que|eu|o time|a equipe) )?(?:(?:ta|esta|tamo|estamos|to|estou) )?(?:errando|perdendo|falhando|travando|pecando|deixando a desejar)|(?:qual|onde) (?:ta |esta |e |fica )?o gargalo|gargalo|onde (?:ta|esta|e) o problema|o que (?:ta|esta) (?:travando|emperrando|dando errado))\b/;
const META = /\bmeta\b/;
const META_TEAM = /\b(?:equipe|time|pessoal|galera|todo mundo|geral)\b/;
const META_ONLY = /^(?:(?:e|e ai|me fala|fala|como (?:e que )?(?:ta|esta|anda|vai)) )*(?:a )?meta(?: diaria)?(?: do dia| de hoje| hoje)?$/;
const META_OTHER = /\b(?:falta|faltam|faltando|quem|quais|bateu|bateram|bater|cada|corretor|corretora|prospec\w*)\b/;
const NEW_CLIENTS = /\b(?:clientes? novos?|novos? clientes?|leads?|cadastros? novos?|novos? cadastros?)\b/;
const COUNT_ASK = /\b(?:quant\w*|tem|teve|entr\w*|cai\w*|cheg\w*|aparec\w*|veio|vieram)\b/;
const LIST_ASK = /\b(?:quais|quem|nomes?|lista|de onde|origem|origens)\b/;
const MOVEMENT = /\bmovimento\b/;
const CATALOG_PERIODS = new Set(["hoje", "ontem", "esta_semana", "semana_passada", "este_mes", "mes_passado"]);
const MUSIC_NOT_PLAY = /\b(?:volume|alto|baixo|pausa|pausar|proxima|anterior|alexa|echo|computador|celular|caixa)\b/;
const VAGUE_MUSIC = /^(?:uma|um|alguma|algo|qualquer|qualquer uma|qualquer coisa|alguma coisa|uma ai|um som|musica|uma musica|outra|outra musica)$/;
// "uma música mais tranquila" → busca "música tranquila" (clima, não nome de faixa).
// Treino 6 (2026-10-25: "põe uma coisa mais de boa aí" não casava): "de boa", "pra relaxar", "pra animar"… também; a busca usa
// a palavra de MUSIC_MOOD_SEARCH quando a fala é gíria.
const MUSIC_MOOD = /^(?:mais )?(?:tranquil\w*|calm\w*|relax\w*|suave|leve|animad\w*|agitad\w*|alegre|romantic\w*|lent\w*|para cima|pra cima|de boa|de boas|tranks|sossegad\w*|gostos\w*|(?:pra|para) (?:relaxar|descansar|animar|agitar|dancar|curtir|trabalhar|focar|concentrar)|de fundo)$/;
const MUSIC_MOOD_SEARCH = [[/^de boas?$|^tranks$|^sossegad/, "tranquila"], [/^(?:pra|para) (?:relaxar|descansar)$/, "relaxante"], [/^(?:pra|para) (?:animar|agitar|dancar|curtir)$/, "animada"], [/^(?:pra|para) (?:trabalhar|focar|concentrar)$|^de fundo$/, "para trabalhar"], [/^gostos/, "boa"]];
const moodSearch = (mood) => MUSIC_MOOD_SEARCH.find(([pattern]) => pattern.test(mood))?.[1] || mood;
// Atendimentos feitos no período pela equipe (Treino 4: "quantos atendimentos a galera já fez hoje?" → "294 clientes em
// atendimento… Quer que eu veja?"): med_atendimentos do catálogo = "atendimento" do Desempenho (metrics.service, MEDIDAS),
// a mesma métrica do funil do Henry. "Em/sem/aguardando atendimento" é etapa ou fila — fica com o modelo.
const ATTEND_COUNT = /\b(?:quant[oa]s? atendimentos?|atendimentos? (?:que )?(?:a (?:galera|equipe|turma|gente)|o (?:time|pessoal)|nos|o povo) (?:ja )?(?:fez|fizeram|fizemos|tem|teve|deu|deram))\b/;
const ATTEND_NOT = /\b(?:em|sem|aguardando) atendimento\b/;
// Nomes dos clientes novos (Treino 4: "me passa o nome deles" → "estão na tela de Clientes").
const NAMES_ASK = /\b(?:quais|quem|nomes?)\b/;
const NAMES_OF_THEM = /\b(?:(?:o|os) nomes? (?:deles|delas|dess[ae]s?|desses clientes)|quem (?:sao|foram|e) (?:eles|elas)|quais (?:sao|foram) (?:eles|elas)|como (?:eles|elas) se chamam)\b/;
const NEW_CLIENTS_SAID = /\b(?:clientes? nov[oa]s?|nov[oa]s? clientes?|entr(?:ou|aram) (?:\w+ )?clientes?)\b/;
const ORIGIN_ASK = /\b(?:de onde|origem|origens)\b/;
// Volume e aparelho (Treino 4: "Dá uma baixada no som" → 2 rodadas do modelo e "Se quiser, é só falar de novo…").
// Fato do CRM (conferido no código em 2026-10-25): não existe meta de VENDAS configurada — a única meta é a Meta Diária
// (ações de prospecção + pendentes por corretor). O "meta do mês" do pré-cálculo (crm-metrics team-goal) é essa Meta Diária.
// Treino 6 (2026-10-25: funil do mês "20 aprovados" e, depois, a etapa "9 aprovados esperando" → "eu tinha errado o
// número"): são duas métricas certas e diferentes — o funil do período conta quem PASSOU pela etapa no período; a etapa
// conta quem ESTÁ nela agora. Mesma frase na dica (henryTurnHint), nos números do funil (buildHenryFunnelReport) e na persona.
export const HENRY_STAGE_NOW_NOTE = "os clientes na etapa AGORA já vieram; o funil de um período conta quem PASSOU pela etapa no período (ex.: aprovados no mês) e a etapa conta quem CONTINUA nela hoje — são números diferentes e os dois estão certos";
export const HENRY_NO_SALES_GOAL = "não existe meta de vendas cadastrada no CRM (a única meta é a Meta Diária, de ações de prospecção e pendentes)";
// Treino 5 (2026-10-25): "quanto a equipe precisa fechar por dia pra bater a meta?" → "Não tenho esse número fixo aqui…".
// O TAMANHO da Meta Diária de hoje (ações previstas da equipe, feitas e faltando) — mesma fonte da tela.
const META_TARGET = /\b(?:precis\w* (?:fazer|fechar|bater|cumprir|completar)|tem que (?:fazer|fechar|bater|cumprir)|(?:qual|quanto) (?:e |eh )?(?:o tamanho d)?a meta|tamanho da meta|meta (?:e|eh|ta|esta) (?:de|em) quant\w*|quant\w* (?:\w+ ){0,4}(?:pra|para) (?:bater|fechar|completar|cumprir) a meta|quant\w* falta\w*(?: \w+){0,3} (?:pra|para|da) (?:bater |fechar |completar )?a meta)\b/;
// "quanto falta pra fechar essas vendas" (Treino 5): não existe meta de vendas no CRM (a única meta é a Meta Diária de
// ações) — o funil do período (aprovados → vendas) responde, com a frase de que não há meta de vendas.
const SALES_WORD = /\bvendas?\b/;
const SALES_GAP = /\b(?:quant\w* falta\w*|falta\w* quant\w*|meta de vendas?|(?:pra|para) bater a meta)\b/;
const SALES_TOPIC = /\b(?:vendas?|funil|aprovad\w*)\b/;
// "e os vinte esperando? isso não pode ficar parado" (Treino 5, 20 aprovados) → a lista de quem está esperando na etapa.
const STAGE_WAIT = /\b(?:esperando|aguardando|parad[oa]s?|travad[oa]s?|empacad[oa]s?)\b/;
function stageOf(value) {
  if (/\baprovad[oa]s?\b/.test(value)) return "aprovados";
  if (/\b(?:aprovacao|analise)\b/.test(value)) return "aprovacao";
  if (/\bdocument\w*\b/.test(value)) return "documentacao";
  if (/\bsimulac\w*\b/.test(value)) return "simulacao";
  return "";
}
// Etapa citada pela ÚLTIMA resposta dele junto do número que o dono repetiu ("20 aprovados" … "e os vinte esperando?").
function stageFromLastAnswer(value, turns) {
  const numbers = numbersOf(value).split(" ").filter(Boolean);
  if (!numbers.length) return "";
  const last = [...(Array.isArray(turns) ? turns : [])].reverse().find((turn) => turn?.role === "assistant" && turn.text)?.text || "";
  const said = normalizeSpeechText(last);
  for (const number of numbers) {
    const near = new RegExp(`\\b${number}\\b(?: \\w+){0,3}`).exec(said);
    const stage = near ? stageOf(near[0]) : "";
    if (stage) return stage;
  }
  return "";
}
// Treino 5 (2026-10-25: "Pode baixar um pouco a música, Henry?" → 2 rodadas do modelo): o infinitivo ("baixar", "abaixar",
// "diminuir", "aumentar", "subir") e "mais baixo/alto" também valem.
const VOLUME_DOWN = /\b(?:abaixa|abaixe|abaixar|baixa|baixe|baixar|diminui|diminua|diminuir|reduz|reduza|reduzir|baixada|abaixada|diminuida|mais baix[oa])\b/;
const VOLUME_UP = /\b(?:aumenta|aumente|aumentar|sobe|suba|subir|aumentada|levanta|levantar|mais alt[oa])\b/;
const VOLUME_WORD = /\b(?:som|volume|musica|sonzinho)\b/;
const VOLUME_TO = /\bvolume (?:em|pra|para|no|a) (\d{1,3})\b/;
const DEVICE_KINDS_DIRECT = new Set(["alexa", "computador", "celular"]);
// Treino 6 (2026-10-25): "dá uma olhada no WhatsApp pra mim" → "quer saber as conversas aguardando ou de um cliente?" — o
// pedido genérico de olhar o WhatsApp/Chat é o resumo das conversas aguardando resposta (o mesmo do Início).
const WHATSAPP_LOOK = /\b(?:(?:da|de|dar|faz|faca) (?:uma )?(?:olhada|olhadinha|espiada|conferida|checada|passada) n[oa] (?:whatsapp|zap|chat)|(?:olha|olhe|confere|confira|checa|cheque|ve|veja) (?:o |no |a |na )?(?:whatsapp|zap|chat)|como (?:ta|esta|anda) (?:o )?(?:whatsapp|zap|chat))\b/;
// Pedido composto com verbo de tocar no começo que NÃO virou pedido de música reconhecido ("põe <algo> e depois me diz…"):
// o modelo cuida das duas partes — nunca a rota direta só da parte do CRM (Treino 6).
const MUSIC_HEAD_VERB = /^(?:\w+ ){0,3}?(?:toca|toque|tocar|poe|ponha|bota|bote|coloca|coloque|solta|solte)\b/;

function lastTopicPeriod(turns, topic, today) {
  for (const turn of [...(Array.isArray(turns) ? turns : [])].reverse()) {
    if (turn?.role !== "user" || !turn.text || !topic.test(plain(turn.text))) continue;
    const period = henryPeriodFromText(turn.text, today);
    if (period) return period;
  }
  return null;
}
const periodFields = (period) => (period?.periodo === "intervalo" ? { periodo: "intervalo", inicio: period.inicio, fim: period.fim } : { periodo: period.periodo });

// --- Comparação entre corretores (dono, 2026-10-25) ---------------------------------------------------------------------
// "quantas simulações o Eduardo realizou nos últimos 30 dias?" foi respondida; "qual corretor mais realizou simulações?" e
// "olha as simulações dos corretores um por um e me diz quem mais realizou" não ("não consegui"). Quem mais/menos + uma
// métrica do Desempenho por corretor → comparar_corretores. Métrica e período que faltam na fala vêm da conversa de hoje
// ("e quem mais fez?" depois de falar das simulações dos últimos 30 dias). "Quem mais está aí?" (sem métrica nem verbo de
// produção) não é comparação.
const COMPARE_ASK = /\b(?:quem|qual (?:foi )?(?:o |a )?(?:corretor|corretora|deles|delas|dos corretores)|que corretora?)\b(?: \w+){0,4}? (mais|menos)\b/;
const COMPARE_DONE = /\b(?:fez|fizeram|realizou|realizaram|vendeu|venderam|atendeu|atenderam|simulou|simularam|aprovou|aprovaram|pontuou|pontuaram|recebeu|receberam|prospectou|prospectaram|mandou|mandaram|enviou|enviaram|trouxe|trouxeram|fechou|fecharam)\b/;
const COMPARE_NOT = /\b(?:parad[oa]s?|aguard\w*|esperand\w*|atrasad\w*|esfriad\w*|frios?|conversa\w*|whatsapp|mensage\w*|online|imobiliaria|cheg\w*|aniversari\w*|meta)\b/;
const COMPARE_METRICS = [
  ["simulacoes", /\b(?:simulac\w*|simulou|simularam)\b/],
  ["enviados_aprovacao", /\b(?:aprovacao|analise)\b/],
  ["aprovados", /\b(?:aprovad[oa]s?|aprovou|aprovaram|aprovacoes)\b/],
  ["documentacao", /\bdocument\w*\b/],
  ["vendas", /\b(?:vendas?|vendeu|venderam|fechou|fecharam)\b/],
  ["pontos", /\b(?:pontos?|pontuou|pontuaram|pontuacao)\b/],
  ["atendimentos", /\b(?:atendimentos?|atendeu|atenderam)\b/],
  ["prospeccao", /\bprospec\w*\b/],
  ["novos_clientes", /\b(?:clientes? nov[oa]s?|nov[oa]s? clientes?|leads?|cadastros? nov[oa]s?|nov[oa]s? cadastros?|recebeu|receberam)\b/]
];
const COMPARE_RECENT_TURNS = 8;
function compareMetricOf(value) {
  return COMPARE_METRICS.find(([, pattern]) => pattern.test(value)) || null;
}
// Pergunta de comparação pela fala sozinha (também usada pelo Treino): quem mais/menos + métrica ou verbo de produção.
export function isBrokerComparisonQuestion(text) {
  const value = plain(text);
  return Boolean(value) && COMPARE_ASK.test(value) && !COMPARE_NOT.test(value) && Boolean(compareMetricOf(value) || COMPARE_DONE.test(value));
}
// → input do comparar_corretores ({ metrica, ordem, periodo… }) ou null (sem métrica na fala nem na conversa recente).
export function henryComparisonRequest(text, { turns = [], today = "" } = {}) {
  if (!isBrokerComparisonQuestion(text)) return null;
  const value = plain(text);
  const ordem = COMPARE_ASK.exec(value)[1];
  const said = henryPeriodFromText(text, today);
  let metric = compareMetricOf(value);
  let inherited = null;
  if (!metric) {
    const recent = (Array.isArray(turns) ? turns : []).filter((turn) => turn?.role === "user" && turn.text).slice(-COMPARE_RECENT_TURNS).reverse();
    for (const turn of recent) {
      const found = compareMetricOf(plain(turn.text));
      if (found) {
        metric = found;
        inherited = turn;
        break;
      }
    }
  }
  if (!metric) return null;
  const period = said || (inherited ? henryPeriodFromText(inherited.text, today) : null) || lastTopicPeriod(turns, metric[1], today) || { periodo: "este_mes" };
  return { metrica: metric[0], ordem, ...periodFields(period) };
}

// Volume do Spotify pedido na fala → input da ferramenta spotify (ou null).
// Treino 6 (2026-10-25: "Baixa um pouco aí, Henry, tá muito alto." → "Já abaixei o volume." sem ferramenta): sem a palavra
// som/volume vale o comando CURTO — só o verbo ("baixa/abaixa/aumenta/sobe"), "tá alto/baixo (demais)" e enfeites. Qualquer
// outra palavra ("baixa o relatório", "tá baixo o número de leads") = não é volume.
const LOUDNESS = /\b(?:ta|esta|tá|tao|muito|meio|bem|mt) (?:muito |meio |bem |um pouco |mt |tao )?(alt[oa]|baix[oa])(?: demais)?\b/;
const BARE_VOLUME_VERB = /\b(?:abaixa|abaixe|baixa|baixe|diminui|diminua|aumenta|aumente|sobe|suba)\b/;
const BARE_VOLUME_FILLER = new Set(["um", "pouco", "pouquinho", "tiquinho", "mais", "ai", "ae", "isso", "so", "pra", "mim", "ta", "esta", "muito", "meio", "bem", "demais", "pode", "da", "consegue", "por", "favor", "cara", "ei", "o", "e", "ja", "ele", "ela", "mt", "tao", "alto", "alta", "baixo", "baixa", "abaixa", "abaixe", "baixe", "diminui", "diminua", "aumenta", "aumente", "sobe", "suba", "ouvi", "ouvir", "to", "conseguindo", "mano", "chefe", "oi"]);
function bareVolumeRequest(value) {
  const loud = LOUDNESS.exec(value);
  if (!loud && !BARE_VOLUME_VERB.test(value)) return null;
  if (!value.split(" ").every((word) => BARE_VOLUME_FILLER.has(word))) return null;
  const rest = loud ? value.replace(loud[0], " ") : value;
  const down = VOLUME_DOWN.test(rest) || /^alt/.test(loud?.[1] || "");
  const up = VOLUME_UP.test(rest) || /^baix/.test(loud?.[1] || "");
  if (down && !up) return { acao: "volume", ajuste: "mais_baixo" };
  if (up && !down) return { acao: "volume", ajuste: "mais_alto" };
  return null;
}
export function henryVolumeRequest(text) {
  const value = plain(text);
  if (!value || isCrmQuestion(value)) return null;
  if (!VOLUME_WORD.test(value)) return bareVolumeRequest(value);
  const to = VOLUME_TO.exec(value);
  if (to) return { acao: "volume", volume: Math.min(100, Number(to[1])) };
  if (VOLUME_DOWN.test(value) && !VOLUME_UP.test(value)) return { acao: "volume", ajuste: "mais_baixo" };
  if (VOLUME_UP.test(value) && !VOLUME_DOWN.test(value)) return { acao: "volume", ajuste: "mais_alto" };
  return null;
}

function musicPlayRoute(text) {
  const busca = musicQueryFromText(text);
  const query = normalizeSpeechText(busca);
  if (!query || VAGUE_MUSIC.test(query) || MUSIC_NOT_PLAY.test(query)) return null;
  const mood = query.replace(/^(?:(?:uma|um|alguma) )?(?:coisa|coisinha|algo|som|sonzinho|musica|musiquinha)\s+/, "");
  if (MUSIC_MOOD.test(mood)) return { name: "spotify", input: { acao: "tocar", busca: `música ${moodSearch(mood.replace(/^mais\s+/, ""))}` }, topic: "musica" };
  return { name: "spotify", input: { acao: "tocar", busca }, topic: "musica" };
}

// turns = a conversa de HOJE inteira (memória do dia), não só a janela que vai ao modelo — o período herdado ("ranking dessa
// semana" … 20 trocas depois "me fala do ranking primeiro") estava fora da janela (Treino 4).
export function henryDirectRoute(text, { turns = [], today = "" } = {}) {
  const value = plain(text);
  if (!value || isHenryGreeting(text) || isPersonalQuestion(text) || isCasualRequest(text) || isHenryAgreement(text) || isPreviousReference(text) || isVagueClientReference(text)) return null;
  if (isTeamAlertRequest(text)) return null; // recado à equipe ("avisa a Bruna que a meta…") = enviar_alerta_corretor, pelo modelo
  const volume = henryVolumeRequest(text);
  if (volume) return { name: "spotify", input: volume, topic: "musica" };
  if (!isMusicRequest(text) && musicRequestRest(value) && MUSIC_HEAD_VERB.test(value)) return null;
  if (isMusicRequest(text)) {
    const deviceKind = spotifyDeviceRequestKind(text);
    const part = henryQuestionPart(text);
    if (deviceKind) return !part && DEVICE_KINDS_DIRECT.has(deviceKind) ? { name: "mudar_aparelho_spotify", input: { aparelho: deviceKind }, topic: "musica" } : null;
    const play = musicPlayRoute(text);
    if (!play) return null;
    if (!part) return play;
    // Música + pergunta ("bota uma música tranquila e depois me diz quantos clientes novos"): as duas ferramentas já, juntas.
    const rest = henryDirectRoute(part, { turns, today });
    return rest && rest.name !== "spotify" && rest.name !== "mudar_aparelho_spotify" ? { ...play, also: rest } : null;
  }
  if (mentionsProperName(text)) return null;
  if (WHATSAPP_LOOK.test(value)) return { name: "conversas_aguardando", input: {}, topic: "whatsapp", speak: true };
  const said = henryPeriodFromText(text, today);
  // Treino 5: falta de vendas (sem meta de vendas no CRM → funil do período, aprovados → vendas), tamanho da Meta Diária e
  // os clientes esperando numa etapa. Cada um é exclusivo: com eles, nada mais desta fala vira rota.
  if (SALES_WORD.test(value) && SALES_GAP.test(value)) {
    const period = said || lastTopicPeriod(turns, SALES_TOPIC, today) || { periodo: "este_mes" };
    return { name: "funil_periodo", input: periodFields(period), topic: "vendas_meta" };
  }
  if (META.test(value) && META_TARGET.test(value) && !/\bcada\b/.test(value)) {
    const periodo = said?.periodo === "ontem" ? "ontem" : "hoje";
    return { name: "consultar_crm", input: { assunto: "meta_equipe", periodo, detalhe: "tamanho" }, topic: "meta", speak: true };
  }
  if (STAGE_WAIT.test(value) && !/\b(?:conversa\w*|whatsapp|chat|mensage\w*|respost\w*)\b/.test(value)) {
    const etapa = stageOf(value) || stageFromLastAnswer(value, turns);
    if (etapa) return { name: "consultar_crm", input: { assunto: "etapa", etapa, formato: "lista" }, topic: "etapa", speak: "always" };
  }
  const comparison = henryComparisonRequest(text, { turns, today });
  if (comparison) return { name: "comparar_corretores", input: comparison, topic: "comparacao", speak: true };
  const routes = [];
  if (DIAGNOSIS.test(value)) {
    const period = said && !["hoje", "ontem"].includes(said.periodo) ? said : lastTopicPeriod(turns, FUNIL, today);
    const usable = period && !["hoje", "ontem"].includes(period.periodo) ? period : { periodo: "este_mes" };
    routes.push({ name: "funil_periodo", input: periodFields(usable), topic: "diagnostico" });
  } else if (FUNIL.test(value)) {
    const period = said || lastTopicPeriod(turns, FUNIL, today) || { periodo: "hoje" };
    routes.push(["hoje", "ontem"].includes(period.periodo) ? { name: "consultar_crm", input: { assunto: "funil", periodo: period.periodo }, topic: "funil" } : { name: "funil_periodo", input: periodFields(period), topic: "funil" });
  }
  if (RANKING.test(value)) {
    const period = said || lastTopicPeriod(turns, RANKING, today) || { periodo: "hoje" };
    routes.push(["hoje", "ontem"].includes(period.periodo) ? { name: "consultar_crm", input: { assunto: "ranking", periodo: period.periodo }, topic: "ranking", speak: true } : { name: "ranking_periodo", input: periodFields(period), topic: "ranking", speak: true });
  }
  if (META.test(value) && !META_OTHER.test(value) && (META_TEAM.test(value) || META_ONLY.test(stripGreetingHead(value)))) {
    const periodo = said ? said.periodo : "hoje";
    if (periodo === "hoje" || periodo === "ontem") routes.push({ name: "consultar_crm", input: { assunto: "meta_equipe", periodo }, topic: "meta", speak: true });
  }
  if (NEW_CLIENTS.test(value) && NAMES_ASK.test(value) && !ORIGIN_ASK.test(value)) {
    const periodo = said ? said.periodo : "hoje";
    if (CATALOG_PERIODS.has(periodo)) routes.push({ name: "consultar_crm", input: { assunto: "clientes_novos", formato: "lista", periodo }, topic: "clientes_novos", speak: "always" });
  } else if (NEW_CLIENTS.test(value) && COUNT_ASK.test(value) && !LIST_ASK.test(value)) {
    const periodo = said ? said.periodo : "hoje";
    if (CATALOG_PERIODS.has(periodo)) routes.push({ name: "consultar_crm", input: { assunto: "clientes_novos", periodo }, topic: "clientes_novos", speak: true });
  } else if (NAMES_OF_THEM.test(value)) {
    // "Me passa o nome deles" logo depois de ele ouvir quantos clientes novos entraram: os nomes desses clientes.
    const lastAssistant = [...(Array.isArray(turns) ? turns : [])].reverse().find((turn) => turn?.role === "assistant" && turn.text)?.text || "";
    if (NEW_CLIENTS_SAID.test(normalizeSpeechText(lastAssistant))) {
      const period = said || lastTopicPeriod(turns, NEW_CLIENTS, today) || { periodo: "hoje" };
      if (CATALOG_PERIODS.has(period.periodo)) routes.push({ name: "consultar_crm", input: { assunto: "clientes_novos", formato: "lista", periodo: period.periodo }, topic: "clientes_novos", speak: "always" });
    }
  }
  if (ATTEND_COUNT.test(value) && !ATTEND_NOT.test(value)) {
    const periodo = said ? said.periodo : "hoje";
    if (CATALOG_PERIODS.has(periodo)) routes.push({ name: "consultar_crm", input: { assunto: "med_atendimentos", periodo }, topic: "atendimentos", speak: true });
  }
  if (MOVEMENT.test(value) && (!said || said.periodo === "hoje")) routes.push({ name: "relatorio_do_dia", input: {}, topic: "movimento" });
  return routes.length === 1 ? routes[0] : null;
}

// --- Dica desta resposta ---------------------------------------------------------------------------------------------
// turns = conversa de hoje ({ role, text }) até ANTES desta fala; lastAssistant = a última resposta do Henry.
// direct = a rota direta desta fala (henryDirectRoute), quando houver: o resultado da ferramenta já está na conversa.
export function henryTurnHint({ text = "", lastAssistant = "", turns = [], direct = null } = {}) {
  const hints = [];
  if (isPersonalQuestion(text)) {
    return "ele perguntou de VOCÊ (o seu dia, como você está): é papo de amigo, não pergunta do CRM — responda sobre você numa frase curta e, se quiser, devolva a pergunta; nenhum número nem assunto do CRM";
  }
  if (isCasualRequest(text)) {
    return "ele pediu uma piada/descontração: conte UMA piada curta e leve (sem política, religião, palavrão nem zombaria de ninguém); nenhum número nem assunto do CRM, mesmo que ele cite clientes";
  }
  if (isHenryAgreement(text) && !/\?\s*$/.test(String(lastAssistant || "").trim())) {
    return "ele só concordou/comentou o que ouviu: responda curto, concordando, em poucas palavras; nenhum número novo, nenhuma consulta e nenhuma oferta";
  }
  if (isVagueClientReference(text)) {
    return "ele perguntou de um cliente sem dizer o nome (\"aquele cliente\"): pergunte o nome numa frase curta (ex.: \"Qual cliente? Me fala o nome, mesmo que seja só o primeiro.\"); nenhuma ferramenta, nenhum número e nenhum outro assunto";
  }
  if (isPreviousReference(text)) {
    const lastUser = [...turns].reverse().find((turn) => turn?.role === "user" && turn.text && !isPreviousReference(turn.text));
    return `ele se refere ao ÚLTIMO assunto da conversa, sem dizer qual — a sua última resposta foi "${quote(lastAssistant)}"${lastUser ? ` (sobre a fala dele "${quote(lastUser.text)}")` : ""}: retome ESSE assunto; se ele depende de um dado dele (nome, qual cliente), diga em poucas palavras que precisa desse dado; nunca troque de assunto nem traga número de outro assunto`;
  }
  if (direct) {
    const what = direct.topic === "diagnostico"
      ? "ele quer saber onde a equipe está errando: o funil do período já veio da ferramenta — diga em 1 ou 2 frases curtas a etapa com a maior perda (o gargalo), com os números dela"
      : direct.topic === "vendas_meta"
        ? `ele quer saber quanto falta de vendas: ${HENRY_NO_SALES_GOAL} — diga isso numa frase curta e, na mesma resposta, dê do funil do período os aprovados e as vendas (ex.: "Não tem meta de vendas cadastrada no CRM; no mês são 20 aprovados e 3 vendas."); nada de oferecer funil, tela ou outra consulta`
        : direct.topic === "etapa"
        ? `${HENRY_STAGE_NOW_NOTE} — se a conversa já trouxe outro número dessa etapa (do funil de um período), diga os dois, sem se corrigir (ex.: "No mês 20 foram aprovados; hoje 9 continuam na etapa aprovado, esperando…"), e os mais antigos; nunca diga que errou o número`
        : direct.also
        ? `os resultados de ${direct.name} e ${direct.also.name} já vieram: confirme a música em poucas palavras e responda a outra parte com o número`
        : `o resultado da ferramenta ${direct.name} já veio: responda direto com ele, numa frase curta`;
    hints.push(`${what}; não diga que vai buscar nem ofereça buscar${isHenryComplaint(text) ? "; ele reclamou da resposta anterior: no máximo 2 ou 3 palavras de desculpa antes" : ""}`);
    return hints.join("; ");
  }
  if (isHenryComplaint(text) && lastAssistant) {
    const lastUser = [...turns].reverse().find((turn) => turn?.role === "user" && turn.text && !isHenryComplaint(turn.text));
    hints.push(`ele disse que a sua última resposta ("${quote(lastAssistant)}") NÃO era o que ele perguntou: não repita essa resposta nem o mesmo número; peça desculpa em poucas palavras e pergunte o que ele queria saber${lastUser ? ` — ou, se a pergunta dele ("${quote(lastUser.text)}") tiver outra leitura óbvia, responda essa outra leitura com a ferramenta` : ""}`);
    return hints.join("; ");
  }
  const resume = henryResumeTopic(text, turns);
  if (resume) {
    hints.push(`ele quer VOLTAR ao assunto "${resume.topic}"${resume.previous ? ` (a pergunta dele sobre isso foi "${resume.previous}")` : ""}: responda de novo sobre ${resume.topic}, com o mesmo período que ele tinha pedido, usando a ferramenta; não fale do assunto mais recente e não abra tela`);
  }
  if (isMusicRequest(text)) {
    const part = henryQuestionPart(text);
    if (part) hints.push(`pedido com DUAS partes — a música E "${quote(part)}": chame spotify E a ferramenta da outra parte; confirme a música em poucas palavras e responda a outra parte com o número`);
  } else if (startsWithGreeting(text) && !isHenryGreeting(text) && henryQuestionPart(text)) {
    hints.push(`ele te cumprimentou E fez uma pergunta ("${quote(stripGreetingHead(text))}"): no máximo um cumprimento de 2 ou 3 palavras e RESPONDA a pergunta com a ferramenta ("movimento"/"como tá o dia" = relatorio_do_dia); não pergunte como ele está`);
  }
  return hints.join("; ");
}

// --- Rótulo no começo da fala (Treino 5: "Feito: são 3 vendas…"; antes "Suspense: são 116…") ----------------------------
// Uma palavra e dois-pontos no começo ("Feito:", "Resumo:", "Pronto:") sai da fala; hora ("10:30") não é rótulo. A persona
// já proíbe; esta é a 2ª trava (mesma forma do achado "rotulo_inicio" do Treino, LABEL_PREFIX em henry-training-core.mjs).
const SPEECH_LABEL = /^\s*\p{L}+\s*:\s+(?=\S)/u;
export function stripSpeechLabel(text) {
  const value = String(text || "");
  if (!SPEECH_LABEL.test(value)) return value;
  const rest = value.replace(SPEECH_LABEL, "").trim();
  return rest.split(/\s+/).length >= 2 ? rest.charAt(0).toLocaleUpperCase("pt-BR") + rest.slice(1) : value;
}

// --- Ação dita como feita sem a ferramenta (Treino 6: "Baixa um pouco aí, tá muito alto." → "Já abaixei o volume." sem
// nenhuma ferramenta) -------------------------------------------------------------------------------------------------------
// A resposta afirma uma ação JÁ FEITA (abaixei/aumentei o som, toquei, passei pra Alexa, abri a tela, enviei o recado) e a
// ferramenta daquela ação não rodou neste turno → { kind, tools, retry, fail } (o servidor faz UMA rodada que obriga a
// ferramenta; continuou sem ela → a frase de que não fez). Promessa ("vou tocar") e negação ("não abaixei") não contam.
// Mesma leitura no Treino (achado "acao_sem_ferramenta", lib/henry-training-core.mjs).
const CLAIMED_ACTIONS = [
  { kind: "volume", tools: ["spotify"], pattern: /\b(?:abaixei|baixei|aumentei|(?:subi|diminui|reduzi) (?:um pouco |um pouquinho |mais )?(?:o )?(?:volume|som))\b/, what: "mexeu no volume", fail: "Não consegui mexer no volume agora." },
  { kind: "musica", tools: ["spotify"], pattern: /\b(?:toquei|soltei (?:a |o |um |uma )?(?:musica|som|playlist)|(?:coloquei|botei|pus) (?:uma |um |o |a )?(?:musica|som|sonzinho|playlist|rock|pagode|sertanejo|samba|funk|mpb|forro))\b/, what: "tocou a música", fail: "Não consegui tocar agora." },
  { kind: "aparelho", tools: ["mudar_aparelho_spotify"], pattern: /\b(?:passei|transferi|joguei|mandei|levei) (?:a musica |o som |ela |isso |a playlist )?(?:pra|para|pro|para o|para a) (?:a |o )?(?:alexa|echo|computador|celular|caixa)\b|\b(?:a musica|o som) (?:ja )?(?:foi|passou) (?:pra|para|pro) (?:a |o )?(?:alexa|echo|computador|celular|caixa)\b/, what: "trocou o aparelho da música", fail: "Não consegui trocar o aparelho agora." },
  { kind: "tela", tools: ["abrir_tela", "abrir_cliente"], pattern: /\b(?:abri|deixei aberta|deixei aberto) (?:a |o )?(?:tela|ficha|pagina|cadastro|card)\b/, what: "abriu a tela", fail: "Não consegui abrir a tela agora." },
  { kind: "envio", tools: ["enviar_alerta_corretor", "avisar_corretor_aniversario"], pattern: /\b(?:enviei|mandei) (?:o |um |a |uma )?(?:recado|mensagem|aviso|alerta)\b|\benviei (?:pra|para)\b/, what: "enviou o recado", fail: "Não enviei nada ainda." }
];
const CLAIM_NEGATED = /\b(?:nao|nem|nunca) (?:\w+ )?$/;
export function henryClaimedActionWithoutTool(reply, toolNames = []) {
  const value = normalizeSpeechText(reply);
  if (!value) return null;
  const used = new Set((Array.isArray(toolNames) ? toolNames : []).map((name) => String(name || "")));
  for (const action of CLAIMED_ACTIONS) {
    const match = action.pattern.exec(value);
    if (!match || CLAIM_NEGATED.test(value.slice(0, match.index))) continue;
    if (action.tools.some((tool) => used.has(tool))) continue;
    return {
      kind: action.kind,
      tools: action.tools,
      fail: action.fail,
      retry: `[Sistema] Você disse que já ${action.what}, mas nenhuma ferramenta fez isso. Chame AGORA a ferramenta (${action.tools.join(" ou ")}) para fazer de verdade e confirme em poucas palavras; se não der para fazer, diga que não conseguiu — nunca diga que fez sem a ferramenta.`
    };
  }
  return null;
}

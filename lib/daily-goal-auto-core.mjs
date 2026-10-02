// Regras puras da automação da Meta Diária (sem banco, sem "server-only") —
// testáveis isoladamente, mesmo espírito de daily-goal-progress.mjs e
// whatsapp-individual-routing.mjs deste projeto.

export const HARD_DAILY_CAP = 100; // pedido do dono, 2026-09-30: teto absoluto (mesmo limite da carteira ativa), nunca acima disto.

// Teto do dia = TODAS as atividades pendentes de hoje do corretor (1ª+2ª+3ª
// tentativa juntas), até o máximo de HARD_DAILY_CAP — pedido do dono,
// 2026-09-30 ("o teto são todas as atividades diárias, o máximo é 100").
// Sem rampa de aquecimento progressiva (removida no mesmo pedido) e sem
// relação com a cota de "novos clientes/dia" da Meta Diária. Um
// daily_cap_override manual (se configurado) também entra na disputa —
// sempre o MENOR dos candidatos.
export function computeDailyAutoCap({ totalActivities, dailyCapOverride = null } = {}) {
  const candidates = [Number(totalActivities) || 0, HARD_DAILY_CAP];
  if (Number.isInteger(dailyCapOverride) && dailyCapOverride > 0) candidates.push(dailyCapOverride);
  return Math.max(0, Math.min(...candidates));
}

// Embaralha (Fisher-Yates, sem mutar o array original) — usado pra misturar
// a ordem em que as atividades do dia (1ª/2ª/3ª tentativa) são processadas,
// em vez de FIFO por rodada: pedido do dono, 2026-09-30, pra variar o
// padrão de mensagens e ajudar a evitar banimento do número. Determinístico
// quando `random` é fornecido (facilita teste).
export function shuffleArray(list, random = Math.random) {
  const result = (list || []).slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Espalha `count` horários dentro da janela [windowStart, windowEnd] (minutos
// desde 00:00) — nunca antes de `nowMinutes` (redistribui o restante se a
// automação for ativada tarde). Determinístico quando `random` é fornecido
// (facilita teste).
//
// Dois modos pra decidir o intervalo entre um disparo e o próximo:
//  - padrão (oscillateEnabled=false): aleatório uniforme entre minGapMinutes/
//    maxGapMinutes, fixos, sem relação com quantas mensagens faltam enviar
//    (pode sobrar/faltar tempo de janela dependendo do volume do dia).
//  - oscilação (oscillateEnabled=true, pedido do dono 2026-09-30): a média do
//    intervalo é calculada na hora — tempo restante da janela ÷ `count` (ex.:
//    750 min ÷ 90 mensagens ≈ 8,3 min) — pra caber TODAS as mensagens do dia
//    dentro da janela. Cada intervalo real varia ± oscillatePercent% dessa
//    média (ex.: 50% → entre ~4,2 e ~12,5 min); minGap/maxGap são ignorados
//    nesse modo.
export function spreadScheduleMinutes({
  count,
  windowStartMinutes,
  windowEndMinutes,
  minGapMinutes,
  maxGapMinutes,
  oscillateEnabled = false,
  oscillatePercent = 0,
  maxAverageGapMinutes = null,
  nowMinutes = windowStartMinutes,
  random = Math.random
}) {
  const result = [];
  // O horário em que a fila é (re)calculada NUNCA é horário de envio por si
  // só: o primeiro disparo é sempre >= início da janela (ex.: reagendar às
  // 02:10 com janela 07:00–14:00 começa às 07:00).
  let cursor = Math.max(windowStartMinutes, nowMinutes);
  if (count <= 0 || cursor > windowEndMinutes) return result;
  // Intervalo médio efetivo (2026-10-02) = MENOR entre o necessário para
  // caber tudo na janela e o "Intervalo médio máximo" configurado: com pouco
  // volume a fila termina cedo, a janela é só o limite permitido.
  const fitGap = (windowEndMinutes - cursor) / count;
  const cap = Number(maxAverageGapMinutes);
  const averageGap = oscillateEnabled && count > 0
    ? Math.max(1, Number.isFinite(cap) && cap > 0 ? Math.min(fitGap, cap) : fitGap)
    : null;
  if (averageGap !== null) {
    // Oscilação (2026-10-02): sorteia cada intervalo ± oscillatePercent% da
    // média e, se a soma passar do fim da janela, encolhe todos na mesma
    // proporção — a oscilação nunca empurra mensagem para fora da janela e
    // todas as `count` mensagens cabem nela.
    const spread = averageGap * (Math.max(0, Math.min(100, oscillatePercent)) / 100);
    const low = Math.max(1, averageGap - spread);
    const high = averageGap + spread;
    const gaps = [];
    for (let i = 0; i < count - 1; i += 1) gaps.push(low + random() * (high - low));
    const total = gaps.reduce((sum, gap) => sum + gap, 0);
    const available = windowEndMinutes - cursor;
    const scale = total > available && total > 0 ? available / total : 1;
    result.push(cursor);
    for (const gap of gaps) {
      cursor += gap * scale;
      result.push(Math.min(cursor, windowEndMinutes));
    }
    return result;
  }
  for (let i = 0; i < count; i += 1) {
    if (cursor > windowEndMinutes) break;
    result.push(cursor);
    let gap;
    if (averageGap !== null) {
      const spread = averageGap * (Math.max(0, Math.min(100, oscillatePercent)) / 100);
      const low = Math.max(1, averageGap - spread);
      const high = averageGap + spread;
      gap = low + random() * (high - low);
    } else {
      gap = minGapMinutes + Math.floor(random() * Math.max(1, maxGapMinutes - minGapMinutes + 1));
    }
    cursor += gap;
  }
  return result;
}

// Data (AAAA-MM-DD) e minuto do dia em America/Sao_Paulo de um instante.
export function saoPauloDateMinutes(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short"
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday: weekdayMap[parts.weekday] ?? 1 };
}

// Item pendente da fila com horário que a configuração ATUAL não permite:
// agendado para outro dia (sobra de dia anterior) ou fora da janela (ex.:
// calculado com a janela antiga). Esses itens nunca podem ser enviados —
// a fila do corretor é recalculada.
export function isScheduleOutsideCurrentConfig(scheduledFor, { now = new Date(), windowStartMinutes, windowEndMinutes }) {
  const item = saoPauloDateMinutes(scheduledFor);
  const today = saoPauloDateMinutes(now);
  if (!item || !today) return true;
  if (item.date !== today.date) return true;
  return !isWithinWindow(item.minutes, windowStartMinutes, windowEndMinutes);
}

// TRAVA FINAL do envio (2026-10-02): checada no servidor imediatamente antes
// de cada disparo, com a configuração lida NAQUELE momento — nenhum horário
// gravado no banco, botão ou corrida com o salvamento da configuração passa
// por aqui fora da janela. Devolve null (pode enviar) ou o motivo.
export function sendBlockReason({ scheduledFor, now = new Date(), settings }) {
  if (!settings || !settings.enabled) return "automacao_desligada";
  if (settings.paused) return "automacao_pausada";
  const current = saoPauloDateMinutes(now);
  if (!current) return "relogio_invalido";
  const windowStartMinutes = settings.window_start_minutes;
  const windowEndMinutes = settings.window_end_minutes;
  if (!isWithinWindow(current.minutes, windowStartMinutes, windowEndMinutes)) return "fora_da_janela";
  if (settings.business_days_only && !isBusinessDay(current.weekday)) return "fim_de_semana";
  if (isScheduleOutsideCurrentConfig(scheduledFor, { now, windowStartMinutes, windowEndMinutes })) return "agendado_fora_da_configuracao";
  return null;
}

export function isWithinWindow(nowMinutes, windowStartMinutes, windowEndMinutes) {
  return nowMinutes >= windowStartMinutes && nowMinutes <= windowEndMinutes;
}

// weekday: 0=domingo ... 6=sábado (mesma convenção de Date#getDay()).
export function isBusinessDay(weekday) {
  return weekday >= 1 && weekday <= 5;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

const OPT_OUT_KEYWORDS = new Set(["parar", "sair", "cancelar", "descadastrar", "descadastro", "remover", "nao quero mais", "pare"]);

// Só considera opt-out quando a mensagem INTEIRA (normalizada) é uma palavra
// de saída — evita falso positivo em frases longas que só mencionam a
// palavra ("vou cancelar minha viagem amanhã" não é opt-out).
export function isOptOutMessage(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return OPT_OUT_KEYWORDS.has(normalized);
}

// Escolha do modelo (variação) com ALEATORIEDADE + ANTI-REPETIÇÃO (pedido do
// dono, 2026-10-02 — substitui a rotação fixa 1A→1B→1C→1D de 2026-09-30).
// Fonte ÚNICA para Meta Diária e fila extra ("Disparar"), chamada no
// servidor no momento do envio (lib/daily-goal-auto.js, processClaimedItem).
//
// `history` = índices dos modelos REALMENTE enviados por ESTE WhatsApp
// (corretor) NESTA tentativa, do mais antigo para o mais recente. Ciclos:
// dentro de um ciclo nenhum modelo se repete; o próximo é sorteado entre os
// que ainda não saíram no ciclo (então cada ciclo é uma ordem embaralhada
// nova, nunca uma sequência fixa); com o ciclo completo começa outro, cujo
// primeiro modelo nunca é o último enviado. Índice fora do banco atual
// (modelo apagado/editado) é ignorado; repetição já existente no histórico
// (ex.: antes desta regra) apenas fecha o ciclo ali.
export function cycleStateFromHistory(history, count) {
  let used = new Set();
  let last = null;
  for (const value of Array.isArray(history) ? history : []) {
    if (!Number.isInteger(value) || value < 0 || value >= count) continue;
    if (used.has(value) || used.size >= count) used = new Set();
    used.add(value);
    last = value;
  }
  return { used, last };
}

// Item da fila que conta no histórico da anti-repetição: mensagem que SAIU
// (enviada, ou com id do WhatsApp, ou envio incerto mandado para revisão —
// conservador: pode ter saído). Cancelado, pulado, pendente ou erro antes do
// envio nunca contam.
export function wasVariantActuallySent(row) {
  if (!row || !Number.isInteger(row.variant_index)) return false;
  return row.status === "sent" || Boolean(row.wa_message_id) || row.skip_reason === "enviando_sem_confirmacao";
}

export function pickAntiRepeatVariant({ count, history = [], random = Math.random }) {
  const total = Number.isInteger(count) ? count : 0;
  if (total <= 0) return -1;
  if (total === 1) return 0;
  const { used, last } = cycleStateFromHistory(history, total);
  const all = Array.from({ length: total }, (_, index) => index);
  let candidates = all.filter((index) => !used.has(index));
  // Ciclo completo: novo ciclo, todos voltam — menos o último enviado.
  if (!candidates.length) candidates = all.filter((index) => index !== last);
  const pick = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
  return candidates[pick];
}

// Erro de ENVIO (não de geração/validação) classificado em duas categorias
// (pedido do dono, 2026-09-30):
//  - 'contact': atribuível ao destinatário (número inválido, JID inexistente,
//    sem WhatsApp...) — só quando EXPLICITAMENTE identificável na mensagem de
//    erro. Consome o contador de retry do CLIENTE (3 falhas -> "Erro").
//  - 'infra': tudo o mais (sessão/Baileys/microsserviço/rede indisponível,
//    timeout, 5xx, ou qualquer mensagem ambígua) — NUNCA penaliza o cliente.
// Padrão seguro: na dúvida, classifica como 'infra' (o dono já pediu
// repetidas vezes pra nunca transformar instabilidade em erro de cliente).
const CONTACT_ERROR_PATTERNS = [
  /destinat[aá]rio inv[aá]lido/i,
  /telefone inv[aá]lido/i,
  /n[uú]mero inv[aá]lido/i,
  /not[- ]?registered/i,
  /no sessions? found/i,
  /n[aã]o (est[aá]|esta) no whatsapp/i,
  /item-not-found/i,
  /jid.*(inv[aá]lido|invalid|not found)/i
];
const INFRA_ERROR_PATTERNS = [
  /n[aã]o est[aá] conectad/i,
  /desconectad/i,
  /timeout/i,
  /timed out/i,
  /econnrefused/i,
  /enotfound/i,
  /fetch failed/i,
  /network/i,
  /socket hang up/i,
  /connection (closed|terminated)/i,
  /stream errored/i,
  /restart required/i,
  /logged.?out/i,
  /rate.?limit/i,
  /too many requests/i,
  /servi[cç]o de whatsapp individual/i,
  /n[aã]o est[aá] configurado/i
];

export function classifySendError(error) {
  const message = String(error?.message || error || "");
  const status = Number(error?.status) || null;
  const code = String(error?.code || "");
  if (code === "NOT_CONNECTED" || code === "SERVICE_NOT_CONFIGURED") return "infra";
  if (status === 409) return "infra";
  if (CONTACT_ERROR_PATTERNS.some((re) => re.test(message))) return "contact";
  if (INFRA_ERROR_PATTERNS.some((re) => re.test(message))) return "infra";
  if (status && status >= 500) return "infra";
  return "infra";
}

// {associado_associada} some templates trazem a frase "sou {associado_associada}
// do corretor Matheus Machado" (variante 1) ou ", {associado_associada} do
// corretor Matheus Machado" (variantes sem "sou" na frente, ex.: "Aqui é
// Fulano, {associado_associada} do corretor Matheus Machado") — sem gênero
// cadastrado pro corretor, nenhuma das duas formas vira "(a)" cru na
// mensagem: a frase inteira é trocada por "faço parte da equipe do corretor
// Matheus Machado" (a 1ª substituição cobre "sou X", a 2ª cobre o resto).
// Pedido do dono, 2026-09-30.
export function renderAutoMessage(template, { primeiroNome = "", nomeCorretor = "", corretorGender = "" } = {}) {
  let text = String(template || "");
  const gender = corretorGender === "male" || corretorGender === "female" ? corretorGender : "";
  if (gender) {
    text = text.replace(/\{associado_associada\}/g, gender === "female" ? "associada" : "associado");
  } else {
    text = text
      .replace(/sou \{associado_associada\} do corretor Matheus Machado/g, "faço parte da equipe do corretor Matheus Machado")
      .replace(/\{associado_associada\} do corretor Matheus Machado/g, "faço parte da equipe do corretor Matheus Machado");
  }
  return text
    .replace(/\{primeiro_nome\}/g, primeiroNome)
    .replace(/\{nome_corretor\}/g, nomeCorretor);
}

// Item preso em 'sending' (processo morreu entre reivindicar e concluir —
// ex.: tempo-limite da função). Decide a recuperação SEM nunca arriscar
// mensagem duplicada (2026-10-02):
//  - "wait": ainda dentro do tempo normal de processamento;
//  - "mark_sent": há prova de envio (wa_message_id, sent_at ou entrega);
//  - "return_pending": prova de que o envio NÃO começou (marca
//    send_started_at ausente num item reivindicado depois que a marca passou
//    a existir) e a tentativa ainda é devida;
//  - "skip_obsolete": não começou, mas a tentativa já não é devida;
//  - "review": não dá para saber se saiu — nunca reenviar, vai para revisão.
export const STUCK_SENDING_TIMEOUT_MS = 15 * 60 * 1000;
export const SEND_MARKER_SINCE = "2026-10-02T06:00:00Z";

export function decideStuckSendingItem({ item, round = null, slotAlreadyAttempted = false, now = Date.now(), timeoutMs = STUCK_SENDING_TIMEOUT_MS, markerSince = SEND_MARKER_SINCE }) {
  const claimedAt = new Date(item?.updated_at || 0).getTime();
  if (Number.isNaN(claimedAt) || now - claimedAt < timeoutMs) return "wait";
  if (item.wa_message_id || item.sent_at || item.delivered_at) return "mark_sent";
  const markerAvailable = claimedAt >= new Date(markerSince).getTime();
  if (!markerAvailable || item.send_started_at) return "review";
  const stillDue = round && round.status === "active" && Number(round.attempt_count) + 1 === Number(item.attempt_number) && !slotAlreadyAttempted;
  return stillDue ? "return_pending" : "skip_obsolete";
}

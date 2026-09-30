// Regras puras da automação da Meta Diária (sem banco, sem "server-only") —
// testáveis isoladamente, mesmo espírito de daily-goal-progress.mjs e
// whatsapp-individual-routing.mjs deste projeto.

export const HARD_DAILY_CAP = 20; // item 1 do pedido: nunca acima disto, mesmo que a cota de Gestão seja maior.
export const DEFAULT_WARMUP_SCHEDULE = [5, 10, 15, 20];

// Teto do dia = o menor entre: cota da Meta Diária, o teto rígido (20) e o
// valor da rampa de aquecimento do dia (se a sessão ainda estiver "nova").
// Um daily_cap_override manual (se configurado) também entra na disputa.
export function computeDailyAutoCap({ quota, warmupSchedule = DEFAULT_WARMUP_SCHEDULE, warmupDayNumber = null, dailyCapOverride = null } = {}) {
  const candidates = [Number(quota) || 0, HARD_DAILY_CAP];
  if (Number.isInteger(dailyCapOverride) && dailyCapOverride > 0) candidates.push(dailyCapOverride);
  const warmupLimit = warmupLimitForDay(warmupSchedule, warmupDayNumber);
  if (warmupLimit !== null) candidates.push(warmupLimit);
  return Math.max(0, Math.min(...candidates));
}

// Dia 1 = warmup_start_date. Do dia (schedule.length + 1) em diante a rampa
// termina (retorna null = sem teto extra, só os outros candidatos valem).
export function warmupDayNumber(warmupStartDate, todayPlainDate) {
  if (!warmupStartDate || !todayPlainDate) return null;
  const start = new Date(`${warmupStartDate}T00:00:00Z`).getTime();
  const today = new Date(`${todayPlainDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(today) || today < start) return null;
  return Math.floor((today - start) / (24 * 60 * 60 * 1000)) + 1;
}

function warmupLimitForDay(schedule, dayNumber) {
  if (!dayNumber || dayNumber < 1) return null;
  const list = Array.isArray(schedule) && schedule.length ? schedule : DEFAULT_WARMUP_SCHEDULE;
  if (dayNumber > list.length) return null;
  return list[dayNumber - 1];
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
  nowMinutes = windowStartMinutes,
  random = Math.random
}) {
  const result = [];
  let cursor = Math.max(windowStartMinutes, nowMinutes);
  const averageGap = oscillateEnabled && count > 0
    ? Math.max(1, (windowEndMinutes - cursor) / count)
    : null;
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

// Sorteio simples sem repetir a última variação usada por aquele corretor
// (evita a mesma frase duas vezes seguidas) — se só houver 1 variação, repete.
export function pickMessageVariant(variants, lastUsedIndex = -1, random = Math.random) {
  if (!Array.isArray(variants) || !variants.length) return { text: "", index: -1 };
  if (variants.length === 1) return { text: variants[0], index: 0 };
  let index = Math.floor(random() * variants.length);
  if (index === lastUsedIndex) index = (index + 1) % variants.length;
  return { text: variants[index], index };
}

export function renderAutoMessage(template, { primeiroNome = "" } = {}) {
  return String(template || "").replace(/\{primeiro_nome\}/g, primeiroNome);
}

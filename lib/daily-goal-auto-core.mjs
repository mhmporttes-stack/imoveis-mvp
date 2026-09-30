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

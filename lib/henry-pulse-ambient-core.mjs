// "Modo ambiente" da tela de bloqueio do Henry (dono, 2026-10-24: "deixei bloqueado de madrugada e nada aconteceu").
// Só com a tela cheia BLOQUEADA e o Henry parado: cards do Pulso INVENTADOS, com frases genéricas (nunca nome de cliente
// nem de corretor, nunca dado real), em horários sorteados; de vez em quando, em vez de card, só um pulso no anel.
// Existe só no navegador: nada é gravado, nada vai ao servidor, sem som, notificação ou contagem. Regras PURAS aqui
// (testadas com sorteio fixo em tests/henry-pulse-ambient.test.mjs); quem desenha é o HenryPulse.

// Tipos do Pulso (HENRY_PULSE_TYPES) com 2 a 3 frases genéricas cada. Sem nome, número, telefone ou valor.
export const AMBIENT_PHRASES = Object.freeze({
  lead: ["Novo cliente aguardando atendimento", "Novo cliente cadastrado", "Cliente novo entrou na roleta"],
  simulacao: ["Cliente preencheu o formulário", "Nova simulação gerada", "Simulação enviada ao cliente"],
  messenger: ["Cliente enviou mensagem no Marketplace", "Nova conversa no Marketplace", "Resposta enviada no Marketplace"],
  whatsapp: ["Nova mensagem no WhatsApp", "Cliente respondeu no WhatsApp", "Conversa nova no WhatsApp"],
  cca: ["Documentos enviados para análise", "Documentação recebida", "Pasta enviada à CCA"],
  pontos: ["Pontos distribuídos no ranking", "Ranking atualizado", "Meta do dia avançou"],
  instagram: ["Imóvel publicado", "Novo anúncio no ar"]
});
export const AMBIENT_TYPES = Object.freeze(Object.keys(AMBIENT_PHRASES));
export const AMBIENT_SECOND_LINES = Object.freeze(["agora há pouco", "há instantes", "neste momento"]);

// Ritmo: 35 s a 2 min entre um e outro; às vezes 2 seguidos (3–8 s), às vezes uma pausa maior (3–5 min).
export const AMBIENT_TIMING = Object.freeze({ minMs: 35_000, maxMs: 120_000, burstChance: 0.18, burstMinMs: 3_000, burstMaxMs: 8_000, longChance: 0.12, longMinMs: 180_000, longMaxMs: 300_000, realWaitMs: 12_000 });
// A cada 6 a 8 itens, um é só o pulso no anel (partículas + pulso), sem card.
export const AMBIENT_SCENE_EVERY = Object.freeze([6, 8]);

const between = (random, min, max) => min + random() * (max - min);
const pickOne = (random, list) => list[Math.floor(random() * list.length) % list.length];

export function createAmbientState(random = Math.random) {
  return { lastPhrase: "", lastTypes: [], sinceScene: 0, sceneAt: Math.round(between(random, AMBIENT_SCENE_EVERY[0], AMBIENT_SCENE_EVERY[1])), burstLeft: 0 };
}

// Espera até o próximo item. Depois de um "2 seguidos", o seguinte volta ao ritmo normal.
export function nextAmbientDelay(state, random = Math.random) {
  const t = AMBIENT_TIMING;
  if (state.burstLeft > 0) {
    state.burstLeft -= 1;
    return Math.round(between(random, t.burstMinMs, t.burstMaxMs));
  }
  const roll = random();
  if (roll < t.longChance) return Math.round(between(random, t.longMinMs, t.longMaxMs));
  if (roll < t.longChance + t.burstChance) state.burstLeft = 1; // o próximo vem logo em seguida
  return Math.round(between(random, t.minMs, t.maxMs));
}

// Próximo item: { kind: "scene" } (só o pulso) ou { kind: "card", type, phrase, line2, side }.
// Nunca a mesma frase duas vezes seguidas; nunca o mesmo tipo 3 vezes seguidas.
export function nextAmbientItem(state, random = Math.random) {
  state.sinceScene += 1;
  if (state.sinceScene >= state.sceneAt) {
    state.sinceScene = 0;
    state.sceneAt = Math.round(between(random, AMBIENT_SCENE_EVERY[0], AMBIENT_SCENE_EVERY[1]));
    return { kind: "scene" };
  }
  const [a, b] = state.lastTypes.slice(-2);
  const blocked = a && a === b ? a : "";
  const types = AMBIENT_TYPES.filter((type) => type !== blocked);
  const type = pickOne(random, types);
  const phrases = AMBIENT_PHRASES[type].filter((phrase) => phrase !== state.lastPhrase);
  const phrase = pickOne(random, phrases);
  state.lastPhrase = phrase;
  state.lastTypes = [...state.lastTypes, type].slice(-2);
  return { kind: "card", type, phrase, line2: pickOne(random, AMBIENT_SECOND_LINES), side: random() < 0.5 ? "left" : "right" };
}

// Evento inventado no formato que o HenryPulse desenha (marcado como `ambient`; sem link, nada para abrir).
export function ambientPulseEvent(item, seq = 0) {
  return { id: `ambient-${seq}`, ambient: true, type: item.type, side: item.side, ambientText: { tag: "", who: item.phrase, what: item.line2, trail: item.phrase, initial: "•" } };
}

// Card real tem prioridade: com real na fila ou na tela, o ambiente espera.
export function ambientShouldWait({ realQueued = 0, realLive = 0 } = {}) {
  return realQueued > 0 || realLive > 0;
}

// O ambiente só vale com a tela cheia bloqueada e o Henry parado.
export function ambientActive({ locked = false, expanded = false, idle = false } = {}) {
  return Boolean(locked && expanded && idle);
}

// Gerador determinístico para testes e vitrine (mulberry32).
export function seededRandom(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

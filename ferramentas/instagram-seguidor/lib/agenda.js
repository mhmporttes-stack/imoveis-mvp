// Planejamento dos horários de SEGUIR / DEIXAR DE SEGUIR e atrasos aleatórios.
// Funções puras (o gerador aleatório pode ser injetado nos testes).

import { MINUTO } from './tempo.js';

/** Número aleatório uniforme em [min, max]. */
export function aleatorioEntre(min, max, rand = Math.random) {
  return min + (max - min) * rand();
}

/** Pequeno atraso "humano" entre chamadas: 1 a 4 segundos. */
export function atrasoHumanoMs(rand = Math.random) {
  return Math.round(aleatorioEntre(1000, 4000, rand));
}

/** Atraso da DM de boas-vindas: 1 a 3 minutos depois de detectado o follow-back. */
export function atrasoDmMs(rand = Math.random) {
  return Math.round(aleatorioEntre(1 * MINUTO, 3 * MINUTO, rand));
}

/**
 * Distribui `quantidade` ações dentro de [inicio, fim) com o MAIOR intervalo possível
 * (intervalo base = (fim - inicio) / quantidade) e oscilação de ±jitter em CADA intervalo.
 *
 * - A primeira ação cai no início (+ até 2 min de oscilação), as seguintes vêm a cada
 *   intervalo base ± jitter.
 * - Se a soma dos intervalos passar do fim da janela, todos os intervalos são
 *   comprimidos proporcionalmente (nunca sai da janela).
 * - Se a janela restante não comporta `quantidade` ações com pelo menos
 *   `intervaloMinimoMs` entre elas, a quantidade é reduzida (nunca vira rajada).
 * - `deslocamento` (0..1) adia o início em uma fração do intervalo base — usado para
 *   intercalar "deixar de seguir" entre os "seguir".
 *
 * Retorna uma lista crescente de timestamps (ms).
 */
export function planejarHorarios({
  inicio,
  fim,
  quantidade,
  jitter = 0.1,
  intervaloMinimoMs = 20 * MINUTO,
  deslocamento = 0,
  rand = Math.random,
}) {
  const janela = fim - inicio;
  if (!(quantidade > 0) || !(janela > 0)) return [];

  let qtd = Math.floor(quantidade);
  if (intervaloMinimoMs > 0) {
    qtd = Math.min(qtd, Math.max(0, Math.floor(janela / intervaloMinimoMs)));
    if (qtd === 0) {
      // Janela menor que o intervalo mínimo: ainda cabe UMA ação, se houver tempo útil.
      qtd = janela > 2 * MINUTO ? 1 : 0;
    }
  }
  if (qtd === 0) return [];

  const base = janela / qtd;
  const margemFinal = Math.min(MINUTO, base * 0.05);
  const primeiro = Math.min(deslocamento * base + aleatorioEntre(0, Math.min(2 * MINUTO, base * 0.05), rand), base * 0.5);

  const intervalos = [];
  for (let i = 1; i < qtd; i += 1) {
    intervalos.push(base * (1 + aleatorioEntre(-jitter, jitter, rand)));
  }
  const soma = intervalos.reduce((a, b) => a + b, 0);
  const disponivel = janela - primeiro - margemFinal;
  const fator = soma > disponivel ? disponivel / soma : 1;

  const horarios = [];
  let t = inicio + primeiro;
  horarios.push(Math.round(t));
  for (const iv of intervalos) {
    t += iv * fator;
    horarios.push(Math.round(t));
  }
  return horarios;
}

/** Intervalo base teórico (ms) para N ações numa janela de X ms. */
export function intervaloBaseMs(janelaMs, quantidade) {
  return quantidade > 0 ? janelaMs / quantidade : 0;
}

/**
 * Decide o que fazer com a lista de horários pendentes no instante `agora`.
 * - 'aguardar'  : o próximo horário ainda não chegou.
 * - 'executar'  : chegou a hora (atraso tolerado: `toleranciaMs`).
 * - 'replanejar': o horário passou há muito (PC dormiu/desligado) — é preciso
 *                 redistribuir as ações restantes a partir de agora, sem rajada.
 * - 'nada'      : não há horários pendentes.
 */
export function decidirHorario(pendentes, agora, toleranciaMs = 10 * MINUTO) {
  if (!pendentes || pendentes.length === 0) return 'nada';
  const proximo = pendentes[0];
  if (agora < proximo) return 'aguardar';
  if (agora - proximo > toleranciaMs) return 'replanejar';
  return 'executar';
}

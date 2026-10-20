// Utilitários de horário no fuso de São Paulo (America/Sao_Paulo).
// Funções puras: recebem timestamps (ms) e devolvem valores; sem chrome.*.

export const FUSO = 'America/Sao_Paulo';
export const MINUTO = 60 * 1000;
export const HORA = 60 * MINUTO;
export const DIA = 24 * HORA;

const formatador = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Partes da data/hora em São Paulo. */
export function partesSP(ts) {
  const p = {};
  for (const { type, value } of formatador.formatToParts(new Date(ts))) p[type] = value;
  return {
    ano: Number(p.year),
    mes: Number(p.month),
    dia: Number(p.day),
    hora: Number(p.hour),
    minuto: Number(p.minute),
    segundo: Number(p.second),
  };
}

/** Diferença (em minutos) entre o horário de SP e o UTC no instante ts. Ex.: -180. */
export function deslocamentoSPMinutos(ts) {
  const p = partesSP(ts);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return Math.round((comoUtc - Math.floor(ts / 1000) * 1000) / MINUTO);
}

/** Chave do dia em SP: "AAAA-MM-DD". */
export function diaSP(ts) {
  const p = partesSP(ts);
  return `${p.ano}-${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')}`;
}

/** Timestamp de "hora:minuto" (horário de SP) no mesmo dia SP de `ts`. */
export function tsHoraSP(ts, hora, minuto = 0) {
  const p = partesSP(ts);
  const palpite = Date.UTC(p.ano, p.mes - 1, p.dia, hora, minuto, 0);
  // Corrige pelo deslocamento do fuso (duas passadas cobrem eventual horário de verão).
  let r = palpite - deslocamentoSPMinutos(palpite) * MINUTO;
  r = palpite - deslocamentoSPMinutos(r) * MINUTO;
  return r;
}

/** Janela de trabalho do dia SP de `ts`: { inicio, fim } em ms. */
export function janelaDoDia(ts, cfg) {
  return {
    inicio: tsHoraSP(ts, cfg.inicioHora, 0),
    fim: tsHoraSP(ts, cfg.fimHora, 0),
  };
}

export function dentroDaJanela(ts, cfg) {
  const { inicio, fim } = janelaDoDia(ts, cfg);
  return ts >= inicio && ts < fim;
}

/** Próxima abertura da janela (agora, se já estiver dentro dela). */
export function proximaAbertura(ts, cfg) {
  const { inicio, fim } = janelaDoDia(ts, cfg);
  if (ts < inicio) return inicio;
  if (ts < fim) return ts;
  // Amanhã: soma ~26 h para cair com folga no dia seguinte e recalcula as 05:00 de lá.
  return tsHoraSP(ts + 26 * HORA - (ts - inicio), cfg.inicioHora, 0);
}

/** Data/hora legível em SP: "20/10/2026 05:03:12". */
export function formatarSP(ts) {
  if (!ts) return '';
  const p = partesSP(ts);
  const d2 = (n) => String(n).padStart(2, '0');
  return `${d2(p.dia)}/${d2(p.mes)}/${p.ano} ${d2(p.hora)}:${d2(p.minuto)}:${d2(p.segundo)}`;
}

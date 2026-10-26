// 1.1.9 (pedido do dono, 26/10): "Ele deve puxar os últimos 3 dias hoje; depois ele puxa apenas até a última
// conferida." Carga ÚNICA (por instalação) dos seguidores novos das últimas 72 h. A lista de seguidores não tem data,
// então a fonte é a atividade do Instagram (notificações "começou a seguir você", com timestamp). Funções puras.
//
// Regra de segurança: só entra quem tem a data CONFIRMADA na notificação (≥ agora − 72 h). Notificação agrupada
// ("fulano e mais 5 começaram a seguir você") não tem a data de cada pessoa: fica de fora. Resposta sem a lista de
// notificações (HTML, formato desconhecido) = carga indisponível, ninguém recebe DM por ela.

import { HORA, MINUTO } from './tempo.js';
import { atrasoDmMs } from './agenda.js';
import { ajustarParaJanela, jaTemBoasVindas, STATUS } from './regras.js';

export const CARGA_HORAS = 72;
export const CARGA_JANELA_MS = CARGA_HORAS * HORA;
/** Páginas da atividade lidas no máximo (só segue para a próxima enquanto ainda houver eventos dentro das 72 h). */
export const CARGA_PAGINAS_MAX = 5;
/** Tentativas da carga quando o Instagram pede para esperar / sem sessão / sem janela (depois: indisponível). */
export const CARGA_TENTATIVAS_MAX = 5;
export const ORIGEM_CARGA = 'carga 3 dias';

const RE_SEGUIU = /(started following you|começou a seguir você|começou a te seguir|começaram a seguir você|started following)/i;
const RE_AGRUPADO = /(\bothers\b|\boutras?\b|\boutros\b|\be mais \d+|\band \d+ |começaram a seguir)/i;

/** Timestamp do Instagram (segundos, ms ou µs) → ms. null se não for uma data plausível. */
export function timestampParaMs(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  let ms = null;
  if (n >= 1e9 && n < 1e11) ms = n * 1000; // segundos (o formato do news/inbox)
  else if (n >= 1e12 && n < 1e14) ms = n; // milissegundos
  else if (n >= 1e15 && n < 1e17) ms = n / 1000; // microssegundos
  if (ms == null || ms < Date.UTC(2015, 0, 1)) return null;
  return Math.round(ms);
}

/** É uma notificação de "começou a seguir você"? */
function ehSeguiu(s, args, texto) {
  const nome = String(args.notif_name || s.notif_name || '');
  if (nome === 'user_followed') return true;
  return RE_SEGUIU.test(texto);
}

/**
 * Interpreta UMA página da atividade (news/inbox). Retorna:
 * { ok: false, motivo } — a resposta não tem a lista de notificações (nunca chutar);
 * { ok: true, eventos: [{ id, username, em }], seguiu, agrupados, semData, maisAntigoEm, proximo }.
 * `eventos` = só "começou a seguir você" com data confirmada ≥ `desde` e ≤ agora (+10 min de folga de relógio).
 */
export function interpretarAtividade(json, { agora, desde, meuId = null } = {}) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { ok: false, motivo: 'a atividade não respondeu dados (resposta vazia ou fora do formato)' };
  const listas = ['new_stories', 'old_stories', 'stories'].filter((k) => Array.isArray(json[k]));
  if (!listas.length) return { ok: false, motivo: 'a resposta da atividade não tem a lista de notificações (new_stories/old_stories) — o Instagram pode ter mudado o formato' };
  const eventos = [];
  let seguiu = 0;
  let agrupados = 0;
  let semData = 0;
  let maisAntigoEm = null;
  for (const k of listas) {
    for (const s of json[k]) {
      if (!s || typeof s !== 'object') continue;
      const args = s.args && typeof s.args === 'object' ? s.args : {};
      const texto = String(args.text || args.rich_text || s.text || '');
      const em = timestampParaMs(args.timestamp ?? s.timestamp);
      if (em != null && em <= agora + 10 * MINUTO && (maisAntigoEm == null || em < maisAntigoEm)) maisAntigoEm = em;
      if (!ehSeguiu(s, args, texto)) continue;
      seguiu += 1;
      const ids = Array.isArray(args.profile_ids) ? args.profile_ids : null;
      const semNome = args.profile_name ? texto.split(String(args.profile_name)).join(' ') : texto; // o @ não conta
      if ((ids && ids.length > 1) || RE_AGRUPADO.test(semNome)) { agrupados += 1; continue; }
      const id = String(args.profile_id ?? (ids && ids[0]) ?? '');
      if (!/^\d+$/.test(id) || em == null || em > agora + 10 * MINUTO) { semData += 1; continue; }
      if (meuId && id === String(meuId)) continue;
      if (em >= desde) eventos.push({ id, username: String(args.profile_name || args.username || ''), em });
    }
  }
  const prox = json.next_max_id ?? json.max_id_next ?? null;
  return { ok: true, eventos, seguiu, agrupados, semData, maisAntigoEm, proximo: prox != null && prox !== '' ? String(prox) : null };
}

/**
 * Decide o que fazer com os eventos confirmados (já filtrados por data). Dedupe por id (mesma pessoa em 2
 * notificações conta 1) e contra quem já tem boas-vindas. Quem a extensão segue e ainda não tinha follow-back vai
 * para o fluxo de follow-back (uma única DM, do jeito de sempre).
 * Retorna { encontrados: [u] (únicos, mais antigo primeiro), novos: [u], followBack: [ids], jaTinham: n }.
 */
export function separarCarga(e, eventos) {
  const porId = new Map();
  for (const ev of eventos || []) {
    const atual = porId.get(ev.id);
    if (!atual || ev.em < atual.em) porId.set(ev.id, { ...ev, username: ev.username || (atual && atual.username) || '' });
  }
  const encontrados = [...porId.values()].sort((a, b) => a.em - b.em);
  const novos = [];
  const followBack = [];
  let jaTinham = 0;
  for (const u of encontrados) {
    const seguido = e.seguidos && e.seguidos[u.id];
    if (jaTemBoasVindas(e, u.id)) { jaTinham += 1; continue; }
    if (seguido && !seguido.followBackEm && (seguido.status === STATUS.SEGUINDO || seguido.status === STATUS.SOLICITADO)) { followBack.push(u.id); continue; }
    novos.push(u);
  }
  return { encontrados, novos, followBack, jaTinham };
}

/**
 * Registro de boas-vindas de alguém da carga: mesmo formato do "novo seguidor" (1.1.8). `ordem` espaça a fila na
 * ordem em que as pessoas seguiram (o envio de fato segue o ritmo, a janela e o teto diário de processarDm).
 */
export function registroDaCarga(u, agora, cfg, ordem = 0, rand = Math.random) {
  const base = agora + atrasoDmMs(rand) + ordem * 2 * MINUTO;
  return {
    id: String(u.id),
    username: u.username || '',
    origem: ORIGEM_CARGA,
    detectadoEm: agora,
    seguiuEm: u.em,
    dmAgendadaPara: ajustarParaJanela(base, agora, cfg, rand),
  };
}

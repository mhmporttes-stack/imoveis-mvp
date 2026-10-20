// Regras de negócio puras: dedupe da fila, regra dos 3 dias, DM de boas-vindas,
// classificação de erros do Instagram e pausa automática.

import { DIA, HORA, dentroDaJanela, proximaAbertura } from './tempo.js';
import { atrasoDmMs } from './agenda.js';

export const MENSAGEM_PADRAO = [
  'Que bom ter você por aqui! 🙌🏼',
  '',
  'Pode ficar em paz, não vim aqui para te vender nada. 😅',
  '',
  'Só quis aproveitar para me colocar à disposição.',
  '',
  'Sempre que surgir qualquer dúvida sobre compra de imóveis, financiamento ou investimentos imobiliários, pode me chamar.',
  '',
  'Às vezes, uma orientação simples evita muita dor de cabeça.',
  '',
  'Conte comigo! 😊',
].join('\n');

export const PAUSA_POR_LIMITE_MS = 24 * HORA;

// Status de um perfil seguido pela extensão.
export const STATUS = {
  SEGUINDO: 'seguindo', // seguimos e ainda não seguiu de volta
  SOLICITADO: 'solicitado', // perfil privado: pedido pendente
  SEGUIU_DE_VOLTA: 'seguiu_de_volta',
  DEIXADO: 'deixado', // deixamos de seguir (regra dos 3 dias)
  NAO_SEGUE_MAIS: 'nao_segue_mais', // já não seguíamos (desfeito fora da extensão)
};

const ID_FOTO_PADRAO = '44884218_345707102882519_2446069589734326272_n';

/** true se o perfil está com a foto padrão (sem foto). */
export function semFoto(usuario) {
  if (!usuario) return true;
  if (usuario.has_anonymous_profile_picture === true) return true;
  const url = String(usuario.profile_pic_url || '');
  if (!url) return true;
  return url.includes(ID_FOTO_PADRAO);
}

/**
 * Filtra os usuários retornados pela lista de seguidores do perfil de referência.
 * Remove: eu mesmo, repetidos (na própria página, na fila, já vistos ou já seguidos),
 * privados (se a opção estiver ligada) e sem foto (se a opção estiver ligada).
 * Retorna { aceitos: [...itens da fila], pulados: { motivo: quantidade } }.
 */
export function filtrarCandidatos(usuarios, { meuId, fila = [], vistos = {}, seguidos = {}, pularPrivados = true, pularSemFoto = false, origem = '', agora = Date.now() }) {
  const naFila = new Set(fila.map((f) => String(f.id)));
  const aceitos = [];
  const pulados = {};
  const pular = (motivo) => { pulados[motivo] = (pulados[motivo] || 0) + 1; };

  for (const u of usuarios || []) {
    const id = String(u.pk ?? u.id ?? u.pk_id ?? '');
    if (!id) { pular('sem_id'); continue; }
    if (meuId && id === String(meuId)) { pular('eu_mesmo'); continue; }
    if (seguidos[id]) { pular('ja_seguido_antes'); continue; }
    if (vistos[id]) { pular('ja_avaliado'); continue; }
    if (naFila.has(id)) { pular('ja_na_fila'); continue; }
    if (pularPrivados && u.is_private) { pular('privado'); continue; }
    if (pularSemFoto && semFoto(u)) { pular('sem_foto'); continue; }
    if (u.friendship_status && (u.friendship_status.following || u.friendship_status.followed_by)) {
      pular('ja_relacionado');
      continue;
    }
    naFila.add(id);
    aceitos.push({ id, username: u.username || '', origem, adicionadoEm: agora, privado: Boolean(u.is_private) });
  }
  return { aceitos, pulados };
}

/** Pode deixar de seguir? Só perfis seguidos PELA extensão, há >= N dias, sem follow-back. */
export function elegivelParaUnfollow(registro, agora, dias = 3) {
  if (!registro || !registro.seguidoEm) return false;
  if (registro.status !== STATUS.SEGUINDO && registro.status !== STATUS.SOLICITADO) return false;
  if (registro.followBackEm) return false;
  return agora - registro.seguidoEm >= dias * DIA;
}

/** O mais antigo elegível para deixar de seguir (ou null). */
export function escolherParaUnfollow(seguidos, agora, dias = 3, excluir = new Set()) {
  let melhor = null;
  for (const r of Object.values(seguidos || {})) {
    if (excluir.has(String(r.id))) continue;
    if (!elegivelParaUnfollow(r, agora, dias)) continue;
    if (!melhor || r.seguidoEm < melhor.seguidoEm) melhor = r;
  }
  return melhor;
}

/** Ids que devem ser verificados quanto ao follow-back. */
export function idsParaVerificarFollowBack(seguidos) {
  return Object.values(seguidos || {})
    .filter((r) => r.status === STATUS.SEGUINDO || r.status === STATUS.SOLICITADO)
    .map((r) => String(r.id));
}

/**
 * Marca o follow-back e agenda a DM (1–3 min). Idempotente: se já houver DM
 * agendada/enviada, não mexe. Retorna true se mudou algo.
 */
export function registrarFollowBack(registro, agora, cfg, rand = Math.random) {
  if (!registro) return false;
  let mudou = false;
  if (!registro.followBackEm) {
    registro.followBackEm = agora;
    mudou = true;
  }
  if (registro.status !== STATUS.SEGUIU_DE_VOLTA) {
    registro.status = STATUS.SEGUIU_DE_VOLTA;
    mudou = true;
  }
  if (!registro.dmAgendadaPara && !registro.dmEnviadaEm && !registro.dmTentativaEm) {
    registro.dmAgendadaPara = ajustarParaJanela(agora + atrasoDmMs(rand), agora, cfg, rand);
    mudou = true;
  }
  return mudou;
}

/**
 * Se o horário agendado cair fora da janela 05–22h, empurra para a próxima abertura
 * + novo atraso aleatório de 1–3 min.
 */
export function ajustarParaJanela(agendado, agora, cfg, rand = Math.random) {
  if (dentroDaJanela(agendado, cfg)) return agendado;
  return proximaAbertura(Math.max(agendado, agora), cfg) + atrasoDmMs(rand);
}

/** A DM deste registro pode ser enviada agora? (nunca duas vezes) */
export function dmPronta(registro, agora, cfg) {
  if (!registro || !registro.dmAgendadaPara) return false;
  if (registro.dmEnviadaEm || registro.dmTentativaEm) return false;
  if (registro.dmDesistiu) return false;
  if (agora < registro.dmAgendadaPara) return false;
  return dentroDaJanela(agora, cfg);
}

/**
 * Classifica uma resposta de erro do Instagram.
 * 'limite'  → bloqueio/limite temporário: pausa 24 h.
 * 'sessao'  → não logado: pausa até haver sessão.
 * 'nao_encontrado' → perfil inexistente/indisponível.
 * 'mudanca_api' → endpoint mudou (404 HTML, JSON inesperado).
 * 'outro'.
 * Retorna null quando não é erro.
 */
export function classificarErro({ status = 0, corpo = '' } = {}) {
  const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo || {});
  const t = texto.toLowerCase();
  const limite = [
    'feedback_required',
    'challenge_required',
    'checkpoint_required',
    'please wait a few minutes',
    'rate_limit_error',
    '"spam":true',
    'try again later',
    'action blocked',
    'temporarily blocked',
    'sentry_block',
  ];
  if (status === 429 || limite.some((k) => t.includes(k))) return 'limite';
  if (status === 401 || t.includes('login_required') || t.includes('"require_login":true') || t.includes('not-logged-in')) return 'sessao';
  if (status === 200 && t.trim().startsWith('<')) return 'mudanca_api'; // página HTML em vez de JSON
  if (status >= 200 && status < 300) {
    if (t.includes('"status":"fail"')) return 'outro';
    return null;
  }
  if (status === 404 && t.includes('user not found')) return 'nao_encontrado';
  if (status === 404) return 'mudanca_api';
  if (status === 400 && t.includes('user not found')) return 'nao_encontrado';
  return 'outro';
}

/** Aplica a pausa automática de 24 h por limite/bloqueio. Retorna o estado alterado. */
export function aplicarPausaPorErro(estado, tipo, agora, detalhe = '') {
  if (tipo === 'limite') {
    estado.pausaAte = Math.max(estado.pausaAte || 0, agora + PAUSA_POR_LIMITE_MS);
    estado.alerta = { tipo, em: agora, texto: `O Instagram sinalizou limite/bloqueio (${detalhe || 'sem detalhe'}). Extensão pausada por 24 h.` };
  } else if (tipo === 'sessao') {
    estado.semSessao = true;
    estado.alerta = { tipo, em: agora, texto: 'Sem sessão do Instagram neste Chrome. Entre em instagram.com; a extensão volta sozinha.' };
  }
  return estado;
}

/** A extensão pode agir agora? (sem pausa manual, sem pausa de 24 h, com sessão) */
export function estaAtiva(estado, controle, agora) {
  if (controle && controle.pausado) return false;
  if (estado.pausaAte && agora < estado.pausaAte) return false;
  if (estado.semSessao) return false;
  return true;
}

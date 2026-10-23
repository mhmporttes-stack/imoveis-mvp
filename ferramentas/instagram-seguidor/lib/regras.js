// Regras de negócio puras: dedupe da fila, regra dos 3 dias, DM de boas-vindas,
// classificação de erros do Instagram e pausa automática.

import { DIA, HORA, MINUTO as MINUTO_REGRAS, dentroDaJanela, proximaAbertura } from './tempo.js';
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
export function filtrarCandidatos(usuarios, { meuId, fila = [], vistos = {}, seguidos = {}, pularPrivados = false, pularSemFoto = false, origem = '', agora = Date.now() }) {
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

/** Texto do histórico para um "seguir" confirmado: privado pendente → "Solicitado". */
export function rotuloSeguir(st) {
  if (st && !st.seguindo && st.pedidoPendente) return 'Solicitado (perfil privado)';
  return 'seguindo';
}

/** Status inicial do registro depois de um "seguir" confirmado no friendships/show. */
export function statusAposSeguir(st) {
  return st && !st.seguindo && st.pedidoPendente ? STATUS.SOLICITADO : STATUS.SEGUINDO;
}

/**
 * Atualiza um registro "Solicitado" com o friendships/show (ou show_many): se a pessoa
 * aceitou (following = true), passa a "seguindo". Retorna true se mudou.
 */
export function atualizarSolicitacao(registro, st, agora) {
  if (!registro || !st || registro.status !== STATUS.SOLICITADO) return false;
  if (!st.seguindo) return false;
  registro.status = STATUS.SEGUINDO;
  registro.aceitoEm = agora;
  return true;
}

/** Texto do histórico ao deixar de seguir / cancelar a solicitação (regra dos N dias). */
export function rotuloDeixar(st, dias) {
  if (st && !st.seguindo && st.pedidoPendente) return `Solicitado — solicitação cancelada (não aceitou em ${dias} dias)`;
  return `não seguiu de volta em ${dias} dias`;
}

/** Rótulo curto do status de um perfil seguido (painel). */
export function rotuloStatus(status) {
  return {
    [STATUS.SEGUINDO]: 'Seguindo',
    [STATUS.SOLICITADO]: 'Solicitado',
    [STATUS.SEGUIU_DE_VOLTA]: 'Seguiu de volta',
    [STATUS.DEIXADO]: 'Deixado de seguir',
    [STATUS.NAO_SEGUE_MAIS]: 'Já não seguia',
  }[status] || status || '';
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
 * 'sessao'  → não logado / sessão inválida (require_login, login_required, 401).
 *             Tem prioridade: o Instagram costuma mandar "Please wait a few minutes"
 *             JUNTO com require_login quando a requisição chega sem sessão.
 * 'limite'  → bloqueio/limite explícito: 429, feedback_required, challenge/checkpoint, spam.
 * 'aguarde' → "Please wait a few minutes"/"try again later" SEM require_login: pode ser
 *             passageiro; só vira pausa de 24 h se repetir (ver decidirPausa).
 * 'nao_encontrado' → perfil inexistente/indisponível.
 * 'mudanca_api' → endpoint mudou (404, HTML no lugar de JSON).
 * 'outro'.
 * Retorna null quando não é erro.
 */
export function classificarErro({ status = 0, corpo = '' } = {}) {
  const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo || {});
  const t = texto.toLowerCase().replace(/\s+/g, ' ');
  const sessao = t.includes('login_required') || /"require_login"\s*:\s*true/.test(t) || t.includes('not-logged-in');
  if (status === 401 || sessao) return 'sessao';
  const limite = [
    'feedback_required',
    'challenge_required',
    'checkpoint_required',
    'rate_limit_error',
    'sentry_block',
    'action blocked',
    'temporarily blocked',
  ];
  if (status === 429 || /"spam"\s*:\s*true/.test(t) || limite.some((k) => t.includes(k))) return 'limite';
  if (t.includes('please wait a few minutes') || t.includes('try again later')) return 'aguarde';
  if (status === 200 && t.trim().startsWith('<')) return 'mudanca_api'; // página HTML em vez de JSON
  if (status >= 200 && status < 300) {
    if (t.includes('"status":"fail"')) return 'outro';
    return null;
  }
  if ((status === 404 || status === 400) && t.includes('user not found')) return 'nao_encontrado';
  if (status === 404) return 'mudanca_api';
  return 'outro';
}

export const JANELA_ERROS_MS = 60 * MINUTO_REGRAS;
export const ERROS_PARA_PAUSAR = 3;
export const ESFRIAR_MS = 15 * MINUTO_REGRAS;

/**
 * Decide o que fazer depois de um erro do Instagram.
 * - ehAcao: true para seguir / deixar de seguir / DM; false para leituras
 *   (busca de origem, verificação de follow-back, checagem de amizade).
 * - manual: true quando o dono clicou (busca de origem) → nunca pausa sozinho.
 * - recentes: timestamps de erros de limite/aguarde anteriores (o atual é contado aqui).
 * Retorna 'pausa24h' | 'esfriar' | 'sessao' | 'nenhuma'.
 */
export function decidirPausa({ tipo, ehAcao = false, manual = false, recentes = [], agora = Date.now() }) {
  if (tipo === 'sessao') return manual ? 'nenhuma' : 'sessao';
  if (tipo !== 'limite' && tipo !== 'aguarde') return 'nenhuma';
  if (manual) return 'nenhuma';
  const n = recentes.filter((t) => agora - t < JANELA_ERROS_MS).length + 1;
  if (tipo === 'limite' && ehAcao) return 'pausa24h';
  if (n >= ERROS_PARA_PAUSAR) return 'pausa24h';
  return 'esfriar';
}

/** Trecho da resposta para diagnóstico, sem tokens/ids de sessão. */
export function trechoSeguro(corpo, max = 220) {
  let s = String(corpo || '').replace(/\s+/g, ' ').trim();
  if (s.startsWith('<')) {
    const titulo = s.match(/<title[^>]*>([^<]*)<\/title>/i);
    s = `HTML${titulo ? ` (título: ${titulo[1].trim()})` : ''}`;
  }
  s = s
    .replace(/("[^"]*(?:token|csrf|session|claim|cookie|nonce|password|senha)[^"]*"\s*:\s*)"[^"]*"/gi, '$1"***"')
    .replace(/[A-Za-z0-9%:_\-]{28,}/g, '***');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Aplica a pausa decidida. Retorna o estado alterado. */
export function aplicarPausaPorErro(estado, tipo, agora, detalhe = '') {
  if (tipo === 'limite' || tipo === 'pausa24h') {
    estado.pausaAte = Math.max(estado.pausaAte || 0, agora + PAUSA_POR_LIMITE_MS);
    estado.alerta = { tipo: 'limite', em: agora, texto: `O Instagram sinalizou limite/bloqueio (${detalhe || 'sem detalhe'}). Extensão pausada por 24 h.` };
  } else if (tipo === 'esfriar') {
    estado.esfriarAte = Math.max(estado.esfriarAte || 0, agora + ESFRIAR_MS);
    estado.alerta = { tipo: 'aguarde', em: agora, texto: `O Instagram pediu para esperar (${detalhe || 'sem detalhe'}). Nova tentativa em 15 min; se repetir 3 vezes em 1 h, pausa 24 h.` };
  } else if (tipo === 'sessao') {
    estado.semSessao = true;
    estado.sessaoRecheckEm = agora + 10 * MINUTO_REGRAS;
    estado.alerta = { tipo: 'sessao', em: agora, texto: `Sem sessão válida do Instagram neste Chrome${detalhe ? ` (${detalhe})` : ''}. Entre em instagram.com; a extensão volta sozinha.` };
  }
  return estado;
}

/** A extensão pode agir agora? (sem pausa manual, sem pausa de 24 h, com sessão) */
export function estaAtiva(estado, controle, agora) {
  if (controle && controle.pausado) return false;
  if (estado.pausaAte && agora < estado.pausaAte) return false;
  if (estado.esfriarAte && agora < estado.esfriarAte) return false;
  if (estado.semSessao) return false;
  return true;
}

/** Margem de segurança da fila (perfis descartados na hora de seguir). */
export const MARGEM_FILA = 5;

/** A fila está curta para o dia? (menos que o limite diário + margem) */
export function precisaReabastecer(tamanhoFila, limiteDiario) {
  return limiteDiario > 0 && tamanhoFila < limiteDiario + MARGEM_FILA;
}

/** Tamanho de fila desejado ao reabastecer: ~3 dias de "seguir". */
export function alvoFila(limiteDiario) {
  return Math.max(limiteDiario * 3, limiteDiario + MARGEM_FILA);
}

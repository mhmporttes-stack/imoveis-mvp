// Funções compartilhadas pelo popup e pela página de opções.
import { formatarSP, diaSP } from './lib/tempo.js';
import { normalizarEstado } from './lib/estado.js';

export async function lerTudo() {
  const { estado, controle } = await chrome.storage.local.get(['estado', 'controle']);
  return { e: normalizarEstado(estado), c: { pausado: false, ...(controle || {}) } };
}

export function enviar(tipo, dados = {}) {
  return chrome.runtime.sendMessage({ tipo, ...dados });
}

/** { rotulo, classe } do status atual. */
export function statusAtual(e, c, agora = Date.now()) {
  if (e.pausaAte && agora < e.pausaAte) return { rotulo: 'Pausada (limite IG)', classe: 'bloqueada' };
  if (e.esfriarAte && agora < e.esfriarAte) return { rotulo: 'Esperando (IG)', classe: 'pausada' };
  if (e.semSessao) return { rotulo: 'Sem sessão', classe: 'bloqueada' };
  if (c.pausado) return { rotulo: 'Pausada', classe: 'pausada' };
  return { rotulo: 'Ligada', classe: 'ligada' };
}

export function textoProxima(e) {
  if (!e.proxima) return '—';
  return e.proxima.em ? `${e.proxima.acao} — ${formatarSP(e.proxima.em)}` : e.proxima.acao;
}

export function contadoresHoje(e) {
  const hoje = diaSP(Date.now());
  return e.contadores.dia === hoje ? e.contadores : { seguidos: 0, deixados: 0, followBacks: 0, dms: 0 };
}

/** Está parada por algum motivo que o dono pode desfazer com "Retomar agora"? */
export function estaParada(e, c, agora = Date.now()) {
  return Boolean(c.pausado || (e.pausaAte && agora < e.pausaAte) || (e.esfriarAte && agora < e.esfriarAte) || e.semSessao);
}

/** "Retomar agora" com confirmação. Devolve true se retomou. */
export async function retomarAgora(e) {
  const agora = Date.now();
  let aviso = 'Retomar a extensão agora?';
  if (e.pausaAte && agora < e.pausaAte) aviso = 'O Instagram sinalizou limite/bloqueio. Retomar antes das 24 h aumenta o risco para a conta. Retomar agora mesmo assim?';
  else if (e.esfriarAte && agora < e.esfriarAte) aviso = 'O Instagram pediu para esperar alguns minutos. Retomar agora mesmo assim?';
  if (!confirm(aviso)) return false;
  await enviar('retomar');
  return true;
}

export function textoAlerta(e) {
  if (!e.alerta) return '';
  let t = e.alerta.texto || '';
  if (e.pausaAte && Date.now() < e.pausaAte) t += ` Volta sozinha em ${formatarSP(e.pausaAte)}.`;
  else if (e.esfriarAte && Date.now() < e.esfriarAte) t += ` Nova tentativa às ${formatarSP(e.esfriarAte).slice(11)}.`;
  return t;
}

/** 1.1.7: botão "Conferir seguidores agora" (popup e painel) — confere na hora e mostra o resultado. */
export function ligarBotaoConferir(botao, saida) {
  botao.addEventListener('click', async () => {
    botao.disabled = true;
    saida.textContent = 'Conferindo seus seguidores… (pode levar 1 a 2 min)';
    try {
      const r = await enviar('conferirSeguidores');
      saida.textContent = r && r.ok ? r.texto : `Erro: ${(r && r.erro) || 'sem resposta da extensão'}`;
    } catch (err) {
      saida.textContent = `Erro: ${err.message}`;
    } finally {
      botao.disabled = false;
    }
  });
}

/**
 * 1.1.12 — botão "Enviar a próxima boas-vindas agora" (popup e painel): a próxima DM pendente sai na hora e o resultado
 * (enviada / incerta / não enviada + motivo) aparece em segundos. Habilitado só com pendente (`atualizarBotaoEnviarAgora`).
 */
export function ligarBotaoEnviarAgora(botao, saida) {
  botao.addEventListener('click', async () => {
    botao.disabled = true;
    botao.dataset.enviando = '1';
    saida.textContent = 'Enviando a próxima boas-vindas agora… (abre a conversa na janela de trabalho; leva até 1 min)';
    try {
      const r = await enviar('enviarProximaDm');
      saida.textContent = r && r.texto ? r.texto : `Não enviada: ${(r && r.erro) || 'sem resposta da extensão'}`;
    } catch (err) {
      saida.textContent = `Erro: ${err.message}`;
    } finally {
      delete botao.dataset.enviando;
      botao.disabled = false;
    }
  });
}

/** Habilita/desabilita o botão conforme haja boas-vindas pendente (e a DM esteja ligada). */
export function atualizarBotaoEnviarAgora(botao, e, proxima) {
  const r = e.config.dmAtiva ? proxima : null;
  if (botao.dataset.enviando !== '1') botao.disabled = !r;
  botao.title = r ? `Próxima: @${r.username}` : e.config.dmAtiva ? 'Nenhuma boas-vindas pendente' : 'DM de boas-vindas desligada';
}

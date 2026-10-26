// 1.1.13 — configuração e comandos remotos vindos do CRM (GET /api/marketplace/ig-config). Pedido do dono (26/10): "é
// muito cansativo toda vez baixar, extrair o zip, atualizar no Chrome e rodar de novo. Arrume um jeito de você mesmo
// deixar tudo pronto". Chrome MV3 não roda código baixado — então o CRM manda só DADOS, validados aqui:
//  - config: textos dos botões/avisos, seletores CSS da caixa e do que não é conversa, tempos e liga/desliga da
//    digitação. Campo desconhecido ou fora do formato é ignorado (fica o padrão embutido).
//  - commands: lista FECHADA de tipos (abaixo); cada id roda uma única vez e responde com o diagnóstico `ig_ack`.
// Lógica pura (testada em tests/config-remota.test.mjs).

export const CHAVE_CONFIG_REMOTA = 'crmConfig'; // { versao, recebidaEm, config }
export const CHAVE_COMANDOS = 'crmComandos'; // { executados: [id...], ultimo: { id, tipo, em, resultado } }
export const INTERVALO_SINCRONIZAR_MIN = 5;
export const TIPOS_COMANDO = ['dryrun_dm', 'dryrun_follow', 'send_next_now', 'check_followers', 'reset_dms', 'ping'];

const CHAVES_TEXTOS = [
  'mensagem', 'agoraNao', 'enviar', 'erroAbrir', 'falhaEnvio', 'enviando', 'ui',
  'seguir_de_volta', 'seguir', 'seguindo', 'solicitado', 'segueVoce', 'privado',
];
const CHAVES_SELETORES = ['caixa', 'excluirDaConversa'];

function listaDeTextos(v) {
  if (!Array.isArray(v)) return null;
  const l = v
    .filter((x) => typeof x === 'string')
    .map((x) => x.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter((x) => x.length >= 2 && x.length <= 60)
    .slice(0, 40);
  return l.length ? l : null;
}

function seletor(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.length > 400 || /[{}<>]|javascript:|url\(/i.test(t)) return null; // só seletor CSS, nada de estilo/HTML
  return t;
}

const numero = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : null);

/** Configuração validada (só o que passou); {} se nada servir. */
export function validarConfigRemota(bruta) {
  const c = bruta && typeof bruta === 'object' && !Array.isArray(bruta) ? bruta : {};
  const out = {};
  if (typeof c.versao === 'string' && c.versao.trim()) out.versao = c.versao.trim().slice(0, 40);
  const textos = {};
  for (const k of CHAVES_TEXTOS) {
    const l = c.textos && listaDeTextos(c.textos[k]);
    if (l) textos[k] = l;
  }
  if (Object.keys(textos).length) out.textos = textos;
  const seletores = {};
  for (const k of CHAVES_SELETORES) {
    const s = c.seletores && seletor(c.seletores[k]);
    if (s) seletores[k] = s;
  }
  if (Object.keys(seletores).length) out.seletores = seletores;
  const tempos = {};
  const t = c.tempos || {};
  if (numero(t.confirmarMs, 3000, 30000) != null) tempos.confirmarMs = numero(t.confirmarMs, 3000, 30000);
  if (numero(t.maxCliquesMensagem, 1, 6) != null) tempos.maxCliquesMensagem = numero(t.maxCliquesMensagem, 1, 6);
  if (Object.keys(tempos).length) out.tempos = tempos;
  const d = c.digitacao || {};
  const digitacao = {};
  for (const k of ['ativa', 'colar', 'shiftEnter']) if (typeof d[k] === 'boolean') digitacao[k] = d[k];
  if (Object.keys(digitacao).length) out.digitacao = digitacao;
  return out;
}

/** Comandos novos e válidos, na ordem: [{ id, tipo, args }]; inválidos e já executados ficam de fora. */
export function comandosPendentes(lista, executados = []) {
  const feitos = new Set(executados);
  const out = [];
  for (const c of Array.isArray(lista) ? lista : []) {
    if (!c || typeof c !== 'object') continue;
    const id = typeof c.id === 'string' || typeof c.id === 'number' ? String(c.id).slice(0, 80) : '';
    if (!id || feitos.has(id) || !TIPOS_COMANDO.includes(c.tipo)) continue;
    const a = c.args && typeof c.args === 'object' ? c.args : {};
    const args = {};
    if (typeof a.username === 'string') args.username = a.username.slice(0, 80);
    if (Array.isArray(a.ids)) args.ids = a.ids.map(String).slice(0, 500);
    if (a.desde != null) {
      const d = typeof a.desde === 'number' ? a.desde : Date.parse(a.desde);
      if (Number.isFinite(d)) args.desde = d;
    }
    if ((c.tipo === 'dryrun_dm' || c.tipo === 'dryrun_follow') && !args.username) continue;
    feitos.add(id);
    out.push({ id, tipo: c.tipo, args });
  }
  return out.slice(0, 10);
}

/** Lista de executados com o novo id (guarda os 300 mais recentes). */
export function marcarExecutado(executados = [], id) {
  return [...executados.filter((x) => x !== id), id].slice(-300);
}

/** Linha do popup: "Configuração do CRM: versão X, atualizada HH:MM · último comando: …". */
export function descreverConfigRemota(cfg, comandos, formatarHora) {
  const partes = [];
  if (!cfg || !cfg.recebidaEm) partes.push('Configuração do CRM: ainda não recebida (usa o padrão embutido).');
  else partes.push(`Configuração do CRM: ${cfg.config && cfg.config.versao ? `versão ${cfg.config.versao}` : 'padrão (sem versão)'}, atualizada ${formatarHora(cfg.recebidaEm)}.`);
  if (cfg && cfg.erro) partes.push(`Última busca falhou: ${cfg.erro}`);
  const u = comandos && comandos.ultimo;
  if (u) partes.push(`Último comando: ${u.tipo} (${formatarHora(u.em)}) — ${u.resultado}`);
  return partes.join('\n');
}

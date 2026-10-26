// 1.1.12 — diagnóstico remoto para o CRM (pedido do dono, 26/10: "estamos nesse vai e vem há muitos dias; encontre uma
// maneira de fazer e ir testando até dar certo"). A cada tentativa de seguir/DM (e nos testes a seco) a extensão manda ao
// CRM um RASTRO passo a passo + o ESQUELETO anonimizado da página (botões do perfil, caixa da DM, candidatos a botão
// Enviar, avisos de erro). Nunca vai: @ ou nome de pessoa, texto de mensagem, bio, URL com o @. Rota já existente
// POST /api/marketplace/diagnostic (chave pessoal mkp_… da extensão do Marketplace; tabela marketplace_diagnostics).
// Lógica pura (testada em tests/diagnostico.test.mjs); o envio recebe o `fetch` de quem chama.

export const CRM_URL_PADRAO = 'https://www.matheusmachadoimoveis.com.br';
export const CHAVE_CRM = 'crm'; // chrome.storage.local: { url, chave } — fora do estado (nunca no CSV/histórico)
export const CHAVE_ULTIMO_ENVIO = 'crmUltimoEnvio';
export const TIPOS_DIAGNOSTICO = ['ig_follow', 'ig_dm', 'ig_dryrun', 'ig_ping'];
const LIMITE_BYTES = 200_000; // o CRM aceita até 600 kB; folga grande

export function normalizarUrlCrm(valor) {
  const bruto = String(valor || '').trim() || CRM_URL_PADRAO;
  const url = new URL(/^https?:\/\//i.test(bruto) ? bruto : `https://${bruto}`);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('A URL do CRM precisa começar com https://');
  return url.origin;
}

const escaparRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Tira o @ da pessoa (e variações) de qualquer texto/objeto, recursivamente; corta textos longos. `usuarios`: lista de
 * @ a mascarar (o alvo; o dono não precisa).
 */
export function anonimizar(valor, usuarios = []) {
  const nomes = usuarios.map((u) => String(u || '').replace(/^@/, '').trim()).filter((u) => u.length >= 2);
  const re = nomes.length ? new RegExp(nomes.map(escaparRegex).join('|'), 'gi') : null;
  const texto = (s) => {
    let t = String(s);
    if (re) t = t.replace(re, 'perfil');
    return t.length > 400 ? `${t.slice(0, 400)}…` : t;
  };
  const passar = (v, prof = 0) => {
    if (prof > 12) return null;
    if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'string') return texto(v);
    if (Array.isArray(v)) return v.slice(0, 200).map((x) => passar(x, prof + 1));
    if (typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[texto(k)] = passar(x, prof + 1);
      return o;
    }
    return null;
  };
  return passar(valor);
}

/** Corpo do diagnóstico: { versao, acao, resultado, rastro, esqueleto, em } já anonimizado e dentro do limite. */
export function montarDiagnostico({ versao = '', acao, resultado = '', rastro = [], esqueleto = null, extra = null, usuarios = [], em = Date.now() }) {
  const corpo = anonimizar({ versao, acao, resultado, rastro, esqueleto, ...(extra ? { extra } : {}), em: new Date(em).toISOString() }, usuarios);
  if (JSON.stringify(corpo).length > LIMITE_BYTES) {
    corpo.esqueleto = { cortado: true, motivo: 'esqueleto grande demais' };
  }
  return corpo;
}

/** POST no CRM. Devolve { ok, id } ou lança Error com a mensagem do CRM (401 = chave errada). */
export async function enviarDiagnosticoCrm({ url, chave, versao = '' }, kind, payload, fetchImpl = globalThis.fetch) {
  if (!chave) throw new Error('sem chave do CRM (configure no painel)');
  if (!TIPOS_DIAGNOSTICO.includes(kind)) throw new Error(`tipo de diagnóstico desconhecido: ${kind}`);
  const resp = await fetchImpl(`${normalizarUrlCrm(url)}/api/marketplace/diagnostic`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json', ...(versao ? { 'X-Extension-Version': `instagram-seguidor ${versao}` } : {}) },
    body: JSON.stringify({ kind, payload }),
    cache: 'no-store',
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const motivo = resp.status === 401 ? 'chave do CRM recusada (confira a chave mkp_… em Cadastros › Marketplace)' : dados.error || `CRM respondeu ${resp.status}`;
    throw Object.assign(new Error(motivo), { status: resp.status });
  }
  return { ok: true, id: dados.id || null };
}

/** Texto do último envio para o painel. */
export function descreverUltimoEnvio(u) {
  if (!u) return 'Nenhum diagnóstico enviado ainda.';
  const quando = new Date(u.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return u.ok ? `Último diagnóstico (${u.kind}) enviado ao CRM em ${quando}.` : `Último diagnóstico (${u.kind}) NÃO enviado em ${quando}: ${u.erro}`;
}

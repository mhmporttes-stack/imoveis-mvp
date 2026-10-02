// Resposta à Prospecção pelo WhatsApp (pedido do dono, 2026-10-02) — regras
// PURAS, testadas em tests/prospecting-reply-core.test.mjs. A gravação fica
// em lib/prospecting-reply.js.
//
// Decisão por mensagem RECEBIDA (nunca por mensagem do próprio corretor):
//  - cliente em Prospecção + pedido CLARO para parar -> "Não contactar" automático;
//  - cliente em Prospecção + qualquer outra coisa   -> ALERT_REPLY: o cliente
//    passa sozinho para "Em atendimento" (regra do dono, 2026-10-02); só sem
//    corretor responsável vira a pendência "Cliente respondeu — atualizar
//    status" (rede de segurança, o corretor decide);
//  - cliente em "Não contactar" + mensagem nova     -> pendência de possível
//    reativação (nunca reativa sozinho);
//  - qualquer outro caso                            -> nada (só o Chat).
// Na dúvida sobre a intenção, NUNCA marca "Não contactar": vai para o humano.

export const REPLY_ACTION = {
  IGNORE: "ignore",
  ALERT_REPLY: "alert_reply",
  OPT_OUT: "opt_out",
  ALERT_REACTIVATION: "alert_reactivation"
};

export const ALERT_KIND = { REPLY: "reply", REACTIVATION: "reactivation" };

// Status do cadastro (simulation_registrations.status) — strings iguais às
// de lib/client-status.js, repetidas aqui para o módulo continuar puro.
const AWAITING_RETURN = "awaiting_return";
const DO_NOT_CONTACT = "do_not_contact";

export function normalizeReplyText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Cortesias que podem acompanhar um pedido de parar sem mudar a intenção
// ("parar, obrigado", "não tenho interesse, boa tarde").
const POLITE_WORDS = new Set(["obrigado", "obrigada", "obg", "brigado", "brigada", "grato", "grata", "valeu", "vlw", "ok", "okay", "tchau", "ate", "mais", "por", "favor", "pf", "pfv", "pfvr", "bom", "boa", "dia", "tarde", "noite", "moca", "moco", "senhor", "senhora", "sr", "sra", "amigo", "amiga", "querida", "querido", "ta", "tá", "certo", "beleza", "blz"]);

// Frases inequívocas (texto normalizado). A mensagem INTEIRA, tirando as
// cortesias acima, precisa ser uma delas — frase com qualquer outro conteúdo
// ("não quero esse, tem outro?") vai para o humano.
const OPT_OUT_PATTERNS = [
  /^(pode )?(parar|pare|para de mandar|para de me mandar)( de mandar( mensagens?)?)?( por favor)?$/,
  /^(pode )?parar( com (as )?mensagens?)?$/,
  /^pare (de )?(me )?(mandar|enviar) (mais )?mensage(m|ns)$/,
  /^para de (me )?(mandar|enviar) (mais )?mensage(m|ns)$/,
  /^(sair|cancelar|descadastrar|descadastro|remover|stop)$/,
  /^nao quero( mais)?$/,
  /^nao (tenho|tem) (mais )?interesse$/,
  /^(estou |to |tou )?sem interesse$/,
  /^nao (estou|to|tou) interessad[oa]$/,
  /^nao me (chame|chama|chamem|ligue|liga|liguem|procure|procura)( mais)?$/,
  /^nao (me )?(mande|manda|mandem|envie|envia|enviem) (mais )?(nenhuma )?mensage(m|ns)( pra mim| para mim)?$/,
  /^nao (me )?(mande|manda|mandem|envie|envia|enviem) mais nada$/,
  /^nao (entre|entra|entrem) (mais )?em contato( comigo)?$/,
  /^nao quero (mais )?(receber )?(mensage(m|ns)|contato)$/,
  /^nao quero (mais )?que (me )?(mande|mandem|envie|enviem|chame|chamem|entre|entrem)( mais)?( mensage(m|ns)| em contato)?$/,
  /^(remova|remove|removam|tira|tire|tirem|exclua|exclui|apague|apaga) (o )?meu (contato|numero|telefone)( da (sua )?lista)?$/,
  /^(me )?(remova|remove|removam|tira|tire|tirem|exclua|exclui) (da|dessa|desta) lista$/,
  /^me (remova|remove|removam|tira|tire|tirem|exclua|exclui)( da (sua )?lista)?$/
];

// Qualquer um destes deixa a intenção ambígua ("agora não", "não tenho
// interesse no momento", "me chama depois") -> humano.
const AMBIGUITY_MARKERS = /\b(agora|momento|enquanto|depois|amanha|semana|mes|ano|tarde demais|hoje|ainda|talvez|pensar|outro|outra|valor|preco|quanto|como)\b/;

export function isClearOptOut(text) {
  const normalized = normalizeReplyText(text);
  if (!normalized) return false;
  if (normalized.split(" ").length > 14) return false;
  // "não tenho interesse agora" / "me chama depois" etc. nunca é opt-out automático.
  if (AMBIGUITY_MARKERS.test(normalized)) return false;
  const core = stripPolite(normalized);
  if (!core) return false;
  return OPT_OUT_PATTERNS.some((pattern) => pattern.test(core));
}

function stripPolite(normalized) {
  // Remove cortesias só nas pontas ("parar obrigado", "boa tarde nao quero").
  const words = normalized.split(" ");
  while (words.length && POLITE_WORDS.has(words[0])) words.shift();
  while (words.length && POLITE_WORDS.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

const ATTEMPT_CLOCK_SLACK_MS = 2 * 60 * 1000;

// Cliente "em Prospecção" = cadastro em "Tentando contato" (status de quem
// está na cadência) com pelo menos uma tentativa de prospecção já feita
// ANTES desta mensagem (contato da fila com last_attempt_at). A comparação
// de horário também impede que um evento antigo reentregue (replay/reconexão)
// vire um alerta falso sobre uma prospecção mais nova.
export function isInProspecting({ clientStatus, contacts = [], messageAt }) {
  if (clientStatus !== AWAITING_RETURN) return false;
  const messageMs = new Date(messageAt || "").getTime();
  return contacts.some((contact) => {
    if (!contact || contact.status === DO_NOT_CONTACT || !contact.last_attempt_at) return false;
    const attemptMs = new Date(contact.last_attempt_at).getTime();
    if (Number.isNaN(attemptMs)) return false;
    return Number.isNaN(messageMs) || messageMs >= attemptMs - ATTEMPT_CLOCK_SLACK_MS;
  });
}

// { fromMe, clientStatus, contacts, messageAt, text } -> REPLY_ACTION
export function decideProspectingReplyAction({ fromMe = false, clientId = "", clientStatus = "", contacts = [], messageAt = "", text = "" }) {
  if (fromMe || !clientId) return REPLY_ACTION.IGNORE;
  const optOut = isClearOptOut(text);
  if (clientStatus === DO_NOT_CONTACT) return optOut ? REPLY_ACTION.IGNORE : REPLY_ACTION.ALERT_REACTIVATION;
  if (!isInProspecting({ clientStatus, contacts, messageAt })) return REPLY_ACTION.IGNORE;
  return optOut ? REPLY_ACTION.OPT_OUT : REPLY_ACTION.ALERT_REPLY;
}

// Pendência aberta só faz sentido enquanto o cliente continua na situação
// que a criou: "respondeu" enquanto segue em "Tentando contato"; reativação
// enquanto segue em "Não contactar". Se o corretor mudou o status por outro
// caminho (ficha do cliente), a pendência se resolve sozinha.
export function isAlertStillValid(kind, clientStatus) {
  if (kind === ALERT_KIND.REPLY) return clientStatus === AWAITING_RETURN;
  if (kind === ALERT_KIND.REACTIVATION) return clientStatus === DO_NOT_CONTACT;
  return false;
}

// Quem recebe a pendência: o responsável atual do cliente; sem responsável,
// o corretor do contato da fila; por último, o dono da sessão de WhatsApp que
// recebeu a mensagem (foi pelo número dele que a prospecção saiu).
export function pickAlertBroker({ responsibleUserId = "", contacts = [], sessionUserId = "" }) {
  return responsibleUserId
    || contacts.find((contact) => contact?.assigned_user_id)?.assigned_user_id
    || contacts.find((contact) => contact?.last_broker_id)?.last_broker_id
    || sessionUserId
    || null;
}

export function replyPreview(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 140);
}

// Os dois consumidores do evento de mensagem (Prospecção e Chat) rodam de
// forma INDEPENDENTE: a falha de um nunca impede o outro (pedido do dono).
// consumers: { name: () => Promise } -> { name: { ok, value?, error? } }
export async function runIndependentConsumers(consumers) {
  const names = Object.keys(consumers);
  const settled = await Promise.allSettled(names.map((name) => Promise.resolve().then(() => consumers[name]())));
  return Object.fromEntries(names.map((name, index) => {
    const result = settled[index];
    return [name, result.status === "fulfilled" ? { ok: true, value: result.value } : { ok: false, error: result.reason }];
  }));
}

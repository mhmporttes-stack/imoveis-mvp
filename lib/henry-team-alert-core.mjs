// Henry manda recado para alguém da equipe (HENRY-1 "Recado à equipe", REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-25):
// "Quero que o Henry também possa enviar alertas (mensagens fixadas na tela dos corretores). Eu digo 'Henry, peça para a
// Carol vir até a minha sala', ele escreve e envia aquela mesma mensagem que eu envio pela Meta Diária." + "Sem sim, ele
// apenas envia, não preciso confirmar nada."
// Regras PURAS (sem banco, sem rede). Servidor: lib/henry-team-alert.js. Testes: tests/henry-team-alert.test.mjs.
//
// - O envio é a MESMA mensagem da Supervisão (sendSupervisionMessage, lib/supervision-messages.js — balão central na tela
//   do corretor que só sai com OK/resposta + push). Nenhum outro caminho.
// - Destinatário = pessoa ATIVA da equipe (admin_users: corretor, associado, gestor, outro admin), nunca o próprio dono,
//   nunca cliente. Ambíguo → pergunta qual (não envia); inexistente → diz (não envia).
// - Diferente do aniversariante (que segue com confirmação na tela): aqui o Henry ENVIA direto, sem "sim".
// - Treino (sandbox): nunca envia — simula.

import { brokerKeys, normalizeName } from "./alexa-v2/brokers.mjs";
import { firstName as safeFirstName } from "./alexa-config-core.mjs";

export const TEAM_ALERT_TEXT_MAX = 500; // recado curto (a Supervisão aceita até 2000)
export const TEAM_ALERT_OPTIONS_MAX = 4;
const ACTIVE = "active";
const ARTICLE = /^(?:(?:pra|para|pro|ao|o|a|os|as)\s+)+/;

// "peça/pede/chama/avisa a Carol que…", "manda um recado pro Gabriel", "fala pra Bruna vir aqui": pedido de recado.
const TEAM_ALERT_VERB = /\b(peca|pede|pedir|peça|chama|chame|chamar|avisa|avise|avisar|manda (?:um |uma )?(?:recado|aviso|alerta|mensagem)|mande (?:um |uma )?(?:recado|aviso|alerta|mensagem)|envia (?:um |uma )?(?:recado|aviso|alerta|mensagem)|envie (?:um |uma )?(?:recado|aviso|alerta|mensagem)|(?:da|de|deixa|deixe) (?:um )?recado|fala|diz|diga)\b/;
const TEAM_ALERT_TARGET = /^(?:(?:para|pra|pro|ao|a|o)\s+)+\p{L}{2,}/u;
// Palavra depois do artigo que não é gente ("chama a atenção", "avisa o cliente").
const TEAM_ALERT_NOT_PERSON = /^(atencao|gente|cliente|clientes|equipe|time|pessoal|mim|nos|todos|todo|quando|se|que|musica|tela|ranking|meta|funil)$/;
export function isTeamAlertRequest(text) {
  const value = String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\b(henry|henri)\b/g, " ").replace(/[^\p{L}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (!value) return false;
  const verb = value.match(TEAM_ALERT_VERB);
  if (!verb) return false;
  // "fala/diz" sozinhos são comuns ("me fala o ranking"): só contam com "pra/para <nome>" logo depois.
  const rest = value.slice(verb.index + verb[0].length).trim();
  if (/^(fala|diz|diga)$/.test(verb[0])) return /^(?:pra|para|pro|ao) \p{L}{2,}/u.test(rest) && !/^(?:pra|para) (?:mim|me|nos|voce|gente)\b/.test(rest);
  if (/^(?:me|pra mim|para mim)\b/.test(rest)) return false;
  const target = rest.match(TEAM_ALERT_TARGET);
  return Boolean(target) && target.index === 0 && !TEAM_ALERT_NOT_PERSON.test(target[0].split(" ").pop());
}

// Texto do recado: sem espaços sobrando, uma linha, com ponto final, no máximo TEAM_ALERT_TEXT_MAX. Vazio → "".
export function normalizeTeamAlertText(value) {
  let text = String(value ?? "").replace(/\s+/g, " ").trim().replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if (!text) return "";
  if (text.length > TEAM_ALERT_TEXT_MAX) text = `${text.slice(0, TEAM_ALERT_TEXT_MAX - 1).trim()}…`;
  if (!/[.!?…]$/.test(text)) text = `${text}.`;
  return text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1);
}

// users = [{ id, name, gender, status }] de admin_users. Só ativos e nunca o dono.
export function teamAlertCandidates(users = [], { ownerId = "" } = {}) {
  return (users || []).filter((user) => user?.id && user.id !== ownerId && user.status === ACTIVE && String(user.name || "").trim());
}

// Quem é o destinatário falado. Chaves de nome = as mesmas do reconhecimento de corretor da Alexa (brokerKeys: primeiro
// nome, nome completo, primeiro+último, apelidos). Diferente do matcher da Alexa, ambíguo devolve as opções para perguntar.
// → { kind: "one", user } | { kind: "many", options: [user] } | { kind: "none" }
export function resolveTeamAlertRecipient(spoken, users = [], { ownerId = "" } = {}) {
  const value = normalizeName(spoken).replace(ARTICLE, "").trim();
  if (!value) return { kind: "none" };
  const entries = teamAlertCandidates(users, { ownerId }).map((user) => ({ user, keys: brokerKeys({ name: user.name, fullName: user.name }) }));
  const exact = entries.filter((entry) => entry.keys.includes(value));
  const found = exact.length ? exact : value.length < 2 ? [] : entries.filter((entry) => entry.keys.some((key) => key.startsWith(value) || value.startsWith(`${key} `)));
  if (found.length === 1) return { kind: "one", user: found[0].user };
  if (found.length > 1) return { kind: "many", options: found.slice(0, TEAM_ALERT_OPTIONS_MAX).map((entry) => entry.user) };
  return { kind: "none" };
}

// "a Carol" / "o Gabriel" / "Kim" (gênero do cadastro; sem gênero = só o nome).
export function teamAlertRecipientLabel(user) {
  const first = safeFirstName(user?.name) || String(user?.name || "").trim() || "a pessoa";
  return user?.gender === "female" ? `a ${first}` : user?.gender === "male" ? `o ${first}` : first;
}

// Fala depois do envio (dono: "Enviei para a Carol: '<texto>'."). training = Treino: nada saiu de verdade.
export function teamAlertSentReply(user, text, { training = false } = {}) {
  const who = teamAlertRecipientLabel(user);
  if (training) return `Modo treino: nada foi enviado. Mandaria para ${who}: "${text}"`;
  return `Enviei para ${who}: "${text}"`;
}

// Opções ditas quando o nome é ambíguo ("a Carol Souza ou a Carolina Lima?").
export function teamAlertAskReply(options = []) {
  const names = options.map((user) => {
    const label = String(user?.name || "").trim().split(/\s+/).slice(0, 2).join(" ");
    return user?.gender === "female" ? `a ${label}` : user?.gender === "male" ? `o ${label}` : label;
  });
  const list = names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} ou ${names[names.length - 1]}`;
  return `Tenho mais de uma pessoa com esse nome: ${list}. Pra quem eu mando?`;
}

export function teamAlertNotFoundReply(spoken) {
  const name = String(spoken || "").trim().slice(0, 40);
  return name ? `Não achei ninguém ativo na equipe com o nome ${name}.` : "Pra quem eu mando o recado?";
}

// Tela depois do envio (só informativa: o recado já saiu).
export function teamAlertSentDetail(user, text, { training = false } = {}) {
  return {
    title: training ? "Recado (treino — não enviado)" : "Recado enviado",
    subtitle: training ? "Modo treino: nada saiu de verdade" : `Para ${String(user?.name || "").trim()} · fica na tela até a pessoa responder`,
    sections: [{ title: "Recado", rows: [{ label: text, value: "" }] }]
  };
}

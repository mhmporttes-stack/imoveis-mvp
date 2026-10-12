// "Pare" no número OFICIAL (B12 — regra do dono, 2026-10-12, decisão 3 da Mesa do robô do Chat): quem pede com clareza
// para parar recebe UMA frase de confirmação e vira "Não contactar" sozinho, antes de ir para a roleta, de passar pelo
// Fluxo ou de receber a resposta fora do horário. PURO, testado em tests/whatsapp-official-opt-out.test.mjs; a leitura
// e a gravação ficam em processOfficialOptOuts (lib/prospecting-reply.js), chamado pelo webhook (lib/whatsapp-master.js).
//
// "Pedido claro" = a MESMA regra da resposta à Prospecção (isClearOptOut, PRO-8 opção B): na dúvida, NÃO marca — vai
// para a pessoa.

import { isClearOptOut } from "./prospecting-reply-core.mjs";
import { usableFirstName } from "./whatsapp-form-reminder-core.mjs";

export const OFFICIAL_OPT_OUT_KIND = "opt_out_reply";

// Texto B12 do dossiê (com e sem nome).
export function buildOfficialOptOutText(fullName) {
  const first = usableFirstName(fullName);
  return `Tudo bem${first ? `, ${first}` : ""}. Não vamos mais te mandar mensagens. Se um dia quiser conversar, é só chamar aqui.`;
}

// Só texto digitado (toque em botão, áudio, reação etc. nunca são "pare").
export function isOfficialOptOutCandidate(messageType, text) {
  return String(messageType || "") === "text" && isClearOptOut(text);
}

// Entrada (já lida do banco):
//  messageType, text        a mensagem recebida
//  isTeamPhone              número de integrante da equipe (WA-12)
//  conversation             { private_at, last_human_reply_at } da conversa do número oficial | null
//  client                   { id, status } (cliente da conversa ou o cadastro mais recente do telefone) | null
//  doNotContactReason       motivo de bloqueio já existente no telefone (findDoNotContactInboundBlock) | null
// Resultado: { apply, sendText, reason }.
//  - Sem cliente: nada a marcar (fica com a pessoa).
//  - Uma pessoa da equipe já respondeu nesta conversa: quem decide é a pessoa (Guia: "Pediu para não receber mensagens").
//  - Telefone já bloqueado por outro cadastro/fila: marca este cadastro também, mas não manda a frase (regra 9).
export function decideOfficialOptOut({ messageType = "text", text = "", isTeamPhone = false, conversation = null, client = null, doNotContactReason = null } = {}) {
  const no = (reason) => ({ apply: false, sendText: false, reason });
  if (!isOfficialOptOutCandidate(messageType, text)) return no("nao_e_pedido_claro");
  if (isTeamPhone) return no("numero_da_equipe");
  if (!conversation) return no("sem_conversa");
  if (conversation.private_at) return no("conversa_particular");
  if (!client?.id) return no("sem_cliente");
  if (client.status === "archived") return no("cliente_arquivado");
  if (client.status === "do_not_contact") return no("ja_nao_contactar");
  if (conversation.last_human_reply_at) return no("pessoa_ja_atendeu");
  return { apply: true, sendText: !doNotContactReason, reason: "pedido_claro" };
}

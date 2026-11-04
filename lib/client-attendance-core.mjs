// "Último atendimento" do cliente — regra PURA (testes: tests/client-attendance-core.test.mjs). Servidor:
// lib/client-attendance.js.
//
// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-16] "Se o corretor muda o status do cliente de aguardando documentação para
// aguardando aprovação, automaticamente o cliente recebeu atendimento hoje, então zera os 3 dias novamente. Verifique
// tudo que indica atendimento ou contato com o cliente e já aplique essa nova regra." E: "o último contato com o
// cliente deve atualizar conforme o chat".
//
// Os "3 dias sem contato" (Clientes pendentes, alerta "Sem contato há +3 dias", pendentes da Meta Diária, casos novos
// de "cliente que esfriou") contam a partir do MAIOR entre: o contato gravado no cliente (last_whatsapp_contact_at —
// mensagem enviada pelo responsável/associado, tentativa da Meta Diária, clique no WhatsApp, Prospecção), o cadastro e
// o ÚLTIMO ATENDIMENTO calculado aqui a partir dos registros que já existem (nada novo é gravado):
//  - mudança de status feita por uma PESSOA (client_status_history, qualquer direção; automáticas do sistema fora);
//  - mensagem RECEBIDA do cliente no Chat (whatsapp_conversations.last_inbound_at, conversa do lado do responsável);
//  - atividade/agenda criada por uma pessoa ou concluída (calendar_activities; conclusão da atividade antiga do card);
//  - simulação criada por uma pessoa da equipe (simulations.created_by = e-mail);
//  - ações da pessoa na linha do tempo (client_journey_events): etiqueta marcada/desmarcada, dados/observações
//    editados, atividade agendada/concluída/reagendada, documentos enviados, envio à CCA, lista de documentos e
//    apresentação da simulação enviadas;
//  - conversa no Chat do Marketplace ligada ao cliente: mensagem do cliente e saída humana nossa (enviada ou na fila),
//    inclusive escrita direto no Facebook, só depois da entrega da conversa (assigned_at) — marketplaceReplyTimes abaixo
//    (REGRA OFICIAL, dono, 2026-10-22 MKT-2h; ampliada pelo dono em 2026-11-04).
// last_whatsapp_contact_at NÃO é regravado: ele também decide a redistribuição da roleta (ROL-4), o prazo da
// simulação e o crédito da Meta Diária — por isso o último atendimento é um sinal de LEITURA, usado só nos 3 dias.

export const NO_CONTACT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

// Mudanças de status gravadas sem pessoa (ou por regra automática) não são atendimento.
export const AUTOMATIC_STATUS_SOURCES = Object.freeze([
  "system", // updateSimulationRegistration sem usuário (automação/cron)
  "automatico_por_venda", // marco de Reunião criado sozinho antes da Venda
  "whatsapp_opt_out", // cliente pediu SAIR (Não contactar automático)
  "whatsapp_auto_opt_out",
  "whatsapp-official-opt-out",
  "transfer_auto" // transferido vai para "Tentando contato" (TRANSFER_STATUS_SOURCE, lib/transfer-status-core.mjs)
]);

// Eventos da linha do tempo que são ação de uma pessoa da equipe COM o cliente (status fica no histórico de status).
// Fora de propósito: transferência/roleta/CCA reatribuída (administrativo), exclusões, análise de IA, eventos do fluxo
// de clientes esfriados, eventos do próprio cliente (formulário, agendamento pelo link) e do sistema.
export const ATTENDANCE_JOURNEY_EVENTS = Object.freeze([
  "tag_added",
  "tag_removed",
  "data_updated",
  "activity_scheduled",
  "activity_completed",
  "activity_rescheduled",
  "document_batch_uploaded",
  "document_sent_to_cca",
  "documents_list_sent",
  "presentation_sent"
]);

function isPersonEmail(value) {
  const text = String(value || "").trim().toLowerCase();
  return text.includes("@") && !text.startsWith("sistema");
}

export function isPersonStatusChange(row) {
  if (!row || !isPersonEmail(row.changed_by)) return false;
  return !AUTOMATIC_STATUS_SOURCES.includes(String(row.source || ""));
}

export function isPersonJourneyEvent(row) {
  if (!row || !ATTENDANCE_JOURNEY_EVENTS.includes(row.event_type)) return false;
  if (String(row.actor_role || "") === "automacao") return false;
  return isPersonEmail(row.actor);
}

export function isPersonSimulation(row) {
  return Boolean(row) && isPersonEmail(row.created_by);
}

function timeOf(value) {
  const at = Date.parse(value || "");
  return Number.isFinite(at) ? at : null;
}

// Junta (clientId, instante) num Map com o mais recente por cliente, só dentro da janela [since, until].
export function collectLatest(map, clientId, value, { sinceMs = -Infinity, untilMs = Infinity } = {}) {
  const at = timeOf(value);
  if (!clientId || at === null || at < sinceMs || at > untilMs) return map;
  const current = timeOf(map.get(clientId));
  if (current === null || at > current) map.set(clientId, new Date(at).toISOString());
  return map;
}

// Instante de referência dos 3 dias: o maior entre o contato gravado (ou o cadastro) e o último atendimento.
export function attendanceReferenceAt({ lastWhatsappContactAt, createdAt, lastAttendanceAt } = {}) {
  const base = timeOf(lastWhatsappContactAt || createdAt);
  const attendance = timeOf(lastAttendanceAt);
  if (base === null) return attendance;
  if (attendance === null) return base;
  return Math.max(base, attendance);
}

// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-22, MKT-2h] "Saída fora do CRM conta no relógio de 3 dias" (Mesa "Chat do
// Marketplace + WhatsApp", "5 sim"). Instantes das mensagens de SAÍDA efetivamente enviadas (status `sent`, pelo CRM ou
// vistas no Facebook) de UMA conversa do Marketplace que contam como atendimento: depois do `assigned_at` da conversa E
// respondendo ao cliente (houve mensagem dele depois da nossa saída anterior). Saídas seguidas sem mensagem do cliente no
// meio não contam (não dá para "manter vivo" um lead mudo). Só sinal de LEITURA dos 3 dias: não grava, não muda etapa,
// não credita, não pontua, não mexe na roleta e NÃO entra na baixa da pendência do dia (evaluateDailyGoalPending).
//
// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-11-04, substitui o "só respondendo ao cliente" da MKT-2h] "Cliente do Marketplace e
// as conversas que estão acontecendo pelo Marketplace devem contar também. Se um corretor está conversando só pelo
// Marketplace, o card não pode estar com alerta de mais de 3 dias sem contato." Passa a contar, depois do `assigned_at`:
// a mensagem do CLIENTE (como no WhatsApp, onde a mensagem recebida conta) e a saída humana do corretor — enviada ou ainda
// na fila de envio da extensão (escrita por pessoa; `failed` não conta). Continuam fora: resposta automática (auto_kind) e
// nota interna (direção própria). Antes da entrega da conversa nada conta.
export function marketplaceReplyTimes(conversation, messages = []) {
  const assignedAt = timeOf(conversation?.assigned_at);
  if (assignedAt === null) return [];
  const result = [];
  for (const message of messages) {
    // Resposta automática de disponibilidade (MKT-2l, auto_kind) não é atendimento.
    if (message.auto_kind) continue;
    const countsInbound = message.direction === "inbound";
    const countsOutbound = message.direction === "outbound" && ["sent", "queued"].includes(message.status);
    if (!countsInbound && !countsOutbound) continue;
    const at = timeOf(message.message_at);
    if (at !== null && at > assignedAt) result.push(new Date(at).toISOString());
  }
  return result.sort();
}

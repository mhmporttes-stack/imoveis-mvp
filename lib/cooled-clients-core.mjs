// Fluxo de clientes que esfriaram (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-16). Regras PURAS
// (testes: tests/cooled-clients-core.test.mjs). Servidor: lib/cooled-clients.js.
//
// Gatilho = o mesmo dos pendentes da Meta Diária (isDailyGoalPendingCandidate: etapa ativa + isClientAwaitingAction,
// mais de 3 dias sem contato e sem atividade futura). Passo 1: o corretor responsável escreve o motivo (janela
// obrigatória da Central de Alertas). Passo 2: a decisora (gestora da equipe; dono para clientes da própria gestora
// ou de corretor sem gestora) transfere pela roleta, aplica um status negativo ou devolve UMA vez.

import { CLIENT_FUNNEL_STAGES, CLIENT_STATUS, NEGATIVE_CLIENT_STATUS_VALUES, getClientFunnelStage, normalizeClientStatus } from "./client-status.js";
import { isDailyGoalPendingCandidate } from "./daily-goal-progress.mjs";

export const COOLED_FLOW_SETTING_ID = "cooled_clients_flow";
export const COOLED_REASON_MIN_LENGTH = 15;
export const COOLED_REASON_MAX_LENGTH = 1000;
export const COOLED_QUESTION = "Conte o motivo do desinteresse, desistência ou falta de resposta deste cliente.";
export const COOLED_REASON_REQUIRED_MESSAGE = `Escreva o motivo com pelo menos ${COOLED_REASON_MIN_LENGTH} letras.`;
export const COOLED_RETURN_REQUIRED_MESSAGE = `Escreva o que faltou com pelo menos ${COOLED_REASON_MIN_LENGTH} letras.`;
export const COOLED_DEDUPE_PREFIX = "cooled_client:";
export const COOLED_ALERT_TYPE = "cooled_client";
// REGRA OFICIAL (dono, 2026-10-16): "Os clientes transferidos para novos corretores devem receber uma tag informando o
// recebimento desse novo cliente transferido." Tag do sistema de etiquetas (tags/client_tags), criada uma vez, cor da
// paleta padrão (roxo). Fica no cliente depois da transferência (retirada manual, como qualquer etiqueta).
export const COOLED_TRANSFER_TAG = Object.freeze({ name: "Cliente transferido", color: "#7C3AED" });

// REGRA OFICIAL (dono, 2026-10-16): "sugira antes do corretor escrever essa mensagem 'cliente não me respondeu mais';
// quando essa opção for selecionada como motivo, o cliente vai para a roleta direto, sem passar por aprovação da Carol
// ou minha." Opção pronta da janela do motivo (antes do texto livre). Escolhida, o caso NÃO vai para a decisora: fecha
// como "transferred" (decided_by vazio = automático) e o servidor transfere com o mesmo efeito do "Transferir".
export const COOLED_NO_RESPONSE_REASON = Object.freeze({ key: "no_response", label: "Cliente não respondeu mais" });

export function isNoResponseQuickReason(value) {
  return value === COOLED_NO_RESPONSE_REASON.key;
}

// [REGRA OFICIAL — dono, 2026-10-16] "os que estiverem escrito algo que dê a entender que o cliente não respondeu mais
// pode tratar como se estivessem com o botão selecionado." Ajuste do mesmo dia: "os que pararam de responder, você pode
// jogar direto para a roleta junto." Classificador DETERMINÍSTICO (sem IA) do motivo livre: vale para motivo digitado
// daqui para frente (answerCooledCase) e para os casos que já aguardam a decisora (runCooledClientsFlow).
// Transfere quando: (1) o texto diz que o cliente não responde/parou de responder/sem resposta/falta de resposta;
// (2) DEPOIS da última menção a isso não vem ressalva ("mas", "porém"…) — o texto TERMINA dizendo que não respondeu
// ("Ficou de enviar a documentação, mas parou de responder" transfere; "não responde, mas vou ligar amanhã" não);
// (3) nenhum bloqueio: restrição/renda/reprovado, cliente respondendo ou que escreveu hoje, pedido para não tirar,
// "já passei para…", desinteresse/desistência/já comprou, número/pessoa errada, bloqueio, falecimento.
// Documentação pendente, simulação enviada, interesse anterior e "era de outro corretor" NÃO bloqueiam.
// Texto comparado sem acento, minúsculo, pontuação como espaço e letras repetidas reduzidas ("rresponde" = "responde").
// Os padrões são texto de regex com \b (no SQL de conferência, o Postgres usa \y no lugar); já vêm com letras repetidas
// reduzidas, igual ao texto.
export const NO_RESPONSE_MAX_LENGTH = 200;
// `(?<!\\)`: não junta o "b" de \b com a letra seguinte do padrão ("\bbloque").
const collapseRepeats = (value) => value.replace(/(?<!\\)([a-z])\1+/g, "$1");
export const NO_RESPONSE_POSITIVE_PATTERNS = Object.freeze([
  "\\bnao (?:me |nos |mais |esta |estava |ta )*(?:responde|respondeu|responderam|respondia|respondendo|retorna|retornou|retornava|retornando|atende|atendeu|atendia|atendendo)\\b",
  "\\bnao (?:me |nos )?(?:da|deu|dar) (?:mais )?retorno\\b",
  "\\bnunca (?:me |nos |mais )*(?:respondeu|retornou|atendeu|responde|retorna)\\b",
  "\\bsem (?:nenhuma |qualquer )?(?:resposta|retorno)\\b",
  "\\bfalta de (?:resposta|retorno)\\b",
  "\\bparou de (?:me |nos )?(?:responder|retornar|atender|falar)\\b",
  "\\bsumiu\\b",
  "\\bvacuo\\b"
].map(collapseRepeats));
// Ressalva DEPOIS da última menção a "não respondeu": o texto não termina nisso → fica com a decisora.
export const NO_RESPONSE_CONTRAST_PATTERN = "\\b(?:mas|porem|entretanto|contudo|so que|apesar|todavia)\\b";
export const NO_RESPONSE_BLOCK_PATTERNS = Object.freeze([
  // crédito / desfecho que é decisão de status, não de roleta
  "\\brestri",
  "\\bnome sujo\\b",
  "\\brenda\\b",
  "\\breprov",
  "\\b(?:nao tem|sem|perdeu o|nenhum) interesse\\b",
  "\\bdesist",
  "\\b(?:ja comprou|comprou com|comprou em outr|fechou com)\\b",
  // cliente respondendo / escreveu
  "(?<!nao )\\b(?:esta|ta) respondendo\\b",
  "\\b(?:ja|voltou a|chegou a) (?:respond|retorn|atend)",
  "\\b(?:respondeu|retornou|atendeu) (?:hoje|ontem|agora|que|dizendo|falando)\\b",
  "\\b(?:me mandou|mandou mensagem|me chamou|me escreveu|escreveu hoje)\\b",
  // pedido do corretor / já encaminhado
  "\\bnao (?:tira|tire|retira|retire|remova|transfira|passa)\\b",
  "\\bdeixa comigo\\b",
  "\\bpassei (?:para|pra|pro|a)\\b",
  // contato inválido / outros desfechos
  "\\bnumero (?:errado|invalido|inexistente|nao existe)\\b",
  "\\bbloque",
  "\\bpessoa errada\\b",
  "\\bnao (?:e|sou) (?:o|a|ele|ela|eu)\\b",
  "\\bfalec"
].map(collapseRepeats));
const NO_RESPONSE_POSITIVE = NO_RESPONSE_POSITIVE_PATTERNS.map((source) => new RegExp(source));
const NO_RESPONSE_TAIL = new RegExp(`^.*(?:${NO_RESPONSE_POSITIVE_PATTERNS.join("|")})(.*)$`);
const NO_RESPONSE_CONTRAST = new RegExp(NO_RESPONSE_CONTRAST_PATTERN);
const NO_RESPONSE_BLOCK = NO_RESPONSE_BLOCK_PATTERNS.map((source) => new RegExp(source));

export function normalizeReasonForMatch(text) {
  const plain = String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return collapseRepeats(plain);
}

export function isNoResponseReasonText(text) {
  const normalized = normalizeReasonForMatch(text);
  if (!normalized || normalized.length > NO_RESPONSE_MAX_LENGTH) return false;
  // Restrição citada no motivo nunca vai para a roleta (FUN-15k): o caso é encerrado como restrição.
  if (isRestrictionReasonText(text)) return false;
  if (normalized === normalizeReasonForMatch(COOLED_NO_RESPONSE_REASON.label)) return true;
  if (!NO_RESPONSE_POSITIVE.some((pattern) => pattern.test(normalized))) return false;
  if (NO_RESPONSE_BLOCK.some((pattern) => pattern.test(normalized))) return false;
  const tail = normalized.match(NO_RESPONSE_TAIL)?.[1] ?? "";
  return !NO_RESPONSE_CONTRAST.test(tail);
}

// [REGRA OFICIAL — dono, 2026-10-16, complemento da FUN-15j] Motivo que diz que o corretor NUNCA teve conversa com o
// cliente ("não tenho conversa/mensagens", "não tem nenhuma conversa", "nunca falei com", "cliente não era meu/minha")
// é tratado igual ao botão "Cliente não respondeu mais": transfere direto para a roleta, sem decisora (também os casos
// que já aguardam a decisora, pela rotina). Mesmas travas do "não respondeu mais": restrição, bloqueios (está
// respondendo, me mandou mensagem, não tira, já passei para…, desinteresse…), ressalva no fim e "aguardando…" ficam
// com a decisora. A transferência é marcada como COOLED_NO_CONVERSATION_KEY ("sem_conversa") para o relatório.
export const COOLED_NO_CONVERSATION_KEY = "sem_conversa";
export const COOLED_NO_RESPONSE_KEY = "nao_respondeu";
export const NO_CONVERSATION_POSITIVE_PATTERNS = Object.freeze([
  "\\bnao (?:tenho|tem|temos|tinha|possuo|ha) (?:nenhuma |nenhum |nada de |mais )?(?:conversa|conversas|mensagem|mensagens|historico)\\b",
  "\\bnunca (?:falei|conversei|falamos|conversamos|tive conversa|tive contato)\\b",
  "\\bnao (?:era|e) (?:meu|minha)\\b"
].map(collapseRepeats));
// Pendência em andamento ("aguardando documentação") não é "nunca teve conversa": fica com a decisora.
export const NO_CONVERSATION_BLOCK_PATTERNS = Object.freeze(["\\baguardando\\b"].map(collapseRepeats));
const NO_CONVERSATION_POSITIVE = NO_CONVERSATION_POSITIVE_PATTERNS.map((source) => new RegExp(source));
const NO_CONVERSATION_TAIL = new RegExp(`^.*(?:${NO_CONVERSATION_POSITIVE_PATTERNS.join("|")})(.*)$`);
const NO_CONVERSATION_BLOCK = [...NO_RESPONSE_BLOCK_PATTERNS, ...NO_CONVERSATION_BLOCK_PATTERNS].map((source) => new RegExp(source));

export function isNoConversationReasonText(text) {
  const normalized = normalizeReasonForMatch(text);
  if (!normalized || normalized.length > NO_RESPONSE_MAX_LENGTH) return false;
  if (isRestrictionReasonText(text)) return false;
  if (!NO_CONVERSATION_POSITIVE.some((pattern) => pattern.test(normalized))) return false;
  if (NO_CONVERSATION_BLOCK.some((pattern) => pattern.test(normalized))) return false;
  const tail = normalized.match(NO_CONVERSATION_TAIL)?.[1] ?? "";
  return !NO_RESPONSE_CONTRAST.test(tail);
}

// Motivo escrito que transfere direto (sem decisora). Devolve a marca da transferência ou "".
export function directTransferReasonKey(text) {
  if (isNoConversationReasonText(text)) return COOLED_NO_CONVERSATION_KEY;
  if (isNoResponseReasonText(text)) return COOLED_NO_RESPONSE_KEY;
  return "";
}

export function isDirectTransferReasonText(text) {
  return Boolean(directTransferReasonKey(text));
}

// [REGRA OFICIAL — dono, 2026-10-16, FUN-15k] "clientes com restrição, arquivados ou não contactar não entram nessa
// regra". Restrição de crédito no CRM = status "Restrição" (`restriction`) — é a única marcação estruturada (não há
// campo/etiqueta de análise de crédito). Além dele, o motivo ESCRITO pelo corretor que cite restrição ("restrição",
// "nome sujo", "negativado", "score") encerra o caso como restrição: não vai para a decisora nem para a roleta.
// Menção negada ("sem restrição", "não tem nome sujo", "não está negativado") não conta. Mesmo texto normalizado do
// classificador de "não respondeu mais" (sem acento, minúsculo, letras repetidas reduzidas).
export const COOLED_RESTRICTION_CANCEL_REASON = "cliente_com_restricao";
export const RESTRICTION_REASON_PATTERNS = Object.freeze([
  "\\brestri",
  "\\bnome sujo\\b",
  "\\bnegativad",
  "\\bscore\\b"
].map(collapseRepeats));
// Menção negada, retirada do texto antes de procurar a restrição.
export const RESTRICTION_NEGATION_PATTERN = collapseRepeats("\\b(?:sem|nenhuma|nao tem|nao possui|nao tinha|nao esta|nao estava|nao ta|nao e|nunca teve) (?:nenhuma |mais |o |a |de )?(?:restri[a-z]*|nome sujo|negativad[a-z]*)");
const RESTRICTION_REASON = RESTRICTION_REASON_PATTERNS.map((source) => new RegExp(source));
const RESTRICTION_NEGATION = new RegExp(RESTRICTION_NEGATION_PATTERN, "g");

// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24] Etiqueta "RESTRIÇÃO" no cliente também tira o cliente do fluxo do
// cliente frio (FUN-15 inteiro, inclusive a fila de reativação do FUN-15l), como o status Restrição e o motivo escrito.
// Nome normalizado exato (tags.normalized_name, mesma normalização de normalizeTagKey em lib/client-tags.js).
export const COOLED_RESTRICTION_TAG_KEY = "restricao";

export function isRestrictionReasonText(text) {
  const normalized = normalizeReasonForMatch(text).replace(RESTRICTION_NEGATION, " ");
  return Boolean(normalized.trim()) && RESTRICTION_REASON.some((pattern) => pattern.test(normalized));
}

export const CASE_STATUS = Object.freeze({
  AWAITING_REASON: "awaiting_reason",
  AWAITING_DECISION: "awaiting_decision",
  CLOSED: "closed",
  CANCELED: "canceled"
});
export const OPEN_CASE_STATUSES = [CASE_STATUS.AWAITING_REASON, CASE_STATUS.AWAITING_DECISION];

// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-17, FUN-15m] "Segunda chance": "Quando vier para gerente, ou da gerente
// para mim, ele deve ter uma opção de devolver o cliente a esse corretor. Pelo menos assim ele vai estar mais
// atencioso, como se fosse uma segunda chance para alguns casos." O cliente continua com o corretor do caso (sem
// roleta, sem fila de reativação, sem etiqueta "Cliente transferido"); o caso fecha com decision = 'second_chance' e
// os 3 dias recomeçam a partir da decisão (isCooledCandidate, `secondChanceAt`). Não confundir com "Devolver" (pede
// mais explicação ao corretor, uma vez).
export const COOLED_SECOND_CHANCE_DECISION = "second_chance";
export const COOLED_SECOND_CHANCE_DEDUPE_PREFIX = "cooled_second_chance:";

// Aviso ao corretor (Central de Alertas, Informativo — aparece na tela e no sino). Nada vai para o cliente.
export function buildSecondChanceAlertDelivery({ caseRow, clientName }) {
  const name = String(clientName || "").trim() || "Cliente";
  return {
    recipient_id: caseRow.broker_id,
    kind: "informative",
    title: `Segunda chance: ${name}`,
    body: `Segunda chance: ${name} continua com você — agende a próxima atividade.`,
    context: { type: "cooled_second_chance", case_id: caseRow.id, client_id: caseRow.client_id, client_name: name, link: "/admin/simulacoes" },
    dedupe_key: `${COOLED_SECOND_CHANCE_DEDUPE_PREFIX}${caseRow.id}`
  };
}

// Os 5 status negativos (Blindagem fica FORA). Também saem do gatilho: status negativo já é desfecho.
export const NEGATIVE_DECISION_STATUSES = [...NEGATIVE_CLIENT_STATUS_VALUES]; // fonte única: lib/client-status.js
export const NEGATIVE_DECISION_OPTIONS = [
  { status: CLIENT_STATUS.RESTRICTION, label: "Restrição" },
  { status: CLIENT_STATUS.REJECTED, label: "Reprovado" },
  { status: CLIENT_STATUS.INCOME_COMMITMENT, label: "Comprometimento de renda" },
  { status: CLIENT_STATUS.ARCHIVED, label: "Arquivado" },
  { status: CLIENT_STATUS.DO_NOT_CONTACT, label: "Não contactar" }
];

// REGRA OFICIAL (dono, 2026-10-16, FUN-15e): "Clientes aprovados não devem entrar nessa lista de transferência."
// "Aprovado" = macroetapa "Cliente aprovado" do funil (CLIENT_FUNNEL_STAGES, status `approved`) e as etapas que vêm
// depois dela (Reunião e Venda), que pressupõem crédito aprovado. Fonte única das etapas: lib/client-status.js.
export const COOLED_APPROVED_FUNNEL_STAGES = Object.freeze(["approved", "meeting", "sale"]);

export function isApprovedForCooledFlow(status) {
  return COOLED_APPROVED_FUNNEL_STAGES.includes(getClientFunnelStage(status));
}

// Status das etapas "aprovado ou depois" (consulta do histórico em lib/cooled-clients.js).
export const COOLED_APPROVED_STATUS_VALUES = Object.freeze(
  CLIENT_FUNNEL_STAGES.filter((stage) => COOLED_APPROVED_FUNNEL_STAGES.includes(stage.key)).flatMap((stage) => stage.statuses)
);

// REGRA OFICIAL (dono, 2026-10-16): "Cliente aprovado que voltou para uma etapa anterior pode entrar de novo na lista?"
// -> "não". Cliente que JÁ FOI aprovado alguma vez nunca entra no fluxo. Fontes (qualquer uma basta, porque nenhuma
// sozinha é completa): status atual; simulation_registrations.approved_at (gravado só quando a pessoa muda para
// "Cliente aprovado" em updateSimulationRegistration — quem pulou direto para Reunião/Venda não tem); e o histórico
// client_status_history (gravado pelo código, P-02) com entrada ou saída de Aprovado/Reunião/Venda.
export function wasEverApprovedForCooledFlow({ status, approvedAt, historyRows = [] } = {}) {
  if (isApprovedForCooledFlow(status)) return true;
  if (Number.isFinite(Date.parse(approvedAt || ""))) return true;
  return historyRows.some((row) => (row?.new_status && isApprovedForCooledFlow(row.new_status))
    || (row?.previous_status && isApprovedForCooledFlow(row.previous_status)));
}

const RESPONSIBLE_ROLES = new Set(["broker", "associate", "manager"]);
const NO_CONTACT_MS = 3 * 24 * 60 * 60 * 1000;

export function cooledDedupeKey(caseId, round) {
  return `${COOLED_DEDUPE_PREFIX}${caseId}:${round === 2 ? 2 : 1}`;
}

export function isCooledDedupeKey(key) {
  return String(key || "").startsWith(COOLED_DEDUPE_PREFIX);
}

export function normalizeCooledText(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, COOLED_REASON_MAX_LENGTH);
}

// Conta só letras/números (mesmo critério do FUN-14): "..............." não vale.
export function isValidCooledText(text) {
  return normalizeCooledText(text).replace(/[^\p{L}\p{N}]/gu, "").length >= COOLED_REASON_MIN_LENGTH;
}

export function assertCooledText(text, message = COOLED_REASON_REQUIRED_MESSAGE) {
  if (!isValidCooledText(text)) throw new Error(message);
  return normalizeCooledText(text);
}

// Responsável que entra no fluxo: corretor, associado ou gestora ativos. Admin geral (o dono) fica fora.
export function isEligibleResponsible(user) {
  return Boolean(user?.id) && user.status !== "inactive" && RESPONSIBLE_ROLES.has(user.role) && !user.isGeneralAdmin;
}

// "Tentando contato" só entra se o cliente já teve OUTRO status antes (histórico de status); quem sempre foi
// "Tentando contato" (prospecção que nunca avançou) não entra.
export function hadStatusOtherThanAwaitingReturn(historyRows = []) {
  return historyRows.some((row) => {
    const next = row?.new_status ? normalizeClientStatus(row.new_status) : null;
    const previous = row?.previous_status ? normalizeClientStatus(row.previous_status) : null;
    return (next && next !== CLIENT_STATUS.AWAITING_RETURN) || (previous && previous !== CLIENT_STATUS.AWAITING_RETURN);
  });
}

// client: formato de daily-goal-pending (status, lastWhatsappContactAt, lastStatusChangeAt, createdAt, latestActivityAt)
// + privateContactAt, responsibleChangedAt, approvedAt e lastAttendanceAt (último atendimento, lib/client-attendance.js).
// historyRows: client_status_history do cliente
// (no mínimo as linhas de Aprovado/Reunião/Venda; completo para "Tentando contato"). Particular, negativos, arquivado,
// Não contactar e quem já foi aprovado alguma vez ficam fora.
export function isCooledCandidate({ client, responsible, historyRows = [], now = Date.now() }) {
  if (!client || client.privateContactAt) return false;
  if (!isEligibleResponsible(responsible) || client.responsibleUserId !== responsible.id) return false;
  const status = normalizeClientStatus(client.status);
  // Restrição, Reprovado, Comprometimento de renda, Arquivado e Não contactar (FUN-15k: "clientes com restrição,
  // arquivados ou não contactar não entram nessa regra").
  if (NEGATIVE_DECISION_STATUSES.includes(status)) return false;
  if (client.hasRestrictionTag) return false;
  if (isRestrictionHoldActive(client)) return false;
  if (wasEverApprovedForCooledFlow({ status, approvedAt: client.approvedAt, historyRows })) return false;
  // `lastAttendanceAt` (regra do dono de 2026-10-16, lib/client-attendance.js): qualquer atendimento nos últimos 3 dias
  // — mudança de status por pessoa, mensagem recebida no Chat, atividade, simulação, etiqueta, documentos — zera a
  // contagem pela mesma regra dos pendentes, então não abre caso novo.
  if (!isDailyGoalPendingCandidate(client, now)) return false;
  // Responsável recém-trocado (roleta, transferência deste fluxo, fila de espera) ganha os mesmos 3 dias antes de
  // ser cobrado: sem isso o novo corretor receberia a janela no mesmo dia em que recebeu o cliente.
  const changedAt = Date.parse(client.responsibleChangedAt || "");
  if (Number.isFinite(changedAt) && changedAt > now - NO_CONTACT_MS) return false;
  // "Segunda chance" (FUN-15m, dono 2026-10-17): os 3 dias recomeçam a partir da decisão, sem atividade fictícia.
  const secondChanceAt = Date.parse(client.secondChanceAt || "");
  if (Number.isFinite(secondChanceAt) && secondChanceAt > now - NO_CONTACT_MS) return false;
  if (status === CLIENT_STATUS.AWAITING_RETURN && !hadStatusOtherThanAwaitingReturn(historyRows)) return false;
  return true;
}

// FUN-15k: caso encerrado como restrição pelo motivo escrito (o status do cliente não muda) segura o cliente fora do
// fluxo até alguém mudar o status dele depois disso — sem isso o caso reabriria na rodada seguinte.
// client.restrictionClosedAt: closed_at do último caso encerrado com COOLED_RESTRICTION_CANCEL_REASON.
export function isRestrictionHoldActive(client) {
  const closedAt = Date.parse(client?.restrictionClosedAt || "");
  if (!Number.isFinite(closedAt)) return false;
  const statusChangedAt = Date.parse(client?.lastStatusChangeAt || "");
  return !Number.isFinite(statusChangedAt) || statusChangedAt <= closedAt;
}

// Quem decide: gestora (manager_id) do corretor; do associado, a gestora do corretor vinculado. Cliente da própria
// gestora, corretor sem gestora (ou gestora inativa) → o dono.
export function resolveDeciderId({ responsible, usersById = new Map(), ownerId = "" }) {
  if (!responsible || responsible.role === "manager") return ownerId || "";
  const broker = responsible.role === "associate" ? usersById.get(responsible.linked_broker_id) : responsible;
  const manager = broker?.manager_id ? usersById.get(broker.manager_id) : null;
  if (manager && manager.role === "manager" && manager.status !== "inactive" && !manager.isGeneralAdmin) return manager.id;
  return ownerId || "";
}

export function caseRound(row) {
  return row?.returned_at ? 2 : 1;
}

export function caseLatestReason(row) {
  return row?.second_reason || row?.first_reason || "";
}

export function caseLatestReasonAt(row) {
  const times = [row?.first_reason_at, row?.second_reason_at].map((value) => Date.parse(value || "")).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

export function availableDecisionActions(row) {
  if (row?.status !== CASE_STATUS.AWAITING_DECISION) return [];
  // "second_chance" (FUN-15m): disponível em todo caso aguardando decisão, mesmo depois do "Devolver".
  return row.returned_at ? ["transfer", "second_chance", "status"] : ["transfer", "second_chance", "status", "return"];
}

// Permissões (servidor): corretor só responde casos dele; o dono decide qualquer caso; a gestora só casos
// endereçados a ela de corretor/associado da equipe dela.
export function canAnswerCase(viewerId, row) {
  return Boolean(viewerId) && Boolean(row) && row.broker_id === viewerId && row.status === CASE_STATUS.AWAITING_REASON;
}

export function canDecideCase({ viewerId, isOwner = false, isManager = false, managedUserIds = [] }, row) {
  if (!viewerId || !row) return false;
  if (isOwner) return true;
  return Boolean(isManager) && row.decider_id === viewerId && managedUserIds.includes(row.broker_id) && row.broker_id !== viewerId;
}

// Transições do caso. Devolve o patch a gravar (o servidor grava com .eq("status", <de>) para não sobrescrever
// uma decisão concorrente). Lança erro em transição inválida.
export function applyCaseAction(row, action, { actorId, text = "", status = "", now = new Date().toISOString() } = {}) {
  if (!row) throw new Error("Caso não encontrado.");
  if (action === "reason") {
    if (row.status !== CASE_STATUS.AWAITING_REASON) throw new Error("Este caso não está aguardando o motivo.");
    const reason = assertCooledText(text);
    const prefix = row.returned_at ? "second" : "first";
    return { status: CASE_STATUS.AWAITING_DECISION, [`${prefix}_reason`]: reason, [`${prefix}_reason_by`]: actorId || null, [`${prefix}_reason_at`]: now, updated_at: now };
  }
  if (action === "no_response") {
    // Motivo pronto "Cliente não respondeu mais": grava o motivo (1º ou 2º, como o texto livre) e já fecha o caso como
    // transferência AUTOMÁTICA (decided_by vazio), sem passar por "awaiting_decision".
    // `text` (opcional): motivo digitado que o classificador reconheceu como "não respondeu mais" ou "sem conversa"
    // (isDirectTransferReasonText) — grava o texto dele.
    if (row.status !== CASE_STATUS.AWAITING_REASON) throw new Error("Este caso não está aguardando o motivo.");
    const prefix = row.returned_at ? "second" : "first";
    return {
      status: CASE_STATUS.CLOSED,
      [`${prefix}_reason`]: text ? assertCooledText(text) : COOLED_NO_RESPONSE_REASON.label,
      [`${prefix}_reason_by`]: actorId || null,
      [`${prefix}_reason_at`]: now,
      decision: "transferred",
      decision_status: null,
      decided_by: null,
      decided_at: now,
      closed_at: now,
      updated_at: now
    };
  }
  if (action === "restriction_reason") {
    // FUN-15k: motivo digitado que cita restrição. Grava o motivo e encerra o caso como restrição (cancelado, sem
    // decisora e sem roleta). O status do cliente não muda.
    if (row.status !== CASE_STATUS.AWAITING_REASON) throw new Error("Este caso não está aguardando o motivo.");
    const reason = assertCooledText(text);
    if (!isRestrictionReasonText(reason)) throw new Error("O motivo deste caso não cita restrição.");
    const prefix = row.returned_at ? "second" : "first";
    return {
      status: CASE_STATUS.CANCELED,
      [`${prefix}_reason`]: reason,
      [`${prefix}_reason_by`]: actorId || null,
      [`${prefix}_reason_at`]: now,
      canceled_reason: COOLED_RESTRICTION_CANCEL_REASON,
      closed_at: now,
      updated_at: now
    };
  }
  if (row.status !== CASE_STATUS.AWAITING_DECISION) throw new Error("Este caso já foi decidido ou ainda aguarda o corretor.");
  if (action === "auto_transfer") {
    // Caso que já aguardava a decisora com motivo de "não respondeu mais" (regra do dono, 2026-10-16): transferência
    // AUTOMÁTICA (decided_by vazio), aplicada pela rotina do fluxo.
    if (!isDirectTransferReasonText(caseLatestReason(row))) throw new Error("O motivo deste caso não é de cliente que não respondeu mais nem de cliente sem conversa.");
    return { status: CASE_STATUS.CLOSED, decision: "transferred", decision_status: null, decided_by: null, decided_at: now, closed_at: now, updated_at: now };
  }
  if (action === "return") {
    if (row.returned_at) throw new Error("Este caso já foi devolvido uma vez.");
    return { status: CASE_STATUS.AWAITING_REASON, returned_text: assertCooledText(text, COOLED_RETURN_REQUIRED_MESSAGE), returned_by: actorId || null, returned_at: now, updated_at: now };
  }
  if (action === "transfer") {
    return { status: CASE_STATUS.CLOSED, decision: "transferred", decision_status: null, decided_by: actorId || null, decided_at: now, closed_at: now, updated_at: now };
  }
  if (action === "second_chance") {
    return { status: CASE_STATUS.CLOSED, decision: COOLED_SECOND_CHANCE_DECISION, decision_status: null, decided_by: actorId || null, decided_at: now, closed_at: now, updated_at: now };
  }
  if (action === "status") {
    if (!NEGATIVE_DECISION_STATUSES.includes(status)) throw new Error("Status inválido para esta decisão.");
    return { status: CASE_STATUS.CLOSED, decision: "status", decision_status: status, decided_by: actorId || null, decided_at: now, closed_at: now, updated_at: now };
  }
  throw new Error("Ação inválida.");
}

// Caso aberto que deve ser cancelado automaticamente (nada a decidir): o cliente sumiu, mudou de responsável, virou
// Particular, foi para status negativo (Restrição → "cliente_com_restricao"; Reprovado, Comprometimento de renda,
// Arquivado, Não contactar → "status_negativo"), é / já foi aprovado (Aprovado, Reunião, Venda — FUN-15e e regra de
// 2026-10-16) ou o motivo do corretor cita restrição (FUN-15k → "cliente_com_restricao"), em qualquer passo.
// REGRA OFICIAL (dono, 2026-10-16): "Se o corretor mandar mensagem ao cliente ou agendar atividade antes de informar o
// motivo, o card continua até ele informar?" -> "sim". Contato retomado / atividade futura NÃO encerram mais o caso: a
// janela do motivo só sai com o motivo do corretor (ou pelas saídas acima).
export function autoCancelReason({ row, client, historyRows = [] }) {
  if (!row || !OPEN_CASE_STATUSES.includes(row.status)) return "";
  if (!client) return "cliente_removido";
  if (client.responsibleUserId !== row.broker_id) return "responsavel_mudou";
  if (client.privateContactAt) return "contato_particular";
  const status = normalizeClientStatus(client.status);
  if (status === CLIENT_STATUS.RESTRICTION || client.hasRestrictionTag) return COOLED_RESTRICTION_CANCEL_REASON;
  if (NEGATIVE_DECISION_STATUSES.includes(status)) return "status_negativo";
  if (wasEverApprovedForCooledFlow({ status, approvedAt: client.approvedAt, historyRows })) return "cliente_aprovado";
  // FUN-15k: motivo do corretor que cita restrição (inclusive casos que já aguardam a decisora) encerra o caso.
  if (isRestrictionReasonText(caseLatestReason(row))) return COOLED_RESTRICTION_CANCEL_REASON;
  return "";
}

// Entrega da janela obrigatória (Central de Alertas, tipo Importante) para o corretor.
export function buildReasonAlertDelivery({ caseRow, clientName, stageLabel, returnedByName = "" }) {
  const round = caseRound(caseRow);
  const name = String(clientName || "").trim() || "Cliente";
  return {
    recipient_id: caseRow.broker_id,
    kind: "important",
    title: round === 2 ? `Complete o motivo: ${name}` : `Cliente frio: ${name}`,
    body: COOLED_QUESTION,
    context: {
      type: COOLED_ALERT_TYPE,
      case_id: caseRow.id,
      client_id: caseRow.client_id,
      client_name: name,
      stage_label: stageLabel || "",
      round,
      first_reason: round === 2 ? caseRow.first_reason || "" : "",
      returned_text: round === 2 ? caseRow.returned_text || "" : "",
      returned_by_name: round === 2 ? returnedByName : ""
    },
    dedupe_key: cooledDedupeKey(caseRow.id, round)
  };
}

// REGRA OFICIAL (dono, 2026-10-16, FUN-15e): "Não deve aparecer um card de um cliente em cima do outro pela
// notificação. Só deve aparecer o próximo depois que concluírem o primeiro." A janela do motivo mostra UMA entrega
// pendente do fluxo por vez (a mais antiga); as demais continuam pendentes no banco (fila, nada se perde) e só
// aparecem quando a da frente for concluída. Usado na Central de Alertas e no histórico do sino (lib/crm-alerts.js).
function isPendingCooledAlert(row) {
  return Boolean(row) && !row.acknowledged_at && row.context?.type === COOLED_ALERT_TYPE;
}

// `headId`: id da entrega da frente já conhecida (o sino lê só 30 dias; a frente pode ser mais antiga) — com ele, só essa
// entrega pendente do fluxo fica visível.
export function keepFirstPendingCooledAlert(rows = [], headId = undefined) {
  if (headId !== undefined) return rows.filter((row) => !isPendingCooledAlert(row) || (headId && row.id === headId));
  // Mais antiga primeiro; empate (entregas gravadas na mesma rodada têm o mesmo created_at) pelo id, para a janela e o
  // sino sempre escolherem a MESMA entrega, qualquer que seja a ordem da consulta.
  const rank = (row) => [Date.parse(row.created_at || "") || Number.MAX_SAFE_INTEGER, String(row.id || "")];
  let first = null;
  for (const row of rows) {
    if (!isPendingCooledAlert(row)) continue;
    if (!first) { first = row; continue; }
    const [at, id] = rank(row);
    const [firstAt, firstId] = rank(first);
    if (at < firstAt || (at === firstAt && id < firstId)) first = row;
  }
  return rows.filter((row) => !isPendingCooledAlert(row) || row === first);
}

// REGRA OFICIAL (dono, 2026-10-16, complemento da FUN-15e): "Se o corretor tem 10 clientes pendentes, apareceu o
// primeiro. Esse primeiro fica até ele concluir. Assim que concluiu, atualiza e vem o próximo." A frente da fila
// (`headRow`) vem de uma consulta própria e estável (mais antiga, empate pelo id, ver loadFirstPendingCooledAlert em
// lib/crm-alerts.js) — nunca da lista limitada da Central: as entregas do backlog nascem na mesma rodada do cron com o
// MESMO created_at e, com mais pendências que o limite da consulta, cada leitura recebia um recorte diferente e a janela
// trocava de cliente sozinha (incidente da Carol, 2026-10-16). Aqui a frente é garantida na lista (mesmo fora do
// recorte) e as demais pendentes do fluxo saem; sem frente (`headRow` nulo), nenhuma pendente do fluxo aparece.
export function pinCooledHead(rows = [], headRow = null) {
  const headId = headRow?.id || null;
  const list = headId && !rows.some((row) => row?.id === headId) ? [...rows, headRow] : rows;
  return keepFirstPendingCooledAlert(list, headId);
}

// Mensagem sugerida guardada com "{saudacao}" e trocada pela saudação da hora em que é mostrada.
export function renderHandoffMessage(template, greeting) {
  return String(template || "").replace(/\{saudacao\}/gi, greeting || "Olá");
}

// REGRA OFICIAL (dono, 2026-10-16, FUN-15c): a primeira mensagem do novo corretor é 100% de PÓS-ATENDIMENTO — o
// cliente já foi atendido por outra pessoa e parou de responder. Formato: saudação da hora + nome do cliente, nome do
// novo corretor, "associado(a) do corretor Matheus Machado" (nunca o nome antigo da marca), com quem ele estava em
// atendimento (sem nome: frase neutra, nunca inventar) e pergunta aberta sobre o que aconteceu / se foi bem atendido.
// Sem emoji, sem promessa, sem fato inventado. É só RASCUNHO: o corretor edita e envia ele mesmo (FUN-15b).
const firstNameOf = (value) => String(value || "").trim().split(/\s+/)[0] || "";
const genderOf = (value) => (value === "male" || value === "female" ? value : "");

export function genericHandoffMessage(clientName, previousBrokerName, { newBrokerName = "", newBrokerGender = "", previousBrokerGender = "" } = {}) {
  const client = firstNameOf(clientName);
  const me = firstNameOf(newBrokerName);
  const prev = firstNameOf(previousBrokerName);
  const myGender = genderOf(newBrokerGender);
  const prevGender = genderOf(previousBrokerGender);
  const associate = myGender === "female" ? "associada" : myGender === "male" ? "associado" : "associado(a)";
  const intro = me ? `meu nome é ${me}, sou ${associate} do corretor Matheus Machado` : `sou ${associate} do corretor Matheus Machado`;
  const previousTitle = prevGender === "female" ? "a corretora" : prevGender === "male" ? "o corretor" : "";
  const previous = prev
    ? `vi que você estava em atendimento com ${previousTitle ? `${previousTitle} ` : ""}${prev}, certo?`
    : "vi que você já tinha começado um atendimento com a nossa equipe, certo?";
  return `{saudacao}${client ? `, ${client}` : ""}, ${intro}, e ${previous} Estou te mandando essa mensagem hoje para saber se aconteceu alguma coisa e se você foi bem atendido(a).`;
}

// FUN-15g (dono, 2026-10-16): histórico da conversa anterior, somente leitura, com divisor ao fim de cada conversa.
// Rótulo do número: "oficial" (número oficial) ou "1"/"2" com o apelido do número do corretor anterior.
export function transferHistoryNumberLabel({ official = false, slot = 1, label = "" } = {}) {
  if (official) return "oficial";
  const clean = String(label || "").replace(/\s+/g, " ").trim().slice(0, 40);
  const number = Number(slot) === 2 ? "2" : "1";
  return clean ? `${number} · ${clean}` : number;
}

export function transferHistoryDivider({ previousName = "", numberLabel = "", newName = "" } = {}) {
  const previous = String(previousName || "").trim() || "o corretor anterior";
  const next = String(newName || "").trim() || "o novo corretor";
  return `Até aqui: conversa com ${previous} (número ${numberLabel || "não identificado"}). A partir daqui: ${next} assume.`;
}

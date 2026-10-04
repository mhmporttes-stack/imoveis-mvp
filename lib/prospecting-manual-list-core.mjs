// "Imprimir lista" da Prospecção (pedido do dono, 2026-10-04): regras PURAS (sem banco, sem rede) da lista
// manual de até 30 contatos. A seleção e a reserva moram no banco (create_prospecting_manual_list, migration
// 20261004170000); aqui ficam tolerância à migration pendente, formatação de telefone/nome/data, nome do
// arquivo e a exclusão dos reservados nos seletores em JavaScript.
import { digitsOnly } from "./phone-utils.js";

export const MANUAL_LIST_SIZE = 30;
export const MANUAL_LIST_NOT_ENABLED_MESSAGE = "Recurso ainda não ativado no banco.";
export const MANUAL_LIST_NO_CONTACTS_MESSAGE = "Não há contatos elegíveis disponíveis agora para montar uma lista.";
export const MANUAL_LIST_RESERVED_MESSAGE = "Este contato está reservado numa lista de prospecção manual impressa.";
const TIME_ZONE = "America/Sao_Paulo";

// Migration pendente (tabela/função ainda não existe): o resto da Prospecção NÃO pode quebrar.
// 42P01 = tabela inexistente; 42883 = função inexistente; PGRST205/PGRST202 = o PostgREST não conhece a
// tabela/função (cache de esquema). Só vale para os objetos da lista manual.
export function isMissingManualListSchemaError(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const message = String(error.message || error.details || "");
  const mentionsFeature = /prospecting_manual_list|create_prospecting_manual_list/i.test(message);
  if (["PGRST205", "PGRST202"].includes(code)) return mentionsFeature || !message;
  if (["42P01", "42883"].includes(code)) return mentionsFeature || !message;
  return mentionsFeature && /does not exist|schema cache|could not find/i.test(message);
}

// Erros de negócio do RPC -> status HTTP + texto em português.
export function manualListRpcErrorInfo(error) {
  const raw = String(error?.message || "");
  if (isMissingManualListSchemaError(error)) return { status: 503, message: MANUAL_LIST_NOT_ENABLED_MESSAGE };
  if (raw.includes("MANUAL_LIST_NO_CONTACTS")) return { status: 409, message: MANUAL_LIST_NO_CONTACTS_MESSAGE };
  if (raw.includes("MANUAL_LIST_BROKER_INVALID")) return { status: 400, message: "Corretor ou associado inválido ou inativo." };
  return null;
}

export function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// Chave de idempotência do clique (um UUID gerado pela tela a cada confirmação).
export function normalizeRequestKey(value) {
  const key = String(value ?? "").trim();
  return /^[A-Za-z0-9_-]{8,80}$/.test(key) ? key : "";
}

// Telefone do snapshot (E.164 brasileiro) -> "(14) 99999-9999"; sem o 9 -> "(14) 9999-9999". Fora do padrão
// brasileiro, devolve os dígitos como estão (nunca inventa DDD).
export function formatListPhone(value) {
  const raw = String(value ?? "").trim();
  let digits = digitsOnly(value);
  if (raw.startsWith("+") && !raw.startsWith("+55")) return digits; // número de fora do Brasil: sem máscara
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("55") && digits.length >= 12) digits = digits.slice(2);
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return digits;
}

// Caracteres que a codificação WinAnsi (fonte padrão do PDF, sem fonte embutida) consegue desenhar.
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
function isWinAnsi(char) {
  const code = char.codePointAt(0);
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(char);
}

// Texto seguro para a fonte padrão do PDF: mantém acentos do português; o que a fonte não desenha é
// decomposto (ć -> c) ou descartado (emoji, símbolo). Nunca devolve caractere que quebre a geração.
export function toWinAnsiSafe(text) {
  let out = "";
  for (const char of String(text ?? "").normalize("NFC")) {
    if (isWinAnsi(char)) { out += char; continue; }
    if (/\s/.test(char)) { out += " "; continue; }
    const base = char.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (base && base !== char) for (const piece of base) if (isWinAnsi(piece)) out += piece;
  }
  return out.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
}

// Corta o texto para caber em maxWidth (medido por `measure`), terminando em reticências, sem quebrar linha.
export function truncateToWidth(text, maxWidth, measure, ellipsis = "…") {
  const value = String(text ?? "");
  if (measure(value) <= maxWidth) return value;
  let end = value.length;
  while (end > 0 && measure(`${value.slice(0, end).trimEnd()}${ellipsis}`) > maxWidth) end -= 1;
  return end > 0 ? `${value.slice(0, end).trimEnd()}${ellipsis}` : ellipsis;
}

export function formatDateSaoPaulo(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export function formatDateTimeSaoPaulo(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date).replace(",", "");
}

// "30 contatos para prospecção" / "1 contato para prospecção" (com menos de 30, o número real).
export function contactCountLabel(count) {
  const n = Number(count) || 0;
  return `${n} ${n === 1 ? "contato" : "contatos"} para prospecção`;
}

export function manualListFileName(numero, brokerName) {
  const slug = String(brokerName ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 40);
  return `lista-prospeccao-${Number(numero) || 0}${slug ? `-${slug}` : ""}.pdf`;
}

// Escopo de listagem: admin geral vê tudo; gestor só corretores/associados da equipe; os demais nada.
export function manualListBrokerScope({ isGeneralAdmin, isManager, managedUserIds, profileId }) {
  if (isGeneralAdmin) return { all: true, ids: null };
  if (isManager) return { all: false, ids: Array.from(new Set([...(managedUserIds || []), profileId].filter(Boolean))) };
  return { all: false, ids: [] };
}

// Exclusão central dos reservados nos seletores em JavaScript (lista da fila, atribuição em massa).
export function withoutReservedContacts(contacts, reservedIds, getId = (item) => item?.id) {
  if (!reservedIds || !reservedIds.size) return contacts;
  return (contacts || []).filter((item) => !reservedIds.has(getId(item)));
}

export function reservedContactIdsAmong(ids, reservedIds) {
  if (!reservedIds || !reservedIds.size) return [];
  return (ids || []).filter((id) => reservedIds.has(id));
}

// Resposta HTTP de erro das rotas: erro de negócio/permissão (status < 500 ou ManualListError) mostra a mensagem;
// qualquer outro vira texto genérico e só o código é registrado (nunca conteúdo de contato).
export function manualListHttpError(error, fallback) {
  const status = Number(error?.status) || 500;
  const known = error?.name === "ManualListError" || status < 500;
  return { status: known ? status : 500, message: known ? error.message : fallback, log: !known };
}

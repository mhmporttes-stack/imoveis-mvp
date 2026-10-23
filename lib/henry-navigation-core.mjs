// Navegação guiada do Henry (pedido do dono, 2026-10-22: "quando ele for abrir uma tela para mim ou abrir um card de
// cliente, quero que ele minimize automaticamente"; "me mostra o caminho indo pela página, os cliques… um mouse diferente
// simulando ele clicando na tela"). Núcleo PURO (testável), usado pelo servidor (ferramentas) e pelo navegador (cursor).
// As telas continuam só as da lista fechada HENRY_NAV_TARGETS + a ficha de um cliente na lista de Clientes
// (/admin/simulacoes?clientId=<id>, o mesmo parâmetro que o painel já usa para abrir a ficha).
import { HENRY_NAV_TARGETS, normalizeSpeechText } from "./henry-voice-core.mjs";

const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const HENRY_CLIENTS_PATH = HENRY_NAV_TARGETS.clientes.path;

export function isHenryClientId(value) {
  return CLIENT_ID.test(String(value || ""));
}

export function henryClientSheetPath(clientId) {
  return isHenryClientId(clientId) ? `${HENRY_CLIENTS_PATH}?clientId=${clientId}` : "";
}

// Caminho que o navegador pode seguir: uma tela da lista ou a ficha de um cliente (id no formato do banco).
export function isAllowedHenryNavigation(path) {
  const value = String(path || "");
  if (Object.values(HENRY_NAV_TARGETS).some((target) => target.path === value)) return true;
  const match = /^\/admin\/simulacoes\?clientId=([^&#]+)$/.exec(value);
  return Boolean(match && isHenryClientId(match[1]));
}

// Toda navegação do Henry minimiza a tela cheia antes de seguir (a conversa continua; o ícone fica grande enquanto fala).
export function shouldMinimizeForNavigation(navigate) {
  return Boolean(navigate?.path && isAllowedHenryNavigation(navigate.path));
}

// Item do menu (lateral no computador, barra inferior no celular) que leva à tela: o caminho sem a query.
export function navTargetPath(path) {
  return String(path || "").split("?")[0];
}

// "Quer que eu abra?" → "sim" / "abre" / "pode" / "manda ver": aceite da sugestão de abrir uma tela.
const ACCEPT = new Set(["sim", "abre", "abra", "pode", "pode abrir", "pode sim", "claro", "isso", "quero", "manda", "manda ver", "bora", "beleza", "ok", "por favor", "abre ai", "abre la", "vai", "sim por favor", "sim pode", "pode ser", "faz isso"]);
export function isAcceptance(text) {
  const value = normalizeSpeechText(text).replace(/\b(henry|henri)\b/g, "").replace(/\s+/g, " ").trim();
  if (!value || value.split(" ").length > 4) return false;
  return ACCEPT.has(value) || /^(sim|pode|abre|abra|claro|quero)\b/.test(value);
}

export function offeredToOpen(lastAssistant) {
  return /\b(quer que eu abra|posso abrir|quer abrir|abro (a|o|pra)|quer ver na tela|te levo|quer que eu te leve)\b/.test(normalizeSpeechText(lastAssistant));
}

// Ficha de cliente pelo nome: 1 achado → abre; vários → pergunta qual (primeiro nome, etapa, responsável); 0 → não achou.
export function decideClientOpen(matches = [], spokenName = "") {
  const list = Array.isArray(matches) ? matches.filter((item) => isHenryClientId(item?.id)) : [];
  if (!list.length) return { kind: "not_found", reply: `Não achei nenhum cliente com o nome ${spokenName}.` };
  if (list.length === 1) {
    const [client] = list;
    return { kind: "open", navigate: { key: "cliente", path: henryClientSheetPath(client.id), label: `ficha de ${client.firstName || "cliente"}`, clientId: client.id } };
  }
  return {
    kind: "ask",
    options: list.slice(0, 5).map((item) => ({ primeiro_nome: item.firstName, sobrenome_inicial: item.lastInitial || "", etapa: item.stage, responsavel: item.responsible }))
  };
}

// --- Cursor do Henry --------------------------------------------------------------------------------------------------
export const CURSOR_MOVE_MS = 650;
export const CURSOR_CARD_MOVE_MS = 400; // da lista até o card (já está perto)
export const CURSOR_CLICK_MS = 340;
export const CURSOR_FADE_MS = 220;

// Ponto do alvo: centro do elemento visível; elemento escondido/fora da tela (menu recolhido etc.) → posição aproximada
// (computador: coluna do menu lateral; celular: barra inferior) ou null (pula direto).
export function cursorTargetPoint(rect, viewport = { width: 1280, height: 800 }, { mobile = false, approx = true } = {}) {
  const visible = rect && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < viewport.width && rect.top < viewport.height;
  if (visible) return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), exact: true };
  if (!approx) return null;
  return mobile ? { x: Math.round(viewport.width / 2), y: Math.round(viewport.height - 28), exact: false } : { x: 38, y: Math.round(viewport.height * 0.4), exact: false };
}

// Duração total do passeio (~1,2–2 s): mover + clique (+ ficha: mover + clique) + sumir. Movimento reduzido → 0 (navega direto).
export function cursorTimeline({ withClient = false, reducedMotion = false } = {}) {
  if (reducedMotion) return { total: 0, steps: [] };
  const steps = [
    { kind: "move", ms: CURSOR_MOVE_MS },
    { kind: "click", ms: CURSOR_CLICK_MS }
  ];
  if (withClient) steps.push({ kind: "move", ms: CURSOR_CARD_MOVE_MS }, { kind: "click", ms: CURSOR_CLICK_MS });
  steps.push({ kind: "fade", ms: CURSOR_FADE_MS });
  return { total: steps.reduce((sum, step) => sum + step.ms, 0), steps };
}

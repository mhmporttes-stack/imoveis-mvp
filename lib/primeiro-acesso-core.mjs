// Núcleo PURO (testável) do "primeiro acesso do dia" do dono (pedido do dono, 2026-10-22 — docs/BUSINESS_RULES.md
// INI-4): no primeiro acesso do dia (data de São Paulo) o painel abre na tela Início e a Alexa fala o bom dia.
// Usado no navegador (components/FirstAccessGate.jsx) e no servidor (lib/primeiro-acesso.js).
export { saoPauloDateKey } from "./alexa-config-core.mjs";

export const INICIO_PATH = "/admin/inicio";
export const FIRST_ACCESS_STORAGE_KEY = "mm_first_access_day";

// Só o DONO, na conta real (fora de "Alterar conta"). Para os outros perfis nada muda.
export function isFirstAccessEligible({ ok, accountSwitchMode, isOwner } = {}) {
  return Boolean(ok && isOwner && !accountSwitchMode);
}

// Telas em que o acesso NÃO conta como "primeiro acesso" (login, recuperação de senha, verificação em duas etapas).
const SKIPPED_PREFIXES = ["/admin/login", "/admin/reset-password", "/admin/seguranca"];

// O navegador pergunta ao servidor? Não pergunta se este aparelho já registrou o dia, fora do painel, nas telas acima ou
// num link direto para algo específico (com ?parâmetros ou #âncora — ex.: toque numa notificação que abre um cliente):
// esse acesso não "gasta" o dia; o próximo acesso normal abre o Início.
export function shouldCheckFirstAccess({ pathname = "", search = "", hash = "", storedDay = "", today = "" } = {}) {
  if (!today || storedDay === today) return false;
  if (pathname !== "/admin" && !pathname.startsWith("/admin/")) return false;
  if (SKIPPED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return false;
  if ((search && search !== "?") || (hash && hash !== "#")) return false;
  return true;
}

// Para onde ir quando o servidor confirma o primeiro acesso do dia (null = já está no Início).
export function firstAccessRedirect(pathname = "") {
  return pathname === INICIO_PATH || pathname === `${INICIO_PATH}/` ? null : INICIO_PATH;
}

// Resultado do INSERT da marca do dia (chave única usuário + dia): é ele que garante o "1 vez por dia" mesmo com duas
// abas ou dois aparelhos ao mesmo tempo — só um INSERT vence.
export function classifyFirstAccessInsert(error) {
  if (!error) return "claimed";
  if (error.code === "23505") return "already";
  return "unavailable";
}

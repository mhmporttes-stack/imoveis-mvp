// Núcleo PURO (testável) da porta de entrada do painel (regra do dono, 2026-10-24 — docs/BUSINESS_RULES.md INI-6):
// "quando eu iniciar o aplicativo, eu quero que ele abra na página de início e não na página clientes."
// Usado por app/admin/abrir (abertura do app "Painel", do app de desktop e destino depois do login/2FA).
import { INICIO_PATH, isFirstAccessEligible } from "./primeiro-acesso-core.mjs";

export const PAINEL_ENTRADA_PATH = "/admin/abrir";
export const CLIENTES_PATH = "/admin/simulacoes";
export const PAINEL_COMPUTADOR_PATH = "/admin";

// Só o DONO, na conta real (fora de "Alterar conta"), abre no Início. Os outros perfis seguem como antes:
// celular/app instalado → Clientes; computador → /admin (que já manda corretor/associado para Clientes).
export function resolvePanelEntryPath({ ok, accountSwitchMode, isOwner, device } = {}) {
  if (isFirstAccessEligible({ ok, accountSwitchMode, isOwner })) return INICIO_PATH;
  return device === "computador" ? PAINEL_COMPUTADOR_PATH : CLIENTES_PATH;
}

// Endereço da porta de entrada usado no navegador (login/2FA): o servidor decide o destino final.
export function panelEntryHref(device) {
  return device === "computador" ? `${PAINEL_ENTRADA_PATH}?de=computador` : PAINEL_ENTRADA_PATH;
}

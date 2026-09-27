// Puro (sem banco, sem "server-only") — monta as variáveis {{1}}, {{2}}... de uma mensagem de Disparo para UM
// destinatário. Usado tanto no envio real (lib/whatsapp-broadcasts.js) quanto no preview antes de disparar.
import { firstName } from "./whatsapp-flow-core.mjs";

export function buildRecipientVariables(variableMapping, recipient) {
  const variables = {};
  // {{1}} etc. usam só o PRIMEIRO nome ("Bom dia Maria" — não "Bom dia Maria Aparecida dos Santos"), igual ao resto
  // do sistema ({{primeiro_nome}} dos Fluxos). O nome completo continua guardado à parte (full_name da mensagem).
  const contactFirstName = firstName(recipient?.name) || recipient?.name || "";
  for (const [index, entry] of Object.entries(variableMapping || {})) {
    variables[index] = entry?.source === "fixed" ? (entry.value || "") : contactFirstName;
  }
  return variables;
}

// Chave de liberação da Academia (F0). Só o NOME da variável de ambiente vive
// no código. Padrão DESLIGADO: ausente, vazia ou qualquer valor diferente de
// "1"/"true"/"on" (sem diferenciar maiúsculas) mantém o CRM idêntico ao de hoje.
// Lida a cada chamada (tempo de requisição) — nunca congelada no import.
// Sem `import "server-only"` de propósito: o módulo não tem segredo e precisa
// rodar no `node --test`; só é chamado por layouts/páginas de servidor.
export const ACADEMY_ENABLED_ENV = "ACADEMIA_ENABLED";

const ON_VALUES = new Set(["1", "true", "on"]);

export function isAcademyEnabled(env = process.env) {
  const raw = env?.[ACADEMY_ENABLED_ENV];
  if (typeof raw !== "string") return false;
  return ON_VALUES.has(raw.trim().toLowerCase());
}

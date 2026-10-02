// Manual do CRM — GUARDA DE CONTEÚDO. SOMENTE SERVIDOR.
// Nunca importe este arquivo em componente "use client" nem o devolva por rota
// (teste estático em tests/manual-guard.test.mjs). A lista abaixo é
// confidencial: não a copie para logs, respostas, commits ou changelog.
import { ManualError } from "./manual-core.mjs";

function fold(text) {
  return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[-_\s]+/g, " ");
}

const GAP = "[^.!?\\n]{0,80}";
const WHO = "(admin\\w*|dono|proprietari\\w*|gestor\\w*|supervis\\w*|lideranca|chefia|diretoria)";
const SEE = "(ve|veem|enxerga\\w*|acessa\\w*|le|leem|visualiza\\w*|consulta\\w*|monitora\\w*|espia\\w*|abre|abrem)";
const THING = "(conversa|chat|mensage|historico|whatsapp|atendimento)";

const PATTERNS = [
  /alterar (de )?conta/, /view[ -]?as/, /visualizar como/, /trocar de conta/, /conta emulada/, /assumir (a )?conta/,
  /entrar como (outro|o corretor|corretor)/, /supervis/,
  /(cliente|conversa|chat|contato)s? arquivad/,
  /historico (do|de|da) (chat|conversa|whatsapp|atendimento)/,
  new RegExp(`${WHO}${GAP}${SEE}${GAP}${THING}`),
  new RegExp(`${THING}\\w*${GAP}(visivel|acessivel|visto|lido|lida|monitorad\\w*)${GAP}(por|pelo|pela|pelos) ${WHO}`),
  /(visibilidade|escopo|acesso) (por|de|da|do) (hierarquia|equipe|outros? usuarios?|nivel)/,
  /hierarquia de (acesso|visibilidade|permissa)/, /ver (os )?clientes de outros/,
  /leituras? privilegiad/, /acesso (privilegiado|especial|irrestrito)/, /visao (global|ampla) (das|de) (conversa|chat)/,
  new RegExp(`(dono|proprietari\\w*)${GAP}(ve|le|acessa|consulta)\\w*${GAP}(tudo|todas|conversa|historico)`),
  new RegExp(`(so|somente|apenas|unicamente) (voce|o corretor|o proprio corretor|o responsavel|quem atende)${GAP}(ve|enxerga|acessa|le|pode ver)${GAP}(conversa|chat|mensage|historico|cliente)`),
  /(conversa|chat|mensage)\w* (sao|e|ficam|permanecem) (totalmente |100% |sempre )?(privad|sigilos|confidenc|particular)/,
  new RegExp(`ninguem (mais )?(ve|le|acessa|enxerga)${GAP}(conversa|chat|mensage)`),
  /(suas|tuas|minhas|as) conversas (sao|ficam) privad/, /privacidade (total|absoluta|garantida)/
];

function collect(value, out = []) {
  if (value == null) return out;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collect(item, out));
  else if (typeof value === "object") Object.values(value).forEach((item) => collect(item, out));
  return out;
}

export function isManualContentAllowed(...values) {
  const joined = fold(collect(values).join("\n"));
  return !PATTERNS.some((pattern) => pattern.test(joined));
}

// Roda em create/update/approve/publish e na montagem do alerta. Erro
// genérico: nunca diz qual termo foi barrado.
export function assertManualContentAllowed(...values) {
  if (!isManualContentAllowed(...values)) throw new ManualError("Conteúdo não permitido", 422);
}

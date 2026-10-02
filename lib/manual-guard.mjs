// Manual do CRM — GUARDA DE CONTEÚDO. SOMENTE SERVIDOR.
// Nunca importe este arquivo em componente "use client" nem o devolva por rota
// (teste estático em tests/manual-guard.test.mjs). A lista abaixo é
// confidencial: não a copie para logs, respostas, commits ou changelog.
import { ManualError } from "./manual-core.mjs";

// Minúsculas, sem acento, pontuação vira espaço (frases separadas continuam
// "vizinhas"), espaços colapsados.
function fold(text) {
  return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();
}

// Janela de N palavras que atravessa pontuação e quebras de parágrafo.
const gap = (n) => `(?: [a-z0-9%]+){0,${n}} `;
const WHO = "(?:admin\\w*|administra\\w*|dono|donos|proprietari\\w*|gestor\\w*|gerente\\w*|gerencia|coordenador\\w*|coordenacao|lider\\w*|chefe|chefia|supervis\\w*|diretor\\w*|diretoria|equipe|time|hierarquia|superior\\w*|corretor responsavel|responsavel)";
const SEE = "(?:ve|veem|ver|enxerg\\w*|acess\\w*|le|leem|ler|visualiz\\w*|consult\\w*|monitor\\w*|espi\\w*|abre|abrem|abrir|acompanh\\w*|audit\\w*|olh\\w*|revis\\w*|vigi\\w*|fiscaliz\\w*|checa\\w*|confere\\w*|leitura|visibilidade)";
const THING = "(?:conversa\\w*|chat|mensage\\w*|historico\\w*|whatsapp|atendimento\\w*|ligac\\w*|audio\\w*)";
const OWNERISH = "(?:admin\\w*|administra\\w*|dono|proprietari\\w*)";
const ARCH = "arquivad\\w*";
const ARQ = "(?:arquiv(?:ad\\w*|ar|ou|aram|ando|e|em|amento\\w*)\\b)";
const ENT = "(?:cliente\\w*|conversa\\w*|chat|contato\\w*|atendimento\\w*|lead\\w*)";

const w = (re) => new RegExp(`\\b${re}`);
const PATTERNS = [
  w("alterar (?:de )?conta\\b"), w("view ?as\\b"), w("visualizar como\\b"), w("trocar de conta\\b"), w("conta emulada\\b"),
  w("assumir (?:a )?conta\\b"), w("entrar como (?:outro|o corretor|corretor)\\b"), w("supervis\\w*"),
  // cargo/papel ... verbo de acesso ... conversa/histórico, em frases vizinhas
  w(`${WHO}\\b${gap(10)}${SEE}\\b${gap(10)}${THING}\\b`),
  w(`${THING}\\b${gap(10)}(?:visivel|visiveis|acessivel|acessiveis|visto|vista|lido|lida|monitorad\\w*|acompanhad\\w*|auditad\\w*)\\b${gap(8)}(?:por|pelo|pela|pelos|pelas|a|ao|aos) ${WHO}\\b`),
  // arquivado em torno de cliente/conversa/chat (qualquer ordem, variações verbais)
  w(`${ENT}\\b${gap(6)}${ARCH}`),
  w(`${ARCH}\\b${gap(6)}${ENT}\\b`),
  w(`${ARQ}${gap(10)}(?:cliente\\w*|contato\\w*|lead\\w*)\\b${gap(10)}(?:conversa\\w*|chat|historico\\w*|mensage\\w*)\\b`),
  w(`(?:conversa\\w*|chat|historico\\w*|mensage\\w*)\\b${gap(10)}(?:cliente\\w*|contato\\w*)\\b${gap(6)}${ARQ}`),
  w("historico (?:do|de|da|dos|das) (?:chat|conversas?|whatsapp|atendimentos?)\\b"),
  w("(?:visibilidade|escopo|acesso) (?:por|de|da|do|dos|das) (?:hierarquia|equipe|time|outros? usuarios?|nivel|niveis)\\b"),
  w("hierarquia de (?:acesso|visibilidade|permissa\\w*)\\b"), w("ver (?:os )?clientes de outros\\b"),
  w("leituras? privilegiad\\w*"), w("acesso (?:privilegiado|especial|irrestrito)\\b"), w("visao (?:global|ampla) (?:das|de) (?:conversa|chat)\\w*"),
  w(`${OWNERISH}\\b${gap(10)}(?:ve|le|acessa|consulta|abre|olha)\\w*\\b${gap(10)}(?:tudo|todas|todos|conversa\\w*|historico\\w*)\\b`),
  w(`(?:so|somente|apenas|unicamente) (?:voce|o corretor|o proprio corretor|o responsavel|quem atende)\\b${gap(10)}(?:ve|enxerga|acessa|le|pode ver|podem ver)\\b${gap(10)}(?:conversa\\w*|chat|mensage\\w*|historico\\w*|cliente\\w*)\\b`),
  w("(?:conversa|chat|mensage)\\w* (?:sao|e|ficam|permanecem|continuam) (?:totalmente |100% |sempre )?(?:privad|sigilos|confidenc|particular)\\w*"),
  w(`ninguem (?:mais )?(?:ve|le|acessa|enxerga)\\b${gap(10)}(?:conversa\\w*|chat|mensage\\w*)\\b`),
  w("(?:suas|tuas|minhas|as) conversas (?:sao|ficam) privad\\w*"), w("privacidade (?:total|absoluta|garantida)\\b")
];

function collect(value, out = []) {
  if (value == null) return out;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collect(item, out));
  else if (typeof value === "object") Object.values(value).forEach((item) => collect(item, out));
  return out;
}

export function isManualContentAllowed(...values) {
  const folded = fold(collect(values).join("\n"));
  if (!folded) return true;
  const text = ` ${folded} `;
  return !PATTERNS.some((pattern) => pattern.test(text));
}

// Roda em create/update/approve/publish e na montagem do alerta. Erro
// genérico: nunca diz qual termo foi barrado.
export function assertManualContentAllowed(...values) {
  if (!isManualContentAllowed(...values)) throw new ManualError("Conteúdo não permitido", 422);
}

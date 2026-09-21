import "server-only";
import { downloadClientDocumentBuffer } from "./media-storage";
import { DOCUMENT_TYPE_OPTIONS } from "./document-type-options";

// Camada de serviço ISOLADA da IA (item 4 do pedido) — a interface pública
// (analyzeClientDocumentBatch) nunca vaza detalhe de provedor para quem
// chama (lib/client-documents.js). Trocar de provedor no futuro = reescrever
// só este arquivo.
//
// Provedor atual: Anthropic (Claude), chamado via fetch cru na Messages API
// — mesmo padrão "fetch direto, sem SDK" já usado em app/api/analyze/route.js
// para a extração de dados de empreendimento (única outra integração de IA
// do projeto). A chave nunca é exposta ao navegador — só lida aqui, no
// backend.
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = process.env.ANTHROPIC_DOCUMENT_MODEL || "claude-sonnet-5";

// Preço por milhão de tokens (usd) do modelo acima — usado só para estimar o
// custo de cada chamada no extrato de gastos (lib/ai-usage.js). Se o modelo
// mudar, atualizar aqui também.
const PRICE_PER_MILLION_INPUT_USD = 2;
const PRICE_PER_MILLION_OUTPUT_USD = 10;

const SUPPORTED_AI_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/jpg", "image/png", "image/webp"]);

export function isAiSupportedMimeType(mimeType) {
  return SUPPORTED_AI_MIME_TYPES.has(mimeType);
}

export function estimateAnalysisCostUsd(inputTokens, outputTokens) {
  return (Number(inputTokens) || 0) / 1_000_000 * PRICE_PER_MILLION_INPUT_USD
    + (Number(outputTokens) || 0) / 1_000_000 * PRICE_PER_MILLION_OUTPUT_USD;
}

// Resultado estruturado (item 4 do 1º pedido — documentType/status/
// extractedData/observations/pendingItems/confidence), só que em formato de
// LOTE: um array de itens de checklist (cada um aponta pra um índice de
// documento do lote, ou nenhum quando "ausente"), mais divergências
// cruzadas entre documentos e um resumo.
export async function analyzeClientDocumentBatch({ documents }) {
  const token = process.env.ANTHROPIC_API_KEY || "";
  if (!token) throw new Error("ANTHROPIC_API_KEY não configurada no servidor.");

  const supportedDocs = documents.filter((doc) => isAiSupportedMimeType(doc.mimeType));
  const unsupportedDocs = documents.filter((doc) => !isAiSupportedMimeType(doc.mimeType));

  const content = [];
  for (let index = 0; index < supportedDocs.length; index += 1) {
    const doc = supportedDocs[index];
    const buffer = await downloadClientDocumentBuffer(doc.storagePath);
    const base64 = buffer.toString("base64");
    content.push({ type: "text", text: `Arquivo #${index} (nome original: "${doc.filename}"):` });
    if (doc.mimeType === "application/pdf") {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } });
    } else {
      content.push({ type: "image", source: { type: "base64", media_type: doc.mimeType, data: base64 } });
    }
  }

  const checklistTypesList = DOCUMENT_TYPE_OPTIONS.filter((option) => option.key !== "nao_identificado").map((option) => `${option.key} (${option.label})`).join(", ");

  content.push({
    type: "text",
    text: buildInstructions(supportedDocs.length, checklistTypesList)
  });

  const tool = buildAnalysisTool();

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": token,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content }]
    }),
    signal: AbortSignal.timeout(120000)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.type === "error") {
    throw new Error(sanitizeAnthropicError(payload));
  }

  const toolUse = (payload?.content || []).find((block) => block.type === "tool_use" && block.name === tool.name);
  if (!toolUse?.input) throw new Error("A IA não retornou um resultado estruturado válido.");

  const result = toolUse.input;

  // Traduz o índice (relativo a supportedDocs) de volta para o id real do
  // documento — a IA nunca vê/manipula UUIDs, só índices, reduzindo chance
  // de alucinação de id.
  const items = (Array.isArray(result.items) ? result.items : []).map((item) => ({
    documentId: Number.isInteger(item.documentIndex) && supportedDocs[item.documentIndex] ? supportedDocs[item.documentIndex].id : null,
    personLabel: cleanText(item.personLabel, 120) || "Titular",
    documentType: DOCUMENT_TYPE_OPTIONS.some((option) => option.key === item.documentType) ? item.documentType : "nao_identificado",
    status: normalizeStatus(item.status),
    pageRange: cleanText(item.pageRange, 40),
    observations: cleanText(item.observations, 500),
    confidence: typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : null,
    extractedData: item.extractedData && typeof item.extractedData === "object" ? item.extractedData : {}
  }));

  // Cada arquivo não suportado pela IA (ex.: HEIC) sempre vira um item
  // "precisa_confirmacao" — nunca é ignorado silenciosamente (item 9 do 1º
  // pedido: correção manual só como exceção, mas precisa acontecer quando a
  // IA realmente não conseguir processar o arquivo).
  for (const doc of unsupportedDocs) {
    items.push({
      documentId: doc.id,
      personLabel: "Titular",
      documentType: "nao_identificado",
      status: "precisa_confirmacao",
      pageRange: null,
      observations: `Formato (${doc.mimeType}) não suportado para análise automática — classifique manualmente.`,
      confidence: null,
      extractedData: {}
    });
  }

  const divergences = Array.isArray(result.divergences) ? result.divergences.map((entry) => ({
    description: cleanText(entry.description, 500),
    documentTypes: Array.isArray(entry.documentTypes) ? entry.documentTypes.slice(0, 10) : []
  })) : [];

  const inputTokens = Number(payload?.usage?.input_tokens) || 0;
  const outputTokens = Number(payload?.usage?.output_tokens) || 0;

  return {
    items,
    divergences,
    usage: { model: MODEL, inputTokens, outputTokens, costUsd: estimateAnalysisCostUsd(inputTokens, outputTokens) }
  };
}

function buildInstructions(fileCount, checklistTypesList) {
  return `Você está analisando um LOTE de ${fileCount} documento(s) pessoais enviados por um cliente de uma operação de financiamento imobiliário, para uma conferência preliminar (NÃO é aprovação de crédito).

Trate os arquivos como um conjunto relacionado à mesma operação (podem ser de mais de uma pessoa: titular, cônjuge etc.) — cruze informações entre eles, não analise cada um isoladamente.

Tipos de documento esperados (use exatamente uma destas chaves em "documentType", ou "nao_identificado" se realmente não conseguir determinar): ${checklistTypesList}.

Para CADA documento identificado dentro do lote, gere um item. Um único arquivo (ex.: um PDF) pode conter MAIS DE UM tipo de documento em páginas diferentes — nesse caso gere um item por tipo de documento encontrado, preenchendo "pageRange" (ex.: "1-2") quando o arquivo tiver várias páginas e você conseguir identificar o intervalo; deixe "pageRange" vazio se não for possível ou não se aplicar.

Separe por pessoa em "personLabel" (nome completo encontrado no documento, ex.: "João da Silva"). Se não conseguir determinar a pessoa com confiança, use "Titular" e marque status "precisa_confirmacao".

NUNCA adivinhe. Se a confiança for baixa (tipo de documento incerto, pessoa incerta, ou letra ilegível a ponto de não dar pra confirmar o tipo), use status "precisa_confirmacao" e explique em "observations" — não escolha aleatoriamente entre possibilidades.

Depois de identificar os documentos encontrados, compare com a lista de tipos esperados acima e, para cada tipo claramente esperado nessa operação que NÃO apareceu em nenhum arquivo, adicione um item extra com documentIndex nulo, status "ausente", document_type = o tipo faltante, personLabel = a pessoa a quem falta (se identificável, senão "Titular").

Detecte divergências REAIS entre documentos (nome, CPF, PIS, endereço, estado civil, empregador, renda, datas) e liste em "divergences" — cada divergência é só um SINAL para conferência humana, nunca uma reprovação.

Status possíveis por item: "conforme" (documento claro e válido), "pendencia" (problema específico, ex.: página faltando, dado incompleto — explique em observations), "ilegivel" (não dá pra ler o conteúdo), "ausente" (esperado mas não enviado), "divergencia" (dado deste documento diverge de outro do lote — também cite em divergences), "precisa_confirmacao" (baixa confiança).

Preencha "extractedData" com os dados relevantes que conseguir ler do documento (nome, cpf, pis, endereço, data, empregador, renda — só os campos que existirem e você tiver certeza).`;
}

function buildAnalysisTool() {
  return {
    name: "submit_analysis",
    description: "Envia o resultado estruturado da análise do lote de documentos.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              documentIndex: { type: ["integer", "null"], description: "Índice (0-based) do arquivo no lote que originou este item; null quando status='ausente'." },
              personLabel: { type: "string" },
              documentType: { type: "string" },
              status: { type: "string", enum: ["conforme", "pendencia", "ilegivel", "ausente", "divergencia", "precisa_confirmacao"] },
              pageRange: { type: ["string", "null"] },
              observations: { type: ["string", "null"] },
              confidence: { type: ["number", "null"] },
              extractedData: { type: "object" }
            },
            required: ["personLabel", "documentType", "status"]
          }
        },
        divergences: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              documentTypes: { type: "array", items: { type: "string" } }
            },
            required: ["description"]
          }
        }
      },
      required: ["items", "divergences"]
    }
  };
}

function normalizeStatus(status) {
  const valid = ["conforme", "pendencia", "ilegivel", "ausente", "divergencia", "precisa_confirmacao"];
  return valid.includes(status) ? status : "precisa_confirmacao";
}

function cleanText(value, max) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : "";
}

function sanitizeAnthropicError(payload) {
  const message = payload?.error?.message || "Falha na análise por IA.";
  return String(message).slice(0, 500);
}

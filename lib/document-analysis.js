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
export async function analyzeClientDocumentBatch({ documents, clientContext }) {
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
    text: buildInstructions(supportedDocs.length, checklistTypesList, buildClientContextText(clientContext))
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
  // A IA só CLASSIFICA arquivos reais que existem no lote — ela nunca mais
  // inventa item de "ausente" (isso agora é 100% do motor determinístico,
  // lib/document-requirements-engine.js). Por isso todo item aqui sempre tem
  // documentIndex/documentId — filtra qualquer alucinação que aponte pra um
  // índice fora do lote.
  const items = (Array.isArray(result.items) ? result.items : [])
    .filter((item) => Number.isInteger(item.documentIndex) && supportedDocs[item.documentIndex])
    .map((item) => ({
      documentId: supportedDocs[item.documentIndex].id,
      personLabel: cleanText(item.personLabel, 120) || "Titular",
      personRole: normalizePersonRole(item.personRole),
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
      personRole: "outro",
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

function buildClientContextText(clientContext) {
  if (!clientContext) return "";
  const lines = [];
  if (clientContext.fullName) lines.push(`Nome do titular no cadastro: ${clientContext.fullName}.`);
  return lines.length
    ? `\n\nCONTEXTO JÁ CADASTRADO NO CRM (use só para te ajudar a identificar quem é o titular nos documentos — nunca para decidir o que está faltando, isso não é seu trabalho):\n${lines.join("\n")}`
    : "";
}

function buildInstructions(fileCount, checklistTypesList, clientContextText) {
  return `Você está classificando um LOTE de ${fileCount} documento(s) pessoais enviados por um cliente de uma operação de financiamento imobiliário, para uma conferência preliminar (NÃO é aprovação de crédito).

IMPORTANTE SOBRE O SEU PAPEL: seu trabalho é só identificar e ler cada documento que REALMENTE está no lote. Você NUNCA decide o que está faltando/"ausente" — isso é calculado depois, por código, cruzando com o cadastro do cliente. Não gere nenhum item para um documento que não existe no lote.

Trate os arquivos como um conjunto relacionado à mesma operação (podem ser de mais de uma pessoa: titular, cônjuge, dependentes) — cruze informações entre eles, não analise cada um isoladamente.
${clientContextText}

Tipos de documento (use exatamente uma destas chaves em "documentType", ou "nao_identificado" se realmente não conseguir determinar): ${checklistTypesList}.

Para CADA documento identificado dentro do lote, gere um item com "documentIndex" apontando pro arquivo que o originou. Um único arquivo (ex.: um PDF) pode conter MAIS DE UM tipo de documento em páginas diferentes — nesse caso gere um item por tipo de documento encontrado, preenchendo "pageRange" (ex.: "1-2") quando o arquivo tiver várias páginas e você conseguir identificar o intervalo; deixe "pageRange" vazio se não for possível ou não se aplicar.

PARA CADA ITEM, determine "personRole" — de quem é esse documento:
- "titular": pertence à pessoa do cadastro (nome acima). Compare o nome no documento com o nome do cadastro.
- "conjuge": pertence a um cônjuge/companheiro(a) do titular — geralmente porque aparece numa certidão de casamento junto com o titular, ou porque o próprio documento se refere a ele(a) como cônjuge.
- "dependente": pertence a um filho(a) menor de idade do titular — normalmente uma certidão de nascimento de uma criança, mencionando o titular como pai/mãe. NUNCA agrupe a certidão de nascimento de um filho junto com os documentos do próprio titular — é uma pessoa separada, com seu próprio "personLabel" (nome da criança).
- "outro": qualquer pessoa que não se encaixe nos papéis acima, ou quando não for possível determinar.
Preencha também "personLabel" com o nome completo encontrado no documento daquela pessoa específica. Se não conseguir determinar a pessoa/papel com confiança, use personRole "outro" e status "precisa_confirmacao".

NUNCA adivinhe. Se a confiança for baixa (tipo de documento incerto, pessoa/papel incerto, ou letra ilegível a ponto de não dar pra confirmar o tipo), use status "precisa_confirmacao" e explique em "observations" — não escolha aleatoriamente entre possibilidades.

REGRAS DE LEITURA (interpretação do CONTEÚDO de cada documento — isto sim é seu trabalho, o que muda é só o tipo de documento):

1) CERTIDÃO DE CASAMENTO: verifique se existe averbação/anotação de divórcio, separação ou dissolução na própria certidão. Se existir, registre isso claramente em "observations" (ex.: "Certidão de casamento com averbação de divórcio identificada.") — isso muda o que o sistema vai exigir depois. Se não existir nenhuma menção, considere o casamento vigente.

2) COMPROVANTE DE RESIDÊNCIA: aceite QUALQUER boleto, conta ou fatura (água, luz, internet, boleto de compra online/e-commerce, fatura de cartão, carta de banco, etc.) desde que mostre claramente nome e endereço e seja razoavelmente recente (idealmente do mês atual ou dos últimos 2-3 meses) — NÃO marque "pendencia" só por não ser uma "conta de consumo tradicional". Marque "pendencia" apenas se o nome/endereço não bater com o titular ou a data for claramente inválida.

3) HOLERITE DE FÉRIAS: se identificar que um holerite é especificamente de férias, mencione isso em "observations" (ex.: "Holerite de férias — competência de agosto/2026.") — um holerite de férias sozinho não é uma competência regular.

4) PIS: extraia o número do PIS de QUALQUER documento onde ele aparecer (CTPS, CTPS digital, extrato FGTS, Meu INSS, Caixa Trabalhador, Caixa Tem, holerite, etc.), preenchendo "extractedData.pis" — não é necessário um documento específico "de PIS".

5) Preencha "extractedData" com os dados relevantes que conseguir ler do documento (nome, cpf, pis, endereço, data, empregador, renda, competência — só os campos que existirem e você tiver certeza).

Detecte divergências REAIS entre os documentos ENVIADOS (nome, CPF, PIS, endereço, empregador, renda, datas inconsistentes entre dois arquivos do lote) e liste em "divergences" — cada divergência é só um SINAL para conferência humana, nunca uma reprovação. NÃO compare com o cadastro do CRM aqui — isso é feito depois, por código.

Status possíveis por item: "conforme" (documento claro e válido), "pendencia" (problema específico neste documento, ex.: página faltando, dado incompleto — explique em observations), "ilegivel" (não dá pra ler o conteúdo), "divergencia" (dado deste documento diverge de outro do lote — também cite em divergences), "precisa_confirmacao" (baixa confiança). NUNCA use "ausente" — não é seu trabalho decidir isso.`;
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
              documentIndex: { type: "integer", description: "Índice (0-based) do arquivo no lote que originou este item — sempre obrigatório, nunca null (a IA não gera itens de 'ausente')." },
              personLabel: { type: "string" },
              personRole: { type: "string", enum: ["titular", "conjuge", "dependente", "outro"] },
              documentType: { type: "string" },
              status: { type: "string", enum: ["conforme", "pendencia", "ilegivel", "divergencia", "precisa_confirmacao"] },
              pageRange: { type: ["string", "null"] },
              observations: { type: ["string", "null"] },
              confidence: { type: ["number", "null"] },
              extractedData: { type: "object" }
            },
            required: ["documentIndex", "personLabel", "personRole", "documentType", "status"]
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
  const valid = ["conforme", "pendencia", "ilegivel", "divergencia", "precisa_confirmacao"];
  return valid.includes(status) ? status : "precisa_confirmacao";
}

function normalizePersonRole(role) {
  const valid = ["titular", "conjuge", "dependente", "outro"];
  return valid.includes(role) ? role : "outro";
}

function cleanText(value, max) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : "";
}

function sanitizeAnthropicError(payload) {
  const message = payload?.error?.message || "Falha na análise por IA.";
  return String(message).slice(0, 500);
}

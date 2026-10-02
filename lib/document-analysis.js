import "server-only";
import { downloadClientDocumentBuffer } from "./media-storage";
import { DOCUMENT_TYPE_OPTIONS } from "./document-type-options";
import { residenceDecision } from "./document-ai-rule-core.mjs";
import { normalizeNonPrincipalResidenceItem, residenceSourceDecision } from "./document-policy.mjs";

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
// mudar, atualizar aqui também. Preços de cache (prompt caching) são
// múltiplos do preço base de entrada — ver shared/prompt-caching.md do
// skill claude-api: escrita ephemeral de 5min = 1.25x, leitura = 0.1x.
const PRICE_PER_MILLION_INPUT_USD = 2;
const PRICE_PER_MILLION_OUTPUT_USD = 10;
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

const SUPPORTED_AI_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/jpg", "image/png", "image/webp"]);

export function isAiSupportedMimeType(mimeType) {
  return SUPPORTED_AI_MIME_TYPES.has(mimeType);
}

// inputTokens aqui é só a parte NÃO cacheada (é assim que a API já devolve
// em usage.input_tokens) — cache_creation/cache_read entram com seus
// próprios multiplicadores, nunca ao preço cheio.
export function estimateAnalysisCostUsd(inputTokens, outputTokens, cacheCreationTokens = 0, cacheReadTokens = 0) {
  return (Number(inputTokens) || 0) / 1_000_000 * PRICE_PER_MILLION_INPUT_USD
    + (Number(cacheCreationTokens) || 0) / 1_000_000 * PRICE_PER_MILLION_INPUT_USD * CACHE_WRITE_MULTIPLIER
    + (Number(cacheReadTokens) || 0) / 1_000_000 * PRICE_PER_MILLION_INPUT_USD * CACHE_READ_MULTIPLIER
    + (Number(outputTokens) || 0) / 1_000_000 * PRICE_PER_MILLION_OUTPUT_USD;
}

// Resultado estruturado (item 4 do 1º pedido — documentType/status/
// extractedData/observations/pendingItems/confidence), só que em formato de
// LOTE: um array de itens de checklist (cada um aponta pra um índice de
// documento do lote, ou nenhum quando "ausente"), mais divergências
// cruzadas entre documentos e um resumo.
export async function analyzeClientDocumentBatch({ documents, clientContext, rules = [], selectedMessages = [], previousEvidence = [] }) {
  const token = process.env.ANTHROPIC_API_KEY || "";
  if (!token) throw new Error("ANTHROPIC_API_KEY não configurada no servidor.");

  const supportedDocs = documents.filter((doc) => isAiSupportedMimeType(doc.mimeType));
  const unsupportedDocs = documents.filter((doc) => !isAiSupportedMimeType(doc.mimeType));

  // Bloco VARIÁVEL (nunca cacheado): contexto do cliente específico + os
  // arquivos deste lote. Fica em "messages", depois do prefixo fixo.
  const content = [];
  const contextText = buildClientContextText(clientContext, supportedDocs.length);
  if (contextText) content.push({ type: "text", text: contextText });
  if (selectedMessages.length) content.push({ type: "text", text: `MENSAGENS SELECIONADAS (extraia somente dados relevantes; não trate conversa irrelevante como prova):\n${selectedMessages.map((entry) => `[${entry.id}] ${entry.body}`).join("\n").slice(0, 20000)}` });
  if (previousEvidence.length) content.push({ type: "text", text: `RESULTADOS ANTERIORES JÁ CLASSIFICADOS (não reanalise os arquivos):\n${JSON.stringify(previousEvidence).slice(0, 16000)}` });
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
      // Bloco FIXO (instruções + checklist de tipos de documento do MCMV):
      // é IDÊNTICO byte a byte em toda chamada (não depende de cliente,
      // corretor ou empreendimento — ver nota no fim do arquivo), então
      // fica em "system" com cache_control no último bloco. Como tools
      // renderiza antes de system, esse breakpoint cacheia os dois juntos
      // (tools + system) em uma única entrada — ver shared/prompt-caching.md
      // do skill claude-api. TTL padrão de 5min (ephemeral): é o mais barato
      // quando duas chamadas acontecem a menos de 5min uma da outra (ex.:
      // corretor analisando vários clientes seguidos), que é o padrão real
      // de uso aqui — não é tráfego contínuo. Se no futuro o extrato de
      // gastos mostrar cache_read baixo por causa de intervalos maiores
      // (5-60min), trocar para {type:"ephemeral", ttl:"1h"} é a única
      // mudança necessária.
      system: [
        { type: "text", text: FIXED_SYSTEM_INSTRUCTIONS, cache_control: { type: "ephemeral" } },
        { type: "text", text: `REGRAS ATIVAS (somente estas podem fundamentar exigências adicionais):\n${rules.map((rule) => `[${rule.id}] ${rule.category} — ${rule.title}: ${rule.instruction}`).join("\n") || "Nenhuma regra adicional ativa."}` }
      ],
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
  const activeRuleIds = new Set(rules.map((rule) => rule.id));
  const residenceRule = rules.find((rule) => rule.ruleKey === "residence_income_ownership");
  const sourceRule = rules.find((rule) => rule.ruleKey === "residence_source");
  const items = (Array.isArray(result.items) ? result.items : [])
    .filter((item) => Number.isInteger(item.documentIndex) && supportedDocs[item.documentIndex])
    .map((item) => ({
      documentId: supportedDocs[item.documentIndex].id,
      personLabel: cleanText(item.personLabel, 120) || "Titular",
      personRole: normalizePersonRole(item.personRole),
      documentType: DOCUMENT_TYPE_OPTIONS.some((option) => option.key === item.documentType) ? item.documentType : "nao_identificado",
      status: normalizeStatus(item.status),
      expired: Boolean(item.expired),
      pageRange: cleanText(item.pageRange, 40),
      observations: cleanText(item.observations, 500),
      confidence: typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : null,
      extractedData: item.extractedData && typeof item.extractedData === "object" ? item.extractedData : {},
      ruleTrace: activeRuleIds.has(item.ruleId) ? { ruleId: item.ruleId, problem: cleanText(item.observations, 300), evidence: cleanText(item.evidence, 300), justification: cleanText(item.justification, 300) } : null
    })).map((item) => {
      if (item.documentType === "certidao_casamento" && item.extractedData.divorceAnnotation === true && item.status === "divergencia" && /casament|div[oó]rcio|estado civil|averba/i.test(item.observations)) {
        item.status = "conforme";
        item.observations = "Certidão de casamento com divórcio averbado.";
      }
      if (item.documentType === "comprovante_residencia" && sourceRule) {
        const source = item.extractedData.residenceSource;
        // Fatura mantém seu tipo de renda; a exceção de residência é resolvida
        // pelo checklist consolidado quando houver três faturas utilizáveis.
        const sourceDecision = residenceSourceDecision(source);
        if (sourceDecision === "rejected") {
          item.documentType = source === "bank_statement" ? "extrato_bancario" : source === "credit_card" ? "fatura_cartao" : "outro";
          item.status = "conforme";
          item.observations = "Este arquivo não é comprovante de residência; avalie sua outra finalidade documental.";
          item.ruleTrace = null;
        } else if (sourceDecision === "validation" && item.personRole === "titular") {
          item.status = "precisa_confirmacao";
          item.observations = "Confirme o tipo de conta antes de usar como comprovante de residência.";
        }
      }
      if (item.documentType === "comprovante_residencia" && residenceRule && item.status !== "precisa_confirmacao") {
        const decision = residenceDecision({ rule: residenceRule, incomeType: clientContext?.primaryIncomeType, documentName: item.extractedData.nome || item.extractedData.name, clientName: clientContext?.fullName, personRole: item.personRole });
        if (decision && !["ilegivel", "divergencia"].includes(item.status) && (item.status !== "pendencia" || /nome|titular|terceiro/i.test(item.observations))) {
          // A titularidade é decidida pelo perfil cadastrado e pela regra ativa,
          // preservando problemas físicos que exigem conferência humana.
          item.status = item.expired ? "precisa_confirmacao" : decision.status;
          if (item.status !== "conforme") item.observations = decision.reason;
          item.ruleTrace = item.status === "conforme" ? null : { ruleId: residenceRule.id, problem: item.status === "pendencia" ? "Titularidade incompatível" : "Titularidade não confirmada", justification: decision.reason };
        }
      }
      if (item.status === "pendencia" && !item.ruleTrace) {
        if (item.documentType === "comprovante_residencia" && !residenceRule && /nome de terceiro|titularidade de terceiro/i.test(item.observations)) {
          item.status = "conforme";
          item.observations = "Titularidade de terceiro identificada; nenhuma regra ativa restringe essa condição.";
        } else {
          item.status = "precisa_confirmacao";
          item.observations = item.observations || "Necessita validação; nenhuma regra ativa fundamenta a pendência.";
        }
      }
      // Comprovante de residência só é exigido do proponente principal (regra
      // do dono, 2026-10-02): qualquer pendência/validação sobre o comprovante
      // do cônjuge/segundo proponente/dependente é descartada, venha da regra
      // de titularidade, da fonte da conta ou da própria IA.
      return normalizeNonPrincipalResidenceItem(item);
    });

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
  const cacheCreationTokens = Number(payload?.usage?.cache_creation_input_tokens) || 0;
  const cacheReadTokens = Number(payload?.usage?.cache_read_input_tokens) || 0;

  return {
    items,
    divergences,
    messageFacts: result.messageFacts && typeof result.messageFacts === "object" ? result.messageFacts : {},
    usage: {
      model: MODEL,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      costUsd: estimateAnalysisCostUsd(inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens)
    }
  };
}

// Texto do bloco VARIÁVEL (nunca cacheado) — nome do titular (pra ajudar a
// IA a reconhecer quem é quem nos documentos) + quantos arquivos vêm a
// seguir. Fica fora do "system" de propósito: se entrasse no bloco fixo, o
// nome do cliente mudaria o prefixo a cada chamada e derrubaria o cache
// inteiro (ver "silent invalidators" em shared/prompt-caching.md do skill
// claude-api).
function buildClientContextText(clientContext, fileCount) {
  const lines = [`Você está classificando um LOTE de ${fileCount} documento(s) a seguir.`];
  if (clientContext) lines.push(`DADOS DO CADASTRO (não invente campos): ${JSON.stringify(clientContext)}. Identifique estado civil, cônjuge, dependentes e renda antes de aplicar regras.`);
  return lines.join(" ");
}

// Bloco FIXO — instruções de análise + checklist de tipos de documento do
// MCMV. É IDÊNTICO em toda chamada (não depende de cliente, corretor ou
// empreendimento), por isso é um texto pré-computado no carregamento do
// módulo, não uma função reconstruída a cada análise — garante bytes
// idênticos entre chamadas, requisito do prompt caching. Marcado com
// cache_control no ponto de chamada (mais abaixo).
const CHECKLIST_TYPES_LIST = DOCUMENT_TYPE_OPTIONS.filter((option) => option.key !== "nao_identificado").map((option) => `${option.key} (${option.label})`).join(", ");

const FIXED_SYSTEM_INSTRUCTIONS = `Você está classificando documentos pessoais enviados por clientes de uma operação de financiamento imobiliário (MCMV), para uma conferência preliminar (NÃO é aprovação de crédito).

IMPORTANTE SOBRE O SEU PAPEL: seu trabalho é só identificar e ler cada documento que REALMENTE está no lote enviado pelo usuário. Você NUNCA decide o que está faltando/"ausente" — isso é calculado depois, por código, cruzando com o cadastro do cliente. Não gere nenhum item para um documento que não existe no lote.

Trate os arquivos de um mesmo lote como um conjunto relacionado à mesma operação (podem ser de mais de uma pessoa: titular, cônjuge, dependentes) — cruze informações entre eles, não analise cada um isoladamente.

Tipos de documento (use exatamente uma destas chaves em "documentType", ou "nao_identificado" se realmente não conseguir determinar): ${CHECKLIST_TYPES_LIST}.

Para CADA documento identificado dentro do lote, gere um item com "documentIndex" apontando pro arquivo que o originou. Um único arquivo (ex.: um PDF) pode conter MAIS DE UM tipo de documento em páginas diferentes — nesse caso gere um item por tipo de documento encontrado, preenchendo "pageRange" (ex.: "1-2") quando o arquivo tiver várias páginas e você conseguir identificar o intervalo; deixe "pageRange" vazio se não for possível ou não se aplicar.

PARA CADA ITEM, determine "personRole" — de quem é esse documento:
- "titular": pertence à pessoa do cadastro (nome do titular informado no início da mensagem do usuário, junto com os arquivos). Compare o nome no documento com esse nome.
- "conjuge": pertence a um cônjuge/companheiro(a) do titular — geralmente porque aparece numa certidão de casamento junto com o titular, ou porque o próprio documento se refere a ele(a) como cônjuge.
- "dependente": pertence a um filho(a) menor de idade do titular — normalmente uma certidão de nascimento de uma criança, mencionando o titular como pai/mãe. NUNCA agrupe a certidão de nascimento de um filho junto com os documentos do próprio titular — é uma pessoa separada, com seu próprio "personLabel" (nome da criança).
- "outro": qualquer pessoa que não se encaixe nos papéis acima, ou quando não for possível determinar.
Preencha também "personLabel" com o nome completo encontrado no documento daquela pessoa específica. Se não conseguir determinar a pessoa/papel com confiança, use personRole "outro" e status "precisa_confirmacao".

NUNCA adivinhe. Se a confiança for baixa (tipo de documento incerto, pessoa/papel incerto, ou letra ilegível a ponto de não dar pra confirmar o tipo), use status "precisa_confirmacao" e explique em "observations" — não escolha aleatoriamente entre possibilidades.

Não invente exigências. Para marcar "pendencia", cite em ruleId o ID de uma regra ativa aplicável e explique o problema em observations e a aplicação em justification. Se faltar informação para aplicar a regra, use "precisa_confirmacao". As instruções fixas de leitura orientam a extração; não criam novas exigências de titularidade.

REGRAS DE LEITURA (interpretação do CONTEÚDO de cada documento — isto sim é seu trabalho, o que muda é só o tipo de documento):

1) CERTIDÃO DE CASAMENTO: verifique se existe averbação/anotação de divórcio, separação ou dissolução na própria certidão. Se existir, registre isso claramente em "observations" (ex.: "Certidão de casamento com averbação de divórcio identificada.") — isso muda o que o sistema vai exigir depois. Se não existir nenhuma menção, considere o casamento vigente.

2) COMPROVANTE DE RESIDÊNCIA: identifique a origem em extractedData.residenceSource como water, electricity, internet, telephone, credit_card, bank_statement, generic_bill ou unknown. Extraia nome e endereço. Só as regras ativas decidem quais fontes e titulares são aceitos. Se faltar dado, use precisa_confirmacao. IMPORTANTE: comprovante de residência é exigido APENAS do proponente principal (titular); para cônjuge, segundo proponente ou dependente NUNCA marque pendência, divergência ou validação por causa de comprovante de residência (titularidade, fonte ou validade) — apenas identifique e extraia os dados.

3) HOLERITE DE FÉRIAS: se identificar que um holerite é especificamente de férias, mencione isso em "observations" (ex.: "Holerite de férias — competência de agosto/2026.") — um holerite de férias sozinho não é uma competência regular.

4) PIS: extraia o número do PIS de QUALQUER documento onde ele aparecer (CTPS, CTPS digital, extrato FGTS, Meu INSS, Caixa Trabalhador, Caixa Tem, holerite, etc.), preenchendo "extractedData.pis" — não é necessário um documento específico "de PIS".

5) VALIDADE/VENCIMENTO: para comprovante_residencia, extrato_bancario, fatura_cartao, holerite e fgts marque "expired": true se a data demonstrar claramente que está desatualizado. Para os demais tipos, false. Sem data legível, solicite validação, sem presumir vencimento.

6) Preencha "extractedData" com os dados relevantes que conseguir ler do documento (nome, cpf, pis, endereço, data, empregador, renda, competência — só os campos que existirem e você tiver certeza).

Se houver extratos bancários, extraia em extractedData.bankMonths um array por mês YYYY-MM com credits: [{amount, payerName, relation, evidence}]. relation é self, spouse ou first_degree_relative SOMENTE com evidência inequívoca; caso contrário use unknown. Inclua TODAS as entradas legíveis. Não some por inferência. Para certidão de casamento, extractedData.divorceAnnotation deve ser true, false ou null conforme texto legível; ausência explícita de averbação = false. Para FGTS extraia data/competência. Em messageFacts, informe apenas e-mail, PIS, endereço e outros dados realmente presentes nas mensagens SELECIONADAS; nunca use mensagem não selecionada.

Detecte divergências REAIS entre os documentos ENVIADOS (nome, CPF, PIS, endereço, empregador, renda, datas inconsistentes entre dois arquivos do lote) e liste em "divergences" — cada divergência é só um SINAL para conferência humana, nunca uma reprovação. NÃO compare com o cadastro do CRM aqui — isso é feito depois, por código.

Status possíveis por item: "conforme" (documento claro e válido), "pendencia" (problema específico neste documento, ex.: página faltando, dado incompleto — explique em observations), "ilegivel" (não dá pra ler o conteúdo), "divergencia" (dado deste documento diverge de outro do lote — também cite em divergences), "precisa_confirmacao" (baixa confiança). NUNCA use "ausente" — não é seu trabalho decidir isso.`;

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
              expired: { type: "boolean", description: "true só para comprovante_residencia/extrato_bancario/fatura_cartao/holerite/fgts claramente desatualizados; sempre false para os demais tipos." },
              pageRange: { type: ["string", "null"] },
              observations: { type: ["string", "null"] },
              confidence: { type: ["number", "null"] },
              extractedData: { type: "object" },
              ruleId: { type: ["string", "null"], description: "ID de uma regra ativa que fundamenta a pendência; null caso não haja regra." },
              justification: { type: ["string", "null"], description: "Justificativa curta baseada na regra citada." },
              evidence: { type: ["string", "null"], description: "Trecho/dado observado que sustenta a conclusão." }
            },
            required: ["documentIndex", "personLabel", "personRole", "documentType", "status", "expired"]
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
        },
        messageFacts: { type: "object", description: "Dados extraídos exclusivamente das mensagens selecionadas." }
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

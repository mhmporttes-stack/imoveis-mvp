# Análise documental — arquitetura real (verificada no código em 2026-10-02)

Referência do agente `analista-documental`. Linhas citadas valem para o commit desta data — confira com `grep` antes de afirmar.

## 1. Fluxo ponta a ponta

| Etapa | Onde | O que faz |
|---|---|---|
| Upload (painel) | `components/ClientDocumentsModal.jsx` → `POST /api/admin/client-documents/batches` → `createDocumentBatch` (`lib/client-documents.js:50`) | Cria lote e URLs assinadas de upload (bucket privado `client-documents`, `lib/media-storage.js`). O navegador sobe direto ao Storage (anon key, só storage). |
| Confirmação | `POST .../batches/[id]/confirm` → `confirmDocumentBatchUpload` (`:76`) | Grava `client_documents` e chama `analyzeBatchNow` **de forma síncrona** (`:104`). |
| Entrada pelo Chat | `POST .../from-chat` → `analyzeSelectedChatMessages` (`:111`) | Copia as mídias das mensagens selecionadas para o lote; texto das mensagens vira `selectedMessages`/`messageFacts`. |
| Duplicados | `uniqueDocumentBytes` (`lib/document-identity.mjs:7`) | SHA-256 dos bytes; só idênticos são duplicados. Falha de download não marca duplicado. |
| Classificação + extração (IA) | `analyzeClientDocumentBatch` (`lib/document-analysis.js:51`) | Uma chamada por lote com todos os arquivos únicos. Ver §2. |
| Regras da Base Mestra | `listDocumentAiRules({activeOnly:true})` (`lib/document-ai-rules.js:9`), usado em `client-documents.js:254` | Só regras `active`. Vão como texto para a IA **e** ligam comportamentos por `rule_key` no código (§3). |
| Pós-processamento | `lib/document-analysis.js:131-147` | `residenceDecision` (titularidade) e `residenceSourceDecision` (fonte) sobrescrevem o status do comprovante; `ruleTrace` só se a IA citou uma regra ativa. |
| Requisitos ("ausente") | `recomputeRequirements` (`client-documents.js:378`) → `evaluateDocumentRequirements` (`lib/document-requirements-engine.js:18`) | Código puro: cruza cadastro + tudo já classificado (inclusive lotes anteriores, `priorItems` com `limit(100)` em `:257`). |
| Renda informal | `calculateBankIncomeForClient` (`lib/document-policy.mjs:15`), só com `bank_income` ativa (`client-documents.js:325`) | Média bruta e líquida de 3 meses; exclui PIX próprio/cônjuge/parente **só com nome comprovado**. |
| Resultado | `client_document_batches.summary` (`:329`) | `duplicateDocumentIds`, `ruleRevision`, `usedRules`, `messageFacts`, `income`, `generatedMessage`. |
| Devolutiva | `pendingClientMessage` (`lib/document-policy.mjs:42`) → `sendDocumentPendingMessage` (`client-documents.js:195`) | Título `*DEVOLUTIVA CAIXA DOCUMENTAÇÃO*`, uma linha por documento, "Documento pendente." / "Documento ilegível." etc. Enviada pelo Chat/WhatsApp. |
| Reanálise | `reanalyzeBatch` (`:468`) | Se nada novo e `ruleRevision` igual → só recalcula o motor (custo zero de IA). |
| Correção manual | `correctChecklistItem` (`:633`) | Gestor corrige uma linha. |
| PDF / ficha | `generateClientDocumentPdf` (`:716`) → `buildClientDocumentPdf` (`lib/client-document-pdf.js:26`) | 1ª página "Ficha cadastral" (`:133`) com logo, dados do proponente principal (`coverFacts`, `lib/document-cover-facts.mjs:13` — mais velho = principal), endereço, cônjuge/2º proponente, renda por extratos. Depois os documentos mesclados (PDF/JPG/PNG). Exige só o nome (`assertClientReadyForPdf`, `:702`). |
| CCA | `prepareCcaSubmission` (`:677`) / `submitToCca` (`:728`) | Gera PDF, URL assinada de 7 dias, e-mail à CCA, status do cliente → `APPROVAL_PENDING`. |

## 2. Integração com a IA (fatos)

- **Provedor:** Anthropic Messages API (`fetch` para `https://api.anthropic.com/v1/messages`, `lib/document-analysis.js:79`). **Não é OpenAI.**
- **Modelo:** `process.env.ANTHROPIC_DOCUMENT_MODEL || "claude-sonnet-5"` (`:18`). `ai_usage_log` confirma chamadas desse modelo desde 2026-09-21.
- **Arquivos:** base64 inline — PDF como bloco `document`, JPG/PNG/WEBP como `image`. HEIC/HEIF não são analisados.
- **Saída estruturada:** tool forçada `submit_analysis` (`:296`), `status` em enum `conforme|pendencia|ilegivel|divergencia|precisa_confirmacao` (sem `ausente`).
- **Prompt:** `FIXED_SYSTEM_INSTRUCTIONS` com `cache_control` (`:105`) + bloco "REGRAS ATIVAS" (`:106`) com `[id] categoria — título: instrução`.
- **Limites:** `max_tokens: 8000` (`:88`), timeout 120 s (`:110`), **sem retry**, sem teto de tamanho total do lote (só 20 MB por arquivo no upload).
- **Custo:** preço fixo no código US$ 2 / US$ 10 por milhão (`:25-26`) — estimativa; confirmar com a tabela vigente antes de reportar custo real. Registro em `ai_usage_log` (`lib/ai-usage.js`).
- **Validação da resposta:** `cleanText`/normalização no pós-processamento; `messageFacts` não é validado contra o cadastro.
- **PII:** os documentos completos e o contexto do cliente vão para a API (necessário para a tarefa); não há mascaramento.

## 3. Base Mestra (`document_ai_rules`)

Colunas: `id, category, title, instruction, rule_key (unique), policy jsonb, active`. Edição só admin geral em `/admin/documentacao/regras` (`components/DocumentAiRulesManager.jsx`, `app/api/admin/document-ai-rules/**`).

**O comportamento é ligado por `rule_key` no código; o texto `instruction` só orienta a IA.** Excluir/desativar uma regra desliga o comportamento sem aviso. Regras em 2026-10-02 (todas ativas):

| rule_key | Categoria | Efeito no código |
|---|---|---|
| `residence_income_ownership` | Comprovante de residência | `residenceDecision` (`lib/document-ai-rule-core.mjs:1`) com `policy` por tipo de renda (informal = só titular; CLT/IR = terceiro permitido). |
| `residence_source` | Residência | `residenceSourceDecision`: água/luz/internet/telefone; fatura de cartão só quando a renda é por faturas e não há conta de consumo. |
| `marriage_spouse` | Estado civil | Certidão de casamento sem averbação ⇒ trata como casado e exige documentos do cônjuge (motor `:23`; alerta em `client-documents.js:272`). |
| `fgts_updated` | FGTS | Exige extrato FGTS (também de não-CLT) e marca desatualizado como pendência (motor `:64`). |
| `bank_income` | Renda informal | Liga o cálculo de renda por extratos. |
| `ctps_format` | CTPS | **Só texto para a IA** — nenhum efeito no código. |

## 4. Status

Enum gravado: `conforme`, `pendencia`, `ilegivel`, `divergencia`, `precisa_confirmacao` (IA) + `ausente` (só motor). Rótulos: `lib/document-status-labels.js` (fonte única).

## 5. Lacunas técnicas conhecidas (não corrigidas — decisão do dono)

1. Sem retry/teto de tamanho na chamada à IA; análise síncrona de até 120 s pode deixar lote em `processing`.
2. Sem lock de concorrência em `analyzeBatchNow` (duplo clique/duas abas).
3. `regularResidence` (motor) não filtra `personRole` nem `expired`.
4. Comprovante recusado por titularidade pode reaparecer `conforme` se reclassificado com outro tipo.
5. Categorias da tela de regras ≠ categorias semeadas.
6. `priorItems.limit(100)` — clientes com muitos documentos podem perder evidência antiga.
7. Divergências acumulam entre lotes.
8. `duplicateDocumentIds` não aparece na UI.
9. WEBP é analisado mas fica fora do PDF mesclado; HEIC/HEIF nem são analisados.
10. Permissões: `prepareCcaSubmission`/`submitToCca`/`deleteClientDocument` só checam acesso ao cliente (sem checagem de papel); `confirmDocumentBatchUpload` não valida `storage_path`.
11. **Segurança (corrigido em 2026-10-02):** as tabelas `client_documents`, `client_document_batches`, `client_document_checklist_items`, `client_document_submissions`, `ai_usage_log` e `cca` estavam legíveis/alteráveis com a anon key pública. Migration `20261002180000_lock_client_documents_rls.sql`: RLS ligado + `revoke all` de `anon`/`authenticated`, sem policy (todo acesso é service role no servidor). Ao criar tabela nova do módulo, siga o mesmo padrão.
12. Bucket `whatsapp-chat-media` é público.

## 6. Ferramentas locais de inspeção (desenvolvimento, nunca produção)

- `node .claude/skills/analisar-documentacao/scripts/inspecionar-arquivos.mjs <pasta>` — tipo, tamanho, SHA-256, páginas, texto por página, "parece escaneado", duplicados exatos, se o CRM analisa/mescla aquele formato. Usa `pdfjs-dist` já instalado.
- poppler (`pdfinfo`, `pdftotext -layout`, `pdftoppm -r 150 -png`) e ImageMagick (`convert`) costumam estar no container Linux; sem OCR (tesseract) — para escaneado, leia a imagem renderizada com a ferramenta Read (visão).
- A skill oficial de PDF da Anthropic (`anthropics/skills`, licença proprietária) foi pesquisada como referência de técnica (texto × escaneado, rasterizar para visão, extrair tabelas); nada dela foi copiado.

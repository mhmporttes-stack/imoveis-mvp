---
paths:
  - "lib/client-document*"
  - "lib/document-*"
  - "lib/document-*.mjs"
  - "lib/cca*"
  - "lib/client-cca-status.js"
  - "lib/broker-alert.js"
  - "lib/ai-usage.js"
  - "lib/chat-document-progress.mjs"
  - "components/ClientDocumentsModal.jsx"
  - "components/Cca*.jsx"
  - "components/DocumentAiRulesManager.jsx"
  - "components/AdminAiUsageDashboard.jsx"
  - "app/admin/documentacao/**"
  - "app/admin/gastos-ia/**"
  - "app/api/admin/client-documents/**"
  - "app/api/admin/cca/**"
  - "app/api/admin/client-cca-status/**"
  - "app/api/admin/document-ai-rules/**"
---

# Documentação do cliente, análise por IA e envio à CCA

Módulo para coletar, classificar e conferir os documentos de um cliente antes de enviar para uma CCA (Central de Crédito e Análise) parceira. Arquivos principais: `lib/client-documents.js` (orquestração), `lib/document-analysis.js` (chamada à IA), `lib/document-requirements-engine.js` (regras determinísticas), `lib/client-document-pdf.js` (geração do PDF), `lib/cca.js` (cadastro de CCAs parceiras), `lib/broker-alert.js`. UI: `components/ClientDocumentsModal.jsx`.

## Arquitetura: IA classifica, código decide o que falta

Separação deliberada, não misture as duas responsabilidades de volta:

- **`lib/document-analysis.js`** (chama a API da Anthropic, ver `.claude/rules/integracoes-externas.md`) só CLASSIFICA documentos que literalmente existem no lote enviado — cada item classificado sempre tem `documentId`, `personRole` (titular/conjuge/dependente/outro), `documentType`, `status` (conforme/pendencia/ilegivel/divergencia/precisa_confirmacao) e `expired` quando aplicável. **A IA nunca decide "ausente"** — isso está fora do schema que ela pode retornar (verificado: o enum de status permitido no tool schema exclui `"ausente"`, e o prompt proíbe isso explicitamente).
- **`lib/document-requirements-engine.js`** (`evaluateDocumentRequirements`) é a ÚNICA fonte que decide quais documentos estão faltando (`ausente`) — puramente em código, cruzando o cadastro do cliente (estado civil, tipo de renda, tem filhos menores) com tudo que já foi classificado, de qualquer lote anterior. Zero tokens de IA nesse cálculo.

Se um pedido futuro for "mudar a regra de quais documentos são obrigatórios", a mudança é **sempre** em `document-requirements-engine.js`, nunca no prompt da IA.

## Regras documentais do dono e agente especialista

**[REGRA OFICIAL DE NEGÓCIO — definida pelo dono em 2026-10-02]** As regras documentais Caixa/MCMV (identificação, comprovante de residência, estado civil/cônjuge, dependentes, CLT, renda informal, FGTS, IR, duplicados, proponente principal, validação cruzada, devolutiva, ficha do PDF) e onde cada uma vive (Base Mestra × código × falta) estão na **matriz de cobertura** de `.claude/analista-documental/REGRAS-DOCUMENTAIS.md` — fonte única, não duplique aqui. Lacunas listadas lá (ex.: validade do comprovante "mês atual/anterior", CPF cruzado determinístico) **não estão implementadas** e só viram código com pedido explícito do dono.

Hierarquia de autoridade: regras fixas do código > regras **ativas** da Base Mestra > cadastro > documentos > mensagens selecionadas. Caso sem regra ⇒ revisão humana, nunca exigência inventada. Para auditar/testar/explicar a análise use o agente `analista-documental` (`/analisar-documentacao`, `/auditar-analise-documental`, `/testar-regra-documental`); regressão sintética em `tests/document-regression.test.mjs`. Base Mestra: o comportamento é ligado por `rule_key` no código; o texto `instruction` só orienta a IA (`ctps_format` não tem efeito em código).

## Identidade das linhas do checklist

Princípio geral (`person_role` vs. `person_label`) em `.claude/rules/crm-clientes-funil.md` — aplicado aqui via um índice único parcial em `client_document_checklist_items`: `(client_id, person_role, document_type) where document_id is null`, para as linhas de "requisito".

Duas categorias de linha na mesma tabela: linhas de **classificação** (`document_id` preenchido, imutáveis exceto correção manual) e linhas de **requisito faltando** (`document_id` nulo, recalculadas a cada análise/reanálise via `recomputeRequirements`, upsert — nunca delete+insert, por causa de concorrência real já vista em produção com duplo-clique em "Reanalisar").

## Reanálise é gratuita quando não há documento novo

`reanalyzeBatch` verifica se todos os documentos do lote já foram classificados antes — se sim, só recalcula o motor determinístico (zero custo de IA), útil quando o gestor edita o cadastro (estado civil/renda) e quer recalcular sem reler PDFs.

## PDF e envio à CCA

`buildClientDocumentPdf` (pdf-lib): 1ª página "Ficha cadastral" digitada (logo, proponente principal = o mais velho via `coverFacts` em `lib/document-cover-facts.mjs`, endereço, cônjuge/2º proponente, renda por extratos) — não há mais tabela de conferência — seguida do PDF nativo mesclado (não foto de cada arquivo). WEBP/HEIC/HEIF não são suportados nativamente pelo pdf-lib — ficam de fora da mesclagem e aparecem em `skipped` para download manual (decisão deliberada, não adicione uma dependência nativa de conversão sem avaliar o risco de build na Vercel). Hoje só o **nome** é obrigatório antes de gerar o PDF ou enviar à CCA (`assertClientReadyForPdf`; o comentário em `submitToCca` que fala em e-mail/PIS está desatualizado) — sem ele, lança erro com `.code === "MISSING_CLIENT_FIELDS"` para a UI pedir os campos, nunca trava sem explicação.

Envio à CCA muda o status do cliente para `APPROVAL_PENDING` automaticamente — regra de negócio explícita do pedido original, não remova sem confirmar.

**[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-23] Destino no texto e envio direto sem IA (DOC-8).** (1) O texto do envio à CCA começa dizendo para onde vai a documentação ("📂 Documentação para enviar à MENIN — cliente {nome}", nome do destino cadastrado em maiúsculas), com e sem análise; montagem só em `buildCcaSubmissionMessage` (`lib/cca-submission-core.mjs`) — não crie outro texto. (2) No seletor de mídias do Chat e na tela de documentos há duas ações: "Analisar com IA" (de sempre) e "Enviar direto para análise (CCA)" — guarda os arquivos sem IA (lote `summary.analysisSkipped`) e usa o MESMO envio (`submitToCca`: mesmos guard, confirmação de pendências, status, `document_sent_to_cca` com `withoutAnalysis: true`, lido do lote no servidor). Lote sem análise pode ser analisado depois ("Analisar com IA" = `reanalyzeBatch`). A exigência de análise antes do envio era só da implementação (botão só em lote analisado), nunca regra. Detalhe: `docs/BUSINESS_RULES.md` DOC-8; testes `tests/cca-submission.test.mjs`.

**[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24] Corretor envia à CCA também pela ficha (DOC-9).** Todo perfil com acesso ao cliente envia pela tela de documentos da ficha (como já fazia pelo Chat); escopo só no servidor (`requireClientAccess` em `prepareCcaSubmission`/`submitToCca`). Correção de análise e PDF avulso continuam admin/gestor. Detalhe: `docs/BUSINESS_RULES.md` DOC-9.

## Rótulos

Fonte única de rótulos (`lib/document-status-labels.js`) em `.claude/rules/crm-clientes-funil.md`. Exemplo real de divergência que esse arquivo corrigiu: "A confirmar" no PDF vs. "Necessita confirmação" na tela, para o mesmo status.

## Gastos de IA

`lib/ai-usage.js` grava cada chamada em `ai_usage_log` (tokens, custo estimado, sucesso/falha) — tela em `/admin/gastos-ia`, só admin. Ao adicionar uma chamada de IA nova em qualquer parte do sistema, registre nessa mesma tabela em vez de criar um mecanismo de tracking paralelo.

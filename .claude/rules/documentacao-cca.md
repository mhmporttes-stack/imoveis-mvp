# Documentação do cliente, análise por IA e envio à CCA

Módulo para coletar, classificar e conferir os documentos de um cliente antes de enviar para uma CCA (Central de Crédito e Análise) parceira. Arquivos principais: `lib/client-documents.js` (orquestração), `lib/document-analysis.js` (chamada à IA), `lib/document-requirements-engine.js` (regras determinísticas), `lib/client-document-pdf.js` (geração do PDF), `lib/cca.js` (cadastro de CCAs parceiras), `lib/broker-alert.js`. UI: `components/ClientDocumentsModal.jsx`.

## Arquitetura: IA classifica, código decide o que falta

Separação deliberada, não misture as duas responsabilidades de volta:

- **`lib/document-analysis.js`** (chama a API da Anthropic, ver `.claude/rules/integracoes-externas.md`) só CLASSIFICA documentos que literalmente existem no lote enviado — cada item classificado sempre tem `documentId`, `personRole` (titular/conjuge/dependente/outro), `documentType`, `status` (conforme/pendencia/ilegivel/divergencia/precisa_confirmacao) e `expired` quando aplicável. **A IA nunca decide "ausente"** — isso está fora do schema que ela pode retornar (verificado: o enum de status permitido no tool schema exclui `"ausente"`, e o prompt proíbe isso explicitamente).
- **`lib/document-requirements-engine.js`** (`evaluateDocumentRequirements`) é a ÚNICA fonte que decide quais documentos estão faltando (`ausente`) — puramente em código, cruzando o cadastro do cliente (estado civil, tipo de renda, tem filhos menores) com tudo que já foi classificado, de qualquer lote anterior. Zero tokens de IA nesse cálculo.

Se um pedido futuro for "mudar a regra de quais documentos são obrigatórios", a mudança é **sempre** em `document-requirements-engine.js`, nunca no prompt da IA.

## Identidade das linhas do checklist

Princípio geral (`person_role` vs. `person_label`) em `.claude/rules/crm-clientes-funil.md` — aplicado aqui via um índice único parcial em `client_document_checklist_items`: `(client_id, person_role, document_type) where document_id is null`, para as linhas de "requisito".

Duas categorias de linha na mesma tabela: linhas de **classificação** (`document_id` preenchido, imutáveis exceto correção manual) e linhas de **requisito faltando** (`document_id` nulo, recalculadas a cada análise/reanálise via `recomputeRequirements`, upsert — nunca delete+insert, por causa de concorrência real já vista em produção com duplo-clique em "Reanalisar").

## Reanálise é gratuita quando não há documento novo

`reanalyzeBatch` verifica se todos os documentos do lote já foram classificados antes — se sim, só recalcula o motor determinístico (zero custo de IA), útil quando o gestor edita o cadastro (estado civil/renda) e quer recalcular sem reler PDFs.

## PDF e envio à CCA

`buildClientDocumentPdf` (pdf-lib): capa digitada (nunca extraída de OCR) com dados do cadastro + tabela de conferência, PDF nativo mesclado (não foto de cada arquivo). WEBP/HEIC/HEIF não são suportados nativamente pelo pdf-lib — ficam de fora da mesclagem e aparecem em `skipped` para download manual (decisão deliberada, não adicione uma dependência nativa de conversão sem avaliar o risco de build na Vercel). Nome/e-mail/PIS são obrigatórios antes de gerar o PDF ou enviar à CCA (`assertClientReadyForPdf`) — sem eles, lança erro com `.code === "MISSING_CLIENT_FIELDS"` para a UI pedir os campos, nunca trava sem explicação.

Envio à CCA muda o status do cliente para `APPROVAL_PENDING` automaticamente — regra de negócio explícita do pedido original, não remova sem confirmar.

## Rótulos

Fonte única de rótulos (`lib/document-status-labels.js`) em `.claude/rules/crm-clientes-funil.md`. Exemplo real de divergência que esse arquivo corrigiu: "A confirmar" no PDF vs. "Necessita confirmação" na tela, para o mesmo status.

## Gastos de IA

`lib/ai-usage.js` grava cada chamada em `ai_usage_log` (tokens, custo estimado, sucesso/falha) — tela em `/admin/gastos-ia`, só admin. Ao adicionar uma chamada de IA nova em qualquer parte do sistema, registre nessa mesma tabela em vez de criar um mecanismo de tracking paralelo.

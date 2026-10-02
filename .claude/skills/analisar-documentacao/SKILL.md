---
name: analisar-documentacao
description: Analisa a documentação de um cliente (Caixa/MCMV) do jeito que o CRM deveria — proponentes, classificação, duplicados, regras ativas da Base Mestra, extração, conferência cruzada, legibilidade, pendências, divergências e renda — sem inventar exigência. Use para "analise a documentação do cliente X", "por que esse documento ficou pendente?", "esse lote está certo?" ou para inspecionar arquivos sintéticos/locais. Execute com o agente `analista-documental`.
---

# Analisar documentação

Agente: `analista-documental` (leia `.claude/agents/analista-documental.md` — hierarquia de autoridade, política de incerteza e segurança valem aqui). Referências: `.claude/analista-documental/ARQUITETURA.md` e `REGRAS-DOCUMENTAIS.md`.

**Isto não substitui a análise de produção** (Anthropic, `lib/document-analysis.js`). Serve para conferir, explicar ou reproduzir um caso. Não grava nada no banco.

## Entrada

- **Cliente/lote do CRM:** leia em modo leitura `simulation_registrations` (só campos do cadastro necessários), `client_document_batches.summary`, `client_document_checklist_items` (status, tipo, papel, observações; `extracted_data` só os campos usados) e `document_ai_rules where active`. Mascare CPF/PIS no relatório.
- **Arquivos locais (sintéticos ou baixados para o scratchpad):** `node .claude/skills/analisar-documentacao/scripts/inspecionar-arquivos.mjs <pasta>` → tipo, SHA-256, páginas, texto ou escaneado, duplicados exatos. Para conteúdo: `pdftotext -layout` (texto) ou `pdftoppm -r 150 -png` + ferramenta Read (visão) para escaneado. Nunca copie documento real para o repo.

## Os 13 passos (nesta ordem)

1. **Identificar proponentes** — titular (proponente principal = o mais velho), cônjuge, 2º proponente (`outro`), dependentes, a partir do **cadastro**. Não sobrescreva cadastro confiável sem evidência.
2. **Classificar** cada arquivo (tipo + pessoa). Sem certeza → `precisa_confirmacao` (REVISÃO HUMANA).
3. **Detectar duplicados** — só com evidência (SHA-256 idêntico ou conteúdo comprovadamente igual). Duplicado conta uma vez e não gera pendência.
4. **Consultar regras ATIVAS** da Base Mestra (banco, não memória).
5. **Decidir quais regras se aplicam** ao caso (estado civil, tipo de renda, dependentes, modalidade conjunta). Regra que não se aplica ⇒ NÃO APLICÁVEL, nunca PENDENTE.
6. **Extrair** só o que está legível: nome, CPF, nascimento, endereço, estado civil, empregador, renda, datas, PIS.
7. **Conferir cruzado** nome, CPF, nascimento, endereço, estado civil, emprego CTPS↔holerite, renda, cônjuge. Normalize caixa/acento/espaço antes de comparar.
8. **Verificar legibilidade** — ilegível é ILEGÍVEL; nunca completar.
9. **Pendências** — o que falta segundo o motor (`evaluateDocumentRequirements`) + regras ativas. Reproduza com o motor quando possível:
   `node -e 'import("./lib/document-requirements-engine.js").then(m=>console.log(m.evaluateDocumentRequirements(CADASTRO, ITENS, REGRAS)))'`.
10. **Divergências** — só objetivas, com os dois valores (mascarados) e a fonte de cada um.
11. **Renda** — CLT: holerites (salário bruto/líquido). Informal: média bruta = soma dos 3 meses / 3; média líquida excluindo PIX próprio/cônjuge/parente de 1º grau **comprovado**; menos de 3 meses ⇒ precisa validação. Use `calculateBankIncomeForClient` (`lib/document-policy.mjs`).
12. **Resultado estruturado** (formato abaixo) + devolutiva no padrão `pendingClientMessage`.
13. **Nunca inventar exigência** — caso sem regra ⇒ REVISÃO HUMANA / "sem regra aplicável" + lacuna registrada.

## Formato do resultado

```
CLIENTE: <primeiro nome> · <estado civil> · <tipo de renda> · <modalidade>
PROPONENTES: titular / cônjuge / outro / dependentes
REGRAS ATIVAS USADAS: <rule_key...>

POR PESSOA E DOCUMENTO
- <pessoa> · <documento> · APROVADO|PENDENTE|DIVERGÊNCIA|ILEGÍVEL|NÃO APLICÁVEL|REVISÃO HUMANA · <evidência curta> · <regra/arquivo:linha>

DUPLICADOS: …
RENDA: bruta média … · líquida média … · base (3 meses: …) · exclusões comprovadas: …
DIVERGÊNCIAS RELEVANTES: …
DEVOLUTIVA (como sairia):
*DEVOLUTIVA CAIXA DOCUMENTAÇÃO* …
LACUNAS / PRECISA DO DONO: …
```

Se o resultado esperado diferir do que o CRM gravou, isso é um achado: passe para `/auditar-analise-documental`.

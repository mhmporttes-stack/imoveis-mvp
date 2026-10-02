---
name: testar-regra-documental
description: Testa uma regra documental (existente ou proposta pelo dono) com casos sintéticos de regressão contra o motor determinístico do CRM — requisitos, comprovante de residência, renda informal, duplicados e devolutiva. Use para "essa regra funciona?", "o que muda se ativar/desativar X?", "crie casos de teste para Y", antes e depois de mexer em lib/document-*. Execute com o agente `analista-documental`.
---

# Testar regra documental

Arquivos:

- `tests/fixtures/documentos/casos-requisitos.json` — casos do motor de requisitos (`cadastro`, `classificados`, `regras` opcional, `esperado`, `proibido`, `exatamente`).
- `tests/document-regression.test.mjs` — roda os casos + testes de residência, renda, duplicados, devolutiva e as lacunas como `todo`.

Rodar: `node --test tests/document-regression.test.mjs` (e `node --test tests/document-*.test.mjs` para a área inteira).

## Passos

1. **Localize a regra** na Matriz de cobertura (`.claude/analista-documental/REGRAS-DOCUMENTAIS.md`): Base Mestra (`rule_key`), código fixo, só IA ou FALTA.
2. **Escreva casos sintéticos** cobrindo: aplica / não aplica / borda / regra inativa. Nomes fictícios ("Ana Teste Sintética"), sem CPF real, sem documento real.
   - Formato de um caso:
     ```json
     { "nome": "…", "cadastro": { "primaryMaritalStatus": "single", "primaryIncomeType": "registered_employment", "pis": "00000000000" },
       "classificados": [{ "personRole": "titular", "documentType": "rg", "status": "conforme" }],
       "esperado": ["titular:holerite:ausente"], "proibido": ["conjuge:rg"] }
     ```
   - `esperado`: `papel:tipo:status`; `proibido`: `papel:tipo` que não pode aparecer; `"exatamente": true` exige que a lista seja só o esperado.
3. **Rode antes** de qualquer mudança: o caso falha? Então é comportamento atual diferente da regra — reporte. Não edite o motor sem pedido.
4. **Regra do dono ainda não implementada:** registre como `test(..., { todo: "…" })` + lacuna em `REGRAS-DOCUMENTAIS.md`. Não implemente por conta própria.
5. **Com pedido de implementação:** altere o mínimo, rode a área toda e confirme que nenhum caso antigo mudou sem justificativa.
6. **Regra só da IA** (texto da Base Mestra/prompt): o motor não testa isso. Descreva o teste manual (documento sintético + resultado esperado) e, se o dono quiser, rode no ambiente de produção só com documento sintético e com autorização — cada chamada custa tokens e grava em `ai_usage_log`.

## Relatório

```
REGRA: <descrição> · onde vive: <BM rule_key | código | IA | FALTA>
CASOS: <n> (aplica / não aplica / borda / inativa)
RESULTADO: pass X · fail Y · todo Z
FALHAS: <caso> esperado … obtido …  ⇒ diferença entre regra e código (não corrigida)
```

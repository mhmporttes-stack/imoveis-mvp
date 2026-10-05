# Regras documentais (Caixa/MCMV) — regras do dono × implementação

**[REGRA OFICIAL DE NEGÓCIO — definida pelo dono em 2026-10-02]** para os itens da coluna "Regra do dono". A coluna "Onde vive hoje" diz onde cada uma está implementada. **Uma regra = uma fonte de verdade:** política editável → Base Mestra (`document_ai_rules`); requisito fixo → `lib/document-requirements-engine.js`. Não duplique o texto da regra em outro lugar — aponte para cá.

Antes de usar esta tabela, confira a Base Mestra real (`select rule_key, title, active from document_ai_rules`). Se divergir, vale o banco/código e esta página deve ser corrigida.

## Matriz de cobertura

Legenda: **BM** = Base Mestra (`rule_key`) · **CÓDIGO** = fixo no motor/política · **IA** = só no prompt · **FALTA** = não implementado.

| # | Regra do dono | Onde vive hoje | Teste |
|---|---|---|---|
| 1 | Identificação: RG + CPF **ou** CNH, legível | CÓDIGO (motor, item 1 de `evaluatePerson`: RG ou CNH). Legibilidade = IA (`ilegivel`) | casos "CNH sozinha", "RG ilegível" |
| 2 | Comprovante de residência do **mês atual ou anterior** | **FALTA** — hoje só `expired` julgado pela IA | `todo` |
| 2b | **[REGRA OFICIAL — dono, 2026-10-02]** Comprovante de residência é exigido **só do proponente principal** (`titular`). Cônjuge/segundo proponente (`outro`)/dependente **nunca** geram pendência ou validação de comprovante de residência, seja renda CLT ou informal | CÓDIGO — `isResidenceRequiredForRole`/`normalizeNonPrincipalResidenceItem` (`lib/document-policy.mjs`), aplicada em `document-analysis.js` e em todo recálculo (`recomputeRequirements`); `residenceDecision` recebe `personRole` | `tests/document-second-proponent-residence.test.mjs` |
| 3 | Comprovante em nome de terceiro: permitido para CLT e IR; informal exige nome próprio | BM `residence_income_ownership` (`policy`) | "terceiro permitido/não permitido" |
| 4 | Fatura de cartão como comprovante só quando renda por faturas e sem conta de água/luz/internet/telefone | BM `residence_source` | "fontes de comprovante", caso "informal 3 faturas" |
| 5 | Certidão de casamento sem averbação ⇒ pedir documentos do cônjuge, **sem** nova certidão nem novo comprovante para ele; sem a regra, não pedir nada do cônjuge | BM `marriage_spouse` + CÓDIGO (motor) | casos "casado sem averbação", "solteiro", "divórcio averbado" |
| 6 | Exceção: segunda pessoa no financiamento | CÓDIGO (motor: `simulationType === "joint"` ⇒ linhas `outro`) | caso "financiamento conjunto" |
| 7 | Dependentes < 18 conforme cadastro | CÓDIGO (motor: `hasChildrenUnder18`) | casos "com/sem dependente" |
| 8 | CLT: 2 últimos holerites; CTPS para TODOS (dono 2026-10-05); união estável pede certidão de **nascimento** (dono 2026-10-05; viúvo = casamento só na lista da apresentação, motor sem regra) | CÓDIGO (holerite ×2, CTPS); formato da CTPS = BM `ctps_format` (só texto para IA) | "CLT completo", "CLT 1 holerite" |
| 9 | Informal: 3 extratos **ou** 3 faturas (quando permitido) | CÓDIGO (motor) | "informal 2 de 3 extratos", "vários extratos" |
| 10 | Renda informal: média bruta = soma/3; excluir PIX próprio, parente de 1º grau e cônjuge **quando identificável**; calcular média líquida | BM `bank_income` + CÓDIGO (`calculateBankIncomeForClient`) | "média bruta/líquida", "parentesco não comprovado" |
| 11 | FGTS: extrato atualizado quando a regra estiver ativa | BM `fgts_updated` + CÓDIGO (CLT sempre exige FGTS no motor) | — |
| 12 | IR: declaração + recibo quando aplicável; não exigir indiscriminadamente | CÓDIGO (só `income_tax_declarant`) | "IR sem recibo", "CLT não pede IR" |
| 13 | Duplicados: idênticos contam uma vez; parecidos não são duplicados sem evidência | CÓDIGO (SHA-256). Reescaneado = **FALTA** (depende da IA) | "duplicidade", `todo` |
| 14 | Titular = proponente principal; Outro = cônjuge/2º proponente (uso interno). Principal = o mais velho | CÓDIGO (`coverFacts`, `lib/document-cover-facts.mjs`) | — |
| 15 | Não sobrescrever dado confiável do cadastro sem evidência | CÓDIGO parcial (`keepExistingIdentity`; capa do PDF digitada do cadastro) | — |
| 16 | Validação cruzada (nome, CPF, nascimento, endereço, estado civil, CTPS↔holerite, renda, cônjuge) com divergência **objetiva** | IA (`divergences`). Normalização de nome só no comprovante (`residenceDecision`). CPF determinístico = **FALTA** | "nome caixa/acento", `todo` CPF |
| 17 | Nunca completar dado ilegível | IA (prompt) + status `ilegivel` | "RG ilegível" |
| 18 | Devolutiva: título "DEVOLUTIVA CAIXA DOCUMENTAÇÃO", "Documento pendente.", sem repetição, sem "Favor enviar este documento", sem seção longa de conferência | CÓDIGO (`pendingClientMessage`) | "devolutiva" |
| 19 | PDF: 1ª página ficha cadastral (nome, CPF, nascimento, endereço completo do comprovante válido, telefone, e-mail, PIS), logo, "Matheus Machado corretor de imóveis" | CÓDIGO (`lib/client-document-pdf.js`) — conferir campo a campo antes de afirmar completude | — |
| 20 | Unknown/sem regra ⇒ não inventar exigência | CÓDIGO (motor ignora renda/estado civil desconhecidos) | "renda/estado civil desconhecidos" |

## Lacunas abertas (aguardam decisão/tarefa explícita do dono)

- **L-1** Validade do comprovante (mês atual/anterior) não é regra determinística.
- **L-2** Sem validação cruzada determinística de CPF/nome/nascimento entre cadastro e documentos.
- **L-3** Comprovante de residência no motor não filtra papel nem validade (`regularResidence`).
- **L-4** Reescaneado/refotografado não é detectado como duplicado.
- **L-5** `ctps_format` não tem efeito no código (só orienta a IA).
- **L-6** Regras fixas (RG/CNH, holerites, IR, extratos, dependentes, 2º proponente, PIS) não aparecem na Base Mestra — o dono não as vê nem edita na tela. Mover para a Base Mestra é decisão dele.
- **L-7** FGTS: com `fgts_updated` ativa, o motor exige extrato também de quem **não** é CLT — **[PENDENTE DE VALIDAÇÃO]** se é a intenção.

Cada lacuna nova: acrescente aqui **e** como `todo` em `tests/document-regression.test.mjs`.

# A2 — Fontes documentais para o Guia do Corretor (auditoria somente leitura, 2026-10-03)

Método: Base Mestra lida direto do banco (`document_ai_rules`, só SELECT, 6 linhas, todas `active=true`) + código + `.claude/analista-documental/REGRAS-DOCUMENTAIS.md` (matriz do dono, 2026-10-02). Nada foi alterado. Sem dado de cliente.
As pistas do dono NÃO são regra oficial; abaixo, cada uma foi conferida. O Guia só pode CONSULTAR/EXPLICAR; o que o corretor deve exigir vem da Base Mestra + motor, nunca de texto próprio do Guia.

## Legenda
FONTE ATIVA = Base Mestra ativa ou código em produção · FONTE INTERNA A CONFIRMAR = regra do dono escrita só em doc interno, sem implementação · CONTEÚDO ANTIGO · EXEMPLO · HIPÓTESE · NÃO CONFIRMADO

## 1. Textos completos das 6 regras ativas da Base Mestra (banco = migration de seed, idênticos)

| rule_key | Categoria | Texto atual (integral) |
|---|---|---|
| `residence_income_ownership` | Comprovante de residência | "Identifique primeiro o tipo de renda no cadastro. Renda informal: o comprovante deve estar no nome do próprio cliente. CLT ou declarante de IR: pode estar em nome de terceiro. Se a renda ou o nome não puder ser confirmado, peça validação; não presuma uma pendência." policy: informal=`titular_only`, CLT=`third_party_allowed`, IR=`third_party_allowed` |
| `residence_source` | Residência | "Aceite como comprovante de residência somente conta de água, energia elétrica, internet ou telefone com nome e endereço legíveis. Não aceite nenhum boleto nem extrato bancário. Fatura de cartão só pode servir de endereço quando usada para comprovar renda e não houver conta utilizável." |
| `marriage_spouse` | Estado civil | "Certidão de casamento sem averbação de divórcio exige documentação aplicável do cônjuge, salvo segunda certidão de casamento e segundo comprovante de residência. Se cadastro contradizer certidão, sinalize divergência." |
| `fgts_updated` | FGTS | "Exija extrato do FGTS atualizado. Se estiver ausente ou claramente desatualizado, registre pendência específica; se não houver data legível, peça validação." |
| `bank_income` | Renda informal | "Para três meses de extratos bancários, extraia cada entrada com valor, mês, origem e evidência. Exclua da renda líquida apenas transferência própria, do cônjuge ou parente de primeiro grau comprovada. Se a origem for incerta, inclua como renda; não presuma parentesco. Informe média bruta e líquida." |
| `ctps_format` | CTPS | "CTPS pode ser foto legível ou PDF; não crie pendência só pelo formato." |

Fonte: banco (consulta de hoje); seed `supabase/migrations/20260928094000_document_master_rules.sql:2-6` (5 regras; `residence_income_ownership` vem da migration `20260928092500`). Atenção: `lib/document-ai-rules.js:27-31` REGERA o texto de `residence_income_ownership` pela política ao salvar (`residencePolicyInstruction`, `lib/document-ai-rule-core.mjs:18-21`), então o texto da tela pode mudar de redação sem mudar o sentido.

## 2. Tabela ASSUNTO → regra → classificação

| Assunto (pista) | O que a fonte diz de fato | Onde (arquivo:linha / rule_key) | Classificação |
|---|---|---|---|
| Identificação (RG/CPF ou CNH legível) | RG (com CPF) OU CNH; nunca cobra CPF à parte. Legibilidade = IA (`ilegivel`). Não está na Base Mestra. | `lib/document-requirements-engine.js:86-90`; matriz item 1 | FONTE ATIVA (código) |
| Comprovante: mês atual ou anterior | NÃO existe regra determinística. Só a IA marca `expired` "se a data demonstrar claramente que está desatualizado"; sem data legível, pede validação. A matriz registra a regra do dono, mas como FALTA (L-1). | `lib/document-analysis.js:288`; matriz item 2, L-1 | FONTE INTERNA A CONFIRMAR (dono diz; não implementada) |
| Comprovante: tipos aceitos | Só água, energia, internet, telefone; nunca boleto nem extrato. | BM `residence_source`; código `lib/document-policy.mjs:36-37` | FONTE ATIVA |
| Comprovante: CLT/IR × informal | CLT e declarante de IR: pode ser de terceiro. Informal: nome do próprio cliente. Sem renda/nome confirmável: pede validação, não presume pendência. Nome compara sem caixa/acento; nome com 1 palavra = validação. | BM `residence_income_ownership`; `lib/document-ai-rule-core.mjs:1-16` | FONTE ATIVA |
| Comprovante: fatura de cartão | Vale como endereço só se usada para comprovar renda E sem conta utilizável. No motor: informal com 3 faturas dispensa o comprovante. | BM `residence_source`; engine `:149-150`; `document-policy.mjs:37` | FONTE ATIVA |
| Comprovante: de quem é exigido | SÓ do proponente principal (titular). Cônjuge, 2º proponente e dependente nunca geram pendência de comprovante. | `lib/document-policy.mjs` (`isResidenceRequiredForRole`); prompt `document-analysis.js:282`; matriz 2b | FONTE ATIVA (regra oficial do dono 02/10) |
| Estado civil / certidão | Solteiro: certidão de nascimento. Casado/união estável: certidão de casamento. Divorciado: certidão de casamento COM averbação. Viúvo/vazio: nada exigido. | engine `:92-106` | FONTE ATIVA (código) |
| Casamento sem averbação → cônjuge | Exige "documentação aplicável do cônjuge, salvo segunda certidão de casamento e segundo comprovante de residência". No motor: cônjuge recebe RG/CNH, renda conforme o tipo, CTPS/FGTS se CLT, PIS; não recebe certidão de casamento própria nem comprovante. | BM `marriage_spouse`; engine `:41-50`, `:93-105` | FONTE ATIVA |
| Cônjuge × composição do financiamento | Financiamento conjunto (`simulationType === "joint"`) cria linhas do "segundo proponente" (`outro`), independente do casamento. | engine `:52-62`; matriz 6 | FONTE ATIVA (código) |
| Dependentes < 18 | Certidão de nascimento do dependente só quando o cadastro afirma filho(a) < 18; pede 1 como sinalizador (quantidade não é rastreada). | engine `:33-39` | FONTE ATIVA (código) |
| Renda CLT | 2 últimos holerites (mensagem diz "sem férias"); CTPS física ou digital; FGTS atualizado; PIS (número, de qualquer documento). CTPS foto/PDF: sem pendência por formato. | engine `:110-116`, `:156-163`, `:165-171`; BM `ctps_format` | FONTE ATIVA (código + BM) |
| Renda informal — documentos | 3 extratos OU 3 faturas de cartão (últimos). | engine `:127-139` | FONTE ATIVA (código) |
| Renda informal — média e exclusões | Média bruta = soma/3 e líquida = (soma − excluídos)/3. Só exclui crédito de si mesmo, cônjuge ou parente 1º grau quando há evidência E o nome do pagador confere (≥5 caracteres) com nomes verificados; incerto = conta como renda. | BM `bank_income`; `lib/document-policy.mjs:42-70` | FONTE ATIVA |
| Período de análise | "três meses" (texto da BM e divisor fixo 3). "Últimos" 3 não é checado por data em código. | BM `bank_income`; `document-policy.mjs:70` | FONTE ATIVA (período exato = NÃO CONFIRMADO) |
| FGTS | Extrato atualizado; ausente → pendência; desatualizado → pendência; sem data legível → validação. | BM `fgts_updated`; engine `:64-73`, `:160-162` | FONTE ATIVA (ver conflito C-3) |
| Imposto de Renda | Só para quem tem renda "declarante de IR": declaração completa "do ano vigente" + recibo de entrega; se só um dos dois, pede o outro. Não exigido de CLT/informal. | engine `:117-126` | FONTE ATIVA (código); "ano vigente" = FONTE INTERNA A CONFIRMAR |
| Extração de endereço | Prompt só diz "Extraia nome e endereço". Campos usados: rua, número, complemento, bairro, cidade/UF, CEP (capa/PDF só usa comprovante de fonte aceita). Não há regra de endereço na BM. | `document-analysis.js:282`; `lib/document-cover-facts.mjs:32-44`; `lib/client-document-pdf.js:157-162` | FONTE ATIVA (comportamento); regra de completude = NÃO CONFIRMADO |
| Duplicados | Idênticos (SHA-256) contam uma vez; parecido não é duplicado. | matriz 13 | FONTE ATIVA (código) |
| Divergência de dados | Só objetiva; caixa/acento não é divergência. | matriz 16; prompt `:294` | FONTE ATIVA (IA + código parcial) |

## 3. Conflitos entre fontes (versões listadas, sem escolher)

- **C-1 Validade do comprovante.** (a) Matriz do dono: "mês atual ou anterior" (item 2), mas marcada FALTA. (b) Código/prompt: `expired` só quando "claramente desatualizado" (`document-analysis.js:288`). (c) Rascunho do GBP (`docs/posicionamento/rascunhos/2026-10-02-gbp-pacote.md:131`) afirma "recente (mês atual/anterior, regra oficial do dono)" como se fosse vigente. Nenhuma Base Mestra ativa traz esse prazo. O Guia NÃO pode afirmar o prazo como algo que o sistema aplica.
- **C-2 Cônjuge na certidão sem averbação.** BM: "exige documentação aplicável do cônjuge, SALVO segunda certidão de casamento e segundo comprovante". Matriz item 5: "sem nova certidão nem novo comprovante". Código: o cônjuge entra por `married/stable_union` do cadastro OU por certidão sem averbação (`engine:21-23,41`). A palavra "aplicável" não é detalhada em lugar nenhum além do motor.
- **C-3 FGTS.** BM `fgts_updated`: "Exija extrato atualizado" (sem restringir a CLT). Motor: CLT SEMPRE exige FGTS (`engine:160`, independe da regra estar ativa); com a regra ativa, também exige de quem NÃO é CLT (`:67`). Matriz item 11 diz "quando a regra estiver ativa"; L-7 marca como PENDENTE DE VALIDAÇÃO. GBP deixou FGTS fora da lista por isso.
- **C-4 Comprovante: regra × motor.** `residence_source` exclui boleto/extrato, mas `regularResidence` no motor não filtra fonte, papel nem validade (L-3, `engine:148`); a filtragem de fonte está na classificação/IA e no `document-policy.mjs`.
- **C-5 Holerite de férias.** Prompt (`document-analysis.js:284`): holerite de férias "sozinho não é competência regular"; motor conta por tipo (`engine:111`), sem excluir férias. Mensagem ao corretor diz "sem férias".
- **C-6 Texto da regra de titularidade.** Banco tem redação manual; ao salvar na tela vira texto gerado (`document-ai-rule-core.mjs:18-21`: "Renda informal: comprovante no nome do cliente. CLT: ... terceiro permitido. Declarante de IR: ..."). Sentido igual, redação diferente.
- **C-7 Doc do cadastro vs. regras.** `docs/BUSINESS_RULES.md` DOC-6 (linha 163) cobre só tipos de comprovante e médias; não menciona titularidade por renda nem validade. Não conflita, mas é incompleto.
- **C-8 Rascunho GBP × lista oficial** (`gbp-pacote.md:128-133`) já corrigido para RG/CNH, holerites/extratos e certidões; é MATERIAL DE MARKETING, não fonte regulatória.

## 4. Lacunas para o corretor consultar com segurança

1. Prazo de validade do comprovante (mês atual/anterior) sem regra implementada nem texto na BM (L-1).
2. Regras fixas (RG/CNH, holerites, IR, extratos, dependentes, PIS) NÃO estão na Base Mestra: o Guia não poderia "ler a regra" de um só lugar editável (L-6). Hoje exigem leitura do motor ou da matriz.
3. FGTS para não-CLT: intenção do dono não validada (L-7).
4. Sem definição escrita de "documentação aplicável do cônjuge" (C-2).
5. Sem regra de endereço: quais campos (CEP, número, bairro) tornam o comprovante "completo"; só há o que a ficha/PDF exibe.
6. IR "do ano vigente" e recibo "quando aplicável": critério de ano e de aplicabilidade não definidos pelo dono em texto.
7. Período exato dos "3 meses" de extrato/fatura e dos "2 últimos" holerites não é validado por data em código.
8. Nenhuma regra para viúvo/estado civil vazio (sistema não exige nada; é intencional: "não inventa").
9. Reescaneado ≠ duplicado não detectado (L-4); CPF/nome cruzado determinístico inexistente (L-2).

## 5. O que muda com frequência (alto risco de o Guia ficar desatualizado)

- **Mudam por tela, a qualquer hora (admin geral edita):** as 6 regras da BM, em especial `residence_income_ownership` (política por tipo de renda), `residence_source`, `fgts_updated` e ativar/desativar qualquer uma (inativa = não conta). O Guia deve LER do banco, não copiar texto.
- **Mudam por código/pedido do dono:** exigências fixas do motor (quantidade de holerites/extratos, IR, dependentes, PIS), `lib/document-policy.mjs` (papel que exige comprovante), mensagens ao corretor.
- **Estáveis:** separação IA classifica / código decide "ausente"; SHA-256 para duplicado; hierarquia de autoridade.
- Regras da Caixa/CCA externas (que documento a Caixa pede em cada caso) mudam fora do sistema e NÃO estão nesta base: NÃO CONFIRMADO.

## DECISÃO NECESSÁRIA (dono)

**Pergunta:** o "mês atual ou anterior" do comprovante de residência e o FGTS para quem não é CLT devem virar regra oficial do sistema antes de o Guia citá-los?
- **Opção A:** o Guia cita só o que está ativo hoje (Base Mestra + motor) e marca esses itens como "em validação com o Matheus".
- **Opção B:** o dono confirma as duas regras, elas são implementadas (`/registrar-regra`) e só depois entram no Guia.
- **Recomendação:** A agora, B em seguida; assim o corretor nunca recebe como certo algo que o sistema não aplica.

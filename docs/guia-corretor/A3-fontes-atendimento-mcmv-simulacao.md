# A3 - Mapa de fontes: livros Atendimento, Jornada/Funil, MCMV e Simulação (somente leitura, 2026-10-03)

Legenda de classe: ATIVA = FONTE ATIVA/CONFIÁVEL · CONFIRMAR = INTERNA A CONFIRMAR · ANTIGO = CONTEÚDO ANTIGO · EXEMPLO · HIPÓTESE · NC = NÃO CONFIRMADO.
Método: leitura de código e docs do repositório; nenhuma pesquisa web (nenhum item exigiu fonte externa). Nada foi alterado fora deste arquivo.

## 0. Regras de redação do Guia do Corretor (valem para os 4 livros)
- Guia nunca afirma valor, faixa, subsídio, taxa, limite ou fórmula. Frase padrão: "o sistema calcula conforme as regras vigentes".
- Nunca promete aprovação (é da Caixa), prazo ou resultado. "Não contactar" é absoluto em qualquer roteiro.
- Etiquetas de proveniência: só chamar de regra oficial o que estiver marcado [REGRA OFICIAL DE NEGÓCIO] nas rules/docs.

## 1. Livro ATENDIMENTO

### 1.1 Fontes
| Fonte | Classe | Observação |
|---|---|---|
| `docs/GUIA_ATENDIMENTO.md` (L3-7 regra central; L27-31 qual guia abre) | ATIVA | Descreve o Guia de Atendimento (entregue 2026-09-25). Regra central: OBJEÇÃO > INVESTIGAR > MOTIVO REAL > SOLUCIONAR > TESTAR ACEITAÇÃO > DOCUMENTAÇÃO > DATA DE RETORNO. Todo atendimento pendente termina em próximo passo + data de retorno. |
| `lib/attendance-guide-seed-flows.mjs` (guias Prospecção, Lead, Orgânico) | CONFIRMAR | É o conteúdo inicial. A tabela `attendance_guides` pode ter sido editada/publicada depois; o texto real em uso está no banco (`published_graph`), não neste seed. Pedir ao `analista-dados` o publicado se o Guia do Corretor for citá-lo. |
| `lib/attendance-guide-seed-library.mjs` (Banco de Objeções, ~25 cards) | CONFIRMAR | Mesmo caso. Textos prontos com `[Nome]`; sem números. |
| `lib/attendance-guide-core.mjs`, `lib/attendance-guides.js` | ATIVA | Mecânica (classificação do guia, progresso por cliente). Não é conteúdo de ensino. |
| `docs/atendimento/contexto/apoio-aos-corretores.md`, `funil-e-etapas.md`, `vacuo-motor.md` | ATIVA | Micro-packs (só ponteiros). |
| `docs/atendimento/diagnostico-inicial-2026-10-03.md` | INTERNA A CONFIRMAR | Não versionado ainda (untracked); diagnóstico do Diretor, bom para as lacunas. |

### 1.2 Assuntos cobertos pelo Guia (por busca nos seeds)
| Assunto | Cobertura | Onde |
|---|---|---|
| Primeira abordagem | COBERTO | Prospecção: "Abertura/Apresentação"; Lead: "Recepção do lead" e 7 variações (valor, entrada, sem entrada, imóvel, já simulou, responde pouco); Orgânico: "Origem do contato" e 6 variações |
| Prospecção | COBERTO | Guia Prospecção (p-abertura, p-motivo, p-comprou) |
| Condução (interesse, necessidade, situação) | COBERTO | l-interesse/l-necessidade, o-interesse/o-necessidade/o-situacao |
| Simulação | COBERTO (parcial) | l-simulacao, o-simulacao: como conduzir; sem pós-resultado detalhado |
| Pedido de documentos | COBERTO | cards "Documentação", "Conferir os documentos recebidos", "Cliente com dificuldade para reunir documentos" |
| Objeções (~25) | COBERTO | Banco: sem entrada, parcela alta, renda baixa, aprovação baixa, restrição/Blindagem, não gostei do imóvel, juntar dinheiro, esperar, juros, medo de financiar, preciso pensar, família, já reprovado, aluguel, outro corretor |
| Vácuo / retomada | COBERTO só na conversa | Banco: "cliente não responde" (3 tentativas: voltou, algo de valor, despedida com data). Reativação 30/60/90 NÃO existe no Guia nem no sistema (diagnóstico L59) |
| Acompanhamento | PARCIAL | Só via card "próximo passo e data de retorno" (cria atividade na agenda) |
| Aprovado | LACUNA | Sem roteiro de aprovado/aprovação (diagnóstico L44) |
| Reunião / visita | LACUNA | Idem |
| Venda e pós-venda | LACUNA | Idem; só "Cliente comprou" na Prospecção (cliente que já comprou em outro lugar) |
| Boas práticas gerais | PARCIAL | Só a regra central e `guidance` por card; nenhum capítulo de boas práticas |
| WhatsApp (janela 24 h, modelo, escolha de canal) | LACUNA no Guia | Ver seção 5 |

SUGESTÕES PARA REVISÃO do Guia de Atendimento (não alteradas; decisão do dono): (a) roteiros de aprovado, reunião, venda e pós-venda; (b) reativação 30/60/90; (c) card "Simulação enviada: como explicar o resultado" sem números; (d) conferir se `sol-sem-entrada`/`sol-entrada-composta` ("FGTS conta como entrada") e `sol-blindagem` dizem algo que dependa de regra vigente: hoje o texto é cauteloso ("conforme as regras de cada financiamento"), mas FGTS como parte da entrada é afirmação de regra e entra como CONTEÚDO PENDENTE DE VALIDAÇÃO se for citada no Guia do Corretor.

## 2. Livro JORNADA DO CLIENTE / FUNIL

### 2.1 Fontes
| Fonte | Classe |
|---|---|
| `lib/client-status.js` (`CLIENT_STATUS`, `CLIENT_FUNNEL_STAGES` L307, `CLIENT_STATUS_FILTER_GROUPS` L324, `pendingReferenceAt` L361) | ATIVA (fonte única, código) |
| `.claude/rules/crm-clientes-funil.md` | ATIVA (explica o código; tem 2 pontos desatualizados, ver 2.3) |
| `docs/BUSINESS_RULES.md` FUN-1 a FUN-8, PRO-8 | ATIVA, com divergência numérica (2.3) |
| `docs/METRICAS_FUNIL.md` (MET-2 a MET-8, MET-14) | ATIVA para medição; não é guia de conduta |
| `docs/minha-jornada.md` + `app/minha-jornada/**` | ATIVA (jornada pública do cliente, linguagem amigável) |
| `docs/atendimento/contexto/funil-e-etapas.md` | ATIVA (só ponteiros) |

### 2.2 A estrutura PROSPECÇÃO > ATENDIMENTO > SIMULAÇÃO > AGUARDANDO DOCUMENTAÇÃO > AGUARDANDO APROVAÇÃO > CLIENTE APROVADO > REUNIÃO > VENDA continua ativa? SIM, com nuances (código L307-315):
- 7 macroetapas ativas: Atendimento (`in_service`), Simulação (`completed`, `simulation_sent`), Aguardando documentação (`documentation_pending`, `documents_pending`), Aguardando aprovação (aprovação pendente, comprometimento de renda, carta de cancelamento, M.O de pesquisa, restrição, blindagem, reprovado), Cliente aprovado (`approved`), Reunião (aguardando/realizada), Venda (todos os status de venda).
- Prospecção NÃO é macroetapa do array: é a base do funil (performance-overview). Na tela Clientes a aba "Prospecção" agrupa o status `awaiting_return`, rotulado "Tentando contato" (`CLIENT_STATUS_FILTER_GROUPS` L326).
- Status fora das macroetapas: `automated_service` (Atendimento automático; aba Atendimento da tela), `pending` ("Aguardando simulação"; aba Simulação da tela), `archived`, `do_not_contact`. Ou seja: a aba da tela e a macroetapa do funil NÃO coincidem exatamente para `pending` e `automated_service`. Mostrar essa diferença no livro.
- Reprovado/Restrição/Blindagem permanecem em "Aguardando aprovação" [regra explícita do negócio].
- Funil é cumulativo por design (FUN-3). Venda cria registro financeiro e marco de reunião automático (FUN-5).

### 2.3 Divergências a registrar (não escolhi lado)
1. FUN-1 diz "`CLIENT_STATUS` (24 valores)"; o código tem 30 valores (conferido por contagem). FUN-2 e o comentário do código falam em "8 status legados de venda"; o código lista 9 além de `sale_completed` (formulários, reserva, conformidade, contrato, assinatura Caixa, ITBI, cartório, pagamento, pago). Vale o código; corrigir a doc é tarefa do `crm-editor`.
2. Comentário/fonte `.claude/rules/crm-clientes-funil.md` e `funil-e-etapas.md` não citam a diferença aba x macroetapa (2.2).
3. Roteiro do dono cita "PROSPECÇÃO" como etapa 1: no código é base/aba, não etapa do array. Decisão de nomenclatura do livro é do dono.

### 2.4 Por etapa: objetivo, quando usar, próxima ação, erros comuns
Documentado de forma explícita SOMENTE o seguinte; o resto é CONTEÚDO PENDENTE DE VALIDAÇÃO (nenhum texto "o que é / quando usar" por etapa existe no repositório):
| Etapa | Documentado | Fonte |
|---|---|---|
| Tentando contato (Prospecção) | Pendência após 3 dias sem contato e sem atividade futura; reativação manual reinicia o relógio | `client-status.js` L355-381 [REGRA OFICIAL 2026-10-02] |
| Atendimento | Cliente do WhatsApp sem formulário fica em "Atendimento automático"; passa a "Em atendimento" quando corretor responde, e a "Aguardando simulação" quando preenche o formulário | comentário L2-4 do código |
| Simulação | `completed` automático só se o cliente não estiver em status avançado (FUN-7) | BUSINESS_RULES |
| Aprovado | Entrar em `approved` grava `approved_at` (FUN-6) | BUSINESS_RULES |
| Venda | Efeitos automáticos (FUN-5) | BUSINESS_RULES |
| Documentação | Regras documentais Caixa/MCMV do dono × implementação | `.claude/analista-documental/REGRAS-DOCUMENTAIS.md` (CONFIRMAR: tem "Lacunas abertas") |
| Objetivo, próxima ação e erros comuns por etapa | NÃO DOCUMENTADO | CONTEÚDO PENDENTE DE VALIDAÇÃO |
Para preencher: usar a regra central do Guia (próximo passo + data) como padrão de "próxima ação" e `metricas` (tempo parado por etapa) como base de "erros comuns" via `analista-dados`, sempre marcado como hipótese até o dono validar.

## 3. Livro MINHA CASA MINHA VIDA

| Conteúdo | Classe | Fonte |
|---|---|---|
| Jornada em linguagem simples, dúvidas e objeções, sem regra numérica | ATIVA (como método) | `docs/atendimento/especialistas/primeiro-imovel-mcmv.md`: nunca afirma valor/faixa/subsídio/regra |
| Regras documentais Caixa/MCMV (Base Mestra `document_ai_rules`, motor de requisitos) | CONFIRMAR | `REGRAS-DOCUMENTAIS.md`, DOC-6; o dono decide; "nunca inventar exigência" |
| Subsídio MCMV no cálculo | CONFIRMAR | É valor de ENTRADA do cliente (campo `subsidioMcmv` do cliente, `types.ts` L18; `cliente-entrada.js` L15), não regra embutida; não há tabela de faixas no código lido |
| Faixas de renda, valor de subsídio, teto de imóvel, juros, prazos, elegibilidade | NC / CONTEÚDO PENDENTE DE VALIDAÇÃO | Dependem de fonte oficial externa (Caixa/governo) e mudam com frequência; não existem como regra interna confiável |
| Casa Paulista (R$ 10.000 fixo se o empreendimento aceita) | ATIVA, mas é regra do sistema | SIM-1 [REGRA OFICIAL, 2026-10-02]; programa estadual em si: oficial externo, NC. O livro pode dizer "o sistema aplica o que o empreendimento aceita", sem repetir o valor |
| Blindagem Financeira | CONFIRMAR | Produto/serviço interno; só 2 menções em BUSINESS_RULES; o texto do Guia (L173-177) o descreve em linhas gerais, sem prazo. Definição formal pelo dono. |
| Qualquer número/artigo de portaria ou lei antigo | ANTIGO (não usar) | `mcmv-calculator/` é referência antiga, fora do Git; produção é `lib/simulacao-entrada/*` (BUSINESS_RULES CAT-2) |

Classificação operacional x oficial externa x muda com frequência:
- Operacional interna (pode ensinar): fluxo no CRM, status, ordem das etapas, quem decide o quê, frases cautelosas ("vou confirmar com a Caixa/regra vigente").
- Depende de fonte oficial externa (NÃO ensinar sem validar): elegibilidade, faixas, subsídios, limites, taxas, documentos exigidos pela Caixa, prazos de análise.
- Muda com frequência: tudo o anterior; o Guia deve apontar "consulte a regra vigente no sistema/Caixa" e carimbar data da última revisão.
- Pesquisa web: não foi necessária; se o dono quiser capítulo de regras oficiais, delegar a `especialista-atendimento-web` com fonte oficial e data.

## 4. Livro SIMULAÇÃO

### 4.1 Fontes reais de cálculo (para apontar, nunca copiar valores)
| Fonte | Classe | Papel |
|---|---|---|
| `lib/simulacao-entrada/calculator.ts` | ATIVA | Motor de entrada: recebe dados do cliente + configuração de UM empreendimento e devolve a simulação; estratégias (ato + parcelas, obra/pós-obra/balão, tabela de condições, via engenharia) |
| `lib/simulacao-entrada/types.ts` | ATIVA | Conceitos do resultado: valor final do imóvel, total coberto (financiamento + MCMV + Casa Paulista), entrada total, detalhe do pagamento, benefícios só informativos |
| `lib/simulacao-entrada/casa-paulista.mjs` | ATIVA | Regra única do Casa Paulista (SIM-1) |
| `lib/simulacao-entrada/presentation-model.mjs`, `proposta-pdf.mjs` | ATIVA | Tela de apresentação e PDF "Proposta de Valores" (SIM-2) |
| `lib/simulacao-entrada/repository.js`, `cliente-entrada.js` | ATIVA | Leitura das regras do empreendimento e dados do cliente |
| `app/api/simular-entrada/route.js` | ATIVA | Nunca envia `regras` ao navegador (CAT-2) |
| `lib/simulation-registrations.js` | ATIVA | Cadastro/status da simulação do cliente |
| Regras por empreendimento (`empreendimentos`, JSON, campo `atualizadoEm`) | CONFIRMAR | Editáveis; podem estar desatualizadas por empreendimento; tabela e prazo são do empreendimento |
| `docs/guia-corretor/A1-auditoria-manual-empreendimentos.md` | CONFIRMAR | Auditoria do Manual (cadastro de empreendimentos); usar para saber onde o livro mora |

### 4.2 Conceitos e procedimento que o livro PODE explicar (sem números)
- O que é a simulação: ferramenta do CRM que, a partir da renda/dados do cliente e do empreendimento escolhido, mostra como a entrada pode ser montada. Resultado é estimativa, não aprovação.
- Entrada = valor final do imóvel menos o que é coberto (financiamento aprovado, subsídio, Casa Paulista); o resto pode ser parcelado conforme a estratégia do empreendimento. (Conceito; fórmulas e valores ficam no motor.)
- Benefício informativo não reduz a entrada (ex.: "Documentação Grátis"); desconto de tabela reduz.
- Procedimento do corretor: confirmar dados do cliente > escolher empreendimento > simular > conferir resultado e a observação/validade da tabela > enviar apresentação/PDF > registrar próximo passo e data. Momentos (antes, iniciada, concluída, abandonada, recebida) vêm do especialista `simulacao`.
- Status do funil: `pending` (aguardando simulação) > `completed` (simulação realizada; automático se não estiver em etapa avançada) > `simulation_sent` (enviada).
- Frase obrigatória: "o sistema calcula conforme as regras vigentes".
- NÃO incluir: valores de exemplo (R$ 200.000, 20.000 etc. de BUSINESS_RULES SIM-1 são EXEMPLO), taxas (ex.: 15% de lucro imobiliário em `types.ts` é padrão observado, NC), limites de parcela, estratégias com seus parâmetros.

## 5. WhatsApp e Comunicação (o que o Guia pode explicar sem inventar regra)
| Assunto | Classe | Fonte |
|---|---|---|
| Atendimento humano é feito pelo WhatsApp do próprio corretor; canal individual principal desde 2026-09-28 | ATIVA | `docs/WHATSAPP.md` §1-A |
| WhatsApp Oficial (antigo "WhatsApp Master"): números oficiais para aquisição, pré-atendimento, automações e cadências; não substitui o corretor; quantidade de linhas e limites são configuráveis/EXEMPLO | ATIVA (conceito) | `docs/atendimento/contexto/whatsapp-oficial.md` |
| Janela de 24 h: texto livre só dentro dela; fora, só modelo aprovado sem botão ou WhatsApp pessoal; aviso âmbar quando restam < 2 h | ATIVA (comportamento do sistema) | `docs/WHATSAPP.md` §5 (conferir trecho antes de citar) |
| Regras da Meta (templates, categorias, limites, qualidade) | NC; muda com frequência | exigem documentação oficial atual via `especialista-atendimento-web` |
| Botão WhatsApp do card: destino conforme estado real da sessão (conectado > Chat interno; desconectado > WhatsApp Web/app) | ATIVA [REGRA OFICIAL 2026-10-02] | `crm-clientes-funil.md` L57, WA-13a |
| Resposta do cliente muda o estágio e interrompe cadência (PRO-8) | ATIVA [REGRA OFICIAL 2026-10-02] | BUSINESS_RULES PRO-8 |
| Não contactar: cliente `do_not_contact`/bloqueado nunca recebe contato automático | ATIVA, absoluta | `docs/atendimento/contexto/nao-contactar.md`, CLAUDE.md regra 9 |
| Alerta "cliente aguardando" (≥10 min atenção, ≥30 atraso); aviso Alexa desligado por padrão | CONFIRMAR | diagnóstico L26; limites configuráveis |
| Texto de mensagens do Guia ([Nome]/[Corretor]/[Link]) | CONFIRMAR (seed; publicado no banco) | seções 1.1 |
Não explicar: horários/limites por número, volume diário, categorias de template, regras de custo/qualidade (EXEMPLO ou externos).

## 6. Conflitos e pendências (sem escolha silenciosa)
1. Contagem de status e de status legados de venda: doc x código (2.3). Vale o código.
2. "Prospecção" como etapa (roteiro do dono) x base/aba no código (2.2). Decisão do dono.
3. Conteúdo do Guia: seed x publicado no banco (1.1). Verificar o publicado antes de citar.
4. Os micro-packs/perfis de `docs/atendimento` não substituem Base Mestra nem motor; citam fonte.
5. Falta de roteiro de aprovado, reunião, venda, pós-venda, reativação 30/60/90 (sugestões em 1.2).
6. Itens CONTEÚDO PENDENTE DE VALIDAÇÃO: faixas/subsídios/elegibilidade MCMV, definição de Blindagem Financeira, "FGTS conta como entrada", objetivo/erros comuns por etapa, regras da Meta.

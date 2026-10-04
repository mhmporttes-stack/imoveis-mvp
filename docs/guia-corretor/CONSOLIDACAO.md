# Central de Conhecimento do Corretor: consolidação (2026-10-03)

Status: **documento de decisão**. Nada foi implementado, publicado, migrado ou alterado no app/banco. Base: A1, A2, A3, A4, B2 (mockups só por referência), relatório do Scout sobre page-flip. Nenhuma pesquisa externa nova. Uma leitura pontual de código está citada onde aparece (arquivo:linha).

Legenda de confiança: **alta** = fonte ativa (Base Mestra, motor ou código em produção) sem conflito · **média** = fonte ativa com lacuna/conflito pequeno, ou fonte interna a confirmar · **baixa** = hipótese ou texto ainda não comparado · **pendente** = sem fonte (vira "CONTEÚDO PENDENTE DE VALIDAÇÃO").

---

## 0. Resumo executivo e decisões do dono

**Resumo (10 linhas)**
1. O Manual atual já tem o que mais custa construir: workflow Rascunho → Aguardando → Publicado, aprovação só do dono, audiência filtrada no servidor, guarda de confidencialidade, versões e busca com deep link. Falta o nível "livro", campos de fonte/revisão e blocos dinâmicos.
2. Caminho recomendado: **estender o Manual com tabelas aditivas** (livro → capítulo → página), sem tocar nos 8 tópicos/40 seções publicados em 02/10.
3. Regra de ouro: **Guia = apresentação; Base Mestra e motor = verdade**. Onde a fonte é lida do banco/cadastro, a página mostra um **bloco dinâmico**; texto editorial só explica e orienta, sem copiar regra, valor ou fórmula.
4. Cada página carrega **fonte interna + fonte externa + data da última verificação**; corretor vê categoria e data, nunca o caminho interno.
5. Dos 8 livros prioritários, **só parte tem fonte forte**: Documentação, Rendas (parcial) e Jornada/Funil. MCMV, FGTS e Aprovação dependem de fonte oficial/Caixa e ficam majoritariamente PENDENTES.
6. A Prospecção é representada como **Entrada/Base**, separada das 7 macroetapas reais; o CRM não muda.
7. Há **8 conflitos documentais** (A2) mais 3 de A3 que precisam de decisão; nenhum foi resolvido aqui.
8. Ficha viva de empreendimento: **só dados descritivos** nesta fase; preço, condições e notas internas ficam fora.
9. Page flip: **duas alternativas mantidas** (própria × biblioteca), sem escolha; o critério é um protótipo isolado em aparelho real.
10. Achado fora do escopo: **notas internas de empreendimento visíveis a todo perfil** (confirmado; seção 13). Nada corrigido.

**Decisões do dono (numeradas, com recomendação)**

| # | Decisão | Recomendação |
|---|---|---|
| 1 | Comprovante "mês atual ou anterior" e FGTS para não-CLT: virar regra oficial antes de o Guia citar? | A agora (Guia cita só o ativo; os dois itens ficam "em validação"); B depois, por `/registrar-regra` |
| 2 | Ficha viva de empreendimento mostra preço/condições? | Não nesta fase (só descritivos); reavaliar com data visível depois |
| 3 | `internal_notes` do empreendimento entra no Guia? | Não |
| 4 | Agrupamento em 7 livros (vs. 8 ou os 11 cards) | Confirmar 7 (seção 6.0) |
| 5 | Nome: "Guia do Corretor" × "Guia de Atendimento" (árvore do Chat) | Manter "Guia do Corretor"; renomear a árvore na interface para "Roteiro de atendimento" |
| 6 | Estender o Manual (A1) ou criar `guide_*` separado (B2 §18) | Estender o Manual (reuso do workflow, guarda, versões) |
| 7 | Conflitos documentais C-2 a C-6 e definição de "documentação aplicável do cônjuge" (seção 3) | Decidir um a um; até lá o Guia só descreve o que o motor faz |
| 8 | Corrigir docs com contagens de status desatualizadas (FUN-1/FUN-2) | Sim, em tarefa separada do `crm-editor` |
| 9 | Itens PENDENTES de classe A (seção 4): validar pessoalmente | Fazer em lote curto, na ordem de bloqueio (tabela 4) |
| 10 | Regras fixas do motor (RG/CNH, holerites, IR, PIS...) entram na Base Mestra para o Guia poder lê-las? | Decidir depois do piloto; até lá, fonte = motor, página "precisa de revisão" manual |
| 11 | Prazo padrão de revisão por categoria de fonte externa (Caixa, Governo, MCMV, Meta) | Sugestão: curto para Caixa/MCMV/Meta; valor é do dono |
| 12 | Efeito de virada padrão (Realista × Simples no celular) e escolha entre alternativas A/B de page flip | Só depois do protótipo isolado (seção 11) |
| 13 | Recentes (local, v1) sim; Fixados e sincronização entre aparelhos depois do piloto | Como em B2 §11 |
| 14 | Gestor vê a camada de gestão (estado, fonte, revisão)? | Só admin na v1; gestor se o dono liberar |
| 15 | Notas internas de empreendimento visíveis a todos (risco, seção 13): intencional? | Informar; decidir fora desta tarefa |

---

## 1. Diagnóstico do Manual atual e reaproveitamento

**Como é hoje (A1, A4, comprovado no código):**
- 2 níveis: **Tópico → Seção** (corpo de texto único). Sem livro, sem capítulo, sem fonte, sem data de revisão (`supabase/migrations/20261003230000_manual_crm.sql`).
- Estados `draft/pending/published` (`lib/manual-core.mjs:6`). Criar/editar = admin geral; **aprovar/publicar = só o dono** (`lib/manual-service.mjs:60-69`). Seção publicada nunca muda "por baixo": edição vira versão proposta.
- Audiência por perfil no servidor (`canSeeContent`, `buildVisibleManual`, core L26/L111). Associado vê como corretor.
- Guarda de confidencialidade na escrita **e na leitura** (`lib/manual-guard.mjs`).
- Busca só sobre conteúdo já filtrado, com deep link `/admin/manual#topico/secao` (core L74, L168). Novidades em tabela própria.
- **Em produção (A4):** 8 tópicos e 40 seções publicados, todos na versão 1, nenhum editado desde 02/10; 4 novidades em rascunho, 0 leituras.

| Reaproveitar sem mexer | Falta (aditivo) |
|---|---|
| Workflow e aprovação do dono | Nível **livro** e capítulo |
| Audiência no backend, guarda, versões | Campos de fonte, categoria, última revisão, responsável, "precisa de revisão" |
| Semente que cria tudo como rascunho e nunca publica (`loadManualSeeds`, service L391) | **Blocos dinâmicos** (ler Base Mestra/motor/cadastro) |
| Busca pura e deep link por hash | Indexar livros e empreendimentos; página como destino |
| Padrão `manual_news_reads` | Recentes (e Fixados, depois) |

**Central de Conhecimento = 3 áreas, 1 entrada:** Guia do Corretor (livros novos) · Manual do CRM (os 8 tópicos de hoje, sem alteração) · Novidades (`manual_news`). "Uma casa por informação": o Manual explica a **tela**; o Guia explica o **assunto**; cada página tem link cruzado, sem copiar texto.

---

## 2. Fontes encontradas e confiança

| Assunto | Fonte operacional interna | Classe | Confiança |
|---|---|---|---|
| Regras de documento (6) | Base Mestra `document_ai_rules` (6 ativas, lidas do banco em A2) | FONTE ATIVA | alta |
| Exigências fixas (RG/CNH, holerites, IR, PIS, dependentes, certidões) | Motor `lib/document-requirements-engine.js` | FONTE ATIVA (código), **fora da Base Mestra** | alta (conteúdo), média (para leitura dinâmica) |
| Validade do comprovante, FGTS não-CLT | `REGRAS-DOCUMENTAIS.md` (matriz do dono) | INTERNA A CONFIRMAR, não implementada | pendente |
| Funil e status | `lib/client-status.js` (`CLIENT_FUNNEL_STAGES` L307; `CLIENT_STATUS_FILTER_GROUPS` L324) | FONTE ATIVA | alta |
| Docs do funil (FUN-x, rule do funil) | `docs/BUSINESS_RULES.md`, `.claude/rules/crm-clientes-funil.md` | ATIVA com **contagens desatualizadas** | média |
| Cálculo de entrada | Motor `lib/simulacao-entrada/*` (apontar, nunca copiar) | FONTE ATIVA | alta (conceito) |
| Regra Casa Paulista no sistema | SIM-1 (`lib/simulacao-entrada/casa-paulista.mjs`) | REGRA OFICIAL | alta |
| Conduta de atendimento | `docs/GUIA_ATENDIMENTO.md`; Guia de Atendimento **no banco** (A4: 4 guias, 134 nós, v1) | ATIVA; texto exato do banco não comparado com o seed | média |
| WhatsApp (canal, janela 24h, PRO-8, não contactar) | `docs/WHATSAPP.md`, `BUSINESS_RULES.md`, `nao-contactar.md` | ATIVA | alta (comportamento); média (24h: conferir trecho) |
| Cadastro de empreendimentos | `properties` + `lib/properties.js`; regras em `empreendimentos.regras` | FONTE ATIVA (dado vivo) | alta (descritivos); regras comerciais = fora |
| MCMV: elegibilidade, faixas, subsídio, teto, juros, prazos | **Nenhuma fonte interna confiável** | NC (precisa fonte oficial) | pendente |
| Caixa/CCA: documentos e prazos por caso | **Nenhuma** | NC | pendente |
| Meta (templates, limites) | **Nenhuma** | NC | pendente |
| `mcmv-calculator/`, rascunho do GBP | referência antiga / marketing | ANTIGO / não regulatório | **não usar como fonte** |

---

## 3. DECISÕES DE CONTEÚDO NECESSÁRIAS

Nenhum item abaixo foi resolvido. "Sistema hoje" = o que o código faz; o Guia não pode afirmar além disso.

| ID / Assunto | Fonte A × Fonte B | Sistema hoje | Impacto | Recomendação | Decisão do dono |
|---|---|---|---|---|---|
| **C-1** Validade do comprovante | A: matriz do dono "mês atual ou anterior" (marcada FALTA) × B: código só marca vencido se a data for "claramente desatualizada" (`document-analysis.js:288`); rascunho do GBP (`gbp-pacote.md:131`) já afirma como regra | Sem prazo determinístico | Corretor poderia receber como certo o que o sistema não aplica | Guia não cita o prazo; página "em validação" | Prazo vira regra oficial (implementar) ou fica só como orientação? |
| **C-2** Cônjuge na certidão sem averbação | A: Base Mestra "documentação aplicável do cônjuge, salvo segunda certidão e segundo comprovante" × B: matriz "sem nova certidão nem novo comprovante" | Cônjuge entra por casamento/união estável ou por certidão sem averbação (`engine:21-23,41`); "aplicável" não definido | Corretor pede documento a mais/menos | Descrever só o que o motor faz | Definir "aplicável" por escrito |
| **C-3** FGTS | A: Base Mestra "exija extrato atualizado" (sem restringir) × B: matriz "quando a regra estiver ativa" (L-7 pendente) | CLT sempre exige (`engine:160`); não-CLT só com a regra ativa (`:67`) | Exigência diferente por perfil de renda | Guia cita CLT; não-CLT "em validação" | Quem mais precisa de extrato de FGTS? |
| **C-4** Comprovante: regra × motor | A: Base Mestra exclui boleto/extrato × B: `regularResidence` não filtra fonte/papel/validade (`engine:148`) | Filtro está na IA/`document-policy.mjs` | Duas camadas podem divergir | Citar a Base Mestra; avisar que a conferência é da IA + equipe | Confirmar que a camada IA é o desenho desejado |
| **C-5** Holerite de férias | A: prompt "férias sozinho não é competência regular" (`document-analysis.js:284`) × B: motor conta por tipo sem excluir férias | Mensagem ao corretor diz "sem férias" | Corretor pode aceitar/recusar errado | Guia repete só "sem férias" (mensagem existente) | O motor deve excluir férias? |
| **C-6** Texto da regra de titularidade | A: redação manual no banco × B: texto regenerado ao salvar (`document-ai-rule-core.mjs:18-21`) | Sentido igual, redação muda | Bloco dinâmico muda de palavras sozinho | Ler sempre do banco; nunca copiar | Nenhuma (informativo); confirmar leitura dinâmica |
| **C-7** DOC-6 incompleto | `BUSINESS_RULES.md:163` cobre só tipos de comprovante e médias × Base Mestra tem titularidade | Não conflita; faltam itens | Doc oficial não serve de fonte única | Fonte = Base Mestra + motor | Atualizar DOC-6 (tarefa do `crm-editor`)? |
| **C-8** Rascunho GBP × lista oficial | Marketing × motor/Base Mestra | Lista já corrigida (A2), mas L131 ainda cita "regra oficial" de prazo | Marketing pode divulgar regra inexistente | Material de marketing não é fonte | Alinhar rascunho antes de publicar? |
| **FUN-1** Contagem de `CLIENT_STATUS` | A: `BUSINESS_RULES.md:31` "24 valores" × B: código com 30 (contagem de A3; não refeita aqui) | Vale o código | Doc errada confunde quem consultar | Guia **não cita número**; lista lida do código | Autorizar correção da doc |
| **FUN-2** "8 status legados de venda" | A: doc e comentário `client-status.js:303` "8" × B: código lista 9 | Vale o código | Idem | Idem | Idem |
| **Aba × macroetapa** | A: rule/`funil-e-etapas.md` não citam a diferença × B: `pending` cai na aba Simulação e `automated_service` na aba Atendimento, fora do array | Aba da tela ≠ macroetapa | Corretor lê funil e tela diferentes | Livro explica a diferença (dinâmico) | Confirmar o texto |
| **Prospecção** | A: roteiro antigo "etapa 1" × B: código = base/aba "Tentando contato" (`awaiting_return`) | Base do funil | — | **Já decidido pelo dono (ajuste 1)**: Entrada/Base | Só confirmar o nome exibido ("Tentando contato") |
| **Texto publicado × seed** | A: seed `lib/attendance-guide-seed-*.mjs` × B: `published_graph` no banco (A4) | Cadastro igual; texto não comparado | Guia cita texto diferente do que o corretor vê | Ponteiro para o guia publicado, sem copiar | Autorizar comparação (leitura) antes de citar |

---

## 4. Pendências classificadas

Classes: **A** posso validar pessoalmente (dono) · **B** confirmar na Base Mestra/regra operacional · **C** confirmar em fonte oficial atual · **D** depende de Caixa/CCA · **E** depende de regra específica do empreendimento. "Bloqueia" = página impedida de sair do estado PENDENTE (códigos da seção 6).

| ID | Pendência | Classe | Quem / qual fonte resolve | Bloqueia |
|---|---|---|---|---|
| P01 | Prazo de validade do comprovante de residência | A (+B ao implementar) | Dono; depois `/registrar-regra` e Base Mestra | 3.2 (validade) |
| P02 | FGTS para quem não é CLT | A | Dono | 3.5, 4.2 |
| P03 | Definição de "documentação aplicável do cônjuge" | A | Dono | 3.3, 2.5 |
| P04 | Quando o endereço do comprovante é "completo" | A | Dono | 3.2 |
| P05 | IR "ano vigente" e quando exigir recibo | A + C | Dono; Receita Federal atual | 2.4 |
| P06 | Período exato dos "3 meses" de extrato/fatura e "2 últimos" holerites | B | Base Mestra/motor (hoje sem checagem por data) | 2.1, 2.2 |
| P07 | Holerite de férias (C-5) | B | Motor × prompt | 2.1 |
| P08 | Regras fixas do motor fora da Base Mestra | B (+A decide) | Base Mestra ou leitura do motor | 3.1, 3.4, 2.1 (leitura dinâmica) |
| P09 | Documentos que Caixa/CCA exige em cada caso | D | Caixa/CCA, via dono | 3.8, 5.3 |
| P10 | Elegibilidade, faixas de renda, teto do imóvel, juros, prazos do MCMV | C + D | Fonte oficial atual (governo/Caixa) | 1.3, 1.8 |
| P11 | Valores de subsídio | C | Fonte oficial atual | 4.4 |
| P12 | Casa Paulista: regra do programa estadual (a regra do sistema é SIM-1, alta) | C | Fonte oficial estadual | 1.5 (parte externa) |
| P13 | FGTS: o que é, usos e se "conta como entrada" | C + D | Fonte oficial/Caixa; conferir texto dos cards `sol-sem-entrada` | 4.1, 4.3 |
| P14 | Definição de Blindagem Financeira | A | Dono | 1.7, 5.3 |
| P15 | Objetivo, próxima ação e erros comuns por macroetapa | A (+B métricas) | Dono; `analista-dados` como hipótese | 5.2 a 5.8 |
| P16 | Roteiros de aprovado, reunião, venda, pós-venda, reativação 30/60/90 e "simulação enviada: como explicar" | A | Dono | 6.5 |
| P17 | Texto exato publicado dos 134 nós × seed | B | Leitura do `published_graph` por guia | 6.1 a 6.3 |
| P18 | Regras da Meta (templates, categorias, limites, qualidade) | C | Documentação oficial atual da Meta | 6.7 |
| P19 | Janela de 24 h: conferir trecho antes de citar | B | `docs/WHATSAPP.md` §5 | 6.7 |
| P20 | Limites do alerta "cliente aguardando" (configuráveis) | B | Configuração no sistema | 6.7 |
| P21 | Tipologias estruturadas (hoje só `bedrooms`/`area` em texto) | E (+decisão de produto) | Cadastro de empreendimentos | 7.x (tipologias) |
| P22 | Regras comerciais do empreendimento (tabela, ato, parcelas, validade) | E | Cadastro/`regras` do empreendimento | 4.12; **fora da ficha** |
| P23 | Taxas/impostos que aparecem no motor (ex.: lucro imobiliário) | C | Fonte oficial; **não entra no Guia** | nenhuma (não publicar) |
| P24 | Outros tipos de renda além de CLT, informal e IR | A + B | Dono; motor | 2.6 |
| P25 | Estado civil viúvo/vazio (hoje o sistema não exige nada, por desenho) | A | Dono confirma que é intencional | 3.3 |
| P26 | Reescaneado ≠ duplicado; cruzamento determinístico de CPF/nome | B | Motor (lacunas L-2, L-4) | 3.6 |
| P27 | Renda mínima, comprometimento e regras de análise | D | Caixa | 2.7 |
| P28 | Prazos de análise de aprovação | D | Caixa | 5.3 |
| P29 | Texto introdutório "O que é o MCMV" em linguagem simples | A | Dono valida o texto | 1.1 |

---

## 5. Arquitetura técnica proposta

Tudo aditivo; **nenhuma tabela ou coluna existente muda**. Migrations com nome de 14 dígitos e `if not exists`.

### 5.1 Estrutura (reuso do Manual)

| Nível | Hoje | Proposto |
|---|---|---|
| Livro | não existe | `manual_books` (slug, título, subtítulo, ordem, área, tom de capa) |
| Capítulo | `manual_topics` | + `book_id` **nullable**. Tópico sem livro = Manual do CRM (os 8 atuais não são reescritos) |
| Página | `manual_sections` | + `blocks jsonb` (resumo, passos[], atenção, exemplo; `body` continua valendo) |
| Área | — | `manual_books.area` = guia / manual; Novidades continuam em `manual_news` |

Divergência com B2 §18 (tabelas `guide_*`): recomendo estender o Manual para reaproveitar workflow, versões e guarda. Decisão 6.

### 5.2 Campos de fonte e revisão

Em `manual_sections` (valor único por página): `content_kind` (editorial · dinâmico · misto), `last_reviewed_at`, `review_due`, `owner_id`, `needs_review`, `internal_note` (**privado**), `development_id` (ficha viva).

Fontes em **tabela própria** `manual_section_sources` (uma página pode ter várias):

| Campo | Para quê |
|---|---|
| `kind` | **interna** (fonte operacional) ou **externa** (fonte oficial) |
| `source_category` | Base Mestra · Motor de simulação · Cadastro de empreendimentos · Regra do dono · Caixa · Governo Federal · Legislação · MCMV oficial · Meta |
| `reference` | `rule_key`, arquivo ou chave da leitura dinâmica (**só admin vê**) |
| `url` (externa) | Link oficial |
| `verified_at`, `verified_by` | **Data da última verificação** (obrigatória para externa) |
| `change_signal` | Marca da fonte na última revisão (ex.: `updated_at` da regra/cadastro) para detectar mudança |
| `note` | Observação interna (**privada**) |

Sem pesquisa externa agora: as linhas externas nascem com `verified_at` vazio e a página fica PENDENTE (classe C/D).

### 5.3 Blocos dinâmicos (Base Mestra = verdade)

- Um **registro de leituras** no servidor (`lib/`) mapeia chave → resolvedor de lista branca: regras ativas da Base Mestra, rótulos de status/macroetapas de `lib/client-status.js`, ficha descritiva do cadastro. O corretor **nunca** recebe linha de tabela, só o resultado do resolvedor.
- Página `dinâmico/misto` mostra "o que o sistema manda hoje" (lido na hora) + texto editorial só de **como explicar ao cliente**.
- **Precisa de revisão** = revisão vencida **ou** `change_signal` da fonte diferente do atual **ou** verificação externa mais antiga que o prazo da categoria (decisão 11). Se a fonte deixar de existir/ficar inativa, o bloco some e a página vai para revisão (nunca mostra texto antigo como vigente).
- Limite honesto (P08): exigências fixas do motor não estão na Base Mestra; ficam editoriais com fonte "Motor" e **revisão manual** até o dono decidir (decisão 10).

### 5.4 Busca com deep link

Estende `searchVisibleManual` (core L168) sobre o **mesmo funil** `buildVisible*`: título > resumo > corpo; resultado `{livro, capítulo, página, trecho, href}`; abre **direto na página** (`#livro/capitulo/pagina`, compatível com `#topico/secao`) e chip "voltar aos resultados". Rascunho, aguardando, `internal_note` e fonte interna nunca entram. Empreendimentos: nome/região lidos na hora da lista branca. Texto dinâmico não é indexado na v1 (evita índice defasado). Detalhe na seção 8.

### 5.5 Recentes e favoritos (B2 §11)

- **Recentes (v1):** no aparelho (localStorage), 3 a 5 itens, sem banco nem dado pessoal. Não sincroniza.
- **Fixados:** v1.1, só se o dado mostrar repetição; sincronizar exige `manual_user_marks(user_id, section_id, kind, at)` (padrão `manual_news_reads`).
- "Continuar de onde parou": descartado como recurso separado.

### 5.6 Permissões, fluxo e confidencialidade

| Tema | Regra proposta |
|---|---|
| Fluxo | Rascunho → Aguardando aprovação → Publicado (`draft/pending/published`); publicado volta só a pending; edição de publicado = versão proposta |
| Quem | Criar/editar: admin geral. Aprovar/publicar: **só o dono**. Leitura: corretor/gestor/associado só publicado do seu público (associado como corretor) |
| Conteúdo inicial | **Sempre RASCUNHO.** Semente nunca publica nem sobrescreve (padrão `loadManualSeeds`) |
| Trava sugerida | Página sem fonte preenchida não pode ir a "Aguardando aprovação" (fica PENDENTE) |
| Confidencialidade | Guarda de escrita e de leitura passa a cobrir `blocks`; `internal_note`, `reference` e `note` fora da lista branca de leitura; lista branca de campos do cadastro (seção 7) |
| Corretor vê da fonte | Categoria + "Verificado em dd/mm"; nunca arquivo, `rule_key`, nota interna |

### 5.7 Impacto técnico e fases

Arquivos: `manual-core.mjs` (árvore de 3 níveis, busca, lista branca), `manual-service.mjs` (livro, revisão, fontes), `manual.js`, rotas em `app/api/admin/manual/**`, `ManualBrowser.jsx` e `ManualAdmin*.jsx`, leitor de ficha em `lib/properties.js`, semente, `tests/manual-*.test.mjs`, rule `manual.md`, docs. Impacto em outros módulos: nenhum previsto (Manual é isolado de funil/ranking/financeiro). Estimativas são hipóteses.

| Fase | Entrega | Porte |
|---|---|---|
| 0 | Decisões (seção 0) e validação das pendências A mais bloqueantes | sem código |
| 1 | Migrations aditivas, livros/capítulos/páginas, campos e fontes, administração, semente de **rascunhos** (sem flip; índice e navegação já dão "consultar rápido") | M |
| 2 | Busca ampliada com deep link; Recentes local | P/M |
| 3 | Blocos dinâmicos (Base Mestra, funil) e "precisa de revisão" | M |
| 4 | Ficha viva de empreendimento (lista branca) | M |
| 5 | Protótipo isolado do livro (seção 11) e implementação da virada | M/G |
| 6 | Fixados/sincronização, buscas sem resultado, cache offline | P/M |

Total se feito de uma vez: G. Recomendado em fases, com piloto de 3 a 5 corretores (mediana ≤ 10 s da Home à página, B2 §17).

---

## 6. Arquitetura de conteúdo e inventário

Todas as páginas nascem **RASCUNHO**; sem fonte = **PENDENTE DE VALIDAÇÃO**. "Tipo": **D** dinâmico (lido da fonte) · **M** misto · **E** editorial. Pendências (Pnn) estão na seção 4.

### 6.0 Agrupamento: 7 livros (Designer) × 11 cards do dono

| Cards sugeridos pelo dono (11) | Livro proposto (7) |
|---|---|
| MCMV | 01 MCMV |
| Rendas | 02 Rendas |
| Documentação | 03 Documentação |
| FGTS · Benefícios e Subsídios · Simulação | 04 **Dinheiro da compra** (capítulos FGTS, Subsídios, Entrada, Simulação) |
| Aprovação e Financiamento · Jornada do Cliente | 05 **Aprovação e jornada** |
| Atendimento · WhatsApp e Comunicação | 06 Atendimento |
| Empreendimentos | 07 Empreendimentos (estante viva) |

**Difere dos 11:** sim, funde 3+2+2 cards em 3 livros. Motivo (B2 §3.1): cada item a mais na Home é uma decisão com o cliente esperando; livros de 1 a 3 capítulos ficariam rasos. Regra de ajuste: Simulação ou FGTS com 4+ capítulos próprios vira livro separado (Home com 8). Esta consolidação mostra Simulação com 1 capítulo e FGTS com 1; **mantém 7**. Decisão 4.

### 6.1 Livro 01 MCMV (maioria pendente: dependência externa)

| Cap. | Página | Tipo | Fonte | Conf. | Status |
|---|---|---|---|---|---|
| 1.1 O programa | 1.1 O que é o MCMV (linguagem simples) | E | `docs/atendimento/especialistas/primeiro-imovel-mcmv.md` (método) | média | PENDENTE (P29) |
| | 1.2 Como o cliente caminha (etapas) | E | `docs/minha-jornada.md` | média | RASCUNHO |
| 1.2 Quem pode | 1.3 Elegibilidade e faixas de renda | E | nenhuma | pendente | PENDENTE (P10) |
| 1.3 Apoios | 1.4 Subsídio: o que o sistema faz | E | `subsidioMcmv` é dado do cliente (`types.ts` L18; `cliente-entrada.js` L15) | média | RASCUNHO (sem valores) |
| | 1.5 Casa Paulista | M | SIM-1 (sistema) + programa estadual (externa) | alta (sistema) / pendente (programa) | RASCUNHO + PENDENTE (P12) |
| 1.4 Dúvidas | 1.6 Dúvidas e objeções comuns | E | ponteiro ao Banco de Objeções (publicado) | média | RASCUNHO |
| | 1.7 Blindagem Financeira | E | só 2 menções em `BUSINESS_RULES.md` | pendente | PENDENTE (P14) |
| | 1.8 Teto, juros, prazos | E | nenhuma | pendente | PENDENTE (P10) |

### 6.2 Livro 02 Rendas

| Cap. | Página | Tipo | Fonte | Conf. | Status |
|---|---|---|---|---|---|
| 2.1 CLT | 2.1 O que o CLT apresenta | M | motor `engine:110-116,156-171`; Base Mestra `ctps_format` | alta (conflito C-5 em holerite) | RASCUNHO (P06, P07) |
| 2.2 Informal | 2.2 Documentos da renda informal | M | motor `engine:127-139` | alta | RASCUNHO (P06) |
| | 2.3 Como a média é calculada e o que sai | D | Base Mestra `bank_income`; `document-policy.mjs:42-70` | alta | RASCUNHO |
| 2.3 IR | 2.4 Declarante de IR | M | motor `engine:117-126` | média | RASCUNHO (P05) |
| 2.4 Composição | 2.5 Cônjuge e 2º proponente | M | motor `engine:41-62`; `marriage_spouse` | média (C-2) | RASCUNHO (P03) |
| | 2.6 Outros tipos de renda | E | nenhuma | pendente | PENDENTE (P24) |
| | 2.7 Renda mínima e comprometimento | E | nenhuma | pendente | PENDENTE (P27) |

### 6.3 Livro 03 Documentação

| Cap. | Página | Tipo | Fonte | Conf. | Status |
|---|---|---|---|---|---|
| 3.1 Identificação | 3.1 RG (com CPF) ou CNH | M | motor `engine:86-90` | alta | RASCUNHO (P08) |
| 3.2 Residência | 3.2 Comprovante: tipos aceitos, de quem, titularidade por renda, fatura de cartão | D | Base Mestra `residence_source`, `residence_income_ownership`; `document-policy.mjs` | alta (C-6: redação muda) | RASCUNHO |
| | 3.2b Validade e endereço completo | E | matriz do dono (não implementada) | pendente | PENDENTE (P01, P04) |
| 3.3 Estado civil | 3.3 Certidões por estado civil | M | motor `engine:92-106` | alta | RASCUNHO |
| | 3.3b Casamento sem averbação e cônjuge | D | Base Mestra `marriage_spouse` | média (C-2) | RASCUNHO (P03) |
| | 3.3c Viúvo/estado civil vazio | E | motor (nada exigido) | média | PENDENTE (P25) |
| 3.4 Família | 3.4 Dependentes menores | M | motor `engine:33-39` | alta | RASCUNHO |
| 3.5 FGTS | 3.5 Extrato do FGTS na documentação | D | Base Mestra `fgts_updated`; motor `:64-73,160-162` | média (C-3) | RASCUNHO (P02) |
| 3.6 Conferência | 3.6 Duplicados e divergência de dados | E | matriz 13/16; motor | média | RASCUNHO (P26) |
| 3.7 Pendências | 3.7 Como pedir ao cliente (link ao Manual, seção Documentação) | E | Manual publicado | média | RASCUNHO |
| 3.8 Caixa | 3.8 O que a Caixa/CCA pede | E | nenhuma | pendente | PENDENTE (P09) |

### 6.4 Livro 04 Dinheiro da compra (FGTS + Subsídios + Entrada + Simulação)

| Cap. | Página | Tipo | Fonte | Conf. | Status |
|---|---|---|---|---|---|
| 4.A FGTS | 4.1 O que é e usos | E | nenhuma | pendente | PENDENTE (P13) |
| | 4.2 Extrato de FGTS (link 3.5) | D | Base Mestra | média | RASCUNHO (P02) |
| | 4.3 "FGTS conta como entrada" | E | cards `sol-sem-entrada`/`sol-entrada-composta` (A3) | baixa | PENDENTE (P13) |
| 4.B Subsídios | 4.4 Subsídio no cálculo (sem valores) | E | `cliente-entrada.js` L15 | média | PENDENTE para valores (P11) |
| 4.C Entrada | 4.5 O que é a entrada (conceito) | E | `types.ts` (conceitos de resultado) | média | RASCUNHO |
| | 4.6 Benefício informativo × desconto de tabela | E | `types.ts`; A3 §4.2 | média | RASCUNHO |
| 4.D Simulação | 4.8 O que é a simulação (estimativa, não aprovação) | E | A3 §4.2; motor | alta | RASCUNHO |
| | 4.9 Passo a passo do corretor | E | A3 §4.2 | média | RASCUNHO |
| | 4.10 Entender o resultado (valor final, total coberto, entrada total) | M | `types.ts`; `presentation-model.mjs` | média | RASCUNHO |
| | 4.11 Status da simulação no funil | D | `client-status.js` | alta | RASCUNHO |
| | 4.12 Tabela do empreendimento e validade | E | `empreendimentos.regras.atualizadoEm` | baixa | PENDENTE (P22) |
| | 4.13 Proposta de Valores (PDF) | E | SIM-2 | média | RASCUNHO |
| | 4.14 Simulação enviada: como explicar sem números | E | lacuna do Guia de Atendimento | pendente | PENDENTE (P16) |

Regra de redação (A3 §0): o Guia nunca afirma valor, faixa, taxa, limite ou fórmula; usa "o sistema calcula conforme as regras vigentes". Valores de exemplo de SIM-1 são EXEMPLO.

### 6.5 Livro 05 Aprovação e jornada (Jornada do Cliente)

**Representação (ajuste 1).** Prospecção **não** é macroetapa. A página de abertura lê de `lib/client-status.js` e desenha duas faixas:

| Faixa | Itens | Tipo | Fonte |
|---|---|---|---|
| **ENTRADA / BASE** (não é macroetapa) | **Prospecção** = aba "Prospecção" da tela Clientes = status `awaiting_return`, rótulo "Tentando contato" | D | `client-status.js` L324-326 |
| **7 MACROETAPAS** | Atendimento · Simulação · Aguardando documentação · Aguardando aprovação · Cliente aprovado · Reunião · Venda | D | `CLIENT_FUNNEL_STAGES` L307-315 |
| **Estados paralelos** (fora das macroetapas) | Atendimento automático · Aguardando simulação · Arquivado · Não contactar | D | `client-status.js` |

Nota fixa na página: aba da tela e macroetapa **não coincidem** para "Aguardando simulação" (aba Simulação) e "Atendimento automático" (aba Atendimento). Reprovado, Restrição e Blindagem **permanecem em Aguardando aprovação** (regra explícita do negócio). O livro explica o CRM como ele é.

| Cap. | Página | Tipo | Fonte | Conf. | Status |
|---|---|---|---|---|---|
| 5.1 Ler o funil | 5.1 Entrada/Base e macroetapas | D | acima | alta | RASCUNHO |
| | 5.1b Aba da tela × macroetapa; estados paralelos | D | idem | alta | RASCUNHO |
| 5.2 Entrada | 5.2 Prospecção (Tentando contato): pendência após 3 dias sem contato | M | `client-status.js` L355-381 [REGRA OFICIAL 2026-10-02] | alta (regra) | RASCUNHO; objetivo/erros PENDENTE (P15) |
| 5.3 Macroetapas | 5.3 Atendimento | M | comentário do código L2-4 | média | RASCUNHO; PENDENTE (P15) |
| | 5.4 Simulação | M | FUN-7 | média | RASCUNHO; PENDENTE (P15) |
| | 5.5 Aguardando documentação | M | link ao Livro 03 | média | PENDENTE (P15) |
| | 5.6 Aguardando aprovação | M | rule do funil | média | PENDENTE (P14, P28) |
| | 5.7 Cliente aprovado | M | FUN-6 (`approved_at`) | média | PENDENTE (P15) |
| | 5.8 Reunião e Venda | M | FUN-5 (efeitos automáticos) | média | PENDENTE (P15, P16) |
| 5.4 Aprovação | 5.9 A aprovação é da Caixa (o CRM só registra) | E | A3 §0 | média | RASCUNHO |
| | 5.10 Análise de crédito: regras e prazos | E | nenhuma | pendente | PENDENTE (P09, P28) |
| 5.5 Cliente | 5.11 O que o cliente vê na Minha Jornada | M | `docs/minha-jornada.md` | alta | RASCUNHO |

Texto do "objetivo / próxima ação / erros comuns": **CONTEÚDO PENDENTE DE VALIDAÇÃO** (P15). Padrão sugerido para "próxima ação": regra central (próximo passo + data de retorno), marcado como hipótese até o dono validar.

### 6.6 Livro 06 Atendimento (inclui WhatsApp e Comunicação)

Regra: este livro **aponta** para o Guia de Atendimento publicado (A4: 4 guias, 134 nós, v1, `published_at` 25/09/2026; rascunho v4 só no guia "lead", diferença aparentemente de layout) e **não duplica** os nós. Inventário é fotografia de 03/10/2026.

| Cap. | Página | Tipo | Fonte | Conf. | Status |
|---|---|---|---|---|---|
| 6.1 Método | 6.1 Regra central (objeção > investigar > motivo real > solucionar > testar > documentação > data de retorno) | E | `docs/GUIA_ATENDIMENTO.md` L3-7 | alta | RASCUNHO |
| 6.2 Conversa | 6.2 Primeira abordagem (Prospecção, Lead, Orgânico) | E | guias publicados | média | RASCUNHO (P17) |
| | 6.3 Objeções | E | Banco de Objeções publicado | média | RASCUNHO (P17) |
| | 6.4 Vácuo (3 tentativas) e documentos | E | banco/seed | média | RASCUNHO (P17) |
| 6.3 Fases sem roteiro | 6.5 Aprovado, reunião, venda, pós-venda, reativação 30/60/90 | E | nenhuma | pendente | PENDENTE (P16) |
| 6.4 Regras absolutas | 6.6 Não contactar | E | `nao-contactar.md`; CLAUDE.md regra 9 | alta | RASCUNHO |
| 6.5 WhatsApp | 6.7 Canal individual × WhatsApp Oficial; botão do card; resposta muda estágio (PRO-8) | E | `WHATSAPP.md` §1-A; WA-13a; PRO-8 | alta | RASCUNHO |
| | 6.8 Janela de 24 h e modelos | E | `WHATSAPP.md` §5 | média | RASCUNHO (P19) |
| | 6.9 Alerta "cliente aguardando" | E | diagnóstico | média | RASCUNHO (P20) |
| | 6.10 Regras da Meta | E | nenhuma | pendente | PENDENTE (P18) |

### 6.7 Livro 07 Empreendimentos (estante viva)

| Cap. | Página | Tipo | Fonte | Conf. | Status |
|---|---|---|---|---|---|
| 7.1 Estante | Lista de empreendimentos publicados (foto, nome, região) | D | `lib/properties.js` (lista branca) | alta | não é rascunho: segue o cadastro |
| 7.2 Livro de cada empreendimento | Visão geral, Região, Diferenciais, Fotos | D | idem | alta | idem |
| | Tipologias | D/E | `bedrooms`/`area` em texto livre | baixa | PENDENTE (P21) |
| | "Como apresentar" (argumentos, objeções, público) | E | nenhuma | pendente | PENDENTE; passa pelo fluxo |
| | Preço e condições | — | **fora nesta fase** | — | remeter à ficha/simulador |

Detalhes na seção 7.

---

## 7. Ficha viva de empreendimento

**Princípio (A1, B2 §12):** nunca copiar fato do cadastro para texto do Guia. A página editorial referencia `development_id` (=`properties.id`) e o servidor renderiza o bloco na hora da leitura. Campo vazio **some** (não exibe "sem dado").

**Dinâmico × editorial**

| Dinâmico (do cadastro, em tempo de leitura) | Editorial (fluxo de aprovação) |
|---|---|
| Nome, construtora, região/localização, tipo, previsão de entrega, diferenciais, fotos | "Como apresentar": argumentos, objeções, público-alvo, ordem de apresentação |

**Lista branca de campos (positiva; qualquer campo novo no cadastro fica de fora até ser autorizado)**

| Situação | Campos de `properties` |
|---|---|
| **Entra** (descritivos seguros) | `name`, `builder`, `location`, `region`, `type`, `delivery`, `features_json` (diferenciais), `photos_json`, `is_published` (só publicados) |
| **Limítrofes: decisão antes de incluir** | `status`, `area`, `bedrooms` (texto livre), `sales_text` (texto comercial), `builder_url`, `delivery` como promessa de data |
| **Fora por ora** | `price`, `terms`, `discounts`, `installment_entry`, `sales_text`, `regras` (todo o jsonb de `empreendimentos`), `internal_notes`, `pdf_data`, `whatsapp`, `instagram`, `display_order` |

Rodapé de cada ficha: "Dados do cadastro · atualizado em dd/mm · Abrir ficha completa" (a ficha completa é a tela interna existente).

**"Precisa de revisão":** a página editorial `development_id` marca revisão quando `properties.updated_at` for mais novo que `last_reviewed_at` (confirmar a coluna), quando o empreendimento for despublicado, ou quando a lista branca mudar. Despublicado: o corretor vê "indisponível", nunca dado antigo.

**Segurança:** o leitor devolve objeto montado campo a campo; **nunca** serializa `rowToProperty` (`lib/property-mapper.js:8-40`) inteiro. Teste obrigatório: nenhum campo fora da lista branca aparece na resposta, para cada perfil.

**Depois, com aprovação:** preço/condições, só do cadastro e com data visível (A1 opção B).

---

## 8. Busca

| Aspecto | Proposta |
|---|---|
| Escopo | Livros, capítulos, páginas publicadas do perfil; Manual do CRM (já existe); empreendimentos (nome/região, lista branca); Novidades como grupo separado |
| Resultado | `Livro › Capítulo › Página` + título + trecho com termo marcado |
| Destino | **Abre direto na página** (hash `#livro/capitulo/pagina`), termo destacado, chip "Voltar aos resultados" |
| Ordem | Título > resumo > corpo |
| Filtro | No servidor, sobre conteúdo já filtrado por perfil e estado; rascunho/aguardando/`internal_note`/fonte interna nunca entram |
| Dinâmico | Não indexado na v1; só títulos e resumo editorial |
| Termo curto, acento | Mínimo de 2 caracteres, ignora acento e caixa (confirmar no core atual) |
| Sem resultado | "Nada encontrado para '…'. Tente uma palavra mais curta." + "Todos os livros"; registro de buscas sem resultado é opcional (decisão do dono) |
| Atalhos | `/` ou `Ctrl K` no desktop; campo grande na Home do celular |
| Histórico | Virar página não cria entrada de histórico (`replaceState`); abrir livro e resultado criam |
| Compatibilidade | Links atuais `/admin/manual#topico/secao` continuam funcionando |

---

## 9. Administração

- **Mesmo livro com camada de gestão** (admin; gestor só se o dono liberar): faixa de saúde em uma linha (publicadas · aguardando · rascunhos · revisão vencida), árvore Livro › Capítulo com chip de estado, pré-visualização "como o corretor vê" com faixa âmbar se não publicada.
- **Painel da página:** estado em 3 passos, **fonte interna + fonte externa + data da última verificação**, responsável, última revisão e "revisar até", público (perfis), versão (histórico só admin).
- **Ações:** Editar (publicado continua no ar até nova aprovação), Enviar para aprovação, **"Aprovar e publicar" só o dono** (desabilitado com motivo para os demais).
- **Páginas PENDENTES:** visíveis só ao admin, com a lista "o que falta e quem resolve" (classe A–E da seção 4). Ao corretor, grupo recolhido "Em validação (n)" com o aviso padrão; **nunca** texto de rascunho, nem como prévia.
- **Fila de revisão:** ordenada por tipo de fonte externa vencida, fonte viva alterada e revisão vencida.
- **Auditoria:** reaproveita `manual_section_versions` (quem, quando, antes/depois).

---

## 10. Proposta visual (resumo do B2)

Prioridade: **consultar rápido, entender rápido, navegar direto, experiência de livro** (nessa ordem).

- **Índice é a porta; livro é a embalagem.** Home → livro → capítulo em 3 toques. Virar página só entre páginas vizinhas; nunca para achar algo. A capa é o cartão da Home; abrir o livro cai direto no Índice.
- **Home:** busca grande, até 3 Recentes, 6 capas em uma só família (marinho) + faixa de Empreendimentos.
- **Página = uma tela, resposta primeiro:** resumo (≤ 2 frases), passos (≤ 5), Atenção (ícone + rótulo), Exemplo, rodapé "Fonte · Revisado em · Ver no Manual". ~120 palavras, no máximo 4 blocos.
- **Celular:** folha única, barra inferior (Índice · ‹ n/total › · Buscar), alvos ≥ 44 px. **Desktop ≥ 1024:** 2 páginas, abas de capítulo, teclado.
- **Estados:** vazio, pendente (selo "Em validação"), offline, sem permissão (capítulo não existe para o perfil).
- **Acessibilidade:** texto real e selecionável, teclado completo, `aria-live` na troca, `prefers-reduced-motion` = efeito Simples.

Mockups: `docs/guia-corretor/mockups/guia-mobile.html` (8 telas) · `guia-desktop.html` (5 telas) · imagens `render-mobile.png`, `render-desktop.png`. Texto dos mockups é placeholder. Detalhes: `docs/guia-corretor/B2-proposta-design.md`.

---

## 11. Page flip: duas alternativas, sem escolha definitiva

Fonte: relatório do Scout (2026-10-03). O Scout **recomenda** a alternativa A; aqui as duas seguem em aberto, e a escolha só vem do protótipo e do dono.

| | **A. Implementação própria** (CSS 3D + Pointer Events) | **B. Biblioteca (plano B)**: `@gullabs/react-flipbook` + core |
|---|---|---|
| O que é | Código nosso; páginas como `<section>` reais; Motion opcional | Fork do StPageFlip; v3.2.2 (01/10/2026) |
| Dependência | Nenhuma obrigatória | Nova, em versão exata + lockfile |
| Licença | n/a | Wrapper MIT; motor MPL-2.0 (ok sem alterar o motor) |
| Nota do Scout (0-14) | 13 | 10 |
| Esforço (estimativa) | ~4-7 dias | menor para o efeito; integração e correções a medir |
| Bundle | <10 kB gzip (estimativa), só na rota do Guia | maior (motor de 1-2 mil linhas) |
| A favor | DOM real, SSR, deep link, índice e busca naturais; controle total de a11y e reduced motion | Dobra curva pronta |
| Contra | Polimento da dobra; testar em aparelho fraco | Projeto de ~1 mês, 3 estrelas; **só testado em Chromium** (Safari/iOS não confirmado); derivados do StPageFlip reposicionam páginas fora da árvore do React (**inferência, não verificada**): risco para deep link, busca, leitura por tela |
| Não confirmado | desempenho real | atividade do repositório original, compatibilidade com React 19, Safari/iOS e Android |
| Descartadas | `react-pageflip` (abandonada, sem peerDeps), StPageFlip puro (referência), turn.js (licença incerta) | — |

**Avaliação de experiência do Designer (B2 §9, §19).** Requisitos que qualquer técnica deve cumprir: efeito escolhível (Realista / Simples / Nenhum, como Apple Books e Kindle); arraste em que a folha acompanha o dedo, limiar ~30% e interrompível; botão com ≤ 280 ms; só `transform`/`opacity`; fallback automático para Simples em aparelho que perde quadros ou com `prefers-reduced-motion`; texto real selecionável; **a virada nunca atrasa a consulta**. Conclusão do Designer: o efeito é camada opcional; o ganho real está em índice, busca e resumo. **O movimento não é verificável em imagem estática**; a sensação só se valida em protótipo no celular. O crítico alerta que no desktop o efeito mais arrisca virar enfeite (coluna única fica como alternativa a testar no piloto). Contra os requisitos: A atende de forma nativa (é o desenho dela); B precisa provar DOM real, a11y e Safari.

**Critérios do protótipo isolado futuro** (3 páginas, fora do app; **não feito agora**):

| Critério | Como medir |
|---|---|
| Sensação de folhear | Avaliação de 3 a 5 corretores + Designer, nota simples |
| Toque | Botões Anterior/Próxima concluem ≤ 280 ms |
| Arraste parcial | Folha acompanha o dedo; completa após ~30% ou velocidade; senão volta |
| Voltar | Arraste inverso, botão, e botão voltar do navegador sem criar histórico por página |
| Desempenho | 60 fps percebidos; sem travar a rolagem vertical interna (`touch-action`) |
| iPhone / Safari | Aparelho real |
| Android / Chrome | Aparelho real |
| Aparelho intermediário | Android modesto; se falhar, padrão Simples no celular |
| Acessibilidade | Teclado completo, leitor de tela, `aria-live`, páginas ocultas `inert` |
| Reduced motion | Efeito Simples sem deslocamento; gesto ainda troca de página |
| Link direto | Abrir `#livro/capitulo/pagina` cai na página certa (SSR) |
| Texto selecionável | Copiar texto da página para o Chat |

Sequência: protótipo de A (1 dia) → só se reprovar, protótipo de B (versão exata, conferindo Safari/iOS) → Designer define o visual, `design-critic` revisa. Dependência nova exige aprovação do dono.

---

## 12. Decisões do Designer pendentes e decisões do dono nas auditorias

**Designer (B2 §20):** (1) agrupamento 7 × 8 × 11; (2) nome do Guia × Guia de Atendimento; (3) Realista como padrão (alternativa: Simples no celular); (4) Fixados e sincronização; (5) gestor na camada de gestão. Também em aberto: botão "Avisar a gestão" e registro de buscas sem resultado (exigem endpoint); cache offline no service worker; campo de tipologias; reordenar livros por uso real depois do piloto.

**Auditorias**
- **A1:** ficha viva com preço/condições (opção A só descritivos, recomendada; B com data depois) e `internal_notes` fora do Guia (recomendado).
- **A2:** opção A (Guia cita só o ativo; comprovante "mês atual/anterior" e FGTS não-CLT em validação) × opção B (dono confirma, implementa, depois entra). Recomendada: A agora, B depois.
- **A3:** Prospecção como Entrada/Base (**já decidido pelo dono**, só confirmar nome); definição de Blindagem Financeira; "FGTS conta como entrada"; roteiros de aprovado/reunião/venda/pós-venda/reativação; correção das contagens FUN-1/FUN-2 na documentação; comparar o texto publicado com o seed antes de citar.
- **A4:** autorizar comparação (leitura) do texto dos 134 nós com o seed.

Consolidado: seção 0, decisões 1 a 15.

---

## 13. RISCO ENCONTRADO FORA DO ESCOPO (nada foi corrigido)

> **Atualização 2026-10-04:** o risco R1/R3 (notas internas visíveis a todo perfil) **foi corrigido em tarefa separada** — só admin e gestor recebem `internalNotes`, com filtro no servidor (ver `docs/SYSTEM_ARCHITECTURE.md` P-22 e `docs/CHANGELOG_AI.md`). O texto abaixo é o registro original, preservado.

| # | Achado | Evidência | Gravidade |
|---|---|---|---|
| R1 | **Notas internas de empreendimento visíveis a todo perfil.** A tela interna usa `requireAdminPage()` (qualquer perfil ativo, incluindo associado) e mostra o bloco "Informações internas" quando existe `internalNotes` | `app/admin/empreendimentos/consulta/[id]/page.jsx:13` (guard) e **`:28`** (bloco). A1 citou L26; por leitura, a linha correta é a 28 (a 26 é "Informações comerciais"). `internalNotes` vem de `lib/property-mapper.js:30` | **P1** se as notas tiverem dado sensível; P3 se forem só observações de equipe. Intenção não confirmada |
| R2 | A mesma tela mostra "Informações comerciais" (`terms \|\| salesText`) a todo perfil | `page.jsx:26`. Informativo: afeta a decisão de condições comerciais fora do Guia | P3 |
| R3 | Não verificado: se `internalNotes` chega por outra rota pública ou de listagem (o mapper serializa o campo) | `lib/property-mapper.js:30`; não auditei os consumidores | A auditar (`auditor-crm`) |
| R4 | Docs com contagens desatualizadas: FUN-1 "24 valores" × 30; FUN-2/comentário "8 legados" × 9 | `docs/BUSINESS_RULES.md:31`; `lib/client-status.js:303`; contagem de A3 (não refeita) | P3 |
| R5 | Rule do funil e `funil-e-etapas.md` não citam a diferença aba × macroetapa | A3 §2.3 | P3 |
| R6 | Rascunho do GBP afirma "mês atual/anterior, regra oficial do dono" para comprovante, regra não implementada | `docs/posicionamento/rascunhos/2026-10-02-gbp-pacote.md:131` (por A2) | P2 se publicado como está |
| R7 | `list_tables` do Supabase mostrou `attendance_guides = 0` (estatística velha); real = 4 | A4 | P3 (armadilha para auditorias; usar `count(*)`) |
| R8 | Guia do Corretor × "Guia de Atendimento" (nome idêntico; a árvore do Chat já usa "Guia") | B2 §3.2 | P3 (confusão de nome) |
| R9 | Texto de `residence_income_ownership` é regenerado ao salvar; qualquer cópia estática diverge | A2 C-6 | P3 |
| R10 | Árvore de trabalho com mudanças sem relação com esta tarefa (`.claude/despachante/REGISTRO.md`, `docs/posicionamento/**`, `docs/atendimento/diagnostico-inicial-2026-10-03.md`, `docs/scout/relatorios/**`, `docs/guia-corretor/`) | `git status` | Informativo: commitar `docs/guia-corretor/` à parte |
| R11 | Pasta `docs/guia-corretor/mockups/` pesa ~2,3 MB (HTML + PNG); chips tracejados são "só para o dev" | listagem de arquivos | Não publicar nem copiar para `public/` |

---

## 14. Próximos passos propostos após aprovação (sem executar)

1. **Dono:** decidir as 15 decisões da seção 0 (prioridade: 1, 2, 3, 4, 6, 15).
2. **Dono:** validar pendências de classe A, na ordem que mais destrava páginas: P01, P02, P03, P29, P14, P15, P16.
3. **`auditor-crm` (leitura):** confirmar alcance de R1/R3 (quem vê `internalNotes`, e por qual rota). Correção só com pedido explícito.
4. **`analista-dados` (leitura):** comparar texto dos 134 nós publicados com o seed (P17).
5. **`especialista-atendimento-web`:** só se o dono quiser capítulo de regras oficiais; fontes oficiais com data (P10, P11, P12, P13, P18). Nada agora.
6. **`crm-editor`, Fase 1 (M):** migrations aditivas, livros/capítulos/páginas, campos de fonte e revisão, administração, semente de **rascunhos** e testes `tests/manual-*.test.mjs`; atualizar `.claude/rules/manual.md`, docs e `docs/CHANGELOG_AI.md`. Sem publicar.
7. **`crm-editor`, Fases 2 a 4:** busca com deep link e Recentes; blocos dinâmicos; ficha viva com lista branca.
8. **`designer-crm` + `crm-editor`:** protótipo isolado de page flip (seção 11); `design-critic` revisa; escolha A/B com o dono.
9. **Piloto** com 3 a 5 corretores antes de publicar qualquer livro; a publicação é sempre ação do dono.
10. **Tarefa separada:** corrigir FUN-1/FUN-2, DOC-6 e a rule do funil (R4, R5, C-7), se autorizado.

---

### Anexo: onde cada ajuste do dono foi atendido

| Ajuste | Onde |
|---|---|
| 1 Prospecção = Entrada/Base | 3 (Prospecção), 6.5 |
| 2 Pendências A-E em tabela | 4 |
| 3 Fonte interna + externa + data | 5.2, 5.3 |
| 4 Base Mestra = verdade; Guia = apresentação | 0, 5.3, 6 (coluna Tipo) |
| 5 Decisões de conteúdo | 3 |
| 6 Empreendimentos (lista branca) | 7 |
| 7 Riscos fora do escopo | 13 |
| 8 Page flip, duas alternativas | 11 |
| 9 Guia publicado no banco | 2, 6.6, P17 |
| 10 Design: consultar/entender/navegar/livro | 10 |

---

**RESULTADO:** documento consolidado, 15 decisões do dono com recomendação, 29 pendências classificadas A-E com bloqueio por página, arquitetura aditiva sobre o Manual, inventário de 7 livros (todos RASCUNHO; sem fonte = PENDENTE), ficha viva com lista branca, page flip com as duas alternativas e critérios de protótipo. Notas internas de empreendimento visíveis a todo perfil confirmadas por leitura (`page.jsx:28`). Nada implementado, publicado ou corrigido.
**ARQUIVOS:** `docs/guia-corretor/CONSOLIDACAO.md` (único criado).
**PENDÊNCIAS:** decisões 1 a 15 do dono; validação das pendências classe A; R3 (outros consumidores de `internalNotes` não auditados); contagens FUN-1/FUN-2 vêm de A3 (não refeitas); texto dos 134 nós × seed não comparado; coluna `properties.updated_at` e normalização de acento na busca atual a confirmar no código.

---

## 15. DECISÕES DO DONO REGISTRADAS (2026-10-03)

**Aprovadas (estruturais):** #2 preço e condições NÃO entram na ficha (fase 1) · #3 notas internas NÃO entram · #4 agrupamento em 7 livros · #5 manter "Guia do Corretor"; árvore do Chat passa a "Roteiro de atendimento" (só na tela, quando implementar) · #6 estender o Manual existente, sem recriar o módulo e sem alterar os 8 tópicos/40 seções publicados · #12 page flip NÃO escolhido: primeiro protótipo isolado no celular (12 critérios, seção 11) · #13 "Recentes" na v1; Fixados e sincronização entre aparelhos só depois do piloto · #14 camada de gestão: somente Admin na v1 · #15 risco das notas internas: NÃO corrigir aqui; tarefa separada de auditoria/correção.

**Ainda NÃO autorizadas (não presumir resposta):** #1 comprovante mês atual/anterior e FGTS não-CLT · #7 conflitos C-2 a C-6 e "documentação aplicável do cônjuge" · #8 correção das contagens de status · #9 validação das pendências classe A · #10 regras fixas do motor na Base Mestra · #11 prazo de revisão das fontes externas.

**Próximo passo autorizado:** somente o PROTÓTIPO ISOLADO do page flip (conteúdo fictício; sem banco, migration, Manual ou CRM; sem biblioteca definitiva).

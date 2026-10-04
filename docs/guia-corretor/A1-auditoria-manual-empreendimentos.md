# A1 - Auditoria: Manual do CRM e cadastro de empreendimentos (somente leitura, 2026-10-03)

Legenda: [C] comprovado no codigo; [H] hipotese.

## 1. Como o Manual funciona hoje
- Dados [C]: `supabase/migrations/20261003230000_manual_crm.sql` cria 5 tabelas: `manual_topics` (L4), `manual_sections` (L17, `topic_id`, `body`, `published_version_id`), `manual_news` (L31), `manual_section_versions` (L49, body_before/after, aprovado_por/em), `manual_news_reads` (L63). RLS ligado sem policy, so service_role (L77-86).
- Estrutura hoje = 2 niveis: Topico -> Secao (corpo texto unico). Nao ha "livro" nem "capitulo" [C].
- Estados [C]: `lib/manual-core.mjs:6` draft/pending/published (+discarded so em novidade). Transicoes L85-95. Topico e secao: draft->pending->published; publicado volta so a pending.
- Workflow [C]: `lib/manual-service.mjs`. Criar/editar = `admin` (admin geral, L60-64). Aprovar/publicar = so o dono (`approver`, L65-69, `isOwnerAdminEmail` em `lib/manual.js:10`). Secao publicada nunca muda "por baixo": edicao vira versao proposta (L189-216), aprovada em `approveVersion` (L218). Novidade publica gera alerta por audiencia explicita (L340-370) e pode atualizar uma secao (suggested_section_id/body).
- Audiencia [C]: `audiences text[]` (all/broker/manager/admin), aplicada no backend (`canSeeContent`, core L26; `buildVisibleManual` L111 so published). Associado ve como corretor (L18-23).
- Guarda [C]: `lib/manual-guard.mjs` (regex sobre texto normalizado). Roda em create/update/approve/publish/alerta (service L150,163,180,200,304,341) e de novo na LEITURA (`passesGuard`, L387; usado em L90-91,109). Server-only, sem import em client.
- Busca [C]: `searchVisibleManual` (core L168) so sobre conteudo ja filtrado; substring em titulo/corpo, max 30 hits, com snippet e `href` `/admin/manual#topico/secao` (core L74). Rota `app/api/admin/manual/search/route.js`. Sem ranking por fonte, sem busca em Novidades.
- Novidades [C]: tabela propria, "Novo" derivado por data (core L64), leitura confirmada opcional (`requires_ack`), deep link `?novidade=slug`.
- Semente [C]: `loadManualSeeds` (service L391) cria tudo pending/draft, nunca publica nem sobrescreve corpo preenchido.
- UI [C]: `components/manual/ManualBrowser.jsx` (leitura, hash/`?novidade`), `ManualAdmin*.jsx` (`/admin/manual/gerenciar`).

## 2. Reaproveitar x faltante
Reaproveitar sem mexer: workflow de status, aprovacao so do dono, audiencia no backend, guarda de conteudo (escrita+leitura), versionamento, alerta de novidade, busca pura, deep link por hash.
| Necessidade | Situacao |
|---|---|
| Livros -> capitulos -> paginas | Falta 1 nivel. Opcao aditiva: tabela `manual_books` e `manual_topics.book_id` (nullable) = capitulo; secao = pagina [H, viavel] |
| Fonte, categoria da fonte, ultima revisao, responsavel, obs. interna | Nenhum existe [C]. `last_updated_at` e so data de edicao do corpo. Colunas novas em `manual_sections` |
| "Precisa de revisao" | Falta; derivavel de revisao vencida + sinal de mudanca da fonte (ver 3) |
| Favoritos / recentes | Falta; tabela `manual_user_marks(user_id, section_id, kind, at)` (padrao de `manual_news_reads`) |
| Busca com deep link ate a pagina | Ja existe ate a secao (href com hash) [C]; falta indexar livro, Novidades e empreendimentos |
| Obs. interna nunca ao corretor | `stripAudience`/map de `buildVisibleManual` (core L104-126) usa lista branca de campos; campo novo fica privado por padrao [C] |

## 3. Cadastro de empreendimentos
- Base [C]: tabela `properties` (id text) com `is_development` (`20260908_separate_developments_from_properties.sql`) + tabela `empreendimentos` 1:1 pelo mesmo id (`20260908_empreendimentos_regras_entrada.sql:8`), `regras jsonb` no tipo `Empreendimento` (`lib/simulacao-entrada/types.ts:200`).
- Campos de `properties` (`lib/property-mapper.js:8-40`): name, builder, location, region, status, type, price (texto), terms, discounts, installment_entry, delivery, area (texto), bedrooms (texto), features_json (diferenciais), photos_json, pdf_data (book, base64/data URL), builder_url, whatsapp, instagram, internal_notes, sales_text, is_published, display_order.
- Tipologias [C]: NAO ha entidade estruturada; so `bedrooms`/`area` em texto livre. Valores: `price` texto + `valorImovel` numerico em `regras`. Regras comerciais: `regras` jsonb (descontos, ato, parcelas, tabela de condicoes, engenharia) = dado SENSIVEL.
- Tela interna [C]: `app/admin/empreendimentos/consulta/[id]/page.jsx` (requireAdminPage, qualquer perfil) mostra construtora, local, entrega, `terms/salesText`, diferenciais, `internalNotes` e book. Nao ha `app/api/admin/empreendimentos`; leitura via `lib/properties.js`.
- Arquitetura hibrida proposta [H]: NAO copiar fatos para o Manual. Pagina editorial referencia `development_id` (fk logica a `properties.id`, tabela `manual_section_refs` ou coluna em `manual_sections`) e renderiza em tempo de leitura um bloco "ficha viva" (nome, regiao, entrega, diferenciais, fotos) lido de `lib/properties.js`, com lista branca de campos. Texto editorial (argumentos, objecoes, publico-alvo) fica em `manual_sections` com fluxo de aprovacao. Fonte da pagina = "Cadastro de empreendimentos", e mudanca em `properties.updated_at` > ultima revisao marca "precisa de revisao".

## 4. Riscos de permissao e vazamento
1. Nao publicado ao corretor: hoje protegido por filtro `status=published` na query (service L86-87) e de novo no core (L112, L115). Bloco vivo e livros novos devem passar pelo MESMO funil `buildVisible*`; nunca uma rota nova com `select("*")` [C do padrao, H do risco].
2. `internal_notes`, `pdf_data`, `regras` (descontos, limites, engenharia) e `whatsapp` do cadastro: ficha viva deve usar lista branca; nunca serializar `rowToProperty` inteiro. Hoje a tela de consulta ja mostra `internalNotes` a todo perfil (L26) [C]: decidir se e intencional (fora do escopo, apenas informado).
3. Valores: `price`/`terms`/`discounts` sao atuais e mudam; copiados para texto editorial ficam desatualizados e viram promessa comercial indevida. Preferir bloco vivo.
4. Guarda: precisa cobrir campos novos (fonte, obs. interna) na escrita, e a leitura so devolve campos publicos; obs. interna fica fora do guard de leitura porque nao sai.
5. Busca global: indexar so conteudo ja filtrado por perfil/estado; snippet de livro nao publicado e vazamento.
6. Associado ve como corretor (core L22): sem visao financeira projetada; valores de comissao nao entram no Guia [H].
7. Fonte "codigo/documento interno" nunca exibida ao corretor: campos de rastreabilidade so no admin.

## 5. Impacto tecnico estimado
- Migrations aditivas (14 digitos, `if not exists`): `manual_books`; colunas `book_id`, `source`, `source_category`, `last_reviewed_at`, `owner_id`, `internal_note`, `needs_review`, `development_id` em topics/sections; `manual_user_marks`. [H]
- Arquivos: `manual-core.mjs` (arvore 3 niveis, busca, whitelist), `manual-service.mjs` (CRUD livro, revisao, marks), `manual.js` (export), 4-6 rotas em `app/api/admin/manual/**`, `ManualBrowser.jsx`/`ManualAdmin.jsx`, `lib/properties.js` (leitor de ficha com whitelist), seed, testes `tests/manual-*.test.mjs`, rule `manual.md`, docs.
- Esforco [H]: livros/capitulos + campos de fonte/revisao = M; favoritos/recentes = P; busca ampliada com deep link = P/M; ficha viva de empreendimento = M; total G se feito de uma vez, recomendavel em 3 fases.

## DECISAO NECESSARIA
- Pergunta: a ficha viva de empreendimento no Guia pode mostrar valores/condicoes (preco, descontos) ao corretor, ou so dados descritivos (regiao, entrega, diferenciais, fotos)?
- Opcao A: so descritivos; valores continuam na tela de consulta/simulador. Opcao B: inclui preco e condicoes com data de atualizacao visivel.
- Recomendacao: A na primeira fase (menor risco de promessa desatualizada); B depois, com aprovacao.
- Pergunta 2: `internal_notes` do empreendimento (hoje visivel a todos na consulta) entra no Guia? Recomendacao: nao.

# A4 — Guia de Atendimento e Manual do CRM: o que está publicado no banco

Consulta somente leitura em 2026-10-03, projeto Supabase `tshhasbbchjcvhoyizoo`. Sem dado pessoal de cliente. Fonte: `attendance_guides`, `attendance_guide_progress`, `manual_*`.

Aviso de método: `list_tables` mostrou `attendance_guides = 0 linhas`. Está desatualizado (estatística do Postgres). A contagem real (`count(*)`) é 4. Para o inventário, use sempre `count(*)`.

## 1. Guia de Atendimento (`attendance_guides`)

As tabelas existem e o acesso funcionou. São 4 guias, todos `enabled = true` e todos publicados (`published_graph` preenchido, `published_version = 1`, `published_at` = 25/09/2026 15:40 UTC).

| Guia (slug) | Tipo | Nós publicados | Ligações | Cards (decisão) | Versão rascunho | Última edição |
|---|---|---|---|---|---|---|
| prospeccao | prospecting | 24 | 41 | não medido | 1 | 25/09 (nunca editado) |
| lead | lead | 30 | 62 | 15 | 4 | 28/09 06:37 UTC |
| organico | organic | 32 | 61 | não medido | 1 | 25/09 (nunca editado) |
| banco-de-objecoes | library | 48 | 146 | não medido | 1 | 25/09 (nunca editado) |

Uso: `attendance_guide_progress` tem 9 registros, de 25/09 a 02/10/2026 (último em 02/10 12:06 UTC). É uso real pequeno, em 8 dias.

## 2. Seed × publicado

- **Cadastro igual ao seed.** Os 4 guias têm os IDs `5b7f1d2e-...-7b01` a `7b04`, os slugs, os nomes, os tipos e a ordem (10/20/30/90) de `lib/attendance-guide-seed.mjs`. `published_at` é igual nos 4 e coincide com o momento da semeadura automática (`ensureSeedGuides`, que só roda com a tabela vazia). Ou seja, o que está no ar nasceu do seed.
- **Guia "lead" tem rascunho diferente do publicado.** A versão do rascunho é 4 e a publicada é 1. Comparei nó a nó rascunho × publicado. Os mesmos 30 nós, as mesmas 62 ligações e os mesmos 15 cards. Os campos de conteúdo (`data`: título, orientação, mensagem) são idênticos em todos os nós. A diferença está fora do conteúdo, provavelmente posição no mapa (layout). É uma hipótese: não abri os campos x/y.
- **O que o corretor vê é o publicado.** A tela do corretor lê `published_graph` (`getGuideSession`). Por isso a edição de 28/09 do "lead" não muda nada para quem atende.
- **Não confirmado.** Não comparei o texto do banco com o texto atual dos arquivos `attendance-guide-seed-*.mjs`. Isso exigiria rodar `buildSeedGuides` e comparar os dois lados, e isso foge do somente leitura via SQL. Se o seed foi editado depois de 25/09, o banco não acompanha (o seed não regrava). Nenhuma edição de conteúdo publicado foi detectada, pois `updated_at = created_at` em 3 dos 4 guias e o "lead" só mudou fora do conteúdo.

## 3. Manual do CRM (`manual_*`, migration 20261003230000)

As tabelas existem em produção e não estão vazias.

| Tabela | Registros | Status | Datas |
|---|---|---|---|
| manual_topics | 8 | 8 publicados | último ajuste 02/10 23:41 UTC |
| manual_sections | 40 | 40 publicadas | versões criadas 02/10 23:39–23:42 UTC |
| manual_section_versions | 40 | todas versão 1 | nenhuma seção editada depois da carga |
| manual_news | 4 | 4 rascunhos, 0 publicadas | nenhuma `published_at` |
| manual_news_reads | 0 | nenhuma leitura | — |

Tópicos e número de seções: Clientes 10, Prospecção e Meta Diária 9, Chat e WhatsApp 5, Agenda 1, Simulação e Jornada 4, Documentação 4, Ranking e Desempenho 3, Outros 4 (soma = 40, confere).

Novidades em rascunho: botão WhatsApp do card; Meta Diária com carteira de até 50 clientes; não contactar automático mais preciso; WhatsApp restrição informada e validada.

O Manual foi carregado inteiro em 02/10, cerca de 1 dia antes desta consulta, e está intacto na versão 1. Ninguém leu as novidades (0 leituras, e nenhuma está publicada).

## 4. O que muda no inventário do Guia do Corretor

1. A fonte do Guia de Atendimento é o banco (4 guias, 134 nós publicados no total = 24+30+32+48), não só o seed. Hoje coincidem no cadastro. Registrar o `published_at` e a versão no inventário, para detectar edição futura.
2. O guia "lead" é o único com rascunho à frente (v4 × v1). Se o dono publicar, o texto pode mudar. Tratar o inventário como fotografia de 03/10/2026.
3. O Manual é conteúdo vivo: 8 tópicos e 40 seções publicados. O Guia do Corretor deve apontar para o Manual em vez de duplicar texto. As 4 novidades em rascunho não entram, pois ainda não são oficiais.
4. Lacuna: o texto exato dos 134 nós não foi comparado com o seed. Se o inventário precisar citar texto, ler `published_graph` por guia, em lote pequeno.

## Limitações

Medi só contagens e estrutura, não li o conteúdo dos nós. Fiz uma única fotografia do banco (03/10/2026). Os 9 registros de progresso são amostra pequena (n < 10), então não indicam adoção.

# Metodologia comum — Marketing / Posicionamento Digital

Adaptada (não copiada) de quatro referências:
- `garrettjsmith/localseoskills` — brief persistente por local, tarefas recorrentes, uma camada única de dados;
- `mshahiddigital/agentic-local-seo-audit` — auditoria em fases, índice de saúde ponderado, concorrentes por dimensões;
- `AgriciDaniel/claude-seo` — falsificabilidade ("como saberemos que falhou?"), GEO sem mitos, SEO técnico;
- `local-falcon/local-visibility-skill` — SoLV (% de pontos do mapa em top 3) e SAIV (% de respostas de IA que citam a marca).

Não adotado: APIs pagas (Local Falcon, Ahrefs, Semrush, BrightLocal), multi-localização, GBP API, agendamentos que publicam sozinhos.

## Etiquetas de fato
[VERIFICADO] visto agora (URL/arquivo/consulta + data) · [INFORMADO] dono disse/enviou · [A CONFIRMAR] não acessível. Sem etiqueta, não vale.

## Índice de Presença (0–100) — 7 áreas, nota 0–10 cada, por evidência

| Área | Peso | O que pontua |
|---|---|---|
| Google Meu Negócio / Maps | 20 | perfil reivindicado, categorias, serviços, descrição, fotos, posts, perguntas, posição nas consultas-alvo |
| Reputação (avaliações) | 15 | nota, volume, recência (90 dias), % respondidas, texto específico (primeiro imóvel, MCMV) |
| Site + SEO local | 20 | indexação, títulos/descrições, schema, sitemap/robots, páginas por intenção (MCMV, primeiro imóvel, Caixa), velocidade, mobile |
| NAP e marca | 10 | nome/telefone/endereço/CRECI idênticos em site, GMN, Instagram, Facebook, portais |
| Social orgânico | 15 | bio com posicionamento, destaques, pilares de conteúdo, prova social, CTA/link |
| Autoridade e citações | 10 | diretórios locais, menções, backlinks de Marília (imprensa, parceiros, construtoras) |
| Visibilidade em IA (GEO/AEO) | 10 | SAIV amostral: % das consultas-alvo em que ChatGPT/Gemini/Google IA citam Matheus |

Área sem acesso = **"não medido"** (não é zero). O índice total só é divulgado quando as áreas medidas somam **≥ 50 pontos de peso**; abaixo disso, mostre só o placar por área e escreva "índice total indisponível (cobertura X%)". Sempre exiba a cobertura. Compare com o snapshot anterior **na mesma base de áreas**.

### Rubrica da nota (0–10) — seja objetivo
Cada área tem uma checklist de ~10 itens binários verificáveis; nota = itens cumpridos (arredonde). Site + SEO local: robots.txt · sitemap.xml · canonical · title com intenção · description com intenção · H1 único · JSON-LD correto · Open Graph · página por intenção (MCMV / primeiro imóvel / Caixa) · mobile/velocidade ok. GMN: reivindicado · nome sem keyword · categoria principal certa · descrição · serviços · horário/telefone · link com UTM · ≥10 fotos recentes · post nos últimos 30 dias · perguntas e respostas. Reputação: nota ≥ 4,5 · ≥ 20 avaliações · ≥ 3 nos últimos 90 dias · ≥ 90% respondidas · temas de "primeiro imóvel/financiamento" citados · nenhuma negativa sem resposta · pedido de avaliação rotineiro · (demais itens a definir ao ver o perfil real e registrar aqui). **NAP e marca (gravada em 2026-10-01):** nome igual em site/GMN/Instagram · telefone GMN = site · telefone visível no Instagram · endereço GMN = site · CRECI no site · CRECI no GMN · CRECI na bio do Instagram · link do Instagram = domínio oficial · link do GMN = domínio oficial · posicionamento declarado igual nos 3 canais. **Social/Instagram (gravada em 2026-10-01):** bio com posicionamento · bio sem promessa de aprovação · CRECI visível · link para domínio oficial com UTM · ≥3 posts/semana · pilares de conteúdo definidos · mediana de alcance ≥10% dos seguidores · toques no link ≥ 0,5% dos seguidores/30 dias · prova social regular · ≥85% da audiência no Brasil. Autoridade e IA: monte a checklist na 1ª medição e **grave-a aqui** para as próximas notas serem comparáveis.

## Consultas-alvo
Lista fixa em `PERFIL.md` (para comparar no tempo). Para cada consulta registre: quem aparece no pacote de 3 do Maps, orgânico 1–5, se há resposta de IA e quem ela cita — com data e método.

## Prioridade
Impacto (alto/médio/baixo, ligado a lead de primeiro imóvel) × Esforço (horas) → P1 (alto impacto, baixo esforço), P2, P3. **Máximo 7 itens ativos por semana**: foco bate lista.

## Falsificabilidade (obrigatória)
"Funcionou se **[indicador antecedente]** passar de X para Y até **[data]**; se não, revemos **[hipótese]**." Indicadores aceitáveis: impressões/cliques no Search Console, ações no GMN, nº/nota/% respondidas de avaliações, posição amostral, leads do CRM por origem orgânica, citações em IA.

## Atribuição ao CRM (opcional, só leitura)
`SELECT` em `client_origins` (origem/UTM/`source_metadata`) para contar leads vindos de site, Instagram, Google. Funil em `lib/client-status.js`. Sem dado pessoal no relatório. Origem orgânica pode vir subnotificada: diga o limite.

## GEO/AEO sem mito
Não prometa que `llms.txt` ranqueia (sem evidência). O que ajuda: páginas que respondem a pergunta direta no 1º parágrafo; dados verificáveis (faixas MCMV vigentes **com fonte e data**); entidade consistente (mesmo nome/CRECI/endereço em todo lugar); schema `RealEstateAgent`/`LocalBusiness`/`FAQPage`; presença em fontes que as IAs citam (Maps, Instagram, portais, imprensa local); avaliações com texto específico.

## Formato do snapshot em HISTORICO.md
`## AAAA-MM-DD — título` · método e limites · tabela de áreas (nota, base, etiqueta) · amostra de consultas · números-chave · variação vs. anterior.

# MARKETING — POSICIONAMENTO DIGITAL (guia de uso)

Agente permanente para presença, reputação e autoridade **orgânica** do Matheus em Marília. Mídia paga continua com o `gestor-trafego`.

## Ciclo
AUDITAR → OPORTUNIDADES → RECOMENDAR → IMPLEMENTAR → MEDIR → ACOMPANHAR. Cada volta grava um snapshot em `docs/posicionamento/HISTORICO.md` e atualiza o `BACKLOG.md`, então a próxima análise compara com a anterior.

## Como chamar (basta falar)
| Diga | O que acontece |
|---|---|
| "Analise meu posicionamento digital" / "Como estou no Google?" | Auditoria geral, nota por área, snapshot salvo |
| "Como apareço quando pesquisam corretor em Marília?" | Amostra das consultas-alvo (Google/Maps) com quem aparece |
| "Veja minhas avaliações" | Nota, volume, recência, temas, rascunhos de resposta |
| "Analise meus concorrentes" | Quem aparece antes de você e que lacuna dá para ocupar |
| "Como melhorar meu Instagram?" | Bio, destaques, calendário de 4 semanas, métricas |
| "Eu apareço no ChatGPT/Gemini?" | Teste das perguntas-alvo e plano para ser citado |
| "O que devemos melhorar esta semana?" | Até 7 itens priorizados, com tempo seu estimado |
| "Implemente as melhorias que você encontrou" | Faz o que é código/texto; o que é publicação externa vem pronto para você aprovar |

No Claude Code, comece com o agente `marketing-posicionamento` (ou peça "use o agente de marketing").

## O que ele faz sozinho e o que depende de você
- **Faz sozinho:** ajustes no código do site (SEO, schema, sitemap, robots, páginas), textos, relatórios. Só publica no ar quando você disser "publique".
- **Prepara, você aprova:** respostas a avaliações, posts, bio, descrição do Google, pedidos de avaliação. Nada é publicado ou enviado sem o seu "sim" para aquela ação.
- **Nunca faz:** avaliação falsa/comprada, incentivo por avaliação, filtrar quem pode avaliar, comprar seguidores/links, prometer aprovação de crédito.

## O que ele precisa de você (uma vez, depois só atualizar)
1. Link do Google Meu Negócio, página do Facebook e telefone oficial (preencher em `PERFIL.md`).
2. Prints de: Desempenho do Google Meu Negócio e lista de avaliações; Insights do Instagram (90 dias); Search Console (Consultas e Páginas), se tiver. **Sem isso essas áreas ficam "não medido"** — o agente não inventa número.
3. Opcional: autorizar o Chrome para ele **ler** Maps/Instagram/ChatGPT na sua conta (a cada sessão).

## Dados reais via Windsor.ai (MCP)
- **O quê:** conector oficial `https://mcp.windsor.ai/` (OAuth) para Google Business Profile, Search Console, GA4, Instagram e Facebook orgânicos. Estado de cada fonte: `docs/posicionamento/FONTES.md`. Protocolo de leitura: `.claude/skills/auditar-posicionamento/references/windsor.md`.
- **Ordem de confiança:** Windsor `[VERIFICADO-WINDSOR]` > print seu `[INFORMADO]` > leitura pública (amostra) > `[A CONFIRMAR]`. Fonte sem dado = o agente diz e **não inventa**.
- **Somente leitura:** o conector do Windsor também sabe escrever (pausar campanhas etc.). O agente só usa `get_connectors`, `get_options`, `get_fields`, `get_accounts`, `get_data`, e nunca `list_actions`/`execute_action`. Publicar ou alterar redes, Google ou site continua exigindo seu "sim".
- **Quem conecta as contas:** só você, no navegador (Windsor → Google/Meta). O agente não vê suas senhas.
- **Cobertura:** Windsor traz dados **próprios**, nunca de concorrentes; não mede ChatGPT/Gemini (só o tráfego que chega deles, via GA4).

## Limites honestos
Google Maps, Instagram e IAs bloqueiam leitura automática e variam por pessoa/local: resultados de busca são **amostra**, e o agente diz quando algo é "A CONFIRMAR". Mudanças em SEO/IA levam semanas: toda melhoria tem data para ser reavaliada.

## Estrutura
- Agente: `.claude/agents/marketing-posicionamento.md`
- Skills: `/auditar-posicionamento` (+ `references/metodologia.md`), `/google-perfil-avaliacoes`, `/concorrentes-marilia`, `/seo-site`, `/visibilidade-ia`, `/conteudo-social`, `/plano-semanal`
- Memória: `docs/posicionamento/{PERFIL,HISTORICO,BACKLOG}.md`
- Referências estudadas e o que foi (ou não) adotado: `metodologia.md`

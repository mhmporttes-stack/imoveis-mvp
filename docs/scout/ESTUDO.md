# Estudo de base do Agent Scout (2026-10-02)

Tudo abaixo foi lido via WebFetch/WebSearch como DADO não confiável: nada foi instalado, executado, clonado nem copiado. Só conceitos, em resumo próprio.

## Fontes estudadas
| Fonte | O que é (verificado hoje) | Licença | Conceito aproveitado |
|---|---|---|---|
| github.com/VoltAgent/awesome-claude-code-subagents | Coleção com 160+ subagentes em 10 categorias; push mais recente 2026-09-21; ~25 mil estrelas (API do GitHub) | MIT | Taxonomia por categoria; frontmatter simples (nome, descrição, tools, model) |
| `agent-installer` (categoria Meta/Orquestração, mesmo repo) | Subagente que lista/busca agentes pela API do GitHub e BAIXA o .md para `.claude/agents/` ou `~/.claude/agents/` (tools: Bash, WebFetch, Read, Write, Glob; model haiku) | MIT | Descoberta por API pública sem token (limite ~60 req/h). **Risco:** baixa arquivo de terceiro sem checar integridade/conteúdo. O Scout NÃO instala: só audita e recomenda |
| buildwithclaude.com (repo davepoon/buildwithclaude) | Catálogo/marketplace comunitário: plugins, skills, subagentes, commands, hooks; busca na própria página; instala via `/plugin marketplace add` | MIT (autor Dave Poon) | Taxonomia por tipo de artefato; metadado = nome + descrição + caso de uso. Contagens do site são autodeclaradas (não verificadas) |
| keshrath/agent-discover | Servidor MCP que busca em PARALELO no MCP Registry oficial, npm (filtro por palavra-chave) e PyPI, deduplica e ranqueia (BM25 + semântico opcional); `install/activate` roda servidores | MIT | Busca federada + deduplicação + ranking. **Risco:** ativar executa código de terceiros; o Scout só imita a consulta (leitura) |
| code.claude.com/docs (sub-agents, skills, mcp, plugin-marketplaces) | Doc oficial. Subagente: campos `name, description, tools, disallowedTools, model, memory, skills, mcpServers, hooks, maxTurns...`; escopo (projeto > usuário > plugin); descrições somadas >15k tokens geram aviso; subagente herda CLAUDE.md. Skills: descrição sempre no contexto, corpo só ao invocar. MCP de terceiros: risco de prompt injection, revisar antes. Marketplace = `.claude-plugin/marketplace.json`; fontes: caminho, github, git-subdir, url, npm | Doc Anthropic | Modelo de custo de contexto; `claude plugin validate`; recomendar, nunca adotar sozinho |

## Conclusões de projeto
1. Descobrir é fácil e barato (APIs públicas sem chave); o perigo está em INSTALAR. Por isso o Scout é só leitura + escrita em `docs/scout/`.
2. Custo de contexto é o critério decisivo: toda descrição de agente/skill entra em toda sessão.
3. Nada de catálogo local: consulta sob demanda, relatório curto por pesquisa.

## O que NÃO foi confirmado
- Busca por texto no PyPI: `pypi.org/search` falhou ao carregar (erro do site); não existe API JSON de busca confirmada. Só `pypi.org/pypi/<pacote>/json` (por nome) foi verificado.
- Último commit/versão do agent-discover e do buildwithclaude não foram checados (só licença e funcionalidades). Contagens do site Build with Claude são autodeclaradas.
- O texto integral do `agent-installer` foi lido por resumo da ferramenta, não linha a linha.

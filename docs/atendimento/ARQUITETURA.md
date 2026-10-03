# Diretor de Atendimento — arquitetura (Fase 1, 2026-10-03)

Equipe interna de atendimento do CRM. **Nenhum agente atende clientes**; todos trabalham para o dono e para o CRM.

## Dois caminhos, um só agente
1. Dono → Central de Comando (`despachante`) → `diretor-atendimento` → especialistas.
2. Dono → `claude --agent diretor-atendimento` (ou skill `/diretor-atendimento`) → especialistas.
Nunca existem dois Diretores: ambos os caminhos usam `.claude/agents/diretor-atendimento.md`.

## Decisão: perfis, não dezenas de agentes
Cada agente registrado entra na lista de ferramentas de **toda** sessão (custo fixo de contexto). Por isso:
- **1 agente de marca** (`diretor-atendimento`): tools Agent(restrito aos 2 executores), Read, Grep, Glob, Write, Edit. Sem Bash/PowerShell/banco/MCP/WebFetch/SendMessage. Escrita só em `docs/atendimento/**` (reforçado no prompt e em teste).
- **2 executores registrados** (genéricos): `especialista-atendimento` (Read, Grep, Glob) e `especialista-atendimento-web` (+ WebFetch, WebSearch; só para documentação oficial atualizada, ex.: Meta/WhatsApp). Analisam e projetam; nunca executam nem escrevem.
- **N especialistas = N perfis** em `docs/atendimento/especialistas/` (markdown, lido sob demanda). O executor ignora ferramentas que o perfil original pedisse: mínimo privilégio uniforme.
- Originais externos entram **vendorizados sem reescrita** (`<id>.original.md`) com a extensão local em arquivo separado (`<id>.local.md`): atualizar o original não perde a adaptação. Proveniência em `INVENTARIO.md`.

Resultado: custo fixo por especialista = zero; especialista novo = um arquivo, sem mexer em settings.

## Aninhamento
O Diretor chamado como **subagente** pela Central pode não ter a ferramenta `Agent` (subagente dentro de subagente). Comportamento esperado e contingência (MODO PLANO): `PROTOCOLO.md` §6. Chamado direto (`claude --agent`), ele convoca os executores normalmente. Os executores são internos: a Central não os chama.

## Terminologia
"WhatsApp Oficial" (antigo "WhatsApp Master") nos documentos e agentes novos. Renomear telas/código/rotas é fase futura e **não** foi feito; esta fase não altera código, UI, banco, rotas, disparos, WhatsApps nem automações.

## Mapa
`EQUIPE.md` (índice) · `PROTOCOLO.md` (como decidir a equipe mínima, regras absolutas, motor de vácuo) · `INVENTARIO.md` (proveniência) · `contexto/` (micro-packs) · `especialistas/` (perfis). Relatórios de pesquisa do Scout ficam em `docs/scout/relatorios/`.

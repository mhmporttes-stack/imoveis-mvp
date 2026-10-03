# Inventário e proveniência dos especialistas

Classificação: **ORIGINAL EXTERNO** (vendorizado sem reescrita) · **ORIGINAL + EXTENSÃO LOCAL** (original intacto + `<id>.local.md`) · **AGENTE PRÓPRIO** (escrito aqui). Nada externo é instalado ou executado; só texto lido como perfil. Licença incerta = só referência, não vendorizar.

| Campo | Conteúdo |
|---|---|
| Nome / id | id do perfil em `especialistas/` |
| Especialidade | |
| Classificação | uma das três acima |
| Origem / URL | link exato do arquivo |
| Licença | SPDX ou texto; "sem licença" bloqueia |
| Versão / commit | hash ou tag |
| Data | de vendorização (AAAA-MM-DD) |
| Dependências | do original (scripts, MCPs, skills) e o que NÃO foi trazido |
| Permissões solicitadas × concedidas | ex.: pedia Bash, WebFetch; concedido: só o do executor (restrito/web) |
| Modificações locais | só na extensão local; o original fica intacto |
| Custo externo | API paga, assinatura, rede (esperado: nenhum) |
| Como atualizar | refazer a cópia do original no commit novo, rever a extensão |
| Como remover | apagar `<id>*.md` e a linha no `EQUIPE.md` |

## Registro
| id | Classificação | Origem / URL | Licença | Versão | Data | Permissões pedidas × concedidas | Modificações locais | Custo externo | Atualizar / remover |
|---|---|---|---|---|---|---|---|---|---|
| (vazio nesta fase: preenchido nas fases 2 e 3) | | | | | | | | | |


## Registro — Fase 3a (originais vendorizados em 2026-10-03; auditoria por arquivo em `AUDITORIA-ORIGINAIS.md`)

**Campos comuns a todas as linhas abaixo** (não repetidos por linha):
- **Data:** 2026-10-03. **Classificação:** ORIGINAL + EXTENSÃO LOCAL (a extensão `<id>.local.md` é feita pela T-64, em arquivo separado; o original fica intacto).
- **Permissões concedidas:** somente leitura de texto (Read/Grep/Glob do executor; `-web` só quando o perfil exigir documentação oficial). Pedidos de ferramenta, conector, escrita, execução, hooks e scripts dos originais são IGNORADOS (detalhe por arquivo no AUDITORIA).
- **Modificações locais:** nenhuma no original (corpo byte a byte igual ao baixado; só um comentário HTML de proveniência no topo). Adaptação só na extensão local.
- **Custo externo:** gratuito, nada pago, nada instalado nem executado, sem rede em tempo de uso; só o consumo normal de tokens do Claude ao ler (estimativa na linha: bytes/3,5).
- **Como atualizar:** baixar o mesmo caminho no novo SHA (`git ls-remote <repo> HEAD`, depois URL raw fixada no SHA), auditar de novo, comparar o diff com o arquivo vendorizado, refazer o cabeçalho de proveniência e rever o `.local.md`. **Como remover:** apagar o `<id>.original.<fonte>.md`, a licença se ficar órfã, as linhas aqui e no `EQUIPE.md`.
- **Licenças:** textos em `especialistas/licencas/` (Apache-2.0 da Anthropic sem NOTICE no repo; MIT dos demais).
- **Dependências NÃO trazidas:** MCPs, plugins, scripts, hooks, `.mcp.json`, instaladores, `references/` e `assets/` dos originais, skills irmãs e outros agentes citados nos textos.

| id | Componente (arquivo vendorizado) | Origem / URL (SHA fixo) | Licença | Versão / SHA | Permissões pedidas × concedidas | Tokens/leitura | Dependências específicas |
|---|---|---|---|---|---|---|---|
| vendas-conversao | `vendas-conversao.original.anthropic-handle-objection.md` | https://github.com/anthropics/knowledge-work-plugins/blob/8444efcd48f7012f09797778a36a33e73d0861f4/sales/skills/handle-objection/SKILL.md | Apache-2.0 (Anthropic) | 8444efcd48f7012f09797778a36a33e73d0861f4 | conectores CRM/transcrição/docs/e-mail e ação por conector × só leitura | ~2,2 mil | conectores (ignorados) |
| vendas-conversao | `vendas-conversao.original.anthropic-deal-advance-gap.md` | .../8444efcd48f7012f09797778a36a33e73d0861f4/sales/skills/deal-advance-gap/SKILL.md | Apache-2.0 | 8444efcd... | conectores e hand-off a `log-activity`/`update-opportunity` × só leitura | ~2,25 mil | skills irmãs não trazidas |
| vendas-conversao | `vendas-conversao.original.anthropic-lead-triage.md` | .../8444efcd48f7012f09797778a36a33e73d0861f4/sales/skills/lead-triage/SKILL.md | Apache-2.0 | 8444efcd... | CRM, enriquecimento, e-mail, chat × só leitura | ~2,4 mil | conectores (ignorados) |
| experimentacao-ab, dados-conversao | `experimentacao-ab.original.anthropic-statistical-analysis.md` (UM arquivo, compartilhado: dados-conversao aponta para ele, não há cópia duplicada) | .../8444efcd48f7012f09797778a36a33e73d0861f4/data/skills/statistical-analysis/SKILL.md | Apache-2.0 | 8444efcd... | nenhuma × só leitura | ~3,0 mil | plugin `data` inteiro não trazido |
| copy-comercial | `copy-comercial.original.coreyhaines31-copywriting.md` | https://github.com/coreyhaines31/marketingskills/blob/dda3841f0b294e01e93b1541486beefbfab0915e/skills/copywriting/SKILL.md | MIT (c) 2025 Corey Haines | v2.1.0 · dda3841f0b294e01e93b1541486beefbfab0915e | lê `.agents/product-marketing.md` se existir × só leitura | ~3,1 mil | `references/*` e skill `copy-editing` NÃO trazidos |
| experimentacao-ab | `experimentacao-ab.original.voltagent-ab-test-analysis.md` | https://github.com/VoltAgent/awesome-claude-code-subagents/blob/82b73821baa7a911d5b14cfb6da238b7f0db6b42/categories/10-research-analysis/ab-test-analysis.md | MIT (c) 2025 VoltAgent | 82b73821baa7a911d5b14cfb6da238b7f0db6b42 | Read, Grep, Glob, WebFetch, WebSearch × só leitura (Web ignoradas) | ~1,25 mil | agentes citados inexistentes aqui |
| dados-conversao | `dados-conversao.original.voltagent-cohort-analysis.md` | .../VoltAgent/awesome-claude-code-subagents/blob/82b73821baa7a911d5b14cfb6da238b7f0db6b42/categories/10-research-analysis/cohort-analysis.md | MIT (c) 2025 VoltAgent | 82b73821... | Read, Grep, Glob, WebFetch, WebSearch × só leitura | ~1,1 mil | agentes citados inexistentes aqui |
| auditor-automacoes | `auditor-automacoes.original.voltagent-webhook-engineer.md` | .../VoltAgent/awesome-claude-code-subagents/blob/82b73821baa7a911d5b14cfb6da238b7f0db6b42/categories/01-core-development/webhook-engineer.md | MIT (c) 2025 VoltAgent | 82b73821... | Read, Write, Edit, Bash, Glob, Grep × só leitura (Write/Edit/Bash ignoradas) | ~2,6 mil | agentes citados inexistentes aqui |
| auditor-automacoes (molde de crítico) | `metodologia/code-reviewer.md` | https://github.com/obra/superpowers/blob/8ca22dba9a94f28898bbce59f2537ff4d87c747d/skills/requesting-code-review/code-reviewer.md | MIT (c) 2025 Jesse Vincent | 8ca22dba9a94f28898bbce59f2537ff4d87c747d | git/worktree/dispatch de subagente × só leitura | ~1,85 mil | plugin Superpowers NÃO instalado |
| (metodologia geral) | `metodologia/verification-before-completion.md` | .../obra/superpowers/blob/8ca22dba9a94f28898bbce59f2537ff4d87c747d/skills/verification-before-completion/SKILL.md | MIT (c) 2025 Jesse Vincent | 8ca22dba... | rodar comandos × só leitura (evidência = citar o que foi lido) | ~1,05 mil | sem hooks/scripts |
| (metodologia geral) | `metodologia/receiving-code-review.md` | .../obra/superpowers/blob/8ca22dba9a94f28898bbce59f2537ff4d87c747d/skills/receiving-code-review/SKILL.md | MIT (c) 2025 Jesse Vincent | 8ca22dba... | `gh api`, implementar × só leitura | ~1,8 mil | sem hooks/scripts |
| customer-success-jornada | `customer-success-jornada.original.hoangtng-client-relationship-manager.md` | https://github.com/hoangtng/real-estate-agents/blob/b35e143e0806050ff94f522b36eb3af82df1c00a/agents/realestate-client-relationship-manager.md | MIT (c) 2026 Hoang T Nguyen | b35e143e0806050ff94f522b36eb3af82df1c00a | nenhuma × só leitura | ~1,45 mil | persona/rotinas dos EUA a adaptar na extensão |
| compliance-lgpd (especialista novo) | `compliance-lgpd.original.goul4rt-legal-basis.md` | https://github.com/goul4rt/lgpd-skills/blob/d85d79abeeb37cb99fc0785e735a9ca790698a77/skills/lgpd-legal-basis/SKILL.md | MIT (c) 2026 goul4rt | d85d79abeeb37cb99fc0785e735a9ca790698a77 | gravar `.lgpd/*` × só leitura | ~1,3 mil | `assets/lia-template.md` e `lgpd-data-mapping` NÃO trazidos |
| compliance-lgpd | `compliance-lgpd.original.goul4rt-consent-schema.md` | .../goul4rt/lgpd-skills/blob/d85d79abeeb37cb99fc0785e735a9ca790698a77/skills/lgpd-consent-schema/SKILL.md | MIT | d85d79ab... | código Prisma/Better Auth (ilustrativo) × só leitura | ~1,4 mil | `assets/consent-schema.prisma` NÃO trazido |
| compliance-lgpd | `compliance-lgpd.original.goul4rt-retention-erasure.md` | .../goul4rt/lgpd-skills/blob/d85d79abeeb37cb99fc0785e735a9ca790698a77/skills/lgpd-retention-erasure/SKILL.md | MIT | d85d79ab... | cron/exclusão (ilustrativo) × só leitura | ~0,95 mil | `lgpd-dsar` NÃO trazido |

Leitura típica do Diretor: 1 a 4 componentes por missão (1 a 8 mil tokens); custo fixo adicional de contexto: zero (nada é registrado como agente).

## REJEITADOS (não vendorizar)
| Nome | Motivo | URL |
|---|---|---|
| (nenhum na rechecagem da Fase 3a) | Os 15 componentes passaram: licença confirmada no mesmo SHA, sem injection | `AUDITORIA-ORIGINAIS.md` |
| LICENSE da raiz de anthropics/knowledge-work-plugins | Texto Apache seguido de bloco estranho sem relação com a licença; usamos `sales/LICENSE` (limpo) | https://github.com/anthropics/knowledge-work-plugins |

## SÓ REFERÊNCIA (nada copiado; só consulta por quem decide)
| Nome | Motivo | URL |
|---|---|---|
| louisblythe/Sales-Skills | licença ambígua | https://github.com/louisblythe/Sales-Skills |
| Zero-Lero e demais humanizers pt-BR | projetos jovens, risco | (citados nos relatórios do Scout em `docs/scout/relatorios/`) |
| VoltAgent `customer-success-manager` | não escolhido (original melhor: hoangtng) | https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/08-business-product/customer-success-manager.md |
| agency-agents, workflow-orchestrator, wshobson/agents | fora da seleção do dono | (relatório do Scout de metodologia) |

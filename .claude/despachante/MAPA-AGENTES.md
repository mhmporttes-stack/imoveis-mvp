# Mapa de agentes — usado pelo Despachante

> Auditado em 2026-10-02 contra `.claude/agents/`, `.claude/skills/`, `.claude/rules/`, `CLAUDE.md`, `AGENTS.md`. Um teste (`tests/despachante.test.mjs`) falha se algum agente de `.claude/agents/` não estiver aqui. Modo: **L** = só leitura · **E** = pode editar/publicar.

| Agente | Responsabilidade | Quando usar | Quando NÃO usar | Modo | Skills que o acompanham |
|---|---|---|---|---|---|
| `crm-editor` (CRM Architect) | Bug, funcionalidade, regra de negócio, banco, permissões, integrações (inclui **WhatsApp** e **Alexa**) — qualquer código do CRM | Corrigir/criar/alterar algo no sistema; investigar causa raiz; deploy pedido | Só visual (→ designer); só análise de dados; só auditoria sem corrigir | E | `/diagnosticar-bug`, `/diagnosticar-producao`, `/verificar-correcao`, `/consultar-incidentes`, `/nova-funcionalidade`, `/registrar-regra`, `/revisar-permissoes`, `/auditar-banco` |
| `designer-crm` | UI/UX: crítica, redesenho, mobile/PWA, sistema visual — **só interface** | “Melhore visualmente X”, tela poluída, padronizar, revisão visual | Mudar `lib/`, API, banco ou regra (→ crm-editor) | E (só UI) | `/design-crm` |
| `auditor-crm` | Auditoria preventiva e pre-mortem: risco, código morto, regra violada | “Audite X”, antes de publicar algo grande | Corrigir (→ crm-editor); tráfego pago | L | `/auditar-crm`, `/pre-mortem` |
| `analista-dados` | Funil, conversão, tempo entre etapas, padrões, comparar períodos (dados reais) | “Analise meu funil”, “por que o corretor X converte menos” | Anúncio/CPL (→ gestor-trafego); corrigir dado; finanças | L (banco read-only) | `/analisar-funil`, `/descobrir-padroes`, `/comparar-periodos` |
| `analista-documental` | Análise documental Caixa/MCMV: IA, Base Mestra, pendências, devolutiva, PDF | “A IA errou no cliente X?”, testar regra documental | Criar regra documental nova sem o dono; bug fora de documentação | L por padrão (E só se o pedido disser) | `/analisar-documentacao`, `/auditar-analise-documental`, `/testar-regra-documental` |
| `gestor-financeiro` | Saúde financeira da empresa: receita, despesas, caixa, reserva, projeção | “Como está meu financeiro”, “consigo pagar os próximos meses” | Investimentos/cripto; tráfego; alterar dado/código | L (banco read-only) | `/analisar-saude-financeira`, `/analisar-despesas`, `/projetar-fluxo-caixa`, `/comparar-periodos-financeiros` |
| `gestor-trafego` | Tráfego pago Meta: CPL, CTR, criativos, planejar campanha, cruzar com funil | “Como estão minhas campanhas”, copy de anúncio | Alterar campanha/orçamento (só recomenda); orgânico | L (banco read-only) | `/auditar-trafego`, `/criar-anuncio`, `/planejar-campanha` |
| `marketing-posicionamento` | Presença orgânica: Google Meu Negócio, avaliações, SEO do site, Instagram, concorrentes, IA | “Como apareço no Google”, responder avaliação, SEO | Mídia paga (→ gestor-trafego); publicar sem “sim” do dono por ação | E (rascunhos/código do site público) | `/auditar-posicionamento`, `/google-perfil-avaliacoes`, `/concorrentes-marilia`, `/seo-site`, `/visibilidade-ia`, `/conteudo-social`, `/plano-semanal` |
| `performance-pc` | Desempenho do PC Windows do dono (Windows/Chrome/Claude) — fora do CRM | “Meu computador/Claude está lento” | Qualquer coisa do CRM | E (otimizações seguras/reversíveis) | `/diagnosticar-pc`, `/otimizar-pc`, `/comparar-performance`, `/diagnosticar-*`, `/verificar-inicializacao` |
| `claude` (generalista / “laboratório”) | Tarefa que nenhum agente acima cobre; experimento; pesquisa | Fallback | Qualquer coisa que um especialista cobre | E | — |

Outros tipos nativos (não são do CRM, use só quando couber): `Explore` (busca ampla somente leitura), `Plan` (planejamento), `claude-code-guide` (dúvida sobre o próprio Claude Code).

## Especialidades pedidas que **não existem** como agente (decisão pendente do dono)
| Nome citado | Hoje é coberto por | Observação |
|---|---|---|
| **Diretor** (produto/decisão de funcionalidade grande) | `crm-editor` conduzindo `/nova-funcionalidade` como líder; o **Despachante** faz a pergunta de decisão ao dono | Criar um agente “Diretor” só se o dono quiser alguém que escreva especificação de produto antes do código |
| **WhatsApp** | `crm-editor` + `docs/WHATSAPP.md` + `.claude/rules/integracoes-externas.md` (o prompt de delegação deve citá-los) | Agente dedicado só se o volume de tarefas de WhatsApp justificar |
| **Alexa** | `crm-editor` (há `docs/alexa-interaction-model.json` e regras em `integracoes-externas.md`) | Idem |
| **Laboratório** | `claude` (generalista) | Já existe |

## Equipes típicas (líder → auxiliares)
- **Funcionalidade grande com tela** (ex.: Central de Alertas): `crm-editor` (líder: dados/API/regra) → `designer-crm` (tela, depois que o contrato de dados existe) → `auditor-crm` (`/pre-mortem` antes de publicar). Integração com Alexa/WhatsApp: o mesmo `crm-editor` cobre; o prompt cita as docs.
- **Queda de conversão**: `analista-dados` (funil) ∥ `gestor-trafego` (origem do lead) — ambos L, rodam juntos.
- **Bug em produção**: `crm-editor` (`/diagnosticar-bug`) ; depois `/verificar-correcao`.

## Regra de escolha rápida (palavra-chave → agente)
visual/layout/tela/mobile → designer-crm · bug/erro/corrigir/criar/regra/permissão/WhatsApp/Alexa/banco → crm-editor · audite/risco/antes de publicar → auditor-crm · funil/conversão/padrão/período → analista-dados · documento/IA errou/Base Mestra/CCA → analista-documental · financeiro/caixa/despesa/comissão (análise) → gestor-financeiro · campanha/anúncio/CPL → gestor-trafego · Google/avaliação/SEO/Instagram/concorrente → marketing-posicionamento · PC/Chrome/Claude lento → performance-pc · resto → claude.
Comissão/despesa **como funcionalidade do sistema** (alterar tela/regra) = crm-editor; **análise** dos números = gestor-financeiro.

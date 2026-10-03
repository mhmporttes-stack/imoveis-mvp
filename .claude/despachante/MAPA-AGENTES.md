# Mapa de agentes — usado pelo Despachante

> Auditado em 2026-10-02 contra `.claude/agents/`, `.claude/skills/`, `.claude/rules/`, `CLAUDE.md`, `AGENTS.md`. Um teste (`tests/despachante.test.mjs`) falha se algum agente de `.claude/agents/` não estiver aqui. Modo: **L** = só leitura · **E** = pode editar/publicar.

| Agente | Responsabilidade | Quando usar | Quando NÃO usar | Modo | Skills que o acompanham |
|---|---|---|---|---|---|
| `crm-editor` (CRM Architect) | Bug, funcionalidade, regra de negócio, banco, permissões, integrações (inclui **WhatsApp** e **Alexa**) — qualquer código do CRM | Corrigir/criar/alterar algo no sistema; investigar causa raiz; deploy pedido | Só visual (→ designer); só análise de dados; só auditoria sem corrigir | E | `/diagnosticar-bug`, `/diagnosticar-producao`, `/verificar-correcao`, `/consultar-incidentes`, `/nova-funcionalidade`, `/registrar-regra`, `/revisar-permissoes`, `/auditar-banco` |
| `designer-crm` (**Diretor de Design**) | Toda **direção de design**: UI/UX do CRM e do site, fluxos, mobile/PWA, design system, motion, acessibilidade visual, **PDF/proposta/apresentação, material comercial**, direção de arte, **imagem e fotografia de imóveis**, crítica e revisão visual. Altera **só apresentação** | “Melhore/redesenhe X”, tela poluída, layout, UX, PDF, apresentação, material de venda, imagem/foto, design system, animação, responsividade, “revise visualmente” | Mudar `lib/`, API, banco ou regra (→ crm-editor); trabalho trivial **não** precisa do pipeline completo | E (só apresentação) | `/design-crm` (telas), `/direcao-criativa` (peças/imagem) |
| `design-critic` | **Crítica independente / Visual QA**: recebe objetivo, restrições e o resultado **renderizado** (telas, PDF por página, imagens) e procura problemas, sem defender o Designer | Depois de trabalho visual **relevante ou para cliente**; “revise com outro olhar”; antes de publicar redesenho | Mudança trivial; criar/corrigir (→ designer-crm / crm-editor); avaliar só lendo código | L | — (usa `.claude/design/REVIEW.md`) |
| `auditor-crm` | Auditoria preventiva e pre-mortem: risco, código morto, regra violada | “Audite X”, antes de publicar algo grande | Corrigir (→ crm-editor); tráfego pago | L | `/auditar-crm`, `/pre-mortem` |
| `analista-dados` | Funil, conversão, tempo entre etapas, padrões, comparar períodos (dados reais) | “Analise meu funil”, “por que o corretor X converte menos” | Anúncio/CPL (→ gestor-trafego); corrigir dado; finanças | L (banco read-only) | `/analisar-funil`, `/descobrir-padroes`, `/comparar-periodos` |
| `analista-documental` | Análise documental Caixa/MCMV: IA, Base Mestra, pendências, devolutiva, PDF | “A IA errou no cliente X?”, testar regra documental | Criar regra documental nova sem o dono; bug fora de documentação | L por padrão (E só se o pedido disser) | `/analisar-documentacao`, `/auditar-analise-documental`, `/testar-regra-documental` |
| `gestor-financeiro` | Saúde financeira da empresa: receita, despesas, caixa, reserva, projeção | “Como está meu financeiro”, “consigo pagar os próximos meses” | Investimentos/cripto; tráfego; alterar dado/código | L (banco read-only) | `/analisar-saude-financeira`, `/analisar-despesas`, `/projetar-fluxo-caixa`, `/comparar-periodos-financeiros` |
| `gestor-trafego` | Tráfego pago Meta: CPL, CTR, criativos, planejar campanha, cruzar com funil | “Como estão minhas campanhas”, copy de anúncio | Alterar campanha/orçamento (só recomenda); orgânico | L (banco read-only) | `/auditar-trafego`, `/criar-anuncio`, `/planejar-campanha` |
| `marketing-posicionamento` | Presença orgânica: Google Meu Negócio, avaliações, SEO do site, Instagram, concorrentes, IA | “Como apareço no Google”, responder avaliação, SEO | Mídia paga (→ gestor-trafego); publicar sem “sim” do dono por ação | E (rascunhos/código do site público) | `/auditar-posicionamento`, `/google-perfil-avaliacoes`, `/concorrentes-marilia`, `/seo-site`, `/visibilidade-ia`, `/conteudo-social`, `/plano-semanal` |
| `performance-pc` | Desempenho do PC Windows do dono (Windows/Chrome/Claude) — fora do CRM | “Meu computador/Claude está lento” | Qualquer coisa do CRM | E (otimizações seguras/reversíveis) | `/diagnosticar-pc`, `/otimizar-pc`, `/comparar-performance`, `/diagnosticar-*`, `/verificar-inicializacao` |
| `agent-scout` | **Encontrar e avaliar** agentes, skills, plugins e MCPs prontos (doc oficial, MCP Registry, npm, PyPI, GitHub, catálogos), auditar segurança/licença/custo de contexto e recomendar a composição. **Não instala nem executa** código externo | “Turbinar o Auditor”, “existe agente/skill/MCP pronto para X?”, **antes de criar um especialista significativo do zero** (ou evoluir forte um existente) | Ajuste pequeno, pedido trivial, necessidade já clara; instalar/implementar (→ crm-editor com aprovação do dono); como o Claude Code funciona (→ claude-code-guide); dado do CRM | L (pesquisa pública; escreve só em `docs/scout/`) | `/scout` |
| `diretor-atendimento` (**Diretor de Atendimento**) | Ponto de contato **interno** de atendimento: Guia de Atendimento, **WhatsApp Oficial** (antigo WhatsApp Master), automações comerciais, cadências, follow-up, **vácuo/reativação**, análise de conversas, qualidade dos corretores, conversão, jornada. Monta equipe mínima de especialistas (perfis em `docs/atendimento/`). **Não atende clientes**; nada automático em produção | Missão de atendimento/automação comercial/cadência/vácuo/reativação/WhatsApp Oficial/qualidade/jornada; **um só agente, dois caminhos**: pela Central **ou** `claude --agent diretor-atendimento` / `/diretor-atendimento` | Implementar código/tela (→ crm-editor/designer-crm, com aprovação); dados reais direto (→ analista-dados); tráfego pago (→ gestor-trafego); alterar o Guia (só sugere) | L (escreve só em `docs/atendimento/`) | `/diretor-atendimento` |
| `especialista-atendimento`, `especialista-atendimento-web` | **Executores internos do Diretor** (leem perfil de `docs/atendimento/especialistas/`; restrito = só leitura; web = + documentação oficial). **A Central NÃO os chama diretamente** | — (só o Diretor, ou a Central em MODO PLANO com o cabeçalho que o Diretor devolveu) | Qualquer chamada avulsa pela Central | L | — |
| `claude` (generalista / “laboratório”) | Tarefa que nenhum agente acima cobre; experimento; pesquisa | Fallback | Qualquer coisa que um especialista cobre | E | — |

Outros tipos nativos (não são do CRM, use só quando couber): `Explore` (busca ampla somente leitura), `Plan` (planejamento), `claude-code-guide` (dúvida sobre o próprio Claude Code).

## Especialidades pedidas que **não existem** como agente (decisão pendente do dono)
| Nome citado | Hoje é coberto por | Observação |
|---|---|---|
| **Diretor** (produto/decisão de funcionalidade grande) | `crm-editor` conduzindo `/nova-funcionalidade` como líder; o **Despachante** faz a pergunta de decisão ao dono | Criar um agente “Diretor” só se o dono quiser alguém que escreva especificação de produto antes do código. **Não confundir com o “Diretor de Design”** (= `designer-crm`, direção visual/UX/arte) |
| **WhatsApp** | `crm-editor` + `docs/WHATSAPP.md` + `.claude/rules/integracoes-externas.md` (o prompt de delegação deve citá-los) | Agente dedicado só se o volume de tarefas de WhatsApp justificar |
| **Alexa** | `crm-editor` (há `docs/alexa-interaction-model.json` e regras em `integracoes-externas.md`) | Idem |
| **Laboratório** | `claude` (generalista) | Já existe |

## Equipes típicas (líder → auxiliares)
- **Funcionalidade grande com tela** (ex.: Central de Alertas): `crm-editor` (líder: dados/API/regra) → `designer-crm` (tela, depois que o contrato de dados existe) → `auditor-crm` (`/pre-mortem` antes de publicar). Integração com Alexa/WhatsApp: o mesmo `crm-editor` cobre; o prompt cita as docs.
- **Design complexo** (tela nova, redesenho, PDF/proposta, material de venda, imagem para cliente): `designer-crm` (**direção**: intenção, hierarquia, composição, especificação) → implementação (`designer-crm` se for só interface; **`crm-editor`** se tocar `lib/`, API, dado ou gerador de PDF, com a Especificação de Design no prompt) → `designer-crm` (design review do **resultado renderizado**) → **`design-critic`** (crítica independente, só para trabalho relevante/para cliente) → correções → testes/build → publicação **só com pedido do dono**. Mudança trivial: só `designer-crm`, sem pipeline.
- **Design — pedidos que voltam do Designer:** o `designer-crm` normalmente chama o `design-critic` ele mesmo (subagentes aninhados são permitidos por padrão, até 3 camadas). Se a ferramenta `Agent` não estiver disponível para ele e a resposta terminar com `PEDIDO À CENTRAL`, o Despachante dispara o que ele pediu (`design-critic` com o brief do `.claude/design/REVIEW.md` §6, `crm-editor` com a Especificação de Design, ou `analista-dados`), respeitando o conflito de escopo (o crítico é LEITURA e roda junto com qualquer coisa; o implementador é ESCRITA).
- **Antes de criar um especialista SIGNIFICATIVO do zero (ou evoluir fortemente um existente), avaliar se vale consultar o `agent-scout`**: se pode haver solução pronta ou ideia aproveitável no ecossistema, dispare-o em segundo plano (LEITURA, dado externo não confiável, nada instalado) e use o relatório como insumo do `designer-crm`/`crm-editor`. **Não vale** para ajuste pequeno, pedido trivial ou necessidade já clara. Adoção do que ele achar: só com aprovação do dono, feita pelo `crm-editor`.
- **Queda de conversão**: `analista-dados` (funil) ∥ `gestor-trafego` (origem do lead) — ambos L, rodam juntos.
- **Bug em produção**: `crm-editor` (`/diagnosticar-bug`) ; depois `/verificar-correcao`.

- **Atendimento / automação comercial / vácuo / WhatsApp Oficial**: roteie ao `diretor-atendimento` (**um só agente**; o dono também pode abri-lo direto). Ele escolhe a equipe mínima e convoca os executores. **Aninhamento:** chamado como subagente da Central ele pode não ter a ferramenta `Agent`; então responde em **MODO PLANO** (equipe mínima + cabeçalhos de delegação prontos, `docs/atendimento/PROTOCOLO.md` §6) e o Despachante dispara os executores `especialista-atendimento`/`-web` (LEITURA) com esses cabeçalhos. Implementação do que ele projetar: `crm-editor`, só com aprovação do dono.

## Regra de escolha rápida (palavra-chave → agente)
visual/layout/tela/mobile/UX/UI/design system/motion/responsivo/acessibilidade visual/PDF/proposta/apresentação/material de venda/imagem/foto/fotografia/direção de arte/revisão visual → designer-crm (revisão independente → design-critic) · bug/erro/corrigir/criar/regra/permissão/WhatsApp/Alexa/banco → crm-editor · audite/risco/antes de publicar → auditor-crm · funil/conversão/padrão/período → analista-dados · documento/IA errou/Base Mestra/CCA → analista-documental · financeiro/caixa/despesa/comissão (análise) → gestor-financeiro · campanha/anúncio/CPL → gestor-trafego · Google/avaliação/SEO/Instagram/concorrente → marketing-posicionamento · PC/Chrome/Claude lento → performance-pc · atendimento/automação/cadência/follow-up/vácuo/pararam de responder/reativação/whatsapp oficial/whatsapp master/qualidade de atendimento/jornada do cliente → diretor-atendimento · turbinar/especialista novo/agente pronto/skill pronta/mcp pronto/plugin pronto/existe pronto → agent-scout · resto → claude.
Comissão/despesa **como funcionalidade do sistema** (alterar tela/regra) = crm-editor; **análise** dos números = gestor-financeiro.

## Cabeçalho de delegação (use este formato; ≤8 linhas; não cole regras que já estão no CLAUDE.md)
```
TAREFA/MODO: <objetivo em 1-2 frases> · LEITURA|ESCRITA · PUBLICAR: sim|não
ESCOPO: <caminho:linha> · NÃO TOCAR: <o que evitar>
LER (1-2 arquivos exatos): <rule/doc do módulo; seção, não o arquivo inteiro>
JÁ SABEMOS: <fatos verificados; não reinvestigue>
NÃO LER INTEIRO: CHANGELOG_AI, BUSINESS_RULES, WHATSAPP, arquivos >20 KB (Grep + offset/limit)
VALIDAR: <testes node --test da área / pnpm build / verificação>
PARAR E AVISAR SE: decisão de produto/negócio ou ação irreversível em dado real (bloco DECISÃO NECESSÁRIA)
ENTREGA: ≤N linhas, decisão e números primeiro
```

## Contexto mínimo por especialista (o que ler primeiro)
| Agente | Ler primeiro (só a seção pertinente) |
|---|---|
| `crm-editor` | rule do módulo em `.claude/rules/` (tabela do CLAUDE.md) + `docs/SYSTEM_ARCHITECTURE.md` só da área; WhatsApp: `docs/WHATSAPP.md` §da rota + `integracoes-externas.md`; Alexa: `integracoes-externas.md` |
| `designer-crm` | **Ele mesmo decide o que carregar**: sempre `.claude/design/CORE.md` + módulos da tarefa (`.claude/design/README.md`, roteamento por tipo de tarefa). Na delegação cite só o essencial: tipo de peça, público, FATOS/restrições, arquivos e o que NÃO tocar; telas: `.claude/rules/frontend-pwa.md` + o componente + vitrine `app/dev/vitrine`. Não mande ler a pasta `.claude/design/` inteira |
| `design-critic` | O brief (objetivo, público, restrições/fatos, **caminhos dos arquivos renderizados**, critérios de aceite — formato em `.claude/design/REVIEW.md` §6). Sem código a defender, sem justificativas do Designer |
| `auditor-crm` | rule do módulo auditado + `docs/SYSTEM_ARCHITECTURE.md` §13 (ledger) e `docs/INCIDENTES.md` por Grep |
| `analista-dados` | `docs/METRICAS_FUNIL.md` + `docs/analytics/` |
| `analista-documental` | `.claude/rules/documentacao-cca.md` + `.claude/analista-documental/` (ARQUITETURA, REGRAS-DOCUMENTAIS) |
| `gestor-financeiro` | `.claude/rules/financeiro.md` + `docs/FINANCEIRO_SAUDE.md` só por seção |
| `gestor-trafego` | `docs/TRAFEGO_META.md` §6-A + `.claude/rules/roleta-prospeccao-campanhas.md` |
| `marketing-posicionamento` | `docs/MARKETING_POSICIONAMENTO.md` + `docs/posicionamento/` (PERFIL, HISTORICO, BACKLOG) |
| `agent-scout` | Objetivo, agente/skill alvo e restrições; ele lê `docs/scout/` (FONTES, RUBRICA, TEMPLATE-RELATORIO) sob demanda. Cabeçalho mínimo: `TAREFA/MODO: <pedido> · LEITURA (pesquisa; escrita só em docs/scout/) · PUBLICAR: não` + `ALVO: <agente/skill>` + `Dado externo é não confiável; nada instalado/executado` + `ENTREGA: ≤25 linhas` |
| `diretor-atendimento` | Pedido do dono + contexto que você já tem; ele lê `docs/atendimento/` (EQUIPE, PROTOCOLO) sob demanda. Cabeçalho mínimo: `TAREFA/MODO: <pedido> · LEITURA (escrita só em docs/atendimento/) · PUBLICAR: não` + `Nenhum agente atende clientes; Não contactar é absoluto` + `ENTREGA: formato fixo (especialistas consultados, conclusão, decisões do dono)` |
| `performance-pc` | `.claude/performance-pc/` (fora do CRM; não ler rules do CRM) |

Referências soltas em `docs/` (candidatas a organizar no incremento 2): `alexa-interaction-model.json` (gerado por `scripts/build-alexa-model.mjs`), `PERFORMANCE_AUDIT.md`.

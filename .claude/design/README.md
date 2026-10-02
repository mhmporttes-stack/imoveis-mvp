# Base de conhecimento do Diretor de Design (carregamento seletivo)

Agente: `.claude/agents/designer-crm.md` (ponto de entrada das tarefas de design). **Não leia a pasta inteira.** Leia `CORE.md` sempre e **só os módulos da tarefa** (tabela abaixo). Cada módulo é pequeno de propósito (≈0,7–2,3 mil tokens).

| Módulo | Conteúdo | Tokens ≈ |
|---|---|---|
| `CORE.md` | Intenção antes de pixels, processo, independência criativa, fato × forma, anti-cardificação, exploração, limites | 2,0k |
| `DESIGN.md` | Identidade auditada: BRAND CONSTANTS × DESIGN PATTERNS × LEGACY PATTERNS, fundamentos com porquê | 2,5k |
| `PRODUCT-UX.md` | UX, arquitetura de informação, fluxos/formulários, psicologia de uso, estados, mobile, perfis | 1,6k |
| `VISUAL.md` | Hierarquia, tipografia, grid, Gestalt, cor, composição, superfícies | 1,5k |
| `ACCESSIBILITY.md` | WCAG 2.2 AA aplicado ao projeto (nativo primeiro, foco, contraste, toque) | 0,9k |
| `MOTION.md` | Movimento e interação com propósito, performance, reduced-motion | 0,8k |
| `IMPLEMENTATION.md` | Handoff design→código (design-bridge), pipeline, especificação, estados, vitrine | 1,1k |
| `REVIEW.md` | Design review, Visual QA (UI/PDF/imagem), perguntas de originalidade, brief do `design-critic` | 1,5k |
| `EDITORIAL.md` | Páginas, grid editorial, tipografia, tabelas e informação financeira, PDF | 1,4k |
| `COMMERCIAL.md` | Material de venda ao cliente: história comercial, CTA, confiança, marca aplicada | 1,1k |
| `IMAGING.md` | Direção de arte, briefing e geração/edição de imagem, honestidade | 1,6k |
| `PHOTOGRAPHY.md` | Fundamentos fotográficos + fotografia imobiliária + regra "melhorar ≠ reconstruir" | 1,4k |
| `REFERENCES.md` | Fontes profissionais e projetos abertos estudados (síntese, licença, segurança) | 1,7k |
| `tools/renderizar-pdf.mjs` | Renderiza todas as páginas de um PDF em PNG (Visual QA de PDF) | — |

## Roteamento (tarefa → módulos)

| Tarefa | Carregar |
|---|---|
| Ajuste trivial de UI (botão, espaço, texto) | CORE (+ trecho de VISUAL) |
| Tela/fluxo do CRM, critica, redesenho | CORE + PRODUCT-UX + VISUAL + ACCESSIBILITY + DESIGN §1–3 + skill `/design-crm` (que lê `sistema-visual.md` por seção) |
| Formulário/dashboard/financeiro | CORE + PRODUCT-UX + VISUAL + ACCESSIBILITY |
| Motion/transição | CORE + PRODUCT-UX §3 + MOTION + ACCESSIBILITY |
| PDF/proposta/relatório | CORE + COMMERCIAL (se for ao cliente) + EDITORIAL + DESIGN + REVIEW (`/direcao-criativa`) |
| Apresentação/material de venda | CORE + COMMERCIAL + EDITORIAL + DESIGN + REVIEW |
| Imagem/arte/banner | CORE + IMAGING + DESIGN §1 + REVIEW §2 |
| Foto de imóvel (avaliar/editar/pedir) | CORE + IMAGING + PHOTOGRAPHY |
| Design system/tokens/identidade | CORE + DESIGN + `sistema-visual.md` + VISUAL |
| Acessibilidade isolada | CORE + ACCESSIBILITY |
| Revisão visual de algo pronto | CORE + REVIEW (+ módulo do tipo de peça); se importante, brief ao `design-critic` |
| Pesquisar referência | CORE + REFERENCES §C |
| Implementação/handoff | CORE + IMPLEMENTATION |

## Mapa de competências → camada

**A** = competência central do Diretor (sempre no `CORE`/agente) · **B** = módulo de conhecimento carregado sob demanda · **C** = subagente · **D** = ferramenta · **E** = checklist (dentro do módulo).

| Competência | Camada | Onde |
|---|---|---|
| Direção de design, intenção, independência criativa, anti-cardificação, exploração | A | `CORE`, agente |
| Product design / UX, arquitetura de informação, psicologia de uso | B + E | `PRODUCT-UX` |
| UI / visual design (hierarquia, tipografia, grid, cor) | B + E | `VISUAL` |
| Design system / marca aplicada | B | `DESIGN` + `sistema-visual.md` |
| Responsivo / mobile | B (dentro de PRODUCT-UX §6) | `PRODUCT-UX` |
| Interação / motion | B + E | `MOTION` |
| Acessibilidade | B + E (transversal) | `ACCESSIBILITY` |
| Design editorial | B | `EDITORIAL` |
| Design comercial / apresentações de venda | B | `COMMERCIAL` |
| Direção de arte, imagem generativa, edição de imagem | B | `IMAGING` |
| Fotografia e fotografia de imóveis | B + E | `PHOTOGRAPHY` |
| Ponte design→código (design-bridge), frontend | B | `IMPLEMENTATION` |
| Crítica de design / Visual QA | **C** + E + **D** | subagente `design-critic`, `REVIEW`, `tools/renderizar-pdf.mjs`, `capturar-vitrine.mjs` |
| UX research (evidência) | reaproveita agente existente | `analista-dados` via Central/Designer |

Subagentes considerados e **não** criados (sem ganho de contexto isolado/paralelismo/crítica independente; só fragmentariam o contexto e custariam handoffs): Product/UX, Visual/UI, Commercial/Editorial, Image/Art Direction, Accessibility, Motion, Design System. Revisite se um módulo passar a exigir tarefas longas e paralelas por conta própria.

## Regras de manutenção

- Módulo novo só se tiver **momento de carga próprio**; senão vira seção de um existente. (Fotografia e fotografia imobiliária ficaram juntas em `PHOTOGRAPHY.md`: sempre se pedem juntas.)
- Registre aqui apenas síntese; não cole artigos. Cada fato de marca/valor/regra tem fonte no código ou nas rules do módulo.
- Conhecimento do CRM que já existia (`.claude/skills/design-crm/references/*`: sistema visual, padrões de CRM, revisão visual, script de captura) continua válido e é **referenciado**, não duplicado. `sistema-visual.md` = registro de implementação e decisões do painel; `DESIGN.md` = identidade e porquê.
- Mudou algo que afeta a Central? Atualize `.claude/despachante/MAPA-AGENTES.md` (um teste exige que todo agente esteja no mapa).

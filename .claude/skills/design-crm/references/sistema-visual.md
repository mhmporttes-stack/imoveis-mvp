# Sistema visual do CRM (memória do design)

Fonte de verdade das decisões visuais. Status de cada item: **[ADOTADO]** = vale e está no código · **[PROPOSTO]** = direção aprovada para a estrutura, entra no código no primeiro redesenho que o usar (aí vira ADOTADO e vai para a tabela de decisões) · **[OBRIGATÓRIO]** = identidade definida pelo dono. O que está ADOTADO/OBRIGATÓRIO aqui é decisão vigente, não defeito — não "corrija" por reflexo em revisão. **Vigente não é imutável (2026-10-02):** só a identidade (logo + paleta, `.claude/design/DESIGN.md` §1) é âncora; o resto pode ser revisto com justificativa e registro na tabela §6. Este arquivo é o **registro de implementação** do painel (tokens, componentes, decisões); a intenção de marca e o porquê ficam em `.claude/design/DESIGN.md`, e um padrão não vira "padrão de design" só por aparecer muitas vezes.

## 1. Identidade e direção

- **[OBRIGATÓRIO — dono, 2026-10-01]** Cores principais **azul e branco** e a **logo Matheus Machado** (`public/assets/matheus-machado-logo*`, `matheus-machado-symbol*`). Todo o resto pode mudar.
- **Direção [PROPOSTO]:** *ferramenta de trabalho confiável e rápida* — "mesa de corretor organizada", não "landing page". Branco como superfície, navy como estrutura e texto forte, azul `brand` como **o** acento de ação (~10% da tela). Ousadia vai para hierarquia, densidade e composição, não para a paleta. Momentos de celebração (ranking, Top 1, meta batida, mensagem diária) são o único lugar com expressividade alta — e já têm componentes próprios (`components/motion/*`, `celebrations/*`).

## 2. Estado atual (auditoria 2026-10-01 — use como diagnóstico, não como modelo)

- Tokens em `tailwind.config.cjs`: cores `ink #1F2937`, `muted #667085`, `navy #0D3B66`, `brand #1769D1`, `mist #F5F7FA`, `line #E5EAF1`; sombras `soft`, `premium`. Sem escala de tipo, raio, espaçamento nem cor semântica; sem variáveis CSS; sem modo escuro.
- **Fonte:** `Inter, Manrope` declaradas mas **nunca carregadas** → cada aparelho usa a fonte do sistema.
- **Raios:** 12 valores (`rounded-2xl` 517×, `full` 428×, `xl` 177×, `lg` 127×, `[28px]` 120×, `[24px]` 55×, `3xl` 41×, `[32px]`, `[22px]`, `[18px]`, `[20px]`, `[30px]`, `[10px]`).
- **Sombra:** `shadow-soft` 257× — o "kit de cards SaaS" (todo card igual, mesma sombra). `shadow-premium` em botões primários.
- **Texto:** `text-[11px]` 134×, `[10px]` 57×, `[9px]` 5× — abaixo do legível no celular. Hierarquia quase toda por `font-black` + caixa alta + tracking largo, o que achata (tudo grita).
- **Status:** cores cruas do Tailwind (`text-red-700` 210×, `bg-red-50` 161×, `bg-blue-50` 122×, `text-emerald-700` 85×, amber, slate…) sem semântica.
- **Classes inexistentes:** `text-slate` (150×) e `bg-slate` (66×) não geram CSS (o Tailwind só tem `slate-50…950`) — esses elementos herdam a cor do pai sem ninguém perceber.
- **Estilo por cadeia de classes:** `globals.css` estiliza `main.bg-mist.py-14 > section.container-page.mb-8 …` — trocar uma classe utilitária muda o layout de outra tela. Ao redesenhar, substitua por classe semântica.
- **Sem primitivas compartilhadas:** nenhum `Button`, `Badge`, `Modal`, `Drawer`, `EmptyState`. Existem classes globais `premium-button-*`, `client-action-button`, `premium-card`, `admin-input`.
- Movimento: `components/motion/*` (AnimatedNumber, AnimatedRing, RevealCard, Stagger, SceneTransition, `usePrefersReducedMotion`) — **[ADOTADO]**, reutilize.

## 3. Tokens

### Cor [ADOTADO na Fundação, 2026-10-01 — tokens em `tailwind.config.cjs`]
- **Marca:** `navy` (estrutura, títulos, texto forte, botão primário), `brand` (acento de ação, link, seleção, foco), branco (superfície), `mist` (fundo do canvas). Um único matiz azul nas superfícies — variar só a luminosidade.
- **Rampa de texto em 4 níveis:** primário `ink`/`navy` · secundário `ink-2` · terciário `muted` · desabilitado/placeholder `faint`. Hierarquia por peso + nível da rampa, não por caixa alta.
- **Semânticas** `success`, `warning`, `danger`, `info`, `neutral`, cada uma com `DEFAULT` (texto), `soft` (fundo), `line` (borda) e `strong` (ponto/preenchimento) — ex.: `bg-warning-soft text-warning`: sucesso = verde (aprovado, venda, on-line), alerta = âmbar (aguardando, atrasado leve), perigo = vermelho (erro, atrasado crítico, não contatar), info = azul (novo, em andamento). Status do cliente → tom em `components/ui/status-tone.js` (`clientStatusTone`) e `StatusBadge`; nunca cor crua. (`CLIENT_STATUS_META` em `lib/client-status.js` segue nas telas antigas até o redesenho delas.)
- Contraste mínimo AA: 4,5:1 texto normal, 3:1 texto ≥ 18px/negrito ≥ 14px e ícones/bordas de controle.

### Tipografia [ADOTADO — Manrope, escolha do dono em 2026-10-01]
- **Manrope** é a fonte oficial do painel: carregada com `next/font` em `app/admin/layout.jsx` (só rotas `/admin`), que redefine `--font-ui` no `:root` (vale também para modais em portal). O site público segue com a pilha padrão de `--font-ui` (`app/globals.css`). Tailwind `font-sans` = `var(--font-ui)`. Vitrine usa Manrope por padrão (`?fonte=inter|atual` só para comparação). Serifas decorativas só nas telas de celebração (já existem).
- **Escala** (≈1,2): 12 · 13 · 14 · 16 · 18 · 22 · 28 · 36 px (`text-2xs` = 11px micro-rótulo). Corpo de app 14px (desktop) / 15–16px (mobile, inputs **sempre ≥16px** — evita zoom do iOS). 12px é o mínimo para texto lido; 11px só para micro-rótulo em caixa alta com tracking. Nada abaixo de 11px.
- Pesos: 400 texto · 500 rótulos/tabela · 600 títulos e ênfase · 700–800 só ponto focal e números-herói. `font-black` deixa de ser padrão.
- Números que mudam ou se comparam (métricas, valores, ranking, tabelas): `tabular-nums`. Títulos grandes: tracking levemente negativo; `text-wrap: balance`.

### Espaço, raio e profundidade [ADOTADO na Fundação — tokens `rounded-chip|control|card|panel`, `shadow-float`, `min-h-touch`]
- Espaçamento em base 4 (4, 8, 12, 16, 20, 24, 32, 40, 48). Densidade varia por zona: listas e tabelas compactas, cabeçalhos e pontos focais com ar.
- **Raio:** `rounded-chip` 6 (badge) · `rounded-control` 10 (botão, input, item) · `rounded-card` 14 (card) · `rounded-panel` 20 (modal, sheet, contêiner grande) · `full` (pílula, avatar, contador). **Concêntrico:** raio externo = interno + padding. Fim dos `rounded-[28px]` soltos.
- **Uma estratégia de profundidade:** bordas de baixa opacidade (`line` ou `navy/8–10%`) + mudança tonal para estruturar; **sombra só para o que flutua** (`shadow-float`: popover, menu, sheet, barra fixa, toast). Card comum não leva sombra. `shadow-soft`/`shadow-premium` são legado.
- Área de toque mínima 44×44px (40 no mínimo absoluto em desktop denso).

### Movimento [ADOTADO + PROPOSTO]
- [ADOTADO] `components/motion/*` e respeito a `prefers-reduced-motion`.
- [ADOTADO] Interface: 120–250ms, `ease-out-ui` (`cubic-bezier(0.2, 0, 0, 1)`), só `transform`/`opacity`, nunca `transition-all`; feedback de toque `scale(0.97)` em `:active`; nada de `hover:-translate-y-0.5` em itens de lista densa (pula a lista inteira). Animação longa e expressiva só em celebração.

## 4. Componentes base [ADOTADO — `components/ui/`, sem dependência nova]

Use-os em toda tela nova ou redesenhada; telas antigas migram no próprio redesenho. Demonstração viva: vitrine `?tela=fundacao`.

| Componente | Uso |
|---|---|
| `Button` (`buttonClasses`) | `variant`: primary (navy) · secondary (contorno) · ghost · danger · danger-ghost. `size`: sm 36 · md 44 · lg 48 · icon 44×44. `href` → `<Link>`; `loading` → spinner + bloqueia clique duplo. |
| `Badge`, `CountBadge` | `tone` semântico (neutral/info/success/warning/danger/brand), `dot`, `icon`. `CountBadge` some no zero, "99+". |
| `StatusBadge` + `status-tone.js` | Status do cliente com o tom semântico (`clientStatusTone`). |
| `Card` | Superfície com borda, sem sombra; `padding` none/sm/md/lg; `as`. |
| `Sheet` | `<dialog>` nativo: foco preso, Esc, fundo inerte, rolagem travada. `side` bottom (celular) · right (gaveta) · auto (bottom < md, right ≥ md). `footer` fixo. CSS em `globals.css` (`.ui-sheet*`). |
| `EmptyState` | Vazio como convite (ícone, título, descrição, ação); `tone="danger"` para erro com "como resolver". |
| `Skeleton`, `SkeletonList` | Carregamento no formato do conteúdo, com `role=status`. |
| `Field` + `inputClasses` | Rótulo visível + ajuda + erro ligados por `aria-describedby`/`aria-invalid`; input 16px no celular. |
| `Menu` | Menu de ações "⋯" (abre para cima no celular, setas ↑/↓, Esc devolve o foco). |
| `ConfirmDialog` (`useConfirm`) | Confirmação na página no lugar de `window.confirm` (`await confirmAction({ title, description, confirmLabel, tone })`). |
| `Toast` (`useToast`) | Resultado de ação no lugar de `alert()`; sucesso some em 3,5 s, erro fica; `aria-live`. Fica acima da barra inferior. |
| `cx` | Junta classes condicionais. |

Tokens de tamanho: `h-touch`/`w-touch`/`size` 44 px (`spacing.touch`), `min-h-touch`/`min-w-touch`. Ícone dentro de `Button` não encolhe (`[&>svg]:shrink-0`).

Biblioteca externa (Radix, React Aria…) só com aprovação do dono.

## 4.1 Navegação [ADOTADO — autorizada pelo dono em 2026-10-01]

- **Celular (< 768px):** `components/AdminBottomNav.jsx` (montada em `app/admin/layout.jsx`), barra inferior fixa com 4 destinos + **Mais** (sheet com Pendências e **todos** os grupos de `getAdminMenuGroups`, exceto os já na barra). Administrador geral: Meta · Clientes · Chat · Desempenho. Gestor, corretor, associado: Meta · Clientes · Chat · Agenda. Contadores: Clientes = novos atendimentos + aguardando simulação; Chat = mensagens não lidas; Agenda = atividades pendentes. Some enquanto um campo de texto está em foco (teclado virtual). O espaço dela é reservado por `--admin-bottom-nav-space` (padding do `body`); elementos fixos no rodapé devem somar essa variável.
- **Tablet/desktop (≥ 768px):** `AdminMenu` no topo (o mesmo `getAdminMenuGroups`). Mudar destinos/itens → mude os grupos em `AdminMenu.jsx`, nunca uma lista paralela.

## 5. Larguras de referência

360 (Android pequeno) · 390 (iPhone) · 768 (tablet) · 1280 (notebook) · 1440 (desktop). Sem rolagem horizontal da página em nenhuma. Conteúdo de leitura ≤ ~72 caracteres por linha.

## 6. Tabela de decisões

| Data | Decisão | Onde | Por quê |
|---|---|---|---|
| 2026-10-01 | Identidade obrigatória = azul/branco + logo; resto livre | todo o CRM | decisão do dono |
| 2026-10-01 | Fonte pode ser escolhida e carregada pelo Designer | next/font | autorizado pelo dono |
| 2026-10-01 | Dependência nova só com aprovação do dono | — | decisão do dono |
| 2026-10-01 | Fundação: tokens semânticos, raios, `shadow-float`, `ease-out-ui`, `--font-ui`; componentes `components/ui/` | `tailwind.config.cjs`, `globals.css`, `components/ui/*` | aprovado pelo dono; aditivo, telas antigas intactas |
| 2026-10-01 | Tipografia oficial do painel = Manrope (só `/admin`) | `app/admin/layout.jsx` | escolha do dono após comparativo Manrope × Inter |
| 2026-10-01 | Lista de clientes redesenhada: faixa "Para agir agora", funil clicável com barras, lista em colunas (desktop ≥ lg) / cartão compacto (celular), ficha em gaveta; etapa, "Avisar progresso" e CCA **só na ficha**; abre com 20 por página; atalhos Meta/Chat/Agenda no cabeçalho ≥ md | `components/clients/`, `app/admin/simulacoes/page.jsx` | aprovado pelo dono; `AdminSimulationList` removido |
| 2026-10-01 | Lista de clientes em **cards híbridos** (padrão único, sem alternância): o conceito do card antigo com a Fundação; etapa e responsável (só admin/gestor) mudam no próprio card por seletor nativo vestido de selo + **confirmação** (`ConfirmDialog`); concluir/cancelar atividade no card; ficha para o secundário. Substitui a lista em linhas (`ClientRow`, removido) | `components/clients/ClientCard.jsx`, `StatusOptions.jsx` | aprovado pelo dono após comparação antigo × atual × híbrido |
| 2026-10-01 | **Modelo para as próximas páginas** (avaliação do dono em produção): manter a lógica da barra inferior no celular e o padrão de topo da Lista de clientes — indicadores de ação + funil/segmentos horizontais + busca com filtros em painel | todas as telas novas/redesenhadas | "maior evolução da tela" (dono) |
| 2026-10-01 | Densidade de card (lista grande, ~2 mil clientes): alvo de **~2 cards por tela no celular**; card com padding 14–16px, linhas de 13px com `space-y-2`, atividade em uma linha (data + nota truncada), botões do rodapé **44px** (área de toque, decisão final do dono) com pesos próximos (primário não domina); "Sem contato" em vez de "nunca" | `ClientCard.jsx` | ajuste pedido pelo dono; card ~16–17% menor |
| 2026-10-01 | Navegação mobile = barra inferior + "Mais"; menu do topo só ≥ 768px | `AdminBottomNav.jsx`, `AdminMenu.jsx`, `app/admin/layout.jsx` | autorizado pelo dono; distribuição por perfil decidida pelo Designer |
| 2026-10-02 | Aba Saúde (Financeiro): 3 números no topo (Resultado/Caixa/Expectativa), "Contas a pagar" com totais que filtram a lista, ação principal na linha ("Marcar como paga"), secundárias em "⋯"; `Sheet` com `className="ui-sheet-modal"` (modal centrado no desktop, bottom-sheet no celular) e `ui-sheet-full` (gaveta no desktop, tela cheia no celular); selos de status com ícone + texto; aviso com ação "Desfazer" local da aba (`useHealthToast`) | `components/FinancialHealth*.jsx`, `globals.css` | pedido do dono (T-20261002-11); atenção: `space-y-*` no pai dá margem ao `<dialog>` — envolva janelas em `<div className="contents">` |
| 2026-10-02 | Financeiro Vendas/Comissões: 3 números (Recebido no mês · A receber · Comissões em atraso, atraso em vermelho com ícone), "Ver detalhes" recolhido, filtros Período+Status + "Mais filtros", abas sublinhadas (`SectionTabs`, padrão único para abas), editor em 3 blocos recolhíveis com rodapé fixo (resumo + Salvar), lista→editor em duas telas no celular/tablet (< xl) | `components/AdminFinancialDashboard.jsx`, `FinancialSalesParts.jsx` | pedido do dono (T-20261002-12); `<details>` nativo; revisão de 390 px só por iframe (o Chrome headless não abre janela < 500 px) |

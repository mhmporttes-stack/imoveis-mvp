# Sistema visual do CRM (memória do design)

Fonte de verdade das decisões visuais. Status de cada item: **[ADOTADO]** = vale e está no código · **[PROPOSTO]** = direção aprovada para a estrutura, entra no código no primeiro redesenho que o usar (aí vira ADOTADO e vai para a tabela de decisões) · **[OBRIGATÓRIO]** = identidade definida pelo dono. O que está ADOTADO/OBRIGATÓRIO aqui é decisão, não defeito — não "corrija" em revisão.

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

### Cor [PROPOSTO]
- **Marca:** `navy` (estrutura, títulos, texto forte, botão primário), `brand` (acento de ação, link, seleção, foco), branco (superfície), `mist` (fundo do canvas). Um único matiz azul nas superfícies — variar só a luminosidade.
- **Rampa de texto em 4 níveis:** primário `ink`/`navy` · secundário (≈ `#475467`) · terciário `muted` · desabilitado/placeholder (≈ `#98A2B3`). Hierarquia por peso + nível da rampa, não por caixa alta.
- **Semânticas** (criar no `tailwind.config.cjs` como `success`, `warning`, `danger`, `info`, cada uma com `DEFAULT` texto, `soft` fundo, `line` borda): sucesso = verde (aprovado, venda, on-line), alerta = âmbar (aguardando, atrasado leve), perigo = vermelho (erro, atrasado crítico, não contatar), info = azul (novo, em andamento). Status do funil mapeiam para essas, nunca cor crua.
- Contraste mínimo AA: 4,5:1 texto normal, 3:1 texto ≥ 18px/negrito ≥ 14px e ícones/bordas de controle.

### Tipografia [PROPOSTO]
- Carregar a fonte de verdade via `next/font` (autorizado pelo dono). Candidatas: **Manrope** (já declarada, geométrica, combina com a marca, boa em números grandes) e **Inter** (neutra, ótima em tabelas densas). Decidir no primeiro redesenho com screenshot comparativo e registrar na tabela §6. Uma família para UI; serifas decorativas só nas telas de celebração (já existem).
- **Escala** (≈1,2): 12 · 13 · 14 · 16 · 18 · 22 · 28 · 36 px. Corpo de app 14px (desktop) / 15–16px (mobile, inputs **sempre ≥16px** — evita zoom do iOS). 12px é o mínimo para texto lido; 11px só para micro-rótulo em caixa alta com tracking. Nada abaixo de 11px.
- Pesos: 400 texto · 500 rótulos/tabela · 600 títulos e ênfase · 700–800 só ponto focal e números-herói. `font-black` deixa de ser padrão.
- Números que mudam ou se comparam (métricas, valores, ranking, tabelas): `tabular-nums`. Títulos grandes: tracking levemente negativo; `text-wrap: balance`.

### Espaço, raio e profundidade [PROPOSTO]
- Espaçamento em base 4 (4, 8, 12, 16, 20, 24, 32, 40, 48). Densidade varia por zona: listas e tabelas compactas, cabeçalhos e pontos focais com ar.
- **Raio:** 6 (badge, chip pequeno) · 10 (botão, input, item de lista) · 14 (card, painel) · 20 (modal, sheet, contêiner grande) · `full` (pílula, avatar, contador). **Concêntrico:** raio externo = interno + padding. Fim dos `rounded-[28px]` soltos.
- **Uma estratégia de profundidade:** bordas de baixa opacidade (`line` ou `navy/8–10%`) + mudança tonal para estruturar; **sombra só para o que flutua** (popover, menu, modal, barra fixa, toast). Card comum não leva sombra.
- Área de toque mínima 44×44px (40 no mínimo absoluto em desktop denso).

### Movimento [ADOTADO + PROPOSTO]
- [ADOTADO] `components/motion/*` e respeito a `prefers-reduced-motion`.
- [PROPOSTO] Interface: 120–250ms, ease-out (`cubic-bezier(0.2, 0, 0, 1)`), só `transform`/`opacity`, nunca `transition-all`; feedback de toque `scale(0.97)` em `:active`; nada de `hover:-translate-y-0.5` em itens de lista densa (pula a lista inteira). Animação longa e expressiva só em celebração.

## 4. Componentes base [PROPOSTO]

Criar sob demanda, no primeiro redesenho que precisar, em `components/ui/` (sem dependência nova): `Button` (primária navy, secundária contorno, fantasma, perigo; tamanhos 36/44), `Badge`/`StatusBadge` (semântica do funil), `Card`, `Sheet` (drawer lateral no desktop / de baixo no mobile, `<dialog>` nativo), `EmptyState`, `Skeleton`, `Field` (rótulo + input + ajuda + erro). Ao criar um, registre aqui com caminho e variantes. Biblioteca externa (Radix, React Aria…) só com aprovação do dono.

## 5. Larguras de referência

360 (Android pequeno) · 390 (iPhone) · 768 (tablet) · 1280 (notebook) · 1440 (desktop). Sem rolagem horizontal da página em nenhuma. Conteúdo de leitura ≤ ~72 caracteres por linha.

## 6. Tabela de decisões

| Data | Decisão | Onde | Por quê |
|---|---|---|---|
| 2026-10-01 | Identidade obrigatória = azul/branco + logo; resto livre | todo o CRM | decisão do dono |
| 2026-10-01 | Fonte pode ser escolhida e carregada pelo Designer | `app/layout.jsx` (next/font) | autorizado pelo dono; escolha pendente do 1º redesenho |
| 2026-10-01 | Dependência nova só com aprovação do dono | — | decisão do dono |

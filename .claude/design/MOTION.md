# MOTION — interação e movimento com propósito

Carregar para: transição, microinteração, animação de número/gráfico, celebração, navegação animada. Não carregar em PDF estático ou formulário comum.

## Princípios

1. **Movimento é informação — ou ruído.** Antes de animar, escreva o propósito: **orientar** (de onde veio/para onde vai) · **confirmar** (ação registrada) · **conectar estados** (antes → depois) · **mostrar hierarquia** (o que importa entra primeiro) · **dar continuidade** · **indicar progresso** · **percepção de qualidade**. Se a única razão é "ficar legal", não anime.
2. **Anime só os momentos importantes** (cria contraste). Ação repetida muitas vezes por dia (marcar concluída, trocar status) quase não anima.
3. **Acessibilidade primeiro:** respeitar `prefers-reduced-motion` (use `usePrefersReducedMotion` de `components/motion/*`); reduzido = troca instantânea ou fade curto, sem deslocamento/paralaxe/zoom. Nada pisca > 3×/s.
4. **Performance é experiência:** só `transform` e `opacity`; sem `transition-all`; sem animar largura/altura/top/left; sem handler de scroll pesado (use `IntersectionObserver`/CSS); medir INP/LCP quando for tela principal. Celular modesto é o alvo.
5. **Interrompível e reversível:** o usuário pode agir no meio; animação nunca bloqueia entrada; fácil de desligar por tela (flag/classe).
6. **Comece mínimo**, prototipe pequeno, mantenha só o que agrega.

## Especificação (preencha antes de implementar)

Gatilho (hover/clique/scroll/troca de rota) · estados de/para · duração · easing · condição de parada · fallback reduzido · custo (o que mede).

## Valores de partida (ajuste com razão)

| Uso | Duração | Easing |
|---|---|---|
| Feedback de toque/hover | 80–150 ms | `ease-out-ui` (`cubic-bezier(0.2,0,0,1)`) |
| Entrada/saída de elemento (menu, sheet, toast) | 160–250 ms | `ease-out-ui` entrada; saída mais rápida (≈70%) |
| Troca de estado de um componente | 150–250 ms | `ease-out-ui` |
| Transição entre telas | 250–400 ms (já existe `SceneTransition`) | — |
| Número que sobe / anel / progresso | 600–1200 ms, 1 vez | desaceleração |
| Celebração (Top 1, meta) | liberdade, mas com saída e reduced-motion | — |

Escalonamento (`Stagger`) ≤ 40 ms por item e ≤ 6 itens; mais que isso vira espera. Toque: `scale(0.97)` em `:active`. Nada de `hover:-translate-y` em lista densa (a lista inteira "pula").

## Princípios acrescentados na revisão de 2026-10-25

Fontes (só princípios, em palavras nossas): `ref-emil/` (E = emil-design-eng, R = review-animations, P = animation-performance) e `ref-impeccable/animate.md` (I). O que o dono já decidiu e o que está no código manda sobre elas.

1. **Frequência decide se anima (E).** 100+ vezes/dia ou por teclado: sem animação. Dezenas/dia (hover, navegar lista, marcar tarefa): quase nada. Ocasional (sheet, toast): padrão. Raro/primeira vez (celebração, abertura): pode encantar.
2. **Easing forte, nunca ease-in em entrada (E, R).** Os `ease`/`ease-out` embutidos são fracos. Valores de partida: saída/entrada `cubic-bezier(0.23,1,0.32,1)` ou o nosso `ease-out-ui`; movimento na tela `cubic-bezier(0.77,0,0.175,1)`; gaveta `cubic-bezier(0.32,0.72,0,1)`. `ease-in` só em saída de cena, nunca em resposta a toque. `linear` só para movimento constante (barra de tempo, giro).
3. **Nada nasce do nada (E).** Entrada começa em `scale(0.95–0.97)` + opacidade, nunca `scale(0)`. Popover/menu/dica escala a partir do gatilho (`transform-origin`); modal e confirmação ficam no centro.
4. **Interrompível (E, R).** O que o usuário dispara em sequência (toast, alternar, arrastar) usa transição ou mola, que reaproveita o ponto atual; keyframe recomeça do zero. Keyframe é para cena que toca uma vez.
5. **Passar a barra para a camada barata (P).** Troque, mantendo o mesmo visual: largura/altura → `scale`; `left/top/margin` → `translate` (botão liga/desliga: bolinha anda por `translate-x`); `box-shadow` animado → `drop-shadow` ou camada com `opacity`; `display` → `opacity`. Nunca `transition-all`: liste a propriedade (`transition-[width]`).
6. **Onde roda importa (P, E).** Orçamento de quadro: 16,7 ms (60 Hz) e 8 ms (120 Hz) — projete para o menor. Animação em CSS/WAAPI continua suave enquanto a página carrega; `motion` com `x/y/scale` e `requestAnimationFrame` roda na thread principal e engasga em navegação/hidratação (se for assim, use a string `transform`). Nunca `setState` a cada quadro: escreva em `ref.current.style` ou use motion value. Não mude variável CSS num pai para mover filho (recalcula tudo). Blur animado ≤ 20 px (2–5 px basta).
7. **`will-change` é o último passo (P).** Só no elemento que anima, só depois de ver o tremor de 1 px ou quadros perdidos, e temporário. Permanente em card/foto gasta memória, borra imagem e cria "containing block" que prende `position: fixed` de dentro (incidente de 2026-10-12).
8. **Hover só onde existe hover (E, R).** Ganho de hover entra em `@media (hover: hover) and (pointer: fine)`; no toque ele "gruda". Sem levantar (`-translate-y`) linha de lista ou célula de calendário — a lista inteira pula; trocar cor/borda/sombra basta.
9. **Assimétrico (E, R, I).** Onde o usuário decide (segurar, confirmar destrutivo) devagar; onde o sistema responde, rápido. Saída ≈ 70% da entrada. Sem exagero de mola/quique "por reflexo".
10. **Lista que entra em grupo escalona 30–80 ms por item (E)**; aqui o teto continua ≤ 6 itens. Escalonamento é enfeite: nunca bloqueia clique.
11. **Reduzir movimento é "mais suave", não "zero" (E, I).** Tire deslocamento, escala e giro; mantenha opacidade/cor que explicam o estado. Indicador de "carregando" fica mais lento, não some. Toda animação nova nasce com o caminho reduzido. Laço infinito para fora da tela e com a aba oculta.
12. **Uma tese de movimento por tela (I).** Escreva: momento de destaque (um só), continuidade (o que muda de lugar), feedback (o que confirma ação) e orçamento (o que pode ser caro e quantas vezes roda). Conteúdo visível no estado padrão: se o script falhar, nada fica escondido.
13. **Revise como o craque (R, E).** Em câmera lenta 2–5×, quadro a quadro, no celular de verdade e no dia seguinte. Relate achados em tabela Antes | Depois | Por quê, com arquivo:linha. Na dúvida se o movimento "está bom", o forte é apagar.

### Precedência no projeto
- Decisões do dono mandam: `--mm-motion-*` em `app/globals.css`. As cenas do Chat, sheets e mensagem nova foram triplicadas duas vezes a pedido dele (2026-10-12) e a opacidade ficou em 400 ms (2026-10-22). **Em 2026-10-25 o dono aprovou voltar Sheets (500 ms), menu de ações (400 ms) e mensagem nova (450 ms) à faixa de 0,4–0,6 s** ("aplique de 1 até 8"); troca de tela, abas, voltar e indicador da navegação seguem nos valores de 2026-10-12. Não "corrija" para 300 ms sem pedir; proponha.
- Cenas fora do teto de 300 ms (podem mais, com saída e reduzido): Meta Diária, Henry, Celebração, Mensagem do dia, Central de Alertas importante, entrada por rolagem. UI de uso frequente (botão, switch, menu, toast, popup, lista) fica abaixo de 300 ms.
- Os 4 padrões que já estão certos e valem de modelo: `Button`/`:active scale` (`components/ui/Button.jsx`), popup de cliente (`ClientPopupStack.module.css`), Supervisão/Alertas com `motion` (`EASE`, ≤ 260 ms, caminho reduzido separado), Henry (pausa com aba oculta e ritmo adaptativo, `HenryOrb`).

## Cenas do produto (2026-10-25, aprovadas pelo dono: "Todas")

Tese: confirmar com um momento curto o que é raro e importante (venda paga, crédito aprovado, transferência, primeiro acesso do dia, cadastro recebido) sem nunca atrasar clique ou rota. Orçamento: só `transform`/`opacity`/`stroke-dashoffset`; número escrito direto no nó (sem `setState` por quadro); cada cena roda uma vez e tem saída. Código: `components/motion/ProductScenes.{jsx,module.css}` + regras puras `product-scenes-core.mjs` (testes `tests/product-scenes.test.mjs`). Cada cena usa só o que a tela já recebeu (resposta da ação ou lista atual); a tela cheia do Henry (`useHenryFullscreen`) adia a 2 e a 4.

| # | Cena | Gatilho (sinal que a tela já tem) | Dura | Reduzido |
|---|---|---|---|---|
| 1 | Venda "Pago" — selo "PAGO" bate (mesma linguagem do carimbo "Total de descontos"), brilho azul passa, comissão sobe contando | resposta de `saveDraft`/`applyReceiptResult` devolve a venda `received` que antes não era; só o dono (`canManageForecast`); uma vez por venda | 2,2 s | selo parado com fade, valor final na hora |
| 2 | Crédito aprovado — check desenha no anel, faixa acende da esquerda, card pulsa 0,97→1 | `ClientCard` vê o status virar `approved` (último status visto na sessão); só corretor responsável; uma vez por id+status | 1,4 s | faixa/selo em fade, sem pulso |
| 3 | Transferência — card encolhe e desliza 700 ms, selo "Transferido para <1º nome>" se apaga em 1,5 s | `updateClientResponsibleUser` ok quando o corretor transfere o próprio cliente; card "fantasma" por 1,7 s | 0,7 s + 1,5 s | card some em fade, selo em fade |
| 4 | Primeiro acesso do dia à Meta Diária — até 6 cartões a 40 ms e anel sobe do zero em 1,2 s | marca `localStorage` por conta+dia (SP); só com `viewerKey` | 1,2 s | cartões em fade, anel no valor final |
| 5 | Cadastro recebido — check se desenha e o anel fecha no botão "Abrindo o WhatsApp…" | `openingWhatsapp` verdadeiro; o redirecionamento não espera a animação | 0,7 s | check desenhado |

Pontos de cuidado: em celular a cena 1 acontece junto do botão Salvar (a lista está escondida); a cena 3 fecha a ficha aberta para ficar à vista; `transform` no card da cena 2 só durante o pulso (nunca fica, para não prender `position: fixed`); nenhuma cena usa `will-change`.

## Reutilize o que existe

`components/motion/*` (AnimatedNumber, AnimatedRing, RevealCard, Stagger, SceneTransition, usePrefersReducedMotion). Biblioteca de animação nova: só com aprovação do dono.

## Checklist

[ ] Propósito dito em uma frase · [ ] frequência considerada · [ ] `prefers-reduced-motion` (mais suave, não zero) · [ ] só transform/opacity, sem `transition-all`, sem `will-change` permanente · [ ] easing forte, sem ease-in na entrada · [ ] origem certa · [ ] hover só com `(hover: hover)` · [ ] teclado/foco não afetados · [ ] não atrapalha ação repetida · [ ] medido no celular · [ ] desligável.

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

## Reutilize o que existe

`components/motion/*` (AnimatedNumber, AnimatedRing, RevealCard, Stagger, SceneTransition, usePrefersReducedMotion). Biblioteca de animação nova: só com aprovação do dono.

## Checklist

[ ] Propósito dito em uma frase · [ ] `prefers-reduced-motion` · [ ] só transform/opacity · [ ] teclado/foco não afetados · [ ] não atrapalha ação repetida · [ ] medido no celular · [ ] desligável.

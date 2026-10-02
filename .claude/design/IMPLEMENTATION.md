# IMPLEMENTATION — do design ao código sem perder a intenção (design-bridge)

Carregar para: entregar especificação a quem implementa, implementar interface, revisar implementação. **DESIGN INTENT > PIXEL COPYING.**

## 1. Pipeline (Central → Designer → Dev → QA)

Para trabalho **complexo** (tela nova, redesenho, peça para cliente, PDF):
1. **Designer** define intenção, hierarquia, composição, interação, estados, restrições → **Especificação de Design** (§3).
2. **Dev** implementa: o próprio Designer quando é só interface (`components/**`, estilo, vitrine); `crm-editor` quando toca `lib/`, API, dado, geração de PDF em `lib/`.
3. **Implementação volta ao Designer** para *design review* com render real (`REVIEW.md`). Importante/para cliente: **`design-critic`** independente (o Designer o chama direto quando tem a ferramenta `Agent`; senão devolve `PEDIDO À CENTRAL` e o Despachante aciona).
4. Dev corrige → testes/build → publicação (só com pedido do dono).
**Trivial** (ajuste local dentro do sistema): sem pipeline; faça e confira na vitrine.

## 2. Traduzir, não transcrever

- Valores de design (px) são referência; implemente com **escala, proporção e estrutura**: espaçamento em múltiplos de 4/8; tamanhos por **papel** (título, corpo, legenda), não por cópia de número; cor por **token**.
- Estrutura vence margem: flex/grid + `gap`; `position: absolute` só para sobreposição com propósito; evite altura fixa (`min/max/overflow`); `aspect-ratio` em mídia; larguras por **pesos** (coluna principal ≠ apoio), não `flex-1` em tudo.
- Valor fixo é exceção declarada (ícone, alvo de toque, miniatura, altura exigida).
- Evite: números mágicos, CSS corretivo infinito, componente artificial para "organizar", duplicação de string de classe, quebra do sistema (use `components/ui/*` e tokens antes de criar).
- Largura acompanha a viewport; conteúdo e fundo têm responsabilidades separadas.

## 3. Especificação de Design (handoff ≤ ~40 linhas)

```
OBJETIVO / USUÁRIO: <1-2 frases> · DECISÃO que a tela provoca: <...>
HIERARQUIA: 1º <...> · 2º <...> · 3º <...>   (o que sai/é secundário: <...>)
COMPOSIÇÃO: desktop <wireframe ASCII/descrição por zona> · mobile <idem, ordem muda?>
COMPONENTES: <reusar components/ui/X · novo: nome, responsabilidade, props>
ESTADOS: padrão/hover/foco/ativo/carregando/vazio/erro/sucesso/desabilitado/longo/curto
INTERAÇÃO/MOTION: <gatilho, feedback, reduced-motion>
ACESSIBILIDADE: <teclado, foco, nomes, contraste dos pares usados>
DADOS (FATOS, NÃO MEXER): <campos e regras exatos; de onde vêm>
RESTRIÇÕES: <perfis, regra do módulo, o que não tocar>
CRITÉRIOS DE ACEITE VISUAL: <3-6 observáveis: "ato inicial é o 1º elemento lido", "sem rolagem horizontal a 360px"…>
```

## 4. Estados e resiliência (obrigatórios)

Padrão · hover · ativo · foco · desabilitado (previne duplo envio e estado inválido) · carregando · vazio · erro · sucesso · sem permissão. Trate **conteúdo longo, zero itens, falha de rede e lentidão** desde o início (quebra, reticências com `title`, `max-w`, `overflow`). Tela redesenhada que só funciona no caminho feliz é bloqueador.

## 5. Acessibilidade e performance na implementação

HTML nativo, foco visível, nomes acessíveis (`ACCESSIBILITY.md`). Imagens com dimensões e `loading`; sem layout shift; sem biblioteca nova sem aprovação; `pnpm build` limpo.

## 6. Vitrine e verificação

Interface do painel: revise na vitrine `app/dev/vitrine` com dados fictícios (`.claude/skills/design-crm/references/revisao-visual.md`), larguras 360/390/768/1280/1440, estados normal/carregando/erro e perfis. Tela nova sem vitrine: crie fixture (dados inventados). O que a vitrine não reproduz (guard, cabeçalho de ranking) diga explicitamente.

## 7. Registro

Padrão ou token novo → `sistema-visual.md` (tabela de decisões) e, se for identidade/porquê, `DESIGN.md`. Mudança relevante → `docs/CHANGELOG_AI.md`.

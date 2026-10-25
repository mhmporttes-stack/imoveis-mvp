# Scout: skills de design Emil Kowalski e Impeccable (2026-10-25)

Pedido do dono: baixar as skills. Resultado: **Emil = instalar só 3 arquivos markdown (como referência). Impeccable = NÃO instalar como plugin/CLI.**

## 1. Emil Kowalski, repo oficial `github.com/emilkowalski/skills`
- Autor: emilkowalski (dono do repo; Sonner/Vaul). Licença **MIT** (copyright Emil Kowalski 2026). 49,6k estrelas, 57 commits.
- Commit fixo: `2d228630ba1446365f614a108cb8252f1feda202` (2026-10-11, "update readme"; o anterior, 6465079, adicionou animation-performance).
- Estrutura: `skills/<nome>/SKILL.md` em 15 pastas, só markdown (README relata nenhum outro arquivo por skill). Sem scripts, sem hooks, sem rede. Também `performance-cheatsheet.md`.
- Skills: emil-design-eng (principal), animate, review-animations, improve-animations, find-animation-opportunities, animation-performance, animation-vocabulary, apple-design, mobile-native, break-ui, prototype, pick-ui-library, ask-sonner, animate-expo e write-swift (estas 2 irrelevantes: React Native/Swift).
- Custo de contexto: emil-design-eng ~600 linhas / ~25 mil caracteres (~7 mil tokens, estimativa do leitor, não medida) quando invocada; descrições no início de sessão são curtas.
- Riscos: baixos. Dois textos têm "Initial Response" (responde frase fixa e espera) e formato de saída obrigatório; não é malicioso, mas é diretiva ao agente. `review-animations` aponta para `STANDARDS.md` (não confirmei se existe no repo). Cita easing.dev/easings.co como texto.
- Conflito com nosso designer: sem marca/logo/paleta (ok com a regra de identidade única). Atrito: regras de movimento firmes (nunca ease-in, <300 ms) e alguns itens que mudam comportamento (remover animação, dismiss por arrasto) — o designer só pode mexer em apresentação. Já existe `.claude/design/MOTION.md`; a skill sobrepõe.
- **Veredito: ADAPTAR/REFERÊNCIA.** Não instalar o repo inteiro. Copiar apenas `emil-design-eng`, `review-animations` e `animation-performance` para `.claude/design/ref-emil/` (módulo lido sob demanda, NÃO `.claude/skills/`, para não carregar descrições nem permitir autoinvocação), removendo "Initial Response"/persona e mantendo cabeçalho de proveniência (URL, commit, MIT). Depois, o `designer-crm` condensa o essencial em `MOTION.md` com palavras próprias.
- Como baixar (feito pelo `crm-editor`, com aprovação do dono; arquivos raw, commit fixo, sem npx):
  `https://raw.githubusercontent.com/emilkowalski/skills/2d228630ba1446365f614a108cb8252f1feda202/skills/<nome>/SKILL.md` (nomes acima). Não usar `npx skills add` (executa código de terceiros).

## 2. Impeccable, repo oficial `github.com/pbakaus/impeccable` (impeccable.style)
- Autor: Paul Bakaus (copyright 2025 no LICENSE). Licença **Apache-2.0** (exige manter aviso/NOTICE ao redistribuir). 87,6k estrelas, 2.562 commits, muito ativo (commits em 2026-10-25).
- Commit fixo avaliado: `3671d50f0ac9a662ce0615e85a256110c9cd720b` (2026-10-25). Muda todo dia: fixar sempre.
- Estrutura: `plugin/skills/impeccable/` (SKILL.md v4.7.1 ~9 mil caracteres, `reference/` com ~45 .md, `scripts/` com launcher `impeccable`, `impeccable.cmd`, 4 `live-browser*.js`, `modern-screenshot.umd.js`), `plugin/hooks/hooks.json`, `cli/`, `crates/` (Rust), `extension/`, `vscode/`.
- **Riscos altos (conforme README/arquivos lidos):**
  1. Hooks do Claude Code em SessionStart, PostToolUse (Edit/Write) e Stop executando o script `impeccable hook`; o instalador grava hooks em `.claude/settings.local.json`. Hooks rodam fora da aprovação de ferramentas.
  2. Launcher baixa um binário nativo na primeira execução (`~/.impeccable/bin/`).
  3. Telemetria anônima e chamada à API do impeccable.style ao iniciar design (opt-out por variável).
  4. Modo "live" abre servidor HTTP local e pode rodar script do `package.json` do projeto.
  5. A skill manda o agente rodar scripts/CLI a cada sessão e redesenhar tratando o visual atual como "anti-referência" — **choca diretamente com a regra de identidade visual única** (embora respeite estilo "fixado/pinned").
- Custo: SKILL.md ~9 mil caracteres (~2,6 mil tokens) + 30 comandos; referências sob demanda.
- Veredito: **NÃO INSTALAR** (plugin, `npx impeccable install`, hooks, scripts). Equivale a hook + rede + execução = **DECISÃO NECESSÁRIA** do dono. Se quiser aproveitar: USAR COMO REFERÊNCIA — o `designer-crm` lê (WebFetch, sob demanda) só `reference/typeset.md`, `layout.md`, `polish.md`, `critique.md`, `audit.md`, `animate.md` em commit fixo e incorpora ideias com palavras próprias em `.claude/design/` (sem copiar texto; Apache exige crédito se copiar). Não trazer `craft`, `overdrive`, `bolder`, `colorize`, redesign.

## DECISÃO NECESSÁRIA (dono)
Aprovar: (a) copiar 3 arquivos MIT do Emil para `.claude/design/ref-emil/`; (b) Impeccable só como leitura de referência, sem instalar. Impacto: nenhum hook novo, nenhum custo fixo de contexto; ~0 tokens por sessão (módulos lidos só quando a tarefa for de movimento).

## Limites desta verificação
Não consegui ler a lista completa de arquivos por API (GitHub API deu 403); listas vêm das páginas do GitHub e podem estar truncadas. Tamanhos são estimativas. `hooks.json` do Impeccable foi resumido, não lido linha a linha para segurança. Fontes: github.com/emilkowalski/skills, github.com/pbakaus/impeccable (README, plugin/, skill/, LICENSE), buscas gerais (baixa confiança, só para localizar).

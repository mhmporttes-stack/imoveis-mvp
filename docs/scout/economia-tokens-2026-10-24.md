# Economia de tokens nos agentes — 2026-10-24
PEDIDO: reduzir consumo do Claude Code (web, muitos subagentes) sem perder qualidade nem travas · ALVO: `.claude/agents/*`, MAPA-AGENTES, settings
LACUNA ATUAL (evidência): nenhum dos 18 agentes tem `model:` nem `effort:` no frontmatter (Grep em `.claude/agents/`) → todos herdam o modelo da sessão principal (se ela é Opus, tudo roda em Opus). Sem `autoCompactWindow` em `.claude/settings.json` → em modelo de 1M a compactação só ocorre perto de ~967 mil tokens. Cabeçalho do MAPA (l.50-60) já existe, mas sem modelo/esforço nem formato de retorno.
FONTES: (1) code.claude.com/docs/en/{costs, sub-agents, model-config, prompt-caching, plugins/code-intelligence}; platform.claude.com/docs/en/{about-claude/pricing, build-with-claude/vision}; npm `ccusage`; PyPI `serena-agent`. API do GitHub deu 403 (sem estrelas/commits). Nenhuma injeção encontrada nas páginas.

## Números-base (doc oficial, preço de lista por milhão de tokens entrada/saída)
Opus 5.5 $4/$20 · Sonnet 5.5 $2/$10 (-50%) · Haiku 5.5 $0,10/$0,50 até 100k de prompt (-97%). No plano por assinatura o peso de cada modelo no limite NÃO está publicado; a proporção acima é indicativa. Effort padrão no Opus/Sonnet/Haiku 5.5 = `medium`.
Imagem: custo = ⌈largura/28⌉×⌈altura/28⌉ tokens; modelos 4.7+ aceitam até 2.576 px / 4.784 tokens por imagem.

## Proposta 1 — `model:`/`effort:` por agente (maior impacto, esforço baixo)
| Arquivo | model | effort | Por quê |
|---|---|---|---|
| crm-editor | opus | (padrão medium) | Escreve código de produção, auth, banco; explícito para não cair se a sessão for Sonnet |
| auditor-crm, analista-documental | sonnet | high | Só leitura/regressão; erro aqui é omissão → compensar com esforço. Auditoria de auth/RLS: despachante passa `model: opus` na chamada (parâmetro por invocação tem prioridade, doc sub-agents) |
| designer-crm | sonnet | high | Edita só apresentação; visão do Sonnet 5.5 é do mesmo nível de resolução |
| despachante (sessão principal) | sonnet | medium | Roteia e resume; trabalho pesado vai ao crm-editor (opus). DECISÃO do dono |
| analista-dados, gestor-financeiro, gestor-trafego, diretor-atendimento, especialista-atendimento, email-specialist, marketing-posicionamento, editor-video, design-critic, agent-scout, performance-pc | sonnet | medium | Leitura/análise/texto; banco já é só leitura pelo hook |
| tratamento-imagem, especialista-atendimento-web | haiku | low | Tarefa mecânica / busca em doc oficial; testar 1 semana |
Economia: -50% em cada token desses 16 agentes se hoje herdam Opus; -97% nos 2 em Haiku. Peso real: ver `/usage` → aba de atribuição por subagente.

## Proposta 2 — compactação e sessões (esforço baixo, settings → aprovação)
- `"autoCompactWindow": 200000` no settings (faixa 100k–1M, doc model-config). Cada pedido relê o contexto inteiro: sessão em 600k custa ~4x por mensagem uma em 150k.
- `/clear` ao trocar de assunto (custa zero); `/compact <o que manter>` só em pausa natural (compactar é um pedido grande); `/rewind` para abandonar caminho errado (reaproveita cache). Não trocar modelo/esforço no meio da tarefa (troca de modelo zera o cache).
- Usar `/usage` (atribuição + "f to fix") e `/context` 1x por dia.
- Conectores MCP da conta que não servem ao CRM (Gmail, Runway, Claude Docs; Windsor só no marketing) entram com instruções em TODA sessão e subagente (vistos no meu próprio contexto; estimo 2–3 mil tokens). Desligar em `/mcp`/claude.ai. DECISÃO do dono.
- `omitClaudeMd: true` só em agentes fora do CRM (performance-pc, tratamento-imagem): ~7 mil tokens a menos por chamada (CLAUDE.md + 2 rules globais, chars/3,5). Não usar em agente que toca CRM (perderia as regras invioláveis).

## Proposta 3 — cabeçalho de delegação (substitui MAPA l.50-60; 12 linhas)
```
TAREFA: <1 frase> · MODO: LEITURA|ESCRITA · PUBLICAR: não|sim
MODELO: herdar|opus (só auth/banco/RLS) · ESFORÇO: padrão|high
ESCOPO: <caminho:linha> · NÃO TOCAR: <...>
LER: <1-2 arquivos, seção/offset> · NÃO LER INTEIRO: >20 KB
JÁ SABEMOS: <fatos; não reinvestigar>
PRINT: no máx. 1 por estado, recorte do componente, escala 1
TESTES: node --test só da área, saída resumida; build só no fim (1x)
PARAR: decisão de negócio/irreversível → DECISÃO NECESSÁRIA
RETORNO (≤15 linhas; auditoria ≤30):
 1) STATUS ok|bloqueado  2) o que mudou (arquivos)  3) validação (n testes, build)
 4) riscos/decisões  — sem colar código, diff ou log
```

## Proposta 4 — prints (sem instalação; regra em `.claude/design/`)
Escala 1 (`deviceScaleFactor: 1`), recorte do elemento, JPEG/WebP. Ex.: página 1280×2400 em escala 2 = 4.784 tokens; 1280×800 escala 1 = 1.334; recorte 600×400 = 330 (-70% a -93%). Conferir medidas (posição, tamanho, contraste, overflow) por script que imprime números, e o print só no veredito. design-critic: 1 rodada por entrega. Imagens velhas ficam no contexto e, ao acumularem, o Claude Code descarta em lote e reprocessa o histórico.

## Proposta 5 — testes e build (só texto na rule `workflow-dev`)
`node --test --test-reporter=dot tests/<área>.test.mjs 2>&1 | tail -40`; `pnpm build 2>&1 | tail -30` uma vez no fim. Opcional depois: hook PreToolUse que resume saída de teste (modelo na doc costs) — mexe em settings/hooks: junto com o guard de SQL e seu teste, nunca no lugar dele.

## Ferramentas externas (nada instalado)
| Nome | Fonte · versão · licença | Classe | Motivo |
|---|---|---|---|
| typescript-lsp (oficial Anthropic) | claude-plugins-official | DESCARTAR na web / REFERÊNCIA local | Doc: não roda em sessões na nuvem; exige `npm -g` (quebrado no Windows do dono) |
| Serena (MCP) | PyPI serena-agent 2.1.0 · GPL-3.0-or-later · 19/10/2026 | DESCARTAR | MCP com edição de código + Python; mais ferramentas no contexto; ganho coberto por Grep+offset |
| ccusage | npm 20.0.42 · MIT · 0 deps, sem postinstall | REFERÊNCIA | Lê logs locais; na web o container é efêmero; `/usage` nativo já atribui por subagente |
| `/usage`, `/context`, statusline | nativos | ADOTAR | Zero instalação, zero risco |

PRÓXIMO PASSO (crm-editor, após "sim" do dono): Proposta 1 em 18 frontmatters; 3 no MAPA; 4 em `.claude/design/`; 5 em `workflow-dev.md`; 2 no settings (com teste do hook intacto).
NÃO CONFIRMADO: peso de cada modelo no limite da assinatura; economia real de `effort` (doc não dá número); se `omitClaudeMd` também pula as rules globais; tamanho exato das instruções dos conectores.

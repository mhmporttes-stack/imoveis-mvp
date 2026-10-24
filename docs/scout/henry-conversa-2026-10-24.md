# Henry: vocabulário e interação (packs de conversa) — 2026-10-24
PEDIDO: agentes/packs prontos para melhorar o vocabulário e a conversa do Henry · ALVO: `lib/henry-voice-persona.mjs`, `lib/henry-voice-lexicon.mjs`, `lib/henry-voice-narration.mjs`
COMPETÊNCIAS: cenários de papo casual pt-BR · princípios de escrita para voz · reparo/confirmação · variação · persona em prompt de LLM de voz.

LACUNA ATUAL (evidência no código)
- O vocabulário já é grande: bancos de 20+ frases (aberturas, "pode falar", despedidas), 30 dicas de variação, léxico + piadas com sorteio sem repetir no dia, guia de estilo com exemplos (`henry-voice-persona.mjs` L33-223; `henry-voice-lexicon.mjs` L26/L272). Mais frase solta rende pouco.
- O que falta é COBERTURA DE CENÁRIOS de papo: `henryNeedsTools` (persona L298-305) só reconhece saudação, "tudo bem", obrigado, risada, piada e elogio. "Quem te criou?", "você é humano?", "tá cansado?", "você é burro", "tô cansado hoje", "que dia é hoje?" vão com ferramentas e sem orientação de tom.
- Faltam princípios de turno explícitos no prompt: uma pergunta por vez, confirmação implícita ("Tocando X" já faz isso), marcadores de conversa ("então", "aliás", "falando nisso") e o teste de "um fôlego".

FONTES CONSULTADAS: FONTES.md 6 (GitHub raw), 10 (busca geral) + docs oficiais Microsoft, Google, Amazon, ElevenLabs. GitHub API devolveu 403 (licença do repositório da Microsoft lida no arquivo LICENSE raw).

CANDIDATOS
| Nome | Tipo | URL · versão · licença · data | Classe | Custo no Henry | Riscos |
|---|---|---|---|---|---|
| Microsoft chit-chat "Friendly"/"Witty" em português | dataset Q&A (~100 cenários × 5 personas) | github.com/microsoft/botframework-cli/…/qnaFormat/portuguese/ · branch main · MIT (LICENSE do repo) · lido 2026-10-24 | ADAPTAR (como lista de cenários) | 0 fixo se virar só regex + ~150 tokens de orientação no prompt | Texto genérico de "bot" ("sou digital"), mistura tu/você; produto (QnA Maker) aposentado; sem injeção encontrada |
| Google Conversation Design | guia de escrita para voz | developers.google.com/assistant/conversation-design · CC BY 4.0 (texto) · atualizado 2024-09-18; plataforma descontinuada em 2023 | REFERÊNCIA | ~100 tokens de princípios reescritos | Nenhum (só leitura) |
| Alexa Design Guide ("Be brief", "Be natural") | guia de escrita para voz | developer.amazon.com/en-US/alexa/alexa-haus/design-principles · todos os direitos reservados | REFERÊNCIA (só ideias) | incluso acima | Não copiar texto |
| ElevenLabs Prompting Guide (agentes de voz) | guia de prompt | elevenlabs.io/docs/eleven-agents/best-practices/prompting-guide · sem licença visível | REFERÊNCIA | 0 | Página sugere a agentes de IA usar MCP deles para editar prompts: ignorado (risco de injeção leve, registrado) |
| Datasets de small talk pt-BR / skills "voice persona" da comunidade | dataset / SKILL.md | defined.ai (comercial); skills.sh, claudskills, agentskill.sh (registros, repo não confirmado) | DESCARTAR | — | Licença paga ou desconhecida, em inglês, genéricos; nenhum dataset aberto de papo pt-BR encontrado |

RECOMENDAÇÃO (texto nosso, em português, sem copiar terceiros)
1. Usar a lista de cenários da Microsoft só como CHECKLIST para escrever ~15 cenários de papo com a voz do Henry (identidade, "é humano?", criador, idade, humor do dono, xingamento/frustração, "tá aí?", "que horas são", elogio, desculpa), em `henry-voice-persona.mjs` (orientação curta no guia) e regex novos em `SMALL_TALK`. Respostas escritas por nós, nunca as da Microsoft.
2. Acrescentar ao guia de estilo um bloco "Turno de conversa" (~6 linhas): uma pergunta por vez e esperar; confirmação implícita em vez de "você quer mesmo?"; marcadores ("então", "aliás", "falando nisso", "mudando de assunto") para ligar respostas; teste de um fôlego; dado longo vai para a tela. Ideias de Google/Alexa, texto nosso.
3. Frustração/xingamento do dono: resposta calma e curta, sem ironia, com conserto ("Foi mal, deixa eu tentar de novo"). Hoje não há regra para isso.
4. Testar novos itens em `tests/henry-lexicon.test.mjs` (já trava número, palavra sensível, política etc.).
5. Evitar: copiar datasets/guia, instalar skill/MCP de terceiros, dataset comercial, aumentar demais o prompt fixo (já ~3 mil tokens em cache).

CUSTO FIXO ADICIONADO: prompt fixo do Henry ~3.000 → ~3.250 tokens (em cache, ~10% do preço). Zero no Claude Code.
PRÓXIMO PASSO (crm-editor, com aprovação do dono): itens 1-4 em `lib/henry-voice-persona.mjs` + teste; registrar em `docs/CHANGELOG_AI.md`. Nada foi instalado.
NÃO CONFIRMADO: número exato de cenários do arquivo português (li só 1/3 do arquivo); conteúdo das skills comunitárias de voz; tamanho exato em tokens do prompt atual (estimado por caracteres).

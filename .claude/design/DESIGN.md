# DESIGN.md — identidade e fundamentos visuais (com o porquê)

Fonte de verdade **da intenção visual** do projeto: o que é identidade, o que são boas soluções reutilizáveis e o que é herança sem obrigação — sempre com o **porquê**, para o Designer decidir casos que este arquivo não previu. Inspirado no conceito de `DESIGN.md` (token + regra + rationale no mesmo arquivo), mas **original**: nenhum sistema de terceiros foi copiado.
Não é uma prisão. Não congela o estado atual. Valores técnicos e o registro de decisões da interface do CRM ficam em `.claude/skills/design-crm/references/sistema-visual.md` (tokens em `tailwind.config.cjs`); aqui ficam os papéis, os princípios e as razões.
Auditoria desta versão: 2026-10-02, contra `public/assets/*`, `tailwind.config.cjs`, `app/globals.css` e `sistema-visual.md`. Reaudite antes de confiar num item que dependa de tela redesenhada depois.

## 1. BRAND CONSTANTS (preservar)

| Constante | O que é (auditado) | Porquê |
|---|---|---|
| **Logo** | Símbolo "M" geométrico: traço azul + forma branca/cinza-claro sobreposta. Arquivos: `public/assets/matheus-machado-symbol.png` (símbolo), `og-matheus-machado-v2.png` (marca completa com texto, sobre azul-marinho) e `public/icons/*-mm.png` (ícones do símbolo sobre azul-marinho). **Logos antigas (prédios/skyline, `matheus-machado-logo*`, `*-premium*`, `company-mark-avatar`, ícones sem `-mm`) foram removidas e são proibidas.** Não redesenhar, recolorir, distorcer, girar, aplicar efeito ou refazer à mão; usar os arquivos. Margem livre ≥ largura de um dos traços do M; símbolo legível a 16px. | É o ativo reconhecível. Para formatos novos (círculo, ícone), **recorte/enquadre** o arquivo; use os ícones `public/icons/*-mm.png` (já enquadrados sobre azul-marinho). |
| **Paleta âncora** | Medida na logo: azul `#3673C2`, azul-marinho profundo `#031D3A` (fundo da versão escura), branco e cinza-claro `#EFEFEF`. Azul sobre branco = 4,79:1 (texto AA); azul sobre o marinho = 3,54:1 (só texto grande/gráfico); branco sobre o marinho = 16,9:1. | A marca é **azul e branco**, com um marinho profundo como "palco". O dono definiu paleta + logo como as duas âncoras. |
| **Personalidade** | Confiável, clara, acolhedora, profissional sem ser fria. Cliente costuma ser comprador do 1º imóvel (Marília/SP, MCMV): precisa sentir segurança e entendimento, não pressão nem jargão. Corretor precisa de rapidez e controle. | Imóvel é a maior compra de uma vida; clareza vence ornamento. |
| **Idioma e tom** | Português do Brasil, direto, verbos de ação, sem jargão técnico ou bancário sem explicar. | Público é leigo; o dono também. |

**Achado da auditoria (decisão do dono, não alterar sozinho):** os tokens do CRM (`brand #1769D1`, `navy #0D3B66`) são uma **interpretação** da paleta: mais saturados/claros que a logo (`#3673C2` / `#031D3A`). Funcionam (5,28:1 e 11,45:1 sobre branco), mas peças fora do CRM (PDF, social, site) podem ancorar direto nas cores da logo. Perguntar ao dono se quer alinhar os tokens à logo antes de qualquer troca global.

## 2. DESIGN PATTERNS (reutilizar quando fizerem sentido)

Critério de entrada: tem um **porquê ligado ao resultado do usuário** e foi validado (dono aprovou ou há evidência). Frequência no código **não** qualifica. Cada padrão diz quando **não** usar.

| Padrão | Porquê | Não usar quando |
|---|---|---|
| **Status por cor semântica + ícone + texto** (`success/warning/danger/info/neutral`, `status-tone.js`) | Cor sozinha falha em daltonismo e sol no celular; semântica constante cria vocabulário aprendido. [validado] | Decorar sem significado. |
| **Números-herói no topo** (3 no Financeiro; indicadores de ação em Clientes) | Quem entra quer saber "como estou?" em 5 s. [validado pelo dono: "maior evolução da tela"] | Tela sem um número que decida algo. |
| **Ação principal na linha/cartão, secundárias em "⋯"** | Reduz escolha onde a decisão acontece; tira ruído. [validado] | Ação destrutiva sem confirmação. |
| **Confirmação em ações de alto impacto** (trocar responsável/etapa) | Prevenção de erro com custo real. [validado] | Ações triviais e reversíveis (use desfazer). |
| **Detalhe em gaveta/sheet** (desktop: lateral; celular: baixo/tela cheia) | Mantém contexto da lista; nativo (`<dialog>`) e acessível. [validado] | Fluxo longo que merece página própria. |
| **Barra inferior no celular** (4 destinos + Mais) | Alcance do polegar; corretor usa uma mão. [validado] | Desktop. |
| **Tipografia Manrope no painel** + `tabular-nums` em números | Legibilidade de números comparáveis; escolha do dono após comparativo. [validado] | Peças editoriais para cliente: avaliar tipografia própria (EDITORIAL.md). |
| **Alvos ≥ 44px; inputs ≥ 16px no celular** | Evita erro de toque e zoom do iOS. [norma] | — |
| **Acento azul contido (~10%)**, navy como estrutura | Um acento só guia o olhar. [proposto] | Peças comemorativas (celebração tem liberdade própria). |
| **Celebração com liberdade expressiva** (`components/motion/*`, `celebrations/*`) | Reconhecimento emocional é parte do produto. [existente] | Fora de momentos de conquista. |

## 3. LEGACY PATTERNS (sem obrigação de continuidade)

Podem ser questionados e substituídos. Não "corrija" por reflexo nem preserve por hábito; decida pelo problema.

- **"Kit de card SaaS"**: fundo branco + borda + `rounded-2xl` + `shadow-soft` + ícone + título + número aplicado a tudo (257 usos de `shadow-soft`). Padrão automático, não linguagem.
- **12 raios e `rounded-[28px]` soltos; sombras `soft/premium`**; hierarquia por `font-black` + caixa alta + tracking largo (tudo "grita"); texto de 9–11px.
- **Cores cruas de status** (`text-red-700`, `bg-blue-50`…) e classes inexistentes (`text-slate`, `bg-slate`); estilo por cadeia de seletores em `globals.css`.
- **Tokens antigos** (`ink, muted, navy, brand, mist, line, soft, premium`) enquanto cada tela não é redesenhada.
- **PDFs e apresentações como "tela do CRM impressa"** (ver EDITORIAL.md): estrutura, grid e densidade atuais são requisito de dados, não de forma.
- **Arte fotográfica atual** (`hero-premium-casal.png`, `hero-marilia.png`: casal com chaves, luz dourada, céu azul, aparência de imagem gerada): é o que existe, não um estilo obrigatório. Vale avaliar autenticidade, diversidade de imagens e coerência com o azul da marca.
- **Contraste de `faint #98A2B3`** (2,58:1 sobre branco) em placeholder: não passa AA; "desabilitado" é isento, placeholder não.

## 4. Fundamentos visuais e rationale (por papel, não por valor)

- **Cor por papel:** estrutura/título/botão primário = marinho; ação/link/seleção/foco = azul de marca; superfície = branco; canvas = `mist`; texto em 4 níveis (primário, secundário, terciário, desabilitado). *Porquê:* a hierarquia vem do papel, então trocar o tom exato não quebra o sistema. Status só por tokens semânticos.
- **Tipografia:** uma família de interface (Manrope no painel), escala ≈1,2 (12·13·14·16·18·22·28·36), pesos 400/500/600 e 700–800 só para ponto focal. *Porquê:* poucos níveis bem separados leem mais rápido que muitos parecidos. Peças editoriais/comerciais podem usar par tipográfico próprio (justificar).
- **Espaço e forma:** base 4; raios concêntricos em escala curta (chip 6, controle 10, card 14, painel 20); bordas finas para estrutura, sombra só no que flutua. *Porquê:* consistência de proporção, uma única estratégia de profundidade.
- **Densidade:** varia por zona (lista compacta, ponto focal arejado). *Porquê:* ritmo conduz o olhar; densidade uniforme cansa.
- **Ícones:** `lucide-react`, traço consistente, sempre com texto ou `aria-label`. *Porquê:* família única lê como uma voz.
- **Imagem:** fotografia real ou fiel ao imóvel; nada que prometa o que o imóvel não tem (ver `PHOTOGRAPHY.md`).
- **Movimento:** com função; respeita `prefers-reduced-motion` (ver `MOTION.md`).

## 5. Superfícies e liberdade criativa

| Superfície | Público e momento | Liberdade |
|---|---|---|
| CRM admin (celular/desktop) | Corretor/gestor/dono, trabalho diário | Alta em composição e hierarquia; sistema de componentes serve de ponto de partida, não de limite. |
| Site público e simulação | Comprador pesquisando; confiança e conversão | Alta; âncoras de marca; acessibilidade e velocidade obrigatórias. |
| Proposta/PDF/apresentação | Comprador decidindo; **história comercial** | Máxima na forma; dados e condições intocáveis (COMMERCIAL.md, EDITORIAL.md). |
| Social/anúncios | Atenção rápida (coordene com `gestor-trafego`/`marketing-posicionamento`) | Alta; conformidade imobiliária do conteúdo. |
| Celebração (ranking, meta) | Corretor, emoção | Máxima expressão, com reduced-motion. |

## 6. Como este arquivo evolui

Um item sobe de LEGACY/proposta a DESIGN PATTERN só com **porquê escrito + validação** (aprovação do dono ou evidência de uso). Mudança de decisão: registrar em `sistema-visual.md` (tabela de decisões) e ajustar aqui. Se você descobrir uma âncora de marca nova ou um conflito (como o dos tokens × logo), registre em §1 e pergunte ao dono — não decida a identidade sozinho.

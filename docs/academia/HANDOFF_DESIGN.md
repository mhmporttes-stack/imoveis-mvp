> Origem: repasse de design da Academia (Diretor de Design), copiado em 2026-10-04 e atualizado no mesmo dia com as decisões do dono (ACA-3 a ACA-6).
> A interface da F1 já o implementa em `components/academia/**`. Contrato de dados da F2: §6.
> Visão geral atual: [`../ACADEMIA.md`](../ACADEMIA.md).

# Academia MM · Repasse de design (protótipo aprovado -> React/Next no CRM)
Fonte: `proposta2/academia-proposta.html` (v3, 101 KB, vanilla) + `direcao.md`. Protótipo = **intenção**, não código a copiar (IMPLEMENTATION.md §2). Âncoras: logo "M" (`public/icons/icon-192-mm.png`, sem recolorir) + paleta azul/branco. Estado: só documento; nada no repo.
**Premissa de dados do protótipo (fixa em todas as telas):** 18 aulas/andares, módulos de 2,3,5,2,5,1 aulas; exemplo = 9 concluídas (50%), AGORA = Módulo 3 aula 5/5; concluir -> 10/18 = 56%. Tudo isso é exemplo, não regra.

## 1. Componentes (rota sugerida `app/admin/academia/**`, layout próprio)
RSC = Server Component; CC = Client Component. Cena e tudo que anima = CC.
| Componente | Responsabilidade / estados / props principais | Tipo |
|---|---|---|
| `AcademiaLayout` (shell) | Wrapper `.acd` (tokens escopados, §3), **sem** nav/barra inferior do CRM (desligar `AppChrome` nesta rota), `viewport-fit=cover`, `data-view`. Props: `children`, `user`. Provider de estado | RSC + `AcademiaProvider` CC |
| `AcademiaHeader` | Marca (ícone 38/44 px, anel branco 2 px sobre escuro) + "Academia"; "Voltar ao CRM" (link `/admin`, alvo 44); `ReduceMotionToggle`. Props: `onDark` | CC (lê tema da cena) |
| `FloatingNav` | Pílula Início\|Trilha\|Evolução, `<nav aria-label>`, `aria-current="page"`, desfoque opaco (degradê 92 px acima: `NavFade`). Rotas reais (`/academia`, `/trilha`, `/evolucao`), não só estado | CC |
| `ScenePlayer` | Monta a cena **uma vez** no layout (persiste entre rotas = "câmera única"). Props: `progress {done,total,current}`, `view`, `mode: 'full'|'static'`, `lightLevel`. Expõe `useCamera()` | CC, dynamic import |
| `Scene*` (Sky, Clouds, SkylineFar/Mid, Tower, Crane, Ground, Tint, WindowLights, Veils) | Camadas puras (div/SVG, só `transform/opacity`). Tower recebe `floors[]` com estado `done|now|next|future`. Guindaste = componente opcional (decisão do dono) | CC |
| `CameraController` (hook `useCameraRig`) | Estado + molas + rAF; ver §2 | CC (hook) |
| `HomeView` | % herói (Fraunces), rótulo "Formação Inicial · 9 de 18", pino "Você está aqui" -> título da aula, CTA **Continuar** (visível em repouso), indício de rolagem que some no 1º gesto. Spacer de rolagem curto (70% da altura) | CC |
| `TrailView` + `TrailRow` | 4 estados de linha: `done` (check; "Módulo n"/"4 aulas do Módulo m", toque expande aulas), `now` (disco marinho grande + halo, botão), `next` (anel, "libera ao concluir…"), `locked` (tracejado + cadeado). + `CertificationDestination`. Cabeçalho `n% · x de y aulas` sobre faixa opaca. Linha sob o olhar -> andar da câmera | CC |
| `EvolutionView` | Rolagem = tempo (0..N semanas); bandeiras por módulo concluído, trilho vertical com nós de semana, "Hoje", coroa "Certificação". Estático composto em reduzido | CC |
| `LessonScreen` | Plano sólido `#F7F9FC`, sem parallax; cabeçalho 1 linha "Módulo 3 · aula 5 de 5"; voltar; conteúdo; faixa fixa "Fazer a questão" (120 px de respiro). Conteúdo real da aula = do back (vídeo/texto) | RSC (conteúdo) + CC (casca/mergulho) |
| `QuestionScreen` | `radiogroup` rotulado pelo enunciado; "Responder" `aria-disabled` até escolher; feedback `role=status`. Estados: sem escolha, escolhido, certo, errado, enviando, erro de rede | CC |
| `AchievementMoment` | Conquista: 1º câmera, depois texto: "56%", "de 50% para 56%" (**texto também em reduzido**), título, 2 botões; painel marinho sólido embaixo (mobile) | CC |
| `CertificationMoment` | Câmera à coroa, noite, cartão compacto (~30% da altura): selo = logo, nome do aluno, "18 de 18 aulas · data", "Baixar certificado" (primário branco) + "Evolução" | CC |
| `ModuleSheet`/menu | Só se produto precisar (ex.: "Opções": reduzir movimento, ajuda). `<dialog>` nativo, foco preso, Esc, `inert` fechado | CC |
| `AcademiaToast` | Região `role=status aria-live=polite`, 2,6 s, **dentro** do shell; mensagens do protótipo ("Libera ao concluir…") são reaproveitáveis | CC |
| `ReduceMotionToggle` | `aria-pressed`; estado = preferência do SO OU escolha salva (localStorage, chave própria); não enfraquece modo normal | CC |
**SÓ DO PROTÓTIPO (não vai para produção):** barra "Proposta de design"/rótulo "Protótipo"; folha "Só protótipo: telas e opções" (menu para saltar entre telas); botão "Reiniciar exemplo (50%)"; `window.__A` (câmera/QS para teste; em produção, só atrás de flag de dev); dados de exemplo (nomes, semanas 2/4/6, "Nome do aluno (exemplo)", enunciado, textos "No produto: PDF…"); parâmetro `?vz=0`/zona do visualizador do Claude (a 64 px do topo existe só por causa da barra do visualizador: em produção usar só `env(safe-area-inset-top)`); `viewer-host.html`.

## 2. Motor de cena
**Camadas (trás -> frente):** céu (dia/entardecer/noite empilhados, cross-fade por `opacity`) · estrelas · nuvens · skyline longe · skyline meio · chão+torre+guindaste · tinta de entardecer · luzes das janelas · véus de leitura (`veil-b/t/h/l`, `haze`). Removidos e **não reintroduzir**: numerais fantasmas, andaime, projeto tracejado, blur em tempo real, `backdrop-filter`, filtro SVG, animação de `fill`.
**Parallax medido (torre = 1; Trilha, 390x844):** nuvens 0,33 · longe 0,46 · meio 0,64 · torre 1; 1440x900 0,14/0,28/0,49/1. Vizinhas ~1,7:1. Referência (vídeo): frente ~2x o meio; camada da frente abre o movimento ~0,2 s antes. Home: zoom por camada torre .88->1,1, longe .95->1,04, meio .92->1,07.
**Estado único de câmera:** `{zoom(log), andar(fl), deslocamento x(tx), âncora y(ay), luz 0|1|2, mergulho 0-1, obra(bb), guindaste(cr), contador(pv), opacidades de UI}`. Cada eixo segue um alvo por **mola criticamente amortecida** (solução exata, `dt<=50 ms`). ω (rad/s; assentamento 95% = 4,74/ω): rolagem Trilha 8,5 · rolagem Home 12 · zoom 4,6 · andar 3,2 · luz 2,2 · mergulho 4,6 · contador 4,2 · obra 4 · guindaste 2,4 · opacidades 8 · subida da Certificação 1,3.
| Tela | Alvos de câmera |
|---|---|
| Início | zoom ~.88->1,22 em 0-100% da rolagem curta, +0,9 andar, torre +8% à direita; mobile torre ~50% da largura; desktop torre 68-74% à direita, zoom x1,35, panorama ±2400 px |
| Trilha | `fl` = interpolação por âncoras das linhas sob o olhar; torre ~82% da largura (tx .9), lista sobe/torre desce (contramovimento, 0,5-0,8x); desktop câmera comprimida x0,6 |
| Aula | mergulho 0->1: zoom até 4,2x na janela do andar atual + plano claro `clip-path: inset(... round)` crescendo do retângulo da janela (~0,9 s) |
| Conquista | recuo (zoom 1,2->0,86), luz 0->0,95; 0,65 s andar acende; contador 50->56; 1,5 s módulo pisca (andares em sequência, 110 ms); 0,12/0,26 s título/botões; 2,9 s sobe ao módulo seguinte |
| Evolução | rolagem = tempo; obra reconstrói em 4,2 s (ease in-out) ao entrar (rebobina ~0,4 s; trocar por "já no presente" é opção); câmera afasta até enquadrar o prédio |
| Certificação | câmera ao topo, luz noite (2), coroa visível acima do cartão |
**Luz:** 0 dia -> 1 entardecer (marinho -> azul da marca -> gelo; calor só nas janelas, creme) -> 2 noite; só cross-fade de `opacity`. **Rolagem:** nativa e passiva (sem scroll-jacking); o handler só grava `scrollTop` num ref; **o laço rAF lê e move**.
**rAF:** um único laço no `CameraController`; roda só enquanto algo converge (`kick()` ao mudar alvo); `visibilitychange`: ao ocultar cancela rAF, ao voltar zera `lastT` e `kick()`; `dt` limitado a 1/20 s.
**Qualidade adaptativa:** janela de 1,5 s no dt do rAF; mediana >24 ms **ou** >10% dos quadros >33 ms = sobe nível; estável 6 s = desce. N1: sem nuvens e skyline longe · N2: + sem primeiro plano, numerais, brilho das janelas · N3: + sem skyline do meio. Câmera, andares acendendo e transições **nunca** caem. Telas >1 MP começam em N2. Expor nível em `data-q` no wrapper (CSS esconde camadas).
**Movimento reduzido (alternativa estática equivalente):** molas viram atribuição; sem CSS transition/animation; Evolução abre no presente; Conquista completa com texto "de 50% para 56%… Próximo: Módulo 4"; Certificação já com cartão; mergulho vira troca instantânea. Fonte: `prefers-reduced-motion` OU toggle; usar `usePrefersReducedMotion` do projeto.
**Ciclo de vida:** `useEffect` monta laço/observers; cleanup cancela rAF, remove `visibilitychange`/`resize`/`scroll`, limpa timeouts do toast. Pausar também com rota fora da Academia (desmonta).
**Carregamento:** `ScenePlayer` via `next/dynamic(..., { ssr:false })` dentro de `app/admin/academia/layout`: o resto do CRM não paga bytes. **SSR/hidratação:** servidor renderiza só o shell, cabeçalho, nav, **textos da tela** (% e "9 de 18 aulas") e um **fundo estático** (gradiente do céu + silhueta CSS/SVG leve do prédio já no estado correto, mesmo tamanho) que a cena substitui sem salto; nada de `window`/`matchMedia` no render; medidas de viewport lidas em `useLayoutEffect`/ao montar. Sem fundo estático = flash branco: bloqueador.
**Orçamento (medido no protótipo; manter):** celular 390x844 CPU 4x <=3% quadros >33 ms (atingido 1,9-2,5%), sem throttle ~0%; desktop sem GPU <=5% nos fluxos de uso (atingido ~1%); camadas de fundo aparadas (skyline 3600/3200 px, chão 5200x800); rasterização da torre uma vez; `will-change` só nas camadas em movimento; JS da cena sem biblioteca (nada novo: protótipo não usa libs).

## 3. Tokens e CSS isolados
Escopo: `.acd{...}` no wrapper do layout da Academia; **não** tocar `:root`, `tailwind.config.cjs` nem `--font-ui`. Prefixo `--acd-*` (protótipo usa nomes curtos: renomear). Tailwind: layout/espaço/flex com utilitários normais; cores e fontes da Academia via `bg-[var(--acd-ink)]` ou classes CSS em `academia.css` (módulo CSS/arquivo importado só nesse layout). Não usar `shadow-soft/premium`, `brand`, `navy` do CRM aqui.
| Token | Valor | Uso / contraste medido |
|---|---|---|
| ink | #031D3A (marca) | texto/% herói: 16,05 sobre paper, 14,48 sobre ice |
| ink2 | #3C4E66 | rótulos: 8,05 paper / 7,26 ice |
| ink3 | #566982 | bloqueado/apoio: 5,33 paper / **4,80 ice** (mín. AA) |
| blue | #3673C2 (marca) | foco, acentos gráficos: 4,54 paper (texto pequeno ok só sobre paper; **4,09 sobre ice: não usar como texto**) |
| blue6 | #2A5DA3 | texto de link/ação sobre claro: 6,24 / 5,63 |
| navy8 #0B2B52, navy7 #123E73 | painéis escuros; branco sobre navy8 14,17 |
| ice/ice2/ice3 | #E6EEF9 / #C9D8EE / #9DB7DA | superfícies e céu; ice3 só decorativo (1,95) |
| paper | #F7F9FC | fundo Aula/Questão |
| line | #DCE4EF | só estrutura (1,22: nunca sinal único) |
| ok / bad | #1B6B4C / #A23A2C | certo/errado: 6,12 / 6,27, sempre com ícone+texto |
| branco/marinho | 16,93; branco/blue 4,79; branco/blue6 6,58 | botões |
Tipografia: **Fraunces** (variável, `opsz 9..144`, wght 300-600; herói 156 px mobile/maior no desktop, títulos 22-38) + **Manrope** (400-800; já é família do painel; piso 14 px, corpo 17). Escala do protótipo: 14/16/17/20/24/28/32 + herói. Licença: ambas SIL OFL (uso/hospedagem livres). **Decisão do dono (2026-10-04): Fraunces aprovada** (ACA-3) e fontes ≈92 KB aprovadas (ACA-6); implementada na F1 com `next/font/local` (woff2 em `components/academia/fonts/`, sem requisição ao Google em runtime). Plano original: `next/font/google` (self-hosted no build, sem requisição ao Google em runtime) apenas no layout da Academia, `subsets:['latin']`, `display:'swap'`, variável com eixo `opsz` (axes), `adjustFontFallback` + fallback `Georgia, serif` (ajustar métricas p/ CLS ~0). Risco: peso (~80-110 KB só nesse layout), build exige proxy no ambiente web. (Plano B de Georgia no herói: não necessário, fonte aprovada.) Manrope: reutilizar a já carregada se existir, sem duplicar.
Espaços (base 4): margem 20, passos 4/8/12/16/20/24; raios 14 (controles), 22 (pílulas), 9-14 (logo); botão primário 52, pequeno/controle 44; foco 3 px, offset 3. Sombras: só no que flutua (toast, sheet, cartão da Certificação), sem sombra em cartões comuns. Easing padrão `cubic-bezier(.22,.8,.24,1)` (entrada de UI), overshoot `(.3,1.4,.4,1)` só em selos/medalha; no CRM usa `ease-out-ui (.2,0,0,1)`: manter o da Academia só no wrapper.

## 4. Movimento por transição
| Transição | Gatilho | O que muda | Duração/easing | Reduzido |
|---|---|---|---|---|
| Início -> Trilha | toque na nav/Continuar | zoom .88->.86, torre 50%->82%, % 156->47 px (0,3x), linhas entram da direita (+55 ms cada, <=6) | 0,6-1,0 s, mola 4,6/8,5 | troca instantânea |
| Rolagem Home | scroll 0-100% | zoom, +0,9 andar, % vira cabeçalho, pino expande | segue o dedo (mola ω12) | posição final sem mola |
| Rolagem Trilha | scroll | andar da câmera, contramovimento torre | mola ω8,5 (~0,56 s) | câmera pula ao andar |
| Trilha -> Aula | toque em Continuar/linha Agora | mergulho na janela + plano claro | ~0,9 s | corte direto |
| Aula -> Questão | botão | troca de painel, fade curto | 160-250 ms | instantâneo |
| Questão -> Conquista | "Responder" correta | plano encolhe, recuo, luz 0->.95, andar acende, 50->56, módulo pisca, texto entra | ~3 s (ver §2) | tudo no fim, texto já completo |
| Conquista -> Trilha | botão | luz volta ao dia, câmera ao módulo seguinte | ~1,5 s | instantâneo |
| Evolução | entrar/rolar | rebobina + reconstrói (4,2 s); rolagem = tempo | in-out quad | abre no presente |
| Certificação | última aula/menu | subida à coroa, noite | 3,6 s (ω1,3) | cartão direto |
Toast/menu: entrada 160-250 ms, saída ~70%. Feedback de toque `scale(.97)` 80-150 ms.
**Regras:** momentos imersivos = só Início (abertura), mergulho, Conquista, Certificação, Evolução (viagem no tempo). **Telas calmas** = Trilha leitura, Aula, Questão, menus: sem parallax decorativo, sem animação em ação repetida (marcar/responder), conteúdo de estudo em plano sólido estável. Nada bloqueia entrada: toque durante a animação leva ao estado final. Só `transform`/`opacity`. Nada pisca >3x/s; pulso das janelas só no andar "Agora" e pausável (>5 s). Cada momento imersivo tem "Pular" implícito (toque) e fim em estado estável.

## 5. Acessibilidade e iOS/WebKit
- Cena `aria-hidden`; informação nunca só nela: % e estados em texto. Estado = forma+luz+texto (disco/anel/tracejado/cadeado), nunca só cor. Foco: anel 3 px `blue` (branco em fundo escuro), nunca coberto por faixas (ordem: rolagem, controles, telas, CTA, nav). Alvos >=44 px (0 abaixo em 6 tamanhos). `h1` por tela com `tabindex=-1` e foco no título ao trocar tela/momento; regiões `role=status aria-live=polite` (contador, toast, feedback da questão), assertivo só para falha. Visually-hidden **completo**: `position:absolute;left:0;top:0;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap`, **dentro** do shell e fora de botões (nav usa `aria-label`; texto `.sr` duplicado vazava no rodapé do WebKit). Radiogroup real; `inert` em painéis fechados. Zoom 200%/texto em `rem`; **não** herdar `maximumScale:1/userScalable:false` do layout do CRM sem decisão (viola WCAG 1.4.4): sugerir liberar nessa rota.
- Zona segura: topo `env(safe-area-inset-top)` + marca; base `env(safe-area-inset-bottom)` abaixo da pílula; nada interativo/texto sob barra do visualizador (64 px só no teste). Altura: **não** usar `100vh`; `--vh` medido (ou `100dvh`) e `html,body{position:fixed}` no shell; rolagem em contêiner com `overscroll-behavior:contain`.
- WebKit: `-webkit-clip-path` + `clip-path: inset(... round)` (testar); sem `backdrop-filter`/filtro SVG (custo e bug); `-webkit-text-size-adjust:100%`; `text-wrap:balance` degrada com graça; `inert` exige Safari 15.5+; `visibilitychange` ao voltar de segundo plano; `font-variation-settings` p/ `opsz` de Fraunces.
- PWA standalone: CRM já usa `black-translucent` + `viewportFit:cover`: a barra de status sobrepõe o conteúdo, então o `safe-area-inset-top` é **obrigatório**; "Voltar ao CRM" sempre visível (sem barra de endereço); `themeColor #031D3A` já combina com a cena; sem hover como único meio; offline: fundo estático + mensagem, sem cena quebrada.

## 6. Contrato de dados (sugestão; **o back decide regras**; MVP = obrigatório)
```json
{ "track": {"id","title":"Formação Inicial"},                          // MVP
  "progress": {"done":9,"total":18,"percent":50},                      // MVP (percent calculado no back; front não recalcula regra)
  "modules": [{"n":3,"title","lessonsTotal":5,"lessonsDone":4,
     "state":"done|inProgress|next|locked",                             // MVP
     "lockHint":"libera ao concluir o Módulo 3",                        // MVP (texto do back)
     "completedAt":"2026-..", "week":6,                                  // Evolução (pós-MVP se sem histórico)
     "lessons":[{"id","order","title","minutes":12,"state":"done|current|next|locked"}]}], // MVP
  "current": {"lessonId","moduleN":3,"index":5,"of":5,"title","minutes"}, // MVP
  "next": {"lessonId?","moduleN":4,"title","lessonsTotal":2},            // MVP (pode ser null no fim)
  "lesson": {"id","title","minutes","content":"...", "question":{"id","stem","options":[{"id","text"}],"multiple":false}}, // MVP (sem gabarito no cliente)
  "answerResult": {"correct":true,"feedback":"...","progressBefore":50,"progressAfter":56,"moduleCompleted":3,"nextModule":4}, // MVP: alimenta a Conquista
  "evolution": {"weeks":[{"week":1,"startedAt","done":2,"percent":11}],"today":{"done":9}}, // pós-MVP; MVP pode usar só datas de conclusão por aula
  "exam": {"state":"locked|available|passed|failed","attempts":{"used","max"},"score","passingScore"}, // só se existir prova; campos vindos do back
  "certificate": {"issued":true,"holderName","completedAt","downloadUrl"} // MVP só se certificação existir; senão estado "ao concluir 100%"
}
```
Front não inventa: nota mínima, tentativas, regras de liberação, prazos, nomes de módulo. Se o back não tem "prova"/"semanas", a tela mostra estado vazio honesto (não os do protótipo). Erros: `loading`, `empty` (sem trilha atribuída), `error` (rede), `forbidden` por perfil. Perfis (admin/gestor/corretor/associado): definir com dono quem vê/estuda; guard no servidor, UI não é barreira.

## 7. QA visual e de movimento
**Medir** (rAF + quadros do compositor + long tasks; toque real; Chromium CPU 4x e **iPhone real**): p50/p95 do dt e % quadros >33 ms por fluxo (Início, Trilha rolagem, mergulho, Conquista, Evolução, Certificação) + nível de qualidade final. Metas: celular 4x <=3% no total e <=5% por fluxo; desktop sem GPU <=5%. Varredura de colisões (script `_src/sweep.mjs`: sobreposição de texto/botão, fora da tela, abaixo da borda inferior, cortado): 14 estados x (390x844, 360x640) = 0 colisões; repetir também em 1024/1280/1440/1920 e DPR 2.
**Mínimos:** iPhone real Safari (**nunca testado**; navegador e PWA standalone), iPhone SE/360x640, Android de entrada Chrome, desktop Chrome/Edge/Safari, `prefers-reduced-motion` ligado e desligado, zoom 200%, teclado. Perfis e estados: carregando, vazio, erro, sem permissão, conteúdo longo.
**Aceite de design (checklist):** [ ] 1 foco por tela, <=3 níveis de hierarquia; [ ] logo oficial sem alteração; [ ] contraste real >=4,5 (3 em gráficos); [ ] 0 alvo <44; [ ] 0 rolagem horizontal a 360; [ ] nada sob barra de status/nav/home indicator; [ ] sem flash antes da cena (SSR estático); [ ] reduzido = informação equivalente (incl. "de 50% para 56%"); [ ] só transform/opacity; [ ] tokens do CRM intactos (diff de `tailwind.config.cjs`/`globals.css` sem mudança nos existentes); [ ] resto do CRM não ganha bytes (analisar bundle); [ ] fatos vêm do back.
**design-critic:** depois do design review próprio, chamar com brief REVIEW.md §6 (objetivo, fatos, **caminhos de capturas/vídeos renderizados** de 390x844, 360x640, 1440x900, normal e reduzido, todos os estados da Trilha, Conquista, Certificação, e as tiras de tempo real), sem defender decisões; corrigir P0/P1 e renderizar de novo. Repetir após iPhone real.
**Em aberto:** (1) mergulho no desktop sem GPU = 12% >33 ms (e Trilha 4x em 360x640 = 8,8% no pior trecho; rasterização da torre fica macia ~0,3 s a 4x); (2) vegetação/nível da rua (opcional); (3) recuos reais do volume do prédio (só o coroamento recua); (4) guindaste: **aprovado pelo dono em 2026-10-04** (ACA-4); (5) manter CTA visível em repouso na Início (desvio do briefing, dono confirma); (6) "câmera única" como navegação nova = mudança estrutural: aprovação antes; (7) Fraunces/hospedagem: **aprovadas pelo dono em 2026-10-04** (ACA-3, ACA-6); (8) autoplay da Evolução (rebobinar vs já no presente); (9) sem teste em iPhone real, DPR 2 e 1920 em tempo real; (10) arte do prédio é 1ª passada SVG/CSS, não ilustração final; (11) miniatura com play na Aula é clichê, a trocar; (12) contramovimento da Trilha pode incomodar sensíveis (mitigado pelo toggle).

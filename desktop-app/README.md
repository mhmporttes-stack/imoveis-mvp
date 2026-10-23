# CRM Matheus Machado — app de desktop (Windows)

App só do PC do Matheus. Abre o CRM de produção (https://www.matheusmachadoimoveis.com.br/admin) numa janela própria para o Henry ficar sempre ligado: a página não "dorme", o microfone já vem liberado e os avisos "Chefe?" funcionam com a janela escondida. Regra: `docs/BUSINESS_RULES.md` HENRY-1 ("App de desktop").

## Instalar e abrir (versão 1.3.0 — a última instalação manual)

1. No navegador, abra https://github.com/mhmporttes-stack/imoveis-mvp/releases/tag/desktop-v1.3.0 e clique em `CRM-Matheus-Machado-1.3.0-x64.exe` (~200 MB, com as vozes do PC dentro).
2. Se estiver usando a versão antiga (pasta extraída do .zip): ícone do app perto do relógio › botão direito › **Sair**.
3. Abra o `.exe` baixado. O Windows pode mostrar "O Windows protegeu o computador": clique em **Mais informações › Executar assim mesmo** (o app não tem assinatura digital paga). Ele instala sozinho e abre.
4. O login, o log e as preferências continuam (ficam em `%APPDATA%\CRM Matheus Machado`). Se usava **Abrir com o Windows**, marque de novo no ícone (vale para o app instalado). A pasta da versão antiga pode ser apagada.

## Atualização automática (desde a 1.3.0)

O app procura versão nova ao abrir e a cada 4 horas, baixa sozinho e avisa: **"Nova versão X pronta"** — clique no aviso e escolha **Reiniciar agora** ou **Depois** (Depois = ela entra quando você Sair). Também no ícone: **Procurar atualização** (ou **Nova versão X pronta — Reiniciar agora**). Cada passo fica no registro de ações (`atualizacao ...`). Só no app instalado pelo `.exe` (a versão portátil não se atualiza).

## Como usar

- **Barra de título escondida (versão 1.2.0):** a janela não tem a barra do Windows. Leve o mouse até o alto da janela (os últimos ~6 px) e desce uma barra fina com o nome, os botões minimizar, maximizar/restaurar e fechar; ela some 1 s depois que o mouse sai. Arraste pela barra para mover; duplo clique nela maximiza/restaura. Atalhos: **Alt** (apertar e soltar) mostra a barra; **F11** liga/desliga a tela cheia. Prefere a barra sempre à mostra? Ícone › **Mostrar barra de título sempre** (aí o CRM fica logo abaixo dela, sem nada por cima). A janela abre maximizada e continua redimensionável pelas bordas.
- **Fechar a janela (X) não fecha o app:** ele fica no ícone perto do relógio. Botão direito no ícone: Abrir, Recarregar, Abrir com o Windows, Mostrar barra de título sempre, Diagnóstico do nome (2 min), Ver registro de ações, Procurar atualização, Sair.
- **Ctrl+Shift+H** (em qualquer programa): traz o CRM para a frente e abre o Henry já ouvindo. Fale; ele para de gravar sozinho quando você para de falar.
- **Diga "Henry"** (versão 1.1.0): o app fica ouvindo só o nome, no próprio PC — o som não sai do computador e não é gravado. Ele abre ouvindo o seu pedido. Enquanto o Henry fala, o app não fica ouvindo o nome (para interromper, fale "para" ou "Henry", como no navegador). Liga/desliga: cartão do Henry › Voz e personalidade › **Ouvir "Henry" sem atalho** (nasce ligado). Ctrl+Shift+H e o toque continuam valendo. Quando ele chamar "Chefe?", o microfone abre sozinho para você responder.
- **Palavra de chamada (1.3.0):** cartão do Henry › Voz e personalidade › **Palavra de chamada**: "Henry" (padrão), "Ei Henry", "Ok Henry" ou outra palavra (até 3). Se o app não conhecer alguma palavra, continua ouvindo "Henry" e avisa ali.
- **O nome não acorda?** Ícone › **Diagnóstico do nome (2 min)** e fale "Henry" algumas vezes. O registro de ações guarda, só por esses 2 min, o TEXTO que o reconhecedor entendeu (`nome_diag`) e a confiança — nunca o áudio. Sempre (sem diagnóstico) ele também registra o nível do microfone (`nivel media ... dB`; `SEM_AUDIO` = o microfone não entregou som), qual microfone está em uso, erros e quando a escuta pausou/voltou e por quê.
- **Voz de reserva no PC:** se a ElevenLabs e a OpenAI falharem (créditos, internet), o Henry fala com a voz do próprio PC (Piper) antes de cair na voz do Windows.
- "Henry, desliga a tela" / "liga a tela": apaga ou acende o monitor (mexer no mouse também acende).
- Músicas do Spotify abrem direto no app do Spotify; links de fora do CRM abrem no seu navegador.
- F5 recarrega a página. Novidades do CRM chegam sozinhas; o app em si (este programa) se atualiza sozinho desde a 1.3.0 (ver acima).

## Registro de ações (log)

Cada ação do Henry no PC (Spotify, link, aviso, tela, voz do PC, nome ouvido, escuta, atualização) fica em `%APPDATA%\CRM Matheus Machado\logs\acoes.log` (ícone › **Ver registro de ações**). Só data, ação e resultado (no nome ouvido, a palavra e a confiança; na voz do PC, só quantos caracteres) — nunca o que você falou nem áudio.

## Desinstalar

Ícone › **Sair**, desligue antes **Abrir com o Windows** (se ligou) e desinstale em Configurações › Aplicativos › "CRM Matheus Machado". Para apagar também o login salvo e o log: apague a pasta `%APPDATA%\CRM Matheus Machado`.

## Para desenvolvedores

- `npm install` e `npm start` (dentro de `desktop-app/`); testes: `npm test` (`node --test tests/*.test.js`).
- Modelos de voz (fase 1.1): `npm run models` baixa para `models/` (fora do git) e confere o SHA-256 fixo de cada arquivo; `dist:portable` e `dist:nsis` já rodam isso antes e empacotam `models/` em `resources/models` (`extraResources`). No Windows a extração usa o `tar.exe` do próprio Windows 10.
- Pacotes: `npm run dist:portable` (zip + `.exe` portátil, roda no Linux). Instalador NSIS: `npm run dist:nsis` (ou `pnpm run dist:nsis`; no Linux precisa de `wine`). Saída em `dist/` (fora do git). Conferir se os modelos entraram: `dist/win-unpacked/resources/models/` deve ter `piper/piper.exe`, `voices/pt_BR-faber-medium.onnx` e `vosk-model-small-pt-0.3.tar.gz`.
- Nome "Henry" (Vosk): janela escondida `src/wake/` (página local `mm-wake://app`, sessão própria sem disco, só microfone), controle em `src/wake-engine.js`, gramática e confiança mínima em `src/core.js` (`WAKE_*`, ajustar ali). Voz local: `src/piper.js` (texto por stdin, argumentos fixos).
- Barra de título (1.2.0): janela `BaseWindow` com `frame: false` e duas `WebContentsView` — o CRM e, por cima, a barra (`src/titlebar/`: página local `file://`, sessão própria `mm-titlebar` sem disco e sem permissão, preload próprio `window.mmTitlebar`). A barra fica `setVisible(false)` quando fechada (nada por cima do CRM); o processo principal lê a posição do cursor a cada 100 ms e decide por `titlebarStep` (`src/core.js`, `TITLEBAR_*`). Botões pelo canal IPC `mm:titlebar`, conferido por `validateTitlebarMessage` (só a webContents da barra, frame principal, `minimize`/`toggleMaximize`/`close`). Preferência em `%APPDATA%\CRM Matheus Machado\preferencias.json` (`titlebarAlwaysVisible`, padrão `false`). `window.mmDesktop` não mudou.
- Segurança: regras em `src/core.js` (origens, navegação, permissões, ações da ponte); ponte em `src/preload.js` (`window.mmDesktop`, só na origem do CRM); o processo principal (`src/main.js`) confere origem e formato de novo em cada ação. Nenhuma chave/segredo no app.
- Escuta do nome (1.3.0): palavra de chamada por `buildWakeConfig` (`src/core.js`; o CRM manda `onWake(cb, { wakeWord, onStatus })`, valores em `lib/henry-desktop-core.mjs`); vocabulário lido do `Gr.fst` dentro do `.tar.gz` do modelo (`src/vosk-vocab.js`); decisões puras `wakeSequenceStep`/`wakePartialStep`/`wakePauseStep`/`logLimitStep` (testes `tests/wake.test.js`).
- Atualização (1.3.0): `src/updater.js` (`electron-updater`, provider `generic`, `UPDATE_FEED_URL` em `src/core.js`, sem token). Publicação pelo workflow `.github/workflows/desktop-app.yml` (Windows; push na `main` mexendo em `desktop-app/**` ou manual): testes, modelos, `electron-builder --win nsis --x64` e GitHub Releases `desktop-v<versão>` + `desktop-latest` (o app lê esta; `latest.yml` sobe por último). Versão já publicada não é republicada: para lançar, suba `version` no `package.json`. App sem assinatura: nunca configure `publisherName` (o atualizador passaria a exigir assinatura).
- Desempenho (1.3.1, app lento e travando): a view do CRM continua com `backgroundThrottling: false` (a voz do Henry minimizada precisa de timers em tempo real), por isso o app avisa a página quando a janela é minimizada/vai para a bandeja (evento `onWindowVisibility`, `isWindowHidden` em `src/core.js`) e o CRM pausa animações e consultas por `components/page-visibility.js`. A caixa "Nova versão pronta" espera a tela cheia do Henry fechar (evento `henryFullscreen` → `updater.setHold`, passo puro `updatePromptStep`); nada se perde nem é cancelado.
- Fora da Vercel: `.vercelignore`, `tsconfig.json` e `scripts/vercel-ignore-build.sh` excluem esta pasta.

## Licenças dos componentes de voz (fase 1.1)

| Componente | Versão | Licença |
|---|---|---|
| Vosk (WASM, `vosk-browser`) | 0.0.8 | Apache-2.0 |
| Modelo `vosk-model-small-pt-0.3` (alphacephei.com/vosk/models) | 0.3 | Apache-2.0 |
| Piper (`piper_windows_amd64.zip`, github.com/rhasspy/piper) | 2023.11.14-2 | MIT (inclui espeak-ng, GPL-3.0, e onnxruntime, MIT) |
| Voz `pt_BR-faber-medium` (huggingface.co/rhasspy/piper-voices) | commit `5041a7a` | MIT (repositório); dados de treino CC0 |

Escolha da voz: `faber` `medium` (22 kHz) em vez de `edresson`, que só existe em `low` (16 kHz, dados CC BY 4.0).

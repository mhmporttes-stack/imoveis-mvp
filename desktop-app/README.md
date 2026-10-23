# CRM Matheus Machado — app de desktop (Windows)

App só do PC do Matheus. Abre o CRM de produção (https://www.matheusmachadoimoveis.com.br/admin) numa janela própria para o Henry ficar sempre ligado: a página não "dorme", o microfone já vem liberado e os avisos "Chefe?" funcionam com a janela escondida. Regra: `docs/BUSINESS_RULES.md` HENRY-1 ("App de desktop").

## Instalar e abrir

Versão portátil (não precisa instalar):

1. Baixe `CRM-Matheus-Machado-1.1.0-x64.zip` (versão 1.1.0, com as vozes do PC dentro; ~240 MB), clique com o botão direito › **Extrair tudo** numa pasta que você não vai apagar (ex.: `Documentos\CRM Matheus Machado`).
2. Abra `CRM Matheus Machado.exe`. Na 1ª vez o Windows pode mostrar "O Windows protegeu o computador": clique em **Mais informações › Executar assim mesmo** (o app não tem assinatura digital paga).
3. Entre no CRM com o seu login normal. O login fica salvo: ao reabrir, já entra.
4. Para abrir sozinho com o Windows: ícone do app perto do relógio › botão direito › **Abrir com o Windows**.

Atualizando da 1.0.0: clique em **Sair** no ícone do relógio, extraia a 1.1.0 por cima da pasta antiga (ou numa pasta nova) e abra. O login continua salvo.

## Como usar

- **Fechar a janela (X) não fecha o app:** ele fica no ícone perto do relógio. Botão direito no ícone: Abrir, Recarregar, Abrir com o Windows, Ver registro de ações, Sair.
- **Ctrl+Shift+H** (em qualquer programa): traz o CRM para a frente e abre o Henry já ouvindo. Fale; ele para de gravar sozinho quando você para de falar.
- **Diga "Henry"** (versão 1.1.0): o app fica ouvindo só o nome, no próprio PC — o som não sai do computador e não é gravado. Ele abre ouvindo o seu pedido. Enquanto o Henry fala, o app não fica ouvindo o nome (para interromper, fale "para" ou "Henry", como no navegador). Liga/desliga: cartão do Henry › Voz e personalidade › **Ouvir "Henry" sem atalho** (nasce ligado). Ctrl+Shift+H e o toque continuam valendo. Quando ele chamar "Chefe?", o microfone abre sozinho para você responder.
- **Voz de reserva no PC:** se a ElevenLabs e a OpenAI falharem (créditos, internet), o Henry fala com a voz do próprio PC (Piper) antes de cair na voz do Windows.
- "Henry, desliga a tela" / "liga a tela": apaga ou acende o monitor (mexer no mouse também acende).
- Músicas do Spotify abrem direto no app do Spotify; links de fora do CRM abrem no seu navegador.
- F5 recarrega a página. Novidades do CRM chegam sozinhas; o app em si (este programa) se atualiza baixando a versão nova e trocando a pasta.

## Registro de ações (log)

Cada ação do Henry no PC (Spotify, link, aviso, tela, voz do PC, nome ouvido) fica em `%APPDATA%\CRM Matheus Machado\logs\acoes.log` (ícone › **Ver registro de ações**). Só data, ação e resultado (no nome ouvido, a palavra e a confiança; na voz do PC, só quantos caracteres) — nunca o que você falou nem áudio.

## Desinstalar

Ícone › **Sair**, desligue antes **Abrir com o Windows** (se ligou) e apague a pasta do app. Para apagar também o login salvo e o log: apague a pasta `%APPDATA%\CRM Matheus Machado`.

## Para desenvolvedores

- `npm install` e `npm start` (dentro de `desktop-app/`); testes: `npm test` (`node --test tests/*.test.js`).
- Modelos de voz (fase 1.1): `npm run models` baixa para `models/` (fora do git) e confere o SHA-256 fixo de cada arquivo; `dist:portable` e `dist:nsis` já rodam isso antes e empacotam `models/` em `resources/models` (`extraResources`). No Windows a extração usa o `tar.exe` do próprio Windows 10.
- Pacotes: `npm run dist:portable` (zip + `.exe` portátil, roda no Linux). Instalador NSIS: `npm run dist:nsis` (ou `pnpm run dist:nsis`; no Linux precisa de `wine`). Saída em `dist/` (fora do git). Conferir se os modelos entraram: `dist/win-unpacked/resources/models/` deve ter `piper/piper.exe`, `voices/pt_BR-faber-medium.onnx` e `vosk-model-small-pt-0.3.tar.gz`.
- Nome "Henry" (Vosk): janela escondida `src/wake/` (página local `mm-wake://app`, sessão própria sem disco, só microfone), controle em `src/wake-engine.js`, gramática e confiança mínima em `src/core.js` (`WAKE_*`, ajustar ali). Voz local: `src/piper.js` (texto por stdin, argumentos fixos).
- Segurança: regras em `src/core.js` (origens, navegação, permissões, ações da ponte); ponte em `src/preload.js` (`window.mmDesktop`, só na origem do CRM); o processo principal (`src/main.js`) confere origem e formato de novo em cada ação. Nenhuma chave/segredo no app.
- Fora da Vercel: `.vercelignore`, `tsconfig.json` e `scripts/vercel-ignore-build.sh` excluem esta pasta.

## Licenças dos componentes de voz (fase 1.1)

| Componente | Versão | Licença |
|---|---|---|
| Vosk (WASM, `vosk-browser`) | 0.0.8 | Apache-2.0 |
| Modelo `vosk-model-small-pt-0.3` (alphacephei.com/vosk/models) | 0.3 | Apache-2.0 |
| Piper (`piper_windows_amd64.zip`, github.com/rhasspy/piper) | 2023.11.14-2 | MIT (inclui espeak-ng, GPL-3.0, e onnxruntime, MIT) |
| Voz `pt_BR-faber-medium` (huggingface.co/rhasspy/piper-voices) | commit `5041a7a` | MIT (repositório); dados de treino CC0 |

Escolha da voz: `faber` `medium` (22 kHz) em vez de `edresson`, que só existe em `low` (16 kHz, dados CC BY 4.0).

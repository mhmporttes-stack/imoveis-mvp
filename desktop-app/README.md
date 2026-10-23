# CRM Matheus Machado — app de desktop (Windows)

App só do PC do Matheus. Abre o CRM de produção (https://www.matheusmachadoimoveis.com.br/admin) numa janela própria para o Henry ficar sempre ligado: a página não "dorme", o microfone já vem liberado e os avisos "Chefe?" funcionam com a janela escondida. Regra: `docs/BUSINESS_RULES.md` HENRY-1 ("App de desktop").

## Instalar e abrir

Versão portátil (não precisa instalar):

1. Baixe `CRM-Matheus-Machado-1.0.0-x64.zip`, clique com o botão direito › **Extrair tudo** numa pasta que você não vai apagar (ex.: `Documentos\CRM Matheus Machado`).
2. Abra `CRM Matheus Machado.exe`. Na 1ª vez o Windows pode mostrar "O Windows protegeu o computador": clique em **Mais informações › Executar assim mesmo** (o app não tem assinatura digital paga).
3. Entre no CRM com o seu login normal. O login fica salvo: ao reabrir, já entra.
4. Para abrir sozinho com o Windows: ícone do app perto do relógio › botão direito › **Abrir com o Windows**.

Também existe `CRM-Matheus-Machado-1.0.0-portable.exe` (um arquivo só, mesma coisa, abre um pouco mais devagar).

## Como usar

- **Fechar a janela (X) não fecha o app:** ele fica no ícone perto do relógio. Botão direito no ícone: Abrir, Recarregar, Abrir com o Windows, Ver registro de ações, Sair.
- **Ctrl+Shift+H** (em qualquer programa): traz o CRM para a frente e abre o Henry já ouvindo. Fale; ele para de gravar sozinho quando você para de falar.
- No app o Henry **não escuta o nome "Henry" o tempo todo** (o Electron não tem o reconhecimento de voz do Chrome). Use Ctrl+Shift+H ou toque no Henry. Quando ele chamar "Chefe?", o microfone abre sozinho para você responder.
- "Henry, desliga a tela" / "liga a tela": apaga ou acende o monitor (mexer no mouse também acende).
- Músicas do Spotify abrem direto no app do Spotify; links de fora do CRM abrem no seu navegador.
- F5 recarrega a página. Novidades do CRM chegam sozinhas; o app em si (este programa) se atualiza baixando a versão nova e trocando a pasta.

## Registro de ações (log)

Cada ação do Henry no PC (Spotify, link, aviso, tela) fica em `%APPDATA%\CRM Matheus Machado\logs\acoes.log` (ícone › **Ver registro de ações**). Só data, ação e resultado — nunca o que você falou.

## Desinstalar

Ícone › **Sair**, desligue antes **Abrir com o Windows** (se ligou) e apague a pasta do app. Para apagar também o login salvo e o log: apague a pasta `%APPDATA%\CRM Matheus Machado`.

## Para desenvolvedores

- `npm install` e `npm start` (dentro de `desktop-app/`); testes: `npm test` (`node --test tests/*.test.js`).
- Pacotes: `npm run dist:portable` (zip + `.exe` portátil, roda no Linux). Instalador NSIS: `npm run dist:nsis` (no Linux precisa de `wine`). Saída em `dist/` (fora do git).
- Segurança: regras em `src/core.js` (origens, navegação, permissões, ações da ponte); ponte em `src/preload.js` (`window.mmDesktop`, só na origem do CRM); o processo principal (`src/main.js`) confere origem e formato de novo em cada ação. Nenhuma chave/segredo no app.
- Fora da Vercel: `.vercelignore`, `tsconfig.json` e `scripts/vercel-ignore-build.sh` excluem esta pasta.

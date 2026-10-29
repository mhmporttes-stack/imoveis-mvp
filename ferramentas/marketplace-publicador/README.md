# Publicador do Facebook Marketplace (extensão do Chrome)

Extensão pessoal do Matheus Machado Corretor de Imóveis. Pega no CRM **só os anúncios que você aprovou** (Cadastros › Marketplace) e publica sozinha no Facebook Marketplace, pelo seu perfil, usando a sessão do Facebook que já está aberta no seu Chrome.

## Aviso de risco (leia antes)

- Publicar por automação **não é permitido pelos termos do Facebook**. O Facebook pode pedir verificação, limitar publicações ou bloquear a conta. Você decidiu aceitar esse risco (volume baixo).
- Para reduzir o risco a extensão: publica no máximo **3 anúncios por dia**, só das **08:00 às 20:00** (horário de Brasília), com 2 a 5 minutos entre um e outro, digita em ritmo humano e **pausa 24 h** se o Facebook mostrar verificação, bloqueio ou aviso de limite.
- Nada é publicado sem o seu "sim": o anúncio só entra na fila quando você toca em **"Aprovado — publicar no Marketplace"** no CRM. Se editar o anúncio depois, a aprovação cai e precisa aprovar de novo.

## Instalar (Carregar sem compactação)

1. Descompacte `marketplace-publicador.zip` numa pasta que você não vai apagar (ex.: `Documentos\marketplace-publicador`).
2. No Chrome, abra `chrome://extensions`.
3. Ligue **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e escolha a pasta.
5. Fixe o ícone da extensão na barra (ícone de quebra-cabeça › alfinete).

## Atualizar para uma versão nova

1. Descompacte o zip novo **por cima da mesma pasta** (substituindo os arquivos).
2. Em `chrome://extensions`, clique no botão de recarregar (seta circular) do "Publicador Marketplace".
3. A chave e as opções continuam salvas — não precisa configurar de novo.
4. **Versão 1.9.6 (24/10/2026):** resposta do corretor que **não foi entregue** é tentada de novo **a cada 30 s** até sair (regra do dono). Antes de digitar de novo uma resposta que pode ter saído, a extensão **confere a conversa** — se já está lá, só marca como enviada (nunca manda duas vezes). Para sozinha se o Facebook bloquear/encerrar a conversa, se o cliente estiver em "Não contactar" ou depois de 24 h — aí fica "Não enviada" no CRM, com alerta. Cada reenvio conta no limite por hora. Confira se o cartão da extensão mostra "1.9.6". Sem permissão nova.
5. **Versão 1.10.0 (29/10/2026):** tela **Extensões** do CRM (só o administrador geral). (1) **Parar tudo / Retomar**: a extensão confere antes de cada publicação, de cada conversa lida e de cada resposta enviada, e para na hora (sem internet, vale o último estado conhecido; parada pelo CRM não gera o aviso "extensão sem sinal"). (2) **Publicações por dia** (padrão 3, de 0 a 10) e **horário de publicação** (padrão 08–20h) passam a ser editados lá; o chat continua configurado em Chat Marketplace (sem teto diário de mensagens — decisão do dono). (3) **Sinal de saúde**: versão, última rodada, publicações do dia × limite, pausa de 24 h, erros das últimas 24 h, partes da tela não achadas e as falhas internas que antes sumiam em silêncio (`.catch(() => {})`), sem dado de terceiros. (4) Se a área de mensagens da conversa só for achada pelo seletor genérico (`[role="main"]`, a página inteira), a extensão **para e avisa o CRM** em vez de ler. (5) **Versão nova**: o popup mostra o link do zip e o Chrome avisa uma vez por versão. Mesma chave `mkp_`. Confira se o cartão mostra "1.10.0". Sem permissão nova.
5. **Versão 1.9.10 (29/10/2026):** correção — com o chat a cada 1 minuto, a publicação (que confere a fila a cada 15 min) caía sempre no meio de uma rodada do chat e o anúncio aprovado **ficava parado na fila**. Agora, se a publicação esperou pelo chat, ela roda **assim que a rodada do chat termina**. Confira se o cartão da extensão mostra "1.9.10".
5. **Versão 1.9.9 (26/10/2026):** sincronização **mais rápida** (pedido seu): uma rodada **a cada 1 minuto**, contado do fim da anterior (nunca duas ao mesmo tempo); quando há trabalho a rodada pode durar **até 10 minutos** (lê até 15 conversas e envia as respostas), sem trabalho termina em segundos. As respostas automáticas acumuladas saem **uma a cada 30 segundos** e o limite passa a **40 envios por hora** (confira o número na tela Chat Marketplace do CRM). As pausas humanas entre envios continuam. Mais atividade no Facebook = um pouco mais de risco de verificação. Confira se o cartão da extensão mostra "1.9.9". Sem permissão nova.
5. **Versão 1.9.8 (25/10/2026):** funciona com a **janela de trabalho atrás de outra janela, inclusive em tela cheia**, sem você mudar nada e sem o atalho especial do Chrome (veja "Janela de trabalho" abaixo). E a extensão **nunca mais fica em silêncio**: se não conseguir ler o Facebook, avisa o CRM com o motivo a cada rodada (o Chat Marketplace mostra "última rodada falhou: …" e o aviso aos administradores diz o motivo), e as respostas dos corretores são tentadas mesmo assim. Confira se o cartão da extensão mostra "1.9.8". Sem permissão nova.
5. **Versão 1.9.7 (24/10/2026):** a sugestão de resposta rápida do Facebook ("Sim, você tem interesse?") não entra mais como mensagem do cliente — ela vinha num bloco com id próprio e passava pelo filtro da 1.9.1. E a **resposta automática de disponibilidade** do CRM ("Boa noite, Andreza. Sim, esse item ainda está disponível.") não é digitada se já houver texto no campo da conversa no Facebook (alguém digitando): o CRM cancela. Confira se o cartão da extensão mostra "1.9.7". Sem permissão nova.
5. **Versão 1.9.5 (23/10/2026):** envia também **fotos e PDF** que o corretor anexa no Chat Marketplace do CRM — um arquivo por vez, na ordem em que ele colocou (o texto digitado sai antes). Enquanto o PC estiver numa versão anterior, os arquivos ficam esperando na fila do CRM (os textos seguem saindo). Confira se o cartão da extensão mostra "1.9.5". Sem permissão nova.
6. **Versão 1.9.4:** confira se o cartão da extensão mostra "1.9.4" e, no CRM, Chat Marketplace mostra "Extensão 1.9.4: última leitura…". A partir dela a extensão trabalha numa **janela pequena só dela** (veja "Janela de trabalho" abaixo) e não abre mais abas na sua janela.
7. Desde a 1.9.3: se o Chrome não estiver mostrando a aba do Facebook (tela desligada/bloqueada, janela minimizada ou coberta), a extensão não tenta abrir conversa (o Facebook não abre assim) e deixa para a próxima rodada; conversa que falhou espera 4 → 8 → 15 → 30 min antes de nova tentativa (antes era a cada 2 min); a leitura do histórico para sozinha antes do prazo (não perde mais o que leu). Sem permissão nova.
8. Desde a 1.9.2 o envio das respostas abre a conversa pelo endereço direto (guardado na leitura), espera até 45 s, mostra a aba do Facebook por alguns instantes durante o envio e confere a mensagem na conversa antes de dar como enviada; falha antes de digitar é tentada de novo pelo CRM (até 3 vezes). Ela pede uma permissão nova ("power", para o computador não dormir) — o Chrome não mostra aviso para essa permissão e a extensão continua ligada. "Manter acordado" já vem ligado.

## Janela de trabalho (versão 1.9.4)

Pedido do dono em 22/10/2026: "ela fica a todo momento abrindo novas guias".

- A extensão abre **uma janela pequena só dela** (cerca de 520 × 760), com **uma aba do Facebook** que é reaproveitada sempre: leitura e resposta do Chat, publicação de anúncio, diagnóstico e o "Manter acordado". Ela **nunca** abre aba na janela em que você trabalha e **nunca** puxa o foco. Se você fechar essa janela, ela reabre sozinha (sem foco) na próxima rodada.
- No popup: **"Abrir janela de trabalho"** traz a janela para a frente, e a linha **"Janela de trabalho"** diz se a extensão consegue trabalhar agora (visível / atrás de outra janela / minimizada).
- **Atrás de outras janelas trabalha (1.9.8), inclusive atrás de uma janela em tela cheia, sem atalho especial.** Coberta, o Chrome trata a página do Facebook como oculta (para de desenhar e o Facebook não abre a conversa). Durante cada ação — ler a caixa, abrir/ler uma conversa, enviar uma resposta, publicar, diagnóstico — a extensão liga o modo depurador na aba de trabalho e faz a página se comportar como **visível e com foco** (emulação de foco do Chrome). **Nunca traz a janela para a frente** e não mexe na sua tela. Testado num Chrome de teste com uma página que só reage visível e com foco: sem o recurso o clique não abria; com ele, abria.
- **Efeito visual:** enquanto a ação acontece aparece no alto das janelas a faixa **"Publicador Marketplace começou a depurar este navegador"**; ela some cerca de 5 s depois que a ação termina (ações seguidas a mantêm). Entre as rodadas (a cada ~1 min desde a 1.9.9) a faixa não fica. Para nunca ver a faixa, use o atalho abaixo só com `--silent-debugger-extension-api` (opcional). **Não clique em "Cancelar"** na faixa: a extensão perde o modo naquela ação e a conversa pode não abrir (ela tenta de novo na próxima rodada e o CRM vê o motivo).
- **Minimizada pode não trabalhar.** Prefira deixar a janela atrás das outras. Se a página continuar oculta mesmo com o recurso (janela minimizada, DevTools aberto na aba), a extensão não tenta abrir a conversa e avisa o CRM com o motivo.

### Atalho do Chrome (opcional desde a 1.9.8)

Não é mais necessário para trabalhar atrás de outra janela. Continua útil para **esconder a faixa** do depurador (`--silent-debugger-extension-api`) e para a tela apagada/bloqueada.

1. Feche o Chrome por completo: todas as janelas e, se houver o ícone do Chrome perto do relógio, botão direito › **Sair**.
2. Botão direito no atalho do Chrome que você usa (área de trabalho; na barra de tarefas: botão direito no Chrome › botão direito em "Google Chrome") › **Propriedades**.
3. No campo **Destino**, depois de `chrome.exe"`, acrescente um espaço e cole:
   `--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --silent-debugger-extension-api`
   (o último item, desde 23/10/2026, **esconde a faixa "…começou a depurar este navegador"** que aparecia em todas as janelas durante cada clique da extensão; pedido do dono)
4. **OK**. Abra o Chrome sempre por esse atalho. No popup, a linha "Janela de trabalho" deve dizer **visível** mesmo com a janela atrás das outras.

Não existe mais opção em `chrome://flags` para isso no Windows (confirmado no código do Chromium em 22/10/2026: o recurso `CalculateNativeWinOcclusion` só se desliga pela linha de comando). Se o Chrome for aberto por outro caminho (link, outro atalho, reinício automático depois de atualizar), vale o comportamento normal até abrir de novo pelo atalho.

## Configurar

1. No CRM: **Cadastros › Marketplace › Gerar chave**. Copie a chave (`mkp_...`) — ela aparece uma vez só.
2. Na extensão: botão direito no ícone › **Opções**. Endereço do CRM já vem preenchido (`https://www.matheusmachadoimoveis.com.br`). Cole a chave e **Salvar**.
3. Opcional: marque "Guardar print da tela quando uma publicação falhar" (o print fica só no seu computador, no histórico do popup).

Gerar uma chave nova no CRM desliga a anterior — cole a nova nas Opções.

## Como funciona

- A cada ~15 minutos (com o Chrome aberto e o computador ligado) a extensão pergunta ao CRM se há anúncio aprovado.
- Se houver: abre o "Novo classificado de imóvel" (`facebook.com/marketplace/create/rental`; se não abrir direto, vai em "Escolha o tipo de classificado" e clica em "Imóvel residencial para venda ou locação"), baixa as fotos do CRM e envia, escolhe venda ou locação, tipo de imóvel, quartos, banheiros, preço, localização ("bairro, Marília" — 1ª sugestão; sem sugestão, só "Marília"), descrição e, se houver, metros quadrados, IPTU, condomínio e vagas. Deixa **"Turbinar classificado" desligado**, nunca clica em "Salvar rascunho", marca em "Anunciar nos seus grupos" **só** os grupos da lista do CRM (Cadastros › Marketplace › Grupos do Facebook; até 20; grupo que não aparecer é ignorado e fica registrado no anúncio), clica em Avançar e Publicar, pega o link do classificado e avisa o CRM (o status e o link aparecem na tela do CRM).
- O formulário de imóvel do Facebook não tem campo "Título" (o Facebook monta o título pelos dados); o título fica só no CRM, para você se organizar.
- Deu certo: a aba fecha e chega uma notificação. Deu errado: a aba fica aberta para você ver, chega uma notificação com o passo que falhou e o CRM marca "Falhou" com a descrição.
- Abre sempre uma **aba nova só para isso** (nunca mexe na aba em que você está) e fecha no final. Se o formulário não abrir direto, passa pela escolha do tipo de classificado e, por último, pelo "+ Criar novo classificado" do menu; o erro mostra as páginas atingidas.
- Limites: só publicação **bem-sucedida** conta nas 3 do dia (entre uma publicação e a próxima, 2–5 min). Depois de uma falha, tenta de novo em 15–20 min (no máximo **2 tentativas por anúncio** e 6 tentativas no dia). Se a falha foi **depois** de clicar em Publicar, não tenta de novo (evita anúncio duplicado) — confira no Facebook e, se não saiu, toque em **"Tentar de novo"** no CRM.

## Faixa "está depurando este navegador" (normal)

Desde a 1.9.8 a faixa aparece durante cada ação no Facebook (publicação, leitura da caixa, de uma conversa ou envio de resposta) e some ~5 s depois. Durante cada publicação o Chrome mostra no alto da aba a faixa **"Publicador Marketplace começou a depurar este navegador"**. É normal: a extensão usa esse modo para clicar e digitar como uma pessoa (o campo de localização do Facebook ignora cliques automáticos comuns). A faixa some quando a publicação termina e a aba fecha. **Não clique em "Cancelar"** na faixa durante a publicação (a extensão volta para o modo comum e a localização pode falhar).

## Chat do Marketplace (versão 1.6.0)

- A cada ~1 minuto (1.9.9; contado do fim da rodada anterior), no horário escolhido no CRM (padrão 07h–22h), a extensão abre uma aba própria em **facebook.com/marketplace/inbox**, lê **só as conversas do Marketplace** que mudaram (nunca as conversas pessoais do Messenger) e manda ao CRM, onde elas aparecem em **Chat Marketplace** com o selo do Messenger e vão para a roleta.
- As respostas que os corretores escrevem no CRM saem pelo **seu perfil do Facebook**, sem prefixo, com a mesma faixa "está depurando" durante o envio. Dentro dos 10 min da rodada, com pausa humana entre um envio e outro, e no limite por hora do CRM (40 de padrão desde a 1.9.9). Só a resposta automática de disponibilidade (regra sua) sai sem corretor — uma a cada 30 s quando há acumulado.
- Para desligar: no CRM, Chat Marketplace → desmarque "Sincronizar conversas do Marketplace" (só o administrador geral vê essa opção). O botão **Pausar** do popup também para tudo.
- Precisa do PC do escritório ligado e do Chrome aberto; atraso de ~1 min para chegar e para sair (mais, se a rodada estiver longa).
- **1.8.11 — 1ª carga:** conversas cuja data na lista é anterior ao dia configurado no CRM ("não importar anteriores a") nem são abertas.
- **1.8.10 — clique de verdade:** para abrir cada conversa a aba do Facebook aparece por alguns instantes (o Chrome não deixa uma aba escondida abrir a conversa) e depois o foco volta para a aba em que você estava; o clique é real (faixa "está depurando") na linha do nome do contato.
- **1.8.8 — abrir conversa:** o clique no item abre a janela de chat na mesma página (não recarrega); a extensão espera ali mesmo (até 20 s) a janela com o nome do contato e lê sem esperar a aba carregar. Se não abrir, tenta o endereço do item e manda sozinha um diagnóstico anonimizado ("open_conversation", no máximo 1 a cada 30 min).
- **1.8.7 — trava da sincronização:** cada conversa lida vai ao CRM logo em seguida (o progresso aparece no CRM durante a rodada). Conversa nova (histórico completo): até 5 por rodada; cada rodada tem ~4 min, o resto entra nas próximas. O popup mostra a etapa atual e há quanto tempo, além das contagens/caminho/erro da última rodada. Se o popup ficar parado em "sincronizando", toque em **Destravar sincronização** (a trava também se solta sozinha se a rodada morrer ou passar de 4 min sem sinal, e ao recarregar a extensão).

## Manter acordado (versão 1.9.0)

Motivo: em 22/10/2026 a extensão ficou ~11 h sem falar com o CRM com o PC ligado (Chrome/computador "dormindo").

- **A cada 1 minuto** a extensão acorda sozinha (alarme do Chrome), abre uma aba **em segundo plano** (nunca vira a aba ativa, nunca mexe na aba em que você está) com o título "mantendo o Chrome acordado" e fecha em ~2 s. Não faz isso enquanto publica um anúncio ou sincroniza o chat, nem quando não há janela do Chrome aberta (para não abrir janela nova na sua frente). **Desde a 1.9.4 essa aba abre dentro da janela de trabalho da extensão, nunca na sua janela.**
- **O que de fato impede a suspensão:** a extensão pede ao Chrome para o **computador não dormir** (`chrome.power`, modo "system" — a tela ainda pode apagar normalmente) e marca as abas que ela mesma abre (publicação, chat, diagnóstico) para o Chrome **não descartá-las** por inatividade (`autoDiscardable: false`). A aba que abre e fecha sozinha é o pedido original; o que segura mesmo é isso.
- **Desligar:** Opções › desmarque "Manter o Chrome e o computador acordados". O botão **Pausar** do popup também solta (Retomar volta a segurar). O popup mostra "Manter acordado: ligado/desligado".
- Não impede o computador de dormir se você mandar suspender, fechar a tampa do notebook ou desligar; e precisa do Chrome aberto. Se o Windows tiver "Economia de energia" agressiva, confira também lá.

## Popup

Mostra a situação (ativo, pausado, publicando), quantas publicações hoje, quando pode publicar de novo, a última verificação e o histórico. **Pausar** para tudo até você tocar em **Retomar** (Retomar também encerra a pausa de 24 h depois de você resolver a verificação no Facebook). **Verificar agora** respeita as mesmas regras de horário e limite.

## Quando o Facebook muda a tela

Os textos e rótulos que a extensão procura ficam todos em `selectors.js` (pt-BR e inglês). Se um passo começar a falhar sempre no mesmo lugar ("Campo X não encontrado"), ajuste a lista daquele campo nesse arquivo e recarregue a extensão em `chrome://extensions`.

## Atualização 100% automática (opcional — passo do dono)

Hoje a atualização é manual (zip, baixado pelo CRM em Extensões › Baixar versão). Para o Chrome atualizar sozinho: crie uma conta de desenvolvedor na Chrome Web Store (taxa única de US$ 5), envie o zip (`node scripts/gerar-zips-extensoes.mjs` na raiz do repositório) como item **Não listado** e instale pelo link da loja no lugar do "Carregar sem compactação". Cada versão enviada depois chega sozinha. A loja revisa o item e pode recusar automação do Facebook; nesse caso continue pelo zip.

## Para desenvolvedores

- Zip gerado do código: `node scripts/gerar-zips-extensoes.mjs` (raiz); `tests/extensoes-zip.test.mjs` falha se o zip não for o do código atual (versão diferente do manifest ou arquivo mudado).
- Tela Extensões do CRM: `lib/crm-link.js` (cópia idêntica no Seguidor do Instagram; teste confere) — `GET /api/extensoes/estado` e `POST /api/extensoes/saude`, mesma chave `mkp_`.

- Lógica pura testada: `lib/agenda.js` (horário, limites, intervalo, pausa, histórico), `lib/crm-api.js` (fila e retorno) e `lib/keep-awake.js` (manter acordado). Testes: `node --test tests/*.test.js` (nesta pasta).
- CRM: rotas `GET /api/marketplace/queue/next` e `POST /api/marketplace/queue/<id>/result`, chave no header `Authorization: Bearer mkp_...`. A extensão recebe só os campos do anúncio.

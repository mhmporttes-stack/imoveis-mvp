# Seguidor Instagram (extensão pessoal do Chrome)

Uso pessoal do Matheus Machado, na conta de Instagram dele. Fica fora do CRM, e nada aqui é publicado na Vercel.

## ⚠️ Aviso de risco
Automatizar seguir, deixar de seguir e mandar DM **viola os Termos de Uso do Instagram**. A conta pode receber bloqueio temporário, pedido de verificação ou, no pior caso, suspensão. Os limites padrão são baixos (15 por dia), mas isso **não elimina o risco**. Use por sua conta.

## Instalar
1. Abra `chrome://extensions` no Chrome.
2. Ligue o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e escolha a pasta `instagram-seguidor` (a que tem o `manifest.json`).
4. Fixe o ícone da extensão na barra do Chrome.
5. Entre no **instagram.com** nesse mesmo Chrome. A extensão usa essa sessão; nenhuma senha, token ou cookie fica salvo em arquivo.

## Configurar
- **Popup** (ícone da extensão): digite um `@perfil de referência` e clique em **Buscar**. A extensão lê quem segue esse perfil (até 200 por busca) e monta a fila. Ela tira repetidos, quem você já seguiu antes e quem já te segue. **Perfis privados entram na fila** (desde a 1.1.0): para eles a extensão envia a **solicitação para seguir**, que aparece como "Solicitado". Você pode trocar a referência quando quiser, e cada perfil da fila guarda de onde veio.
- O **perfil de referência** tem de ser **público**: perfil privado não mostra os seguidores, e a extensão avisa isso. Só os perfis da fila (os seguidores dele) podem ser privados. Quando a fila fica curta (menos que o limite do dia + 5), a extensão continua a lista do **mesmo** perfil sozinha, devagar: até 3 páginas de cada vez, de 20 em 20 min, só dentro da janela, até ter fila para uns 3 dias. O painel mostra quantos foram lidos e quantos foram descartados por motivo (privados, já me seguem, já seguidos antes…).
- **Painel** (botão "Painel" ou clique com o botão direito no ícone → Opções): limites diários, pular privados (desligado por padrão; ligue se não quiser mandar solicitações) ou sem foto, ligar/desligar a DM, editar o texto da DM, ver o histórico e **Exportar CSV**. Na atualização para a 1.1.0, quem estava com o padrão antigo ("pular privados" ligado) passa para o novo; se quiser, religue no painel.

## Como funciona
- **Janela:** das 05:00 às 22:00 (horário de São Paulo), todos os dias. Fora dela não faz nada.
- **Seguir:** 15 por dia (dá para mudar), espalhados por toda a janela: um a cada ~68 min, com variação aleatória de ±10%. Em perfil privado o "seguir" vira **solicitação** ("Solicitado" no histórico, no painel e no CSV) e conta no limite do dia igual.
- **Deixar de seguir:** 3 dias depois de seguir, se a pessoa não seguiu de volta. No máximo 15 por dia, intercalados com os "seguir". Só mexe em quem **a extensão** seguiu ou solicitou. Perfil privado que **não aceitou** a solicitação em 3 dias: a extensão **cancela a solicitação**; se aceitou mas não seguiu de volta, deixa de seguir. Nos dois casos ela confere no Instagram que ficou sem seguir e sem pedido pendente.
- **Boas-vindas na DM:** só quando alguém que a extensão seguiu (ou solicitou) passa a te seguir de volta, a mensagem sai **uma única vez**, de 1 a 3 min depois. Se cair fora da janela, sai na abertura seguinte. A extensão confere os seus seguidores mais recentes a cada 2 min e faz uma conferência completa a cada 30 min.
- **Pausa automática:** se o Instagram responder com limite ou bloqueio (429, "feedback_required", "challenge_required", "Please wait a few minutes"…), a extensão **para sozinha por 24 h** e mostra uma notificação do Chrome. Sem login no instagram.com ela também pausa, e volta sozinha quando você entra de novo.
- **Janela de trabalho (1.1.0, igual à extensão do Marketplace):** tudo acontece numa **janela pequena só da extensão** (520×760), com **uma única aba** do instagram.com, sempre a mesma. Ela abre **sem roubar o foco**, nunca abre nem usa aba na janela em que você está, e pode ficar atrás das outras janelas (ou minimizada). Se você fechar, ela reabre sozinha, sem foco, na próxima ação. Se não houver nenhuma janela do Chrome aberta, ela **não cria janela**: espera você abrir o Chrome. No popup, **Abrir janela de trabalho** traz a janela para a frente (é a única vez em que ela aparece na frente). A aba fixada que a versão 1.0.x abria não é mais usada: pode fechá-la.

## Para funcionar
- O **PC precisa estar ligado e o Chrome aberto**, com uma janela aberta. Se o PC dormir, ao voltar a extensão redistribui o que faltou até as 22:00, sem fazer tudo de uma vez.
- **Pausar:** botão **Pausar** no popup ou no painel. **Retomar** volta a funcionar (e também cancela uma pausa automática de 24 h, mas isso aumenta o risco). Para parar de vez: desligue a extensão em `chrome://extensions`.

## Versões
- **1.1.4** (24/10): a checagem em lote (show_many) também passou a receber a página HTML do Instagram. Agora as chamadas levam os cabeçalhos tirados da própria página aberta do Instagram (app-id, versão do site, csrf, claim); se mesmo assim vier HTML, isso vira **"checagem indisponível"** (nunca "sem sessão", nunca pausa, não gasta perfil da fila nem o limite do dia) e a extensão confere pelo **botão do perfil** (Seguir / Seguir de volta / Seguindo / Solicitado), sem clicar, no máximo 5 perfis a cada 30 min, com intervalo entre eles. Como o botão "Seguindo" não diz se a pessoa segue de volta, o **deixar de seguir fica adiado** nesse caso (nunca desfaz com quem pode ter seguido de volta).
- **1.1.3** (23/10): o Instagram passou a responder a página HTML (em vez de dados) ao pedido de seguir pela API, e o endpoint antigo saiu do ar (404). Agora, quando a API não confirma, a extensão abre o perfil na janela de trabalho e **clica no botão Seguir** (para deixar de seguir: **Seguindo → Deixar de seguir**), como uma pessoa faria, e confere no friendships/show.
- **1.1.2** (23/10): uma página de erro HTML do Instagram (ex.: 404 "Page Not Found" do endpoint antigo de seguir) não é mais confundida com "sem sessão" — a extensão não pausa mais por isso; e, antes de tentar o endpoint antigo, ela confere de novo (2,5 s depois) se o seguir já entrou.
- **1.1.1** (23/10): se a busca da referência for feita com a janela já aberta e a fila vazia, os horários de "seguir" que passaram sem ninguém na fila voltam para a agenda (antes o dia ficava em "0 seguidos" mesmo com a fila cheia).

## Manutenção
- Se o Instagram mudar a API, o painel mostra um aviso com o nome do endpoint que falhou. Todos os endpoints ficam em `instagram-api.js` (constante `ENDPOINTS`).
- Testes da lógica (sem Instagram): `node --test tests/*.test.mjs` dentro desta pasta.

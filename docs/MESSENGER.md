# Messenger da Página do Facebook — guia de ativação (MSG-1)

O que já está pronto no CRM (fase 1): as mensagens que chegam na **Página do Facebook** aparecem no **Chat Marketplace** com o selo "Messenger · Página do Facebook", viram cliente (com você, Matheus) e podem ser respondidas por lá — texto e foto. Nada é enviado sozinho.

Regra da Meta que o CRM já respeita: só dá para responder até **24 horas** depois da última mensagem do cliente (**7 dias** se ele veio de anúncio de clique para o Messenger). Passou disso, o CRM bloqueia o envio e avisa; volta a liberar quando o cliente escrever de novo.

## Antes de começar

1. Peça para aplicar a migration `20261025180000_messenger_oficial.sql` no banco (o agente aplica).
2. Você precisa ser administrador da Página do Facebook e ter acesso ao [developers.facebook.com](https://developers.facebook.com).

## Passo a passo na Meta

1. **App:** em developers.facebook.com › Meus apps, abra o app que você já usa para o WhatsApp (ou crie um, tipo "Empresa"). Pode ser o mesmo app.
2. **Messenger:** no app, em "Casos de uso" (ou "Adicionar produto"), adicione **Messenger** › "Configurações da API do Messenger".
3. **Conectar a Página:** em "Gerar tokens de acesso", clique em "Conectar" e escolha a sua Página. Aceite as permissões `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement` e `pages_show_list`.
4. **Token da Página (longa duração):** clique em "Gerar" ao lado da Página. Confira que o token tem as 4 permissões: `pages_messaging`, `pages_show_list`, `pages_manage_metadata` e `pages_read_engagement` (sem alguma delas o webhook não liga ou o envio falha). Esse token normalmente não expira enquanto você continuar admin da Página e o app mantiver a permissão (se expirar, o CRM avisa "acesso expirou" ao enviar). Copie — ele vai direto para a Vercel (passo seguinte), **nunca** para o chat.
5. **App secret:** no app, "Configurações do app" › "Básico" › "Chave secreta do aplicativo" › Mostrar. Também vai direto para a Vercel.
6. **ID da Página:** na sua Página do Facebook › "Sobre" › "Transparência da Página" (ou em "Configurações da API do Messenger", ao lado do nome da Página).
7. **Senha do webhook:** invente uma senha qualquer (ex.: uma frase longa sem espaços). Ela vai na Vercel e no passo 9.

## Na Vercel (projeto `imoveis-mvp` › Settings › Environment Variables › Production)

Cole os valores (sem aspas):

| Variável | O quê |
|---|---|
| `MESSENGER_PAGE_ID` | ID da Página (passo 6) |
| `MESSENGER_PAGE_ACCESS_TOKEN` | token da Página (passo 4) |
| `MESSENGER_APP_SECRET` | chave secreta do app (passo 5) |
| `MESSENGER_VERIFY_TOKEN` | a senha que você inventou (passo 7) |

Depois peça um novo deploy (as variáveis só valem num deploy novo). **O que você precisa me mandar:** só "variáveis coladas" — nenhum valor no chat.

## Ligar o webhook (volta na Meta, depois do deploy)

8. Em "Configurações da API do Messenger" › "Configurar webhooks":
   - **URL de retorno:** `https://www.matheusmachadoimoveis.com.br/api/webhooks/messenger`
   - **Token de verificação:** a mesma senha do passo 7.
   - Clique em "Verificar e salvar". Se der erro, confira se o deploy com as variáveis já terminou.
9. Na linha da sua Página, em "Campos do webhook", assine: **messages**, **messaging_postbacks**, **message_deliveries** e **message_reads**.

## Testar com uma conta de teste

1. Enquanto o app estiver em modo "Desenvolvimento", só pessoas com papel no app conseguem conversar. Em "Funções do app" › "Funções", adicione uma conta pessoal sua (ou de alguém da equipe) como **Testador**, e aceite o convite com essa conta.
2. Com essa conta, mande "teste" para a Página pelo Messenger.
3. Em até alguns segundos a conversa aparece no **Chat Marketplace** com o selo Messenger, e um cliente novo com a etiqueta "Messenger".
4. Responda pelo CRM. A mensagem chega no Messenger da conta de teste; quando ela ler, o CRM mostra "Lida".
5. Para clientes de verdade (fora do app), publique o app ("Ativo"). Como o app só fala com a sua própria Página, a Meta normalmente dispensa a análise do app; a verificação da empresa só é exigida se outras pessoas sem papel no app forem usar.

## Decisão pendente

- **Quem recebe as conversas do Messenger:** a roleta, igual ao Marketplace (decisão sua, 2026-10-25). O cliente vai para um corretor on-line com WhatsApp conectado; se ninguém estiver liberado, espera na fila; se o corretor não responder no prazo da roleta, passa para o próximo. A atribuição do dia que você configura no Chat Marketplace também vale.

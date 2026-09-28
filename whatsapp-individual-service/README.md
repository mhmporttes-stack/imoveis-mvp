# whatsapp-individual-service

Microsserviço separado do site (Next.js/Vercel) que mantém a sessão pessoal
de WhatsApp de cada corretor (via [Baileys](https://github.com/WhiskeySockets/Baileys),
o mesmo protocolo do WhatsApp Web — escaneia QR Code, sem precisar de número
comercial nem aprovação da Meta). Existe porque o número oficial do WhatsApp
Business API da empresa foi banido pela Meta em 28/09/2026.

Não roda na Vercel (Vercel é serverless — não segura uma conexão de socket
aberta 24h). Feito para rodar num host simples e sempre ligado: Railway.

## Como funciona (resumo)

- Um processo = um socket Baileys por corretor (`userId` = `admin_users.id`).
- As credenciais da sessão (equivalentes a estar "logado" no WhatsApp Web)
  são cifradas (AES-256-GCM) aqui mesmo e persistidas na tabela
  `whatsapp_individual_sessions.session_creds_encrypted` do Supabase — não em
  disco. Isso é o que permite o processo reiniciar (deploy novo, restart da
  Railway) sem pedir para o corretor escanear o QR de novo. Este serviço
  **não tem acesso direto ao Supabase** (não guarda `SUPABASE_SERVICE_ROLE_KEY`
  — esse segredo só existe no Next.js): ele lê/grava essas credenciais fazendo
  HTTP para `{APP_WEBHOOK_URL}/api/webhooks/whatsapp-individual/state`.
- O CRM (Next.js) nunca fala com o WhatsApp diretamente: ele chama este
  serviço por HTTP (`connect`/`status`/`disconnect`/`send`) e este serviço
  avisa o CRM por webhook quando chega mensagem ou muda o status/QR.
- Toda chamada nos dois sentidos é autenticada pelo header
  `X-Service-Secret`, comparado a `WHATSAPP_INDIVIDUAL_SERVICE_SECRET` (o
  MESMO valor dos dois lados).

## Rotas HTTP (todas exigem o header `X-Service-Secret`, exceto `/health`)

| Rota | Método | O que faz |
|---|---|---|
| `/health` | GET | Health check (sem segredo) — usado pela Railway. |
| `/sessions/:userId/connect` | POST | Inicia/retoma a sessão. Devolve `{status, qr}` — `qr` em base64 (data URL) quando `status` é `qr_required`. |
| `/sessions/:userId/status` | GET | `{status, phoneNumber, lastConnectedAt, error}`. |
| `/sessions/:userId/disconnect` | POST | Encerra a sessão e apaga as credenciais salvas. |
| `/sessions/:userId/send` | POST | Corpo `{to, text}` — envia pela sessão ativa daquele `userId`. Erro 409 se não estiver conectada. |

## Variáveis de ambiente

Veja `.env.example` — todas obrigatórias (o processo recusa subir sem
alguma delas):

- `WHATSAPP_INDIVIDUAL_SERVICE_SECRET` — mesmo valor configurado na Vercel.
- `APP_WEBHOOK_URL` — URL do site (ex.: `https://SEU-DOMINIO.vercel.app`). É
  por aqui que este serviço lê/grava tudo no banco (status, QR, credenciais)
  — ele não fala com o Supabase direto.
- `SESSION_ENCRYPTION_KEY` — 32 bytes em hex (gere com o comando no
  `.env.example`). Guarde num lugar seguro: perder essa chave = perder todas
  as sessões conectadas (todo corretor escaneia o QR de novo).
- `PORT` — definida automaticamente pela Railway; só fixe local.

## Deploy na Railway (passo a passo)

1. Crie uma conta/projeto na Railway (https://railway.app).
2. **New Project → Deploy from GitHub repo** e selecione este repositório
   (`imoveis-mvp`). Quando a Railway perguntar o diretório raiz do serviço
   ("Root Directory" / "Service Settings → Source"), aponte para
   `whatsapp-individual-service` (não a raiz do repo — lá está o site
   Next.js, que é outro deploy, na Vercel).
   - Alternativa via CLI: `npm i -g @railway/cli`, depois dentro da pasta
     `whatsapp-individual-service/`: `railway login` e `railway up`.
3. A Railway detecta o `Dockerfile` (ou o `railway.json`, que já aponta pra
   ele) e builda a imagem sozinha — não precisa configurar nada de build.
4. Em **Variables**, cole todas as variáveis do `.env.example` preenchidas
   (não copie o `.env.example` como arquivo — a Railway usa variáveis de
   ambiente do painel, não arquivo `.env`).
5. Em **Settings → Networking**, gere um domínio público (**Generate
   Domain**). A URL gerada (algo como
   `https://whatsapp-individual-service-production.up.railway.app`) é o
   endereço que o Next.js vai chamar — configure-a na Vercel como
   `WHATSAPP_INDIVIDUAL_SERVICE_URL`.
6. Confirme que subiu: `curl https://SUA-URL.up.railway.app/health` deve
   responder `{"ok":true}`.
7. Na Vercel (projeto do site), configure as variáveis de ambiente listadas
   no relatório da tarefa (`WHATSAPP_INDIVIDUAL_SERVICE_URL`,
   `WHATSAPP_INDIVIDUAL_SERVICE_SECRET`) e faça um redeploy.
8. Pronto: abra o Chat no CRM, clique em "Conectar" no indicador de WhatsApp
   e escaneie o QR com o celular do corretor (WhatsApp > Aparelhos
   conectados > Conectar um aparelho).

## Limitações desta primeira versão

- Só mensagens de **texto** (enviar e receber). Áudio/imagem/documento por
  este canal ficam para uma etapa futura.
- Um `userId` = uma sessão. Não há fila entre sessões nem múltiplos números
  por corretor.
- Sem retry automático de envio: se o `send` falhar, o Chat mostra o erro e
  preserva o texto digitado — tentar de novo é uma ação manual (mesmo padrão
  do canal oficial hoje).

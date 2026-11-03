# Salvar o Lote de SMS no Google Contatos — passo a passo do dono

Objetivo: o botão "Salvar os 50 no Google Contatos" (aba "Para enviar" do Lote de SMS) cria todos os contatos da lista na sua conta Gmail (mhmporttes@gmail.com); o iPhone sincroniza sozinho e o nome aparece na conversa de SMS. Regra: `docs/BUSINESS_RULES.md` PRO-18g. Faça uma vez só.

## 1. Google Cloud Console (https://console.cloud.google.com), logado com mhmporttes@gmail.com

1. Crie um projeto (ex.: "CRM Matheus Machado").
2. Menu "APIs e serviços" > "Biblioteca" > procure **People API** > **Ativar**.
3. "APIs e serviços" > "Tela de consentimento OAuth" (ou "Google Auth Platform"): tipo **Externo**; nome do app (ex.: "CRM Contatos"); e-mail de suporte e de contato: o seu. Em **Usuários de teste**, adicione **mhmporttes@gmail.com**.
4. Em "Escopos", adicione `.../auth/contacts` (ver, editar, baixar e excluir seus contatos).
5. **ATENÇÃO — clique em "Publicar app"** (modo Produção). App em modo "Teste" tem o acesso renovável que **expira em 7 dias** e o botão para de funcionar toda semana. App pessoal sem verificação do Google mostra o aviso "app não verificado": é normal para uso próprio; toque em "Avançado" > "Acessar (não seguro)" ao conectar.
6. "Credenciais" > "Criar credenciais" > **ID do cliente OAuth** > tipo **Aplicativo da Web**.
   - "URIs de redirecionamento autorizados": exatamente
     `https://www.matheusmachadoimoveis.com.br/api/admin/google-contacts/callback`
   - Copie o **ID do cliente** e a **chave secreta do cliente**.

## 2. Vercel (projeto `imoveis-mvp` > Settings > Environment Variables, ambiente Production)

| Variável | O que colar |
|---|---|
| `GOOGLE_CONTACTS_CLIENT_ID` | o ID do cliente |
| `GOOGLE_CONTACTS_CLIENT_SECRET` | a chave secreta do cliente |
| `GOOGLE_CONTACTS_REDIRECT_URI` | opcional; se usar, a mesma URI do passo 1.6 |

`CRM_SECRETS_ENCRYPTION_KEY` (que cifra o acesso guardado) já é usada pelo CRM; precisa estar definida. Depois, faça um novo deploy para as variáveis valerem. Nunca cole esses valores em conversa, e-mail ou arquivo do projeto.

## 3. Conectar

1. Banco: a tabela `sms_batch_google_contacts` precisa estar criada (migration `20261103130000`, aplicada por quem faz o deploy).
2. Entre no CRM com sua conta de administrador (não em "Alterar conta") > Lote de SMS > "Para enviar" > **Conectar Google** > escolha mhmporttes@gmail.com > permita o acesso a Contatos.
3. Voltando ao CRM, o botão vira **Salvar os 50 no Google Contatos**. Um toque cria todos (rótulo "SMS lote", nomes "Nome (SMS lote)"). Tocar de novo não duplica. Em alguns minutos aparecem no iPhone (Ajustes > Contatos > Contas > Gmail > Contatos ligado).

Os lotes dos corretores também gravam na SUA conta; os corretores só veem o botão depois que você conectar.

## Apagar o lote

No Google Contatos (contacts.google.com) abra o rótulo **SMS lote**, selecione tudo e exclua. (Os contatos apagados não são recriados pelo CRM.)

## Se der erro

- "Reconectar Google": o acesso expirou ou foi revogado (ou o app ficou em modo Teste). Toque em Conectar/Reconectar.
- "Google Contatos ainda não configurado": faltam as variáveis acima.
- "Falta liberar a tabela": a migration ainda não foi aplicada.

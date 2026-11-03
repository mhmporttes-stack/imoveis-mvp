# Salvar o Lote de SMS no Google Contatos

Regra: `docs/BUSINESS_RULES.md` PRO-18g. Não há nada novo para configurar: o botão usa o Google Contatos que você já conectou no CRM (o mesmo da Meta Diária).

- **Uso:** Lote de SMS > "Para enviar" > **Salvar os 50 no Google Contatos**. Um toque cria todos (nome "Nome (SMS lote)", celular +55, rótulo "SMS lote") na SUA conta Google. Tocar de novo não duplica. Cada corretor grava na conta Google dele.
- **No iPhone:** Ajustes > Contatos > Contas > Gmail > deixe **Contatos** ligado. Em alguns minutos os nomes aparecem na conversa de SMS.
- **Sem conexão:** o botão mostra "Conecte seu Google Contatos" (mesma conexão do ícone do Google no topo do painel). "Reconectar" aparece se o acesso expirou ou foi revogado. A sincronização precisa estar ligada.
- **Apagar o lote:** no Google Contatos (contacts.google.com) abra o rótulo **SMS lote**, selecione tudo e exclua. Contatos apagados não são recriados.
- **Banco:** a tabela `sms_batch_google_contacts` precisa existir (migration `20261103130000`, aplicada por quem faz o deploy); sem ela o botão avisa.

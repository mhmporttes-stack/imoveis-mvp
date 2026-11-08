# Texto para colar no Claude Code do PC do escritório (sessão Remote Control, aberta pelo celular)

Cole tudo abaixo na sessão que roda no PC:

---

Você está no PC Windows do escritório (o mesmo do serviço do WhatsApp). Objetivo: instalar o CRM aqui, como serviço do Windows, sem a Vercel.
Contexto: a Vercel bloqueou o projeto por fatura em aberto e o dono não vai pagar; o CRM passa a rodar neste PC e a ser exposto pelo túnel da Cloudflare no domínio `www.matheusmachadoimoveis.com.br`.
Quem manda é o dono, que está pelo celular. Tudo é em português, respostas curtas.

Regras:
- NUNCA imprima, cole em resposta ou grave em log valores de segredos (chaves, tokens, senhas). Só os NOMES das variáveis.
- Não mexa no serviço do WhatsApp (`MMWhatsApp`, `C:\MMWhatsApp`) nem no vigia dele.
- Para qualquer login (GitHub, Vercel, Cloudflare): use o fluxo por código/endereço que mostra um link e um código para o dono abrir no celular, e me diga o link e o código. Não peça senha.
- Ações no DNS do Registro.br e na conta da Cloudflare são do dono: me diga exatamente o que ele precisa clicar.

Faça, nesta ordem, e me diga o resultado de cada passo antes do seguinte:
1. `winget install --id GitHub.cli -e` (se faltar) e `gh auth login -h github.com -p https -w`; depois `gh auth setup-git`.
2. `gh repo clone mhmporttes-stack/imoveis-mvp C:\MMCRM\app` (crie `C:\MMCRM` antes). Leia `C:\MMCRM\app\servidor-local\GUIA-PC.md`.
3. Configuração: `npx vercel login` (código para o dono) e `npx vercel link --project imoveis-mvp --yes` dentro de `C:\MMCRM\app`, depois `npx vercel env pull C:\MMCRM\config\.env.production --environment=production --yes`. Se alguma variável vier vazia/ausente, liste só os NOMES que faltam.
4. Rode `$env:MM_NONINTERACTIVE="1"; powershell -ExecutionPolicy Bypass -File C:\MMCRM\app\servidor-local\windows\instalar-crm.ps1` (leva 5 a 10 minutos para montar).
5. Teste: `Invoke-WebRequest http://127.0.0.1:3000/ -UseBasicParsing` e me diga o status. Mostre o fim de `C:\MMCRM\logs\crm.log` se houver erro.
6. Instale o vigia (`watchdog-crm.ps1` + tarefa `MMCRM-Vigia`, comandos no guia, passo 7).
7. Pare aí e me diga o que o dono precisa fazer na Cloudflare e no Registro.br (guia, passos 4 e 5).

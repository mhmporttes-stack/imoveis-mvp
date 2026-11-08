# CRM rodando no PC do escritório (sem a Vercel)

Decisão do dono (2026-11-08): sair da Vercel (cobrança por consumo, fatura em aberto bloqueou o site) e rodar o CRM no mesmo PC do WhatsApp.
O banco (Supabase) continua na nuvem. O endereço `www.matheusmachadoimoveis.com.br` passa a chegar ao PC por um túnel da Cloudflare (grátis).

Pasta no PC: `C:\MMCRM` (`app` = código, `config` = segredos, `logs`, `ferramentas`).

## Ordem dos passos

**Passo 1 — Pegar a configuração (segredos) da Vercel.** O painel da Vercel continua abrindo mesmo com o projeto bloqueado.
Vercel › projeto `imoveis-mvp` › **Settings › Environment Variables**. Você vai colar esses valores no arquivo `C:\MMCRM\config\.env.production`
(o instalador abre o Bloco de Notas para isso). Os nomes estão em `.env.example`. Valores marcados como "Sensitive" na Vercel não aparecem:
esses precisam ser gerados de novo na origem (ex.: chave do Resend, tokens da Meta) — me diga quais faltam.

**Passo 2 — Instalar.** No navegador (logado no GitHub): `servidor-local/windows/instalar-crm.ps1` › **Raw** › copiar tudo.
No PC: crie a pasta `C:\MMCRM`, abra o Bloco de Notas, cole, **Salvar como** `C:\MMCRM\instalar-crm.ps1` (tipo "Todos os arquivos").
Botão direito no arquivo › **Executar com o PowerShell**. Ele instala Node, Git e pnpm, baixa o CRM (abre o login do GitHub),
abre o Bloco de Notas para a configuração, monta o CRM (5 a 10 min) e cria o serviço **MM CRM (site e painel)**.
Pode rodar de novo sem perder nada.

**Passo 3 — Testar no próprio PC.** Abra `http://127.0.0.1:3000` no navegador do PC: o site tem que abrir. Entre no painel com o seu login.

**Passo 4 — Cloudflare e domínio (Registro.br).**
1. Crie a conta grátis em cloudflare.com › **Add a domain** › `matheusmachadoimoveis.com.br` › plano **Free**.
2. A Cloudflare importa os registros atuais do DNS. **Confira se os de e-mail (MX, TXT/SPF, DKIM) vieram**; se faltar algum, copie do Registro.br (Painel › DNS).
3. No Registro.br: se o domínio tiver **DNSSEC**, desative antes. Depois troque os **servidores DNS** pelos dois que a Cloudflare mostrar.
4. Espera a Cloudflare dizer "Active" (de minutos a algumas horas).

**Passo 5 — Túnel.** Cloudflare › **Zero Trust › Networks › Tunnels › Create a tunnel › Cloudflared**, nome `mm-crm`.
Escolha **Windows**, copie o comando de instalação (ele traz o token) e rode no PowerShell do PC como administrador: vira serviço e liga com o Windows.
Em **Public Hostname**: hostname `www` + domínio `matheusmachadoimoveis.com.br`, serviço **HTTP** `localhost:3000`.
O endereço sem `www`: **Rules › Redirect Rules** da Cloudflare, de `matheusmachadoimoveis.com.br` para `https://www.matheusmachadoimoveis.com.br`.

**Passo 6 — Rotinas automáticas (eu faço).** As rotinas do banco (pg_cron) ainda chamam `imoveis-mvp.vercel.app`. Com o domínio no ar,
eu troco para `https://www.matheusmachadoimoveis.com.br` (com a sua aprovação) e confiro que cada rotina volta a rodar.
Webhooks da Meta/WhatsApp usam o domínio da marca e não mudam.

**Passo 7 — Vigia.** Copie `servidor-local/windows/watchdog-crm.ps1` para `C:\MMCRM\watchdog-crm.ps1` e, no PowerShell como administrador:

```
$acao = New-ScheduledTaskAction -Execute "powershell.exe" -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\MMCRM\watchdog-crm.ps1"'
$gatilho = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "MMCRM-Vigia" -Action $acao -Trigger $gatilho -User "SYSTEM" -RunLevel Highest -Force
```

Conferir: `Get-Content C:\MMCRM\logs\watchdog.log -Tail 20` (só escreve quando há falha ou reinício).

## Dia a dia

- **Atualizar o CRM** (quando houver mudança nova): `servidor-local/windows/atualizar-crm.ps1` (fica fora do ar durante o build; prefira a noite).
  Não há mais deploy automático a cada commit.
- **Log do CRM:** `C:\MMCRM\logs\crm.log`. **Reiniciar:** `Restart-Service MMCRM` (ou `Stop-Process` do processo se travar; o vigia faz isso sozinho).
- **PC:** não pode dormir nem hibernar na tomada (o instalador desliga). Use no-break e deixe o Windows Update fora do horário de trabalho.

## O que muda no código

`MM_PRODUCTION_HOST=1` (definida pelo serviço) faz o CRM se comportar como em produção: sem banco SQLite local e cookies do painel sempre seguros.
Cookies também ficam seguros atrás do túnel (`x-forwarded-proto`). Ver `lib/runtime.js`.

## Riscos conhecidos

PC desligado, sem internet ou sem luz = site, painel, formulário de captação e Atalho do SMS fora do ar. Ponto único de falha: no-break,
internet reserva e o vigia reduzem, não eliminam.

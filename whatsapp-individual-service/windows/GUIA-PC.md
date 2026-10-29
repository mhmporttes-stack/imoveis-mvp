# WhatsApp dos corretores no PC do Matheus — guia

Desde 29/10/2026 o serviço que mantém o WhatsApp dos corretores conectado roda **neste PC** (antes: Railway). O PC precisa ficar ligado e com internet 24 h. Tudo fica em `C:\MMWhatsApp` (código, configuração e log).

## Instalar (uma vez, ~15 min)

1. **Copie as variáveis do Railway, sem colar no chat:** railway.app › serviço `whatsapp-individual-service` › **Variables**. Você vai precisar de `APP_WEBHOOK_URL`, `WHATSAPP_INDIVIDUAL_SERVICE_SECRET` e `SESSION_ENCRYPTION_KEY` (a `PORT` já vem preenchida: 3100). Se o Railway não abrir mais, a `WHATSAPP_INDIVIDUAL_SERVICE_SECRET` está também na Vercel; sem a `SESSION_ENCRYPTION_KEY` antiga funciona, mas todo corretor terá de escanear o QR de novo.
2. **Rode o instalador.** Se você tem esta pasta (`whatsapp-individual-service\windows`), dê duplo clique em **INSTALAR.bat** e aceite o "Sim" do administrador. Se não tem: botão direito no Iniciar › **Terminal (Administrador)**, cole a linha abaixo e Enter:
   `irm https://raw.githubusercontent.com/mhmporttes-stack/imoveis-mvp/main/whatsapp-individual-service/windows/instalar.ps1 | iex`
3. Ele instala o Node.js, o Git e o NSSM, baixa o serviço e abre o **Bloco de Notas**: cole cada valor depois do `=` (sem espaços), salve (Ctrl+S) e **feche** o Bloco de Notas. Ele confere, cria o serviço "MM WhatsApp dos corretores" (liga sozinho com o Windows, mesmo sem login, e volta sozinho se cair) e desliga a suspensão do PC na tomada.
4. **Túnel:** crie uma conta grátis em tailscale.com (entrar com Google). Depois duplo clique em **C:\MMWhatsApp\servico\windows\TUNEL.bat**: faça o login que abrir no navegador; se pedir para liberar o "Funnel", clique em liberar. No fim ele mostra (e copia) a URL `https://….ts.net`.
5. No painel do Tailscale (login.tailscale.com/admin/machines), menu **…** deste PC › **Disable key expiry** (senão o túnel para em ~6 meses).
6. **Vercel:** projeto `imoveis-mvp` › Settings › Environment Variables › edite **`WHATSAPP_INDIVIDUAL_SERVICE_URL`** (Production) e cole a URL do passo 4. Depois Deployments › último › **Redeploy**. Não mexa na `WHATSAPP_INDIVIDUAL_SERVICE_SECRET`.
7. **Confirme:** duplo clique em **VERIFICAR.bat** — tudo verde, com `lease=leased`. No CRM, Chat › indicador do WhatsApp: os números voltam sozinhos como "Conectado" em alguns minutos (um por vez, 5–8 s entre eles). Se algum ficar em erro, clique **Conectar** naquele número.

## Cuidados

- **Não desligue nem deixe o PC dormir.** A tela pode apagar; o PC não. Ligue o PC num **nobreak**.
- **Windows Update:** em Configurações › Windows Update › Opções avançadas › **Horário ativo**, marque 6h às 23h, para ele só reiniciar de madrugada. Depois de qualquer reinício o serviço volta sozinho.
- Log: `C:\MMWhatsApp\logs\servico.log` (gira sozinho a cada 10 MB). A configuração (`C:\MMWhatsApp\config\.env`) tem segredos: não envie esse arquivo para ninguém.
- **Nunca deixe o Railway e o PC ligados ao mesmo tempo de propósito.** Se acontecer, o "lease" impede os dois de conectarem juntos: o segundo fica esperando (`lease=waiting` no VERIFICAR).

## Voltar para o Railway (se precisar)

1. Pare o serviço do PC: Terminal (Administrador) › `C:\MMWhatsApp\ferramentas\nssm.exe stop MMWhatsApp` (para não voltar no próximo boot: `... set MMWhatsApp Start SERVICE_DEMAND_START`).
2. Religue o serviço no Railway (plano pago) e espere `/health` responder.
3. Na Vercel, volte `WHATSAPP_INDIVIDUAL_SERVICE_URL` para a URL do Railway e faça Redeploy.

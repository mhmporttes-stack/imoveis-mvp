# Tunel publico fixo e gratuito (Tailscale Funnel): a Vercel chama https://<pc>.<rede>.ts.net -> localhost:PORT.
# So a porta do servico e exposta. Todas as rotas exigem o header X-Service-Secret, exceto GET /health
# (so estado do lease, nada sensivel). Guia: GUIA-PC.md.
. (Join-Path $PSScriptRoot "comum.ps1")
Assert-Admin $PSCommandPath

$Port = Get-ServicePort
$ts = Get-Tailscale
if (-not $ts) {
  Say "Instalando Tailscale (winget)..." Cyan
  winget install --id Tailscale.Tailscale -e --silent --accept-package-agreements --accept-source-agreements
  $ts = Get-Tailscale
}
if (-not $ts) { Fail "Tailscale nao ficou disponivel. Instale por https://tailscale.com/download/windows e rode o TUNEL de novo." }

# --unattended: continua conectado com o Windows bloqueado/sem ninguem logado (obrigatorio para servidor 24 h).
Say "Entrando no Tailscale. Se abrir o navegador, faca login (Google) e volte aqui." Cyan
& $ts up --unattended
if ($LASTEXITCODE -ne 0) { Fail "tailscale up falhou. Rode o TUNEL de novo." }

$ErrorActionPreference = "Continue"  # o tailscale escreve avisos no stderr
for ($i = 1; $i -le 3; $i++) {
  $out = (& $ts funnel --bg --https=443 "localhost:$Port" 2>&1) | Out-String
  Write-Host $out
  if ($out -match "(https://login\.tailscale\.com\S+)") {
    Say "O Tailscale pediu para liberar o Funnel nesta rede. Abrindo o link; clique em liberar/Enable e volte aqui." Yellow
    Start-Process $Matches[1]
    Read-Host "Depois de liberar no navegador, aperte Enter"
    continue
  }
  if ($LASTEXITCODE -eq 0) { break }
}

$ErrorActionPreference = "Stop"
& $ts funnel status
$url = Get-FunnelUrl
if (-not $url) { Fail "Nao consegui ler a URL do Tailscale." }
Say ""
Say "URL do servico (cole na Vercel em WHATSAPP_INDIVIDUAL_SERVICE_URL):" Green
Say "    $url" Green
Set-Clipboard -Value $url
Say "(ja copiada para a area de transferencia)"
Say ""
Say "IMPORTANTE: em https://login.tailscale.com/admin/machines, no menu (...) deste PC, clique em 'Disable key expiry'." Yellow
Say "Sem isso o tunel para sozinho em ~180 dias." Yellow
try {
  $h = Invoke-RestMethod -UseBasicParsing -Uri "$url/health" -TimeoutSec 20
  Say ("Teste pela internet ok: lease=" + $h.lease) Green
} catch { Say "O teste pela internet ainda falhou (o certificado pode levar 1-2 min na 1a vez). Rode o VERIFICAR daqui a pouco." Yellow }
Read-Host "Aperte Enter para fechar"

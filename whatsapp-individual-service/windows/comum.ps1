# Funcoes usadas por tunel.ps1, verificar.ps1 e atualizar.ps1 (instalar.ps1 e independente: pode rodar via irm|iex).
# Arquivo SEM acentos de proposito (PowerShell 5.1).
$ErrorActionPreference = "Stop"
$Base = "C:\MMWhatsApp"
$App = Join-Path $Base "servico"
$EnvFile = Join-Path $Base "config\.env"
$Logs = Join-Path $Base "logs"
$Nssm = Join-Path $Base "ferramentas\nssm.exe"
$ServiceName = "MMWhatsApp"

function Say($msg, $color = "White") { Write-Host $msg -ForegroundColor $color }
function Fail($msg) { Say "ERRO: $msg" Red; Read-Host "Aperte Enter para fechar"; exit 1 }

function Assert-Admin($scriptPath) {
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($isAdmin) { return }
  Start-Process powershell -Verb RunAs -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$scriptPath`"")
  exit 0
}

# Le so a porta do .env (nunca mostra os outros valores).
function Get-ServicePort {
  if (Test-Path $EnvFile) {
    foreach ($line in Get-Content -Encoding UTF8 $EnvFile) {
      $t = $line.Trim([char]0xFEFF).Trim()
      if ($t -match "^PORT\s*=\s*(\d+)") { return $Matches[1] }
    }
  }
  return "3100"
}

function Get-Tailscale {
  $c = Get-Command tailscale -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $p = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
  if (Test-Path $p) { return $p }
  return $null
}

# URL publica do Funnel: https://<nome-do-pc>.<rede>.ts.net (sem barra no fim)
function Get-FunnelUrl {
  $ts = Get-Tailscale
  if (-not $ts) { return $null }
  try {
    $st = (& $ts status --json) | Out-String | ConvertFrom-Json
    $dns = [string]$st.Self.DNSName
    if ($dns) { return "https://" + $dns.TrimEnd(".") }
  } catch { }
  return $null
}

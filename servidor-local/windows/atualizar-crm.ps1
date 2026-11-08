# Atualiza o CRM neste PC com o codigo mais novo do GitHub (substitui o deploy automatico da Vercel).
# Fica fora do ar durante o build (5 a 10 minutos): prefira a noite. Arquivo SEM acentos de proposito (PowerShell 5.1).
$ErrorActionPreference = "Stop"
$App = "C:\MMCRM\app"
$ServiceName = "MMCRM"
$Nssm = "C:\MMCRM\ferramentas\nssm.exe"
function Say($msg, $color = "White") { Write-Host $msg -ForegroundColor $color }
function Fail($msg) { Say "ERRO: $msg" Red; Read-Host "Aperte Enter para fechar"; exit 1 }
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Start-Process powershell -Verb RunAs -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`""); exit 0 }
if (-not (Test-Path (Join-Path $App ".git"))) { Fail "CRM nao instalado. Rode primeiro o instalar-crm.ps1." }
Push-Location $App
& git checkout -- public/sw.js 2>$null
$before = (& git rev-parse HEAD).Trim()
& git pull --ff-only
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "git pull falhou." }
$after = (& git rev-parse HEAD).Trim()
if ($before -eq $after) { Say "Nada novo no GitHub. Nada a fazer." Green; Pop-Location; Read-Host "Aperte Enter para fechar"; exit 0 }
Say "Parando o CRM para montar a versao nova..." Yellow
& $Nssm stop $ServiceName | Out-Null
$env:NEXT_TELEMETRY_DISABLED = "1"
& pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { Pop-Location; & $Nssm start $ServiceName | Out-Null; Fail "pnpm install falhou." }
& pnpm build
$code = $LASTEXITCODE
& git checkout -- public/sw.js 2>$null
Pop-Location
if ($code -ne 0) { & $Nssm start $ServiceName | Out-Null; Fail "pnpm build falhou (codigo $code). O CRM voltou com o que estava montado." }
& $Nssm start $ServiceName | Out-Null
Say "CRM atualizado e no ar." Green
Read-Host "Aperte Enter para fechar"

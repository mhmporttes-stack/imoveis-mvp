# Instala o CRM (site + painel) neste PC Windows como servico, sem a Vercel (dono, 2026-11-08). Guia: servidor-local/GUIA-PC.md.
# Arquivo SEM acentos de proposito (o PowerShell 5.1 le .ps1 sem BOM como ANSI).
# Pode ser rodado de novo quantas vezes quiser: nao apaga o .env.production.

$ErrorActionPreference = "Stop"
$Base = "C:\MMCRM"
$App = Join-Path $Base "app"
$ConfigDir = Join-Path $Base "config"
$EnvFile = Join-Path $ConfigDir ".env.production"
$Logs = Join-Path $Base "logs"
$Tools = Join-Path $Base "ferramentas"
$ServiceName = "MMCRM"
$Repo = "https://github.com/mhmporttes-stack/imoveis-mvp.git"
$Port = "3000"

function Say($msg, $color = "White") { Write-Host $msg -ForegroundColor $color }
# MM_NONINTERACTIVE=1 (quando o Claude Code roda o script no PC): nunca para esperando Enter nem abre o Bloco de Notas.
function Pause-End { if ($env:MM_NONINTERACTIVE -ne "1") { Read-Host "Aperte Enter para fechar" } }
function Fail($msg) { Say "ERRO: $msg" Red; Pause-End; exit 1 }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  if ($PSCommandPath) {
    Start-Process powershell -Verb RunAs -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
    exit 0
  }
  Fail "Abra o PowerShell como Administrador (botao direito > Executar como administrador) e rode de novo."
}

function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") }
function Winget-Install($id) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Fail "winget nao encontrado. Atualize o 'Instalador de Aplicativo' pela Microsoft Store e rode de novo." }
  Say "Instalando $id (winget)..." Cyan
  winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements
  Refresh-Path
}

# 1) Node.js 20.9 ou mais novo (o Next.js 16 exige)
function Node-Ok {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
  $p = ((& node -v) -replace "^v", "").Split(".")
  return ([int]$p[0] -gt 20) -or ([int]$p[0] -eq 20 -and [int]$p[1] -ge 9)
}
Refresh-Path
if (-not (Node-Ok)) { Winget-Install "OpenJS.NodeJS.22" }
if (-not (Node-Ok)) { Fail "Node.js 20.9 ou mais novo nao ficou disponivel. Feche esta janela e rode de novo." }
$NodeExe = (Get-Command node).Source
Say ("Node.js ok: " + (& node -v)) Green

# 2) Git e pnpm
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Winget-Install "Git.Git" }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail "Git nao ficou disponivel. Feche esta janela e rode de novo." }
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Say "Instalando pnpm..." Cyan
  & npm.cmd install -g pnpm
  Refresh-Path
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { Fail "pnpm nao ficou disponivel. Feche esta janela e rode de novo." }

New-Item -ItemType Directory -Force -Path $Base, $ConfigDir, $Logs, $Tools | Out-Null
& icacls $ConfigDir /inheritance:r /grant:r "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" | Out-Null

# 3) Codigo do CRM (o repositorio e privado: na primeira vez o Git abre o navegador para voce entrar no GitHub)
if (-not (Test-Path (Join-Path $App ".git"))) {
  Say "Baixando o CRM do GitHub (pode abrir uma janela de login do GitHub)..." Cyan
  & git clone --depth 1 --single-branch $Repo $App
  if ($LASTEXITCODE -ne 0) { Fail "Nao consegui baixar o codigo. Entre no GitHub quando a janela abrir e rode de novo." }
} else {
  Say "Codigo ja baixado: atualizando..." Cyan
  Push-Location $App
  & git checkout -- public/sw.js 2>$null
  & git pull --ff-only
  Pop-Location
}

# 4) Configuracao (segredos): fica fora da pasta do codigo; so Administradores e o sistema leem
if (-not (Test-Path $EnvFile)) { Copy-Item (Join-Path $App ".env.example") $EnvFile }
function Read-EnvFile {
  $map = @{}
  foreach ($line in Get-Content -Encoding UTF8 $EnvFile) {
    $t = $line.Trim([char]0xFEFF).Trim()
    if ($t -eq "" -or $t.StartsWith("#") -or -not $t.Contains("=")) { continue }
    $i = $t.IndexOf("=")
    $map[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim().Trim('"')
  }
  return $map
}
function Env-Problems {
  $e = Read-EnvFile
  $p = @()
  foreach ($k in @("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SITE_URL", "CRM_SECRETS_ENCRYPTION_KEY", "ADMIN_TWO_FACTOR_COOKIE_SECRET")) { if (-not $e[$k]) { $p += "$k esta vazia" } }
  return $p
}
while ((Env-Problems).Count -gt 0) {
  Say ""; Say "Falta preencher o arquivo de configuracao:" Yellow
  Env-Problems | ForEach-Object { Say "  - $_" Yellow }
  if ($env:MM_NONINTERACTIVE -eq "1") { Fail "Preencha $EnvFile (ex.: vercel env pull) e rode de novo." }
  Say "O Bloco de Notas vai abrir. Cole os valores copiados da Vercel, salve (Ctrl+S) e FECHE o Bloco de Notas." Yellow
  Start-Process notepad.exe -ArgumentList "`"$EnvFile`"" -Wait
}
Say "Configuracao ok (valores nao sao mostrados)." Green
Copy-Item -Force $EnvFile (Join-Path $App ".env.production")

# 5) Dependencias e build (o build leva de 5 a 10 minutos)
Push-Location $App
$env:NEXT_TELEMETRY_DISABLED = "1"
Say "Instalando dependencias (pnpm install)..." Cyan
& pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "pnpm install falhou. Veja as mensagens acima." }
Say "Montando o CRM (pnpm build, de 5 a 10 minutos)..." Cyan
& pnpm build
$buildCode = $LASTEXITCODE
& git checkout -- public/sw.js 2>$null
Pop-Location
if ($buildCode -ne 0) { Fail "pnpm build falhou (codigo $buildCode). Veja as mensagens acima." }

# 6) Servico do Windows via NSSM (inicia com o Windows, reinicia se cair). So escuta neste PC (127.0.0.1): quem expoe e o tunel.
$Nssm = Join-Path $Tools "nssm.exe"
if (-not (Test-Path $Nssm)) {
  $whats = "C:\MMWhatsApp\ferramentas\nssm.exe"
  if (Test-Path $whats) { Copy-Item $whats $Nssm }
  else {
    $found = Get-Command nssm -ErrorAction SilentlyContinue
    if (-not $found) { try { Winget-Install "NSSM.NSSM"; $found = Get-Command nssm -ErrorAction SilentlyContinue } catch { $found = $null } }
    if ($found) { Copy-Item $found.Source $Nssm }
  }
}
if (-not (Test-Path $Nssm)) { Fail "Nao consegui obter o NSSM." }
$exists = (& sc.exe query $ServiceName) -match "SERVICE_NAME"
if ($exists) { & $Nssm stop $ServiceName | Out-Null }
else { & $Nssm install $ServiceName $NodeExe | Out-Null }
$log = Join-Path $Logs "crm.log"
& $Nssm set $ServiceName Application $NodeExe | Out-Null
& $Nssm set $ServiceName AppParameters "node_modules\next\dist\bin\next start -H 127.0.0.1 -p $Port" | Out-Null
& $Nssm set $ServiceName AppDirectory $App | Out-Null
& $Nssm set $ServiceName AppEnvironmentExtra "NODE_ENV=production" "MM_PRODUCTION_HOST=1" "NEXT_TELEMETRY_DISABLED=1" | Out-Null
& $Nssm set $ServiceName DisplayName "MM CRM (site e painel)" | Out-Null
& $Nssm set $ServiceName Description "CRM Matheus Machado Corretor de Imoveis (servidor-local/GUIA-PC.md)" | Out-Null
& $Nssm set $ServiceName Start SERVICE_DELAYED_AUTO_START | Out-Null
& $Nssm set $ServiceName AppStdout $log | Out-Null
& $Nssm set $ServiceName AppStderr $log | Out-Null
& $Nssm set $ServiceName AppRotateFiles 1 | Out-Null
& $Nssm set $ServiceName AppRotateOnline 1 | Out-Null
& $Nssm set $ServiceName AppRotateBytes 10485760 | Out-Null
& $Nssm set $ServiceName AppExit Default Restart | Out-Null
& $Nssm set $ServiceName AppRestartDelay 10000 | Out-Null
& $Nssm start $ServiceName | Out-Null

& powercfg /change standby-timeout-ac 0
& powercfg /change hibernate-timeout-ac 0

Start-Sleep -Seconds 10
try {
  $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/" -TimeoutSec 30
  Say ("CRM no ar neste PC (http://127.0.0.1:$Port, status " + $r.StatusCode + ").") Green
} catch { Say "O CRM ainda nao respondeu. Veja o log: $log" Yellow }
Say ""
Say "Pronto. Proximo passo: o tunel da Cloudflare (GUIA-PC.md, passo 5)." Green
Pause-End

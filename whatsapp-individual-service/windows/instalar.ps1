# Instala o servico do WhatsApp dos corretores (whatsapp-individual-service) neste PC Windows.
# Regra do dono (2026-10-29): o servico roda no PC do dono, ligado 24 h. Guia: GUIA-PC.md.
# Arquivo SEM acentos de proposito (o PowerShell 5.1 le .ps1 sem BOM como ANSI).
# Pode ser rodado de novo quantas vezes quiser: nao apaga o .env nem as sessoes (elas ficam no banco, cifradas).

$ErrorActionPreference = "Stop"
$Base = "C:\MMWhatsApp"
$App = Join-Path $Base "servico"
$ConfigDir = Join-Path $Base "config"
$EnvFile = Join-Path $ConfigDir ".env"
$Logs = Join-Path $Base "logs"
$Tools = Join-Path $Base "ferramentas"
$ServiceName = "MMWhatsApp"
$Repo = "mhmporttes-stack/imoveis-mvp"
$Branch = "main"

function Say($msg, $color = "White") { Write-Host $msg -ForegroundColor $color }
function Fail($msg) { Say "ERRO: $msg" Red; Read-Host "Aperte Enter para fechar"; exit 1 }

# 1) Administrador (o .bat chama este script; aqui ele se reabre como admin se precisar)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  if ($PSCommandPath) {
    Start-Process powershell -Verb RunAs -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
    exit 0
  }
  Fail "Abra o PowerShell como Administrador (botao direito > Executar como administrador) e rode de novo."
}

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

function Winget-Install($id) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Fail "winget nao encontrado. Atualize o 'Instalador de Aplicativo' pela Microsoft Store e rode de novo." }
  Say "Instalando $id (winget)..." Cyan
  winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements
  Refresh-Path
}

# 2) Node.js: precisa >= 20.6 (engines >=20 + --env-file). Railway usava Node 20; instalamos o 22 (LTS em manutencao).
function Node-Ok {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return $false }
  $v = (& node -v) -replace "^v", ""
  $p = $v.Split(".")
  return ([int]$p[0] -gt 20) -or ([int]$p[0] -eq 20 -and [int]$p[1] -ge 6)
}
Refresh-Path
if (-not (Node-Ok)) { Winget-Install "OpenJS.NodeJS.22" }
if (-not (Node-Ok)) { Fail "Node.js 20.6 ou mais novo nao ficou disponivel. Feche esta janela e rode o INSTALAR de novo." }
$NodeExe = (Get-Command node).Source
Say ("Node.js ok: " + (& node -v)) Green

# 3) Git: a dependencia libsignal do Baileys vem do GitHub (o npm ci precisa do git).
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Winget-Install "Git.Git" }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail "Git nao ficou disponivel. Feche esta janela e rode o INSTALAR de novo." }

# 4) Codigo do servico em C:\MMWhatsApp\servico (o MESMO codigo do repositorio; nada duplicado)
function Get-GithubFolder($path, $dest) {
  $items = Invoke-RestMethod -UseBasicParsing -Headers @{ "User-Agent" = "mm-whatsapp-pc" } -Uri "https://api.github.com/repos/$Repo/contents/$path`?ref=$Branch"
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  foreach ($it in $items) {
    if ($it.type -eq "dir") { Get-GithubFolder $it.path (Join-Path $dest $it.name) }
    elseif ($it.type -eq "file") { Invoke-WebRequest -UseBasicParsing -Uri $it.download_url -OutFile (Join-Path $dest $it.name) }
  }
}
function Copy-ServiceCode($src, $dest) {
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  foreach ($name in @("src", "windows")) {
    if (Test-Path (Join-Path $dest $name)) { Remove-Item -Recurse -Force (Join-Path $dest $name) }
    Copy-Item -Recurse -Force (Join-Path $src $name) (Join-Path $dest $name)
  }
  foreach ($name in @("package.json", "package-lock.json", "README.md")) { Copy-Item -Force (Join-Path $src $name) (Join-Path $dest $name) }
}
$here = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { "" }
if ($here -and (Test-Path (Join-Path $here "src\server.js")) -and ((Resolve-Path $here).Path -ne $App)) {
  Say "Copiando o servico de $here ..." Cyan
  Copy-ServiceCode $here $App
} elseif (-not (Test-Path (Join-Path $App "src\server.js"))) {
  Say "Baixando o servico do GitHub ($Branch)..." Cyan
  $tmp = Join-Path $env:TEMP ("mmwa-" + [guid]::NewGuid().ToString("N"))
  Get-GithubFolder "whatsapp-individual-service" $tmp
  Copy-ServiceCode $tmp $App
  Remove-Item -Recurse -Force $tmp
}

# 5) Dependencias (mesma forma do Dockerfile: npm ci --omit=dev, libsignal por https sem mexer no git do PC)
Say "Instalando dependencias (npm ci --omit=dev)..." Cyan
$env:GIT_CONFIG_COUNT = "1"
$env:GIT_CONFIG_KEY_0 = "url.https://github.com/.insteadOf"
$env:GIT_CONFIG_VALUE_0 = "ssh://git@github.com/"
Push-Location $App
& npm.cmd ci --omit=dev  # npm.cmd: o npm.ps1 e bloqueado pela politica de execucao do Windows
$npmCode = $LASTEXITCODE
Pop-Location
if ($npmCode -ne 0) { Fail "npm ci falhou (codigo $npmCode). Veja as mensagens acima." }

# 6) .env local (fora da pasta do codigo; so Administradores e o sistema leem)
New-Item -ItemType Directory -Force -Path $ConfigDir, $Logs, $Tools | Out-Null
& icacls $ConfigDir /inheritance:r /grant:r "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" | Out-Null
if (-not (Test-Path $EnvFile)) { Copy-Item (Join-Path $App "windows\.env.exemplo") $EnvFile }

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
  foreach ($k in @("APP_WEBHOOK_URL", "WHATSAPP_INDIVIDUAL_SERVICE_SECRET", "SESSION_ENCRYPTION_KEY", "PORT")) { if (-not $e[$k]) { $p += "$k esta vazia" } }
  if ($e["SESSION_ENCRYPTION_KEY"] -and $e["SESSION_ENCRYPTION_KEY"] -notmatch "^[0-9a-fA-F]{64}$") { $p += "SESSION_ENCRYPTION_KEY precisa ter 64 caracteres (0-9, a-f)" }
  if ($e["APP_WEBHOOK_URL"] -and $e["APP_WEBHOOK_URL"] -notmatch "^https://") { $p += "APP_WEBHOOK_URL precisa comecar com https://" }
  if ($e["WHATSAPP_LEASE_DISABLED"] -eq "true") { $p += "WHATSAPP_LEASE_DISABLED=true desliga a protecao contra duas instancias: apague essa linha" }
  return $p
}
while ((Env-Problems).Count -gt 0) {
  Say "" ; Say "Falta preencher o arquivo de configuracao:" Yellow
  Env-Problems | ForEach-Object { Say "  - $_" Yellow }
  Say "O Bloco de Notas vai abrir. Cole os valores copiados do Railway (Variables), salve (Ctrl+S) e FECHE o Bloco de Notas." Yellow
  Start-Process notepad.exe -ArgumentList "`"$EnvFile`"" -Wait
}
$envMap = Read-EnvFile
$Port = $envMap["PORT"]
Say "Configuracao ok (valores nao sao mostrados)." Green

# 7) Servico do Windows via NSSM (inicia com o Windows sem login, reinicia se cair, log rotativo,
#    e no "parar" manda Ctrl+C = SIGINT -> encerramento gracioso: grava credenciais e libera o lease).
$Nssm = Join-Path $Tools "nssm.exe"
if (-not (Test-Path $Nssm)) {
  $found = Get-Command nssm -ErrorAction SilentlyContinue
  if (-not $found) { try { Winget-Install "NSSM.NSSM"; $found = Get-Command nssm -ErrorAction SilentlyContinue } catch { $found = $null } }
  if ($found) { Copy-Item $found.Source $Nssm }
  else {
    Say "Baixando NSSM de nssm.cc..." Cyan
    $zip = Join-Path $env:TEMP "nssm-2.24.zip"
    Invoke-WebRequest -UseBasicParsing -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $zip
    $x = Join-Path $env:TEMP "nssm-2.24-x"
    Expand-Archive -Force $zip $x
    Copy-Item (Join-Path $x "nssm-2.24\win64\nssm.exe") $Nssm
  }
}
if (-not (Test-Path $Nssm)) { Fail "Nao consegui obter o NSSM." }

$exists = (& sc.exe query $ServiceName) -match "SERVICE_NAME"
if ($exists) { & $Nssm stop $ServiceName | Out-Null }
else { & $Nssm install $ServiceName $NodeExe | Out-Null }
$log = Join-Path $Logs "servico.log"
& $Nssm set $ServiceName Application $NodeExe | Out-Null
& $Nssm set $ServiceName AppParameters "--env-file=$EnvFile src\server.js" | Out-Null
& $Nssm set $ServiceName AppDirectory $App | Out-Null
& $Nssm set $ServiceName AppEnvironmentExtra "NODE_ENV=production" | Out-Null
& $Nssm set $ServiceName DisplayName "MM WhatsApp dos corretores" | Out-Null
& $Nssm set $ServiceName Description "whatsapp-individual-service do CRM Matheus Machado (GUIA-PC.md)" | Out-Null
& $Nssm set $ServiceName Start SERVICE_DELAYED_AUTO_START | Out-Null
& $Nssm set $ServiceName AppStdout $log | Out-Null
& $Nssm set $ServiceName AppStderr $log | Out-Null
& $Nssm set $ServiceName AppRotateFiles 1 | Out-Null
& $Nssm set $ServiceName AppRotateOnline 1 | Out-Null
& $Nssm set $ServiceName AppRotateBytes 10485760 | Out-Null
& $Nssm set $ServiceName AppExit Default Restart | Out-Null
& $Nssm set $ServiceName AppRestartDelay 10000 | Out-Null
& $Nssm set $ServiceName AppStopMethodConsole 40000 | Out-Null
& $Nssm start $ServiceName | Out-Null

# 8) PC nao pode dormir na tomada (senao o WhatsApp de todos cai)
Say "Desligando suspensao/hibernacao automatica na tomada (a tela ainda pode apagar)..." Yellow
& powercfg /change standby-timeout-ac 0
& powercfg /change hibernate-timeout-ac 0

# 9) Conferencia
Start-Sleep -Seconds 8
try {
  $h = Invoke-RestMethod -UseBasicParsing -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 10
  Say ("Servico no ar. lease=" + $h.lease + " serving=" + $h.serving) Green
  if ($h.lease -eq "waiting") { Say "Aguardando outra instancia (Railway?) liberar. Se o Railway estiver ligado, desligue-o." Yellow }
} catch { Say "O servico ainda nao respondeu. Veja o log: $log" Yellow }
Say ""
Say "Pronto. Proximo passo: TUNEL.bat (GUIA-PC.md, passo 4)." Green
Read-Host "Aperte Enter para fechar"

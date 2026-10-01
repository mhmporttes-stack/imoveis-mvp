<#
  coletar.ps1 - coleta SOMENTE LEITURA do estado deste PC (Windows PowerShell 5.1+).
  Nao altera nada, nao le conteudo de arquivos pessoais, nao le historico/senhas/cookies do Chrome.
  Uso:
    powershell -NoProfile -ExecutionPolicy Bypass -File coletar.ps1 -Modulo tudo -Rotulo baseline
  Modulos: hardware, memoria, disco, rede, inicializacao, chrome, claude, tudo
  Saida: JSON em -Saida (padrao: %USERPROFILE%\.claude\agent-memory\performance-pc\snapshots\<data>_<rotulo>.json)
  e caminho do arquivo impresso no final. Arquivo ASCII de proposito (PS 5.1 le UTF-8 sem BOM como ANSI).
#>
param(
  [ValidateSet('hardware','memoria','disco','rede','inicializacao','chrome','claude','tudo')]
  [string]$Modulo = 'tudo',
  [string]$Rotulo = 'diag',
  [string]$Saida
)
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

function MB($b) { if ($null -eq $b) { $null } else { [math]::Round($b / 1MB, 1) } }
function GB($b) { if ($null -eq $b) { $null } else { [math]::Round($b / 1GB, 2) } }
function DirMB($p) {
  if (-not (Test-Path -LiteralPath $p)) { return $null }
  $s = (Get-ChildItem -LiteralPath $p -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  MB $s
}
function Mascara($t) {
  if (-not $t) { return $null }
  $t = $t -replace '(?i)(token|key|secret|password|authorization|bearer)([=\s:]+)\S+', '$1$2***'
  if ($t.Length -gt 160) { $t = $t.Substring(0,160) + '...' }
  $t
}
function Cpu2($ids) {
  # CPU% por processo em janela de ~2s
  $a = @{}; Get-Process -Id $ids -ErrorAction SilentlyContinue | ForEach-Object { $a[$_.Id] = $_.CPU }
  Start-Sleep -Seconds 2
  $r = @{}; $n = [Environment]::ProcessorCount
  Get-Process -Id $ids -ErrorAction SilentlyContinue | ForEach-Object {
    if ($a.ContainsKey($_.Id) -and $null -ne $_.CPU) { $r[$_.Id] = [math]::Round((($_.CPU - $a[$_.Id]) / 2) * 100 / $n, 1) }
  }
  $r
}

$out = [ordered]@{
  rotulo = $Rotulo
  coletadoEm = (Get-Date).ToString('s')
  modulo = $Modulo
  admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
$todos = ($Modulo -eq 'tudo')
$procs = Get-CimInstance Win32_Process

# ---------------- HARDWARE / WINDOWS / ENERGIA ----------------
if ($todos -or $Modulo -eq 'hardware') {
  $os = Get-CimInstance Win32_OperatingSystem
  $cs = Get-CimInstance Win32_ComputerSystem
  $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
  $bios = Get-CimInstance Win32_BIOS
  $gpus = Get-CimInstance Win32_VideoController | ForEach-Object {
    [ordered]@{ nome = $_.Name; driver = $_.DriverVersion; driverData = "$($_.DriverDate)"; vramGB = GB $_.AdapterRAM; resolucao = "$($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution)@$($_.CurrentRefreshRate)Hz" }
  }
  $gpuUso = $null
  try {
    $gpuUso = [math]::Round(((Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction Stop).CounterSamples | Where-Object { $_.CookedValue -gt 0 } | Measure-Object CookedValue -Sum).Sum, 1)
  } catch {}
  $nvidia = $null
  if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
    $nvidia = (& nvidia-smi --query-gpu=temperature.gpu,utilization.gpu,memory.used,memory.total --format=csv,noheader 2>$null) -join ' | '
  }
  $temp = $null
  try {
    $temp = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop | ForEach-Object { [math]::Round(($_.CurrentTemperature / 10) - 273.15, 1) }
  } catch {}
  $plano = (powercfg /getactivescheme) -join ' '
  $bat = Get-CimInstance Win32_Battery | Select-Object -First 1
  $hotfix = Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 3 | ForEach-Object { "$($_.HotFixID) $($_.InstalledOn.ToString('yyyy-MM-dd'))" }
  $wu = Get-Service wuauserv, UsoSvc, BITS | ForEach-Object { "$($_.Name)=$($_.Status)/$($_.StartType)" }
  $driversRuins = Get-CimInstance Win32_PnPEntity | Where-Object { $_.ConfigManagerErrorCode -ne 0 } | ForEach-Object { "$($_.Name) (erro $($_.ConfigManagerErrorCode))" }
  $out.hardware = [ordered]@{
    fabricante = $cs.Manufacturer; modelo = $cs.Model
    bios = "$($bios.SMBIOSBIOSVersion) $($bios.ReleaseDate)"
    windows = "$($os.Caption) $($os.Version) build $($os.BuildNumber)"
    uptimeHoras = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1)
    cpu = [ordered]@{ nome = $cpu.Name.Trim(); nucleos = $cpu.NumberOfCores; logicos = $cpu.NumberOfLogicalProcessors; clockMaxMHz = $cpu.MaxClockSpeed; clockAtualMHz = $cpu.CurrentClockSpeed; usoPct = $cpu.LoadPercentage }
    gpus = @($gpus); gpuUsoPct = $gpuUso; nvidiaSmi = $nvidia
    temperaturasC_ACPI = @($temp)
    energia = [ordered]@{ plano = $plano; bateria = $(if ($bat) { "$($bat.EstimatedChargeRemaining)% status $($bat.BatteryStatus)" } else { 'sem bateria (desktop)' }) }
    windowsUpdate = [ordered]@{ servicos = @($wu); ultimosHotfix = @($hotfix) }
    driversComErro = @($driversRuins)
  }
}

# ---------------- MEMORIA ----------------
if ($todos -or $Modulo -eq 'memoria') {
  $os = Get-CimInstance Win32_OperatingSystem
  $totalKB = $os.TotalVisibleMemorySize; $livreKB = $os.FreePhysicalMemory
  $pf = Get-CimInstance Win32_PageFileUsage | ForEach-Object { [ordered]@{ arquivo = $_.Name; tamanhoMB = $_.AllocatedBaseSize; usoMB = $_.CurrentUsage; picoMB = $_.PeakUsage } }
  $pfAuto = (Get-CimInstance Win32_ComputerSystem).AutomaticManagedPagefile
  $pages = $null
  try { $pages = [math]::Round((Get-Counter '\Memory\Pages/sec' -ErrorAction Stop).CounterSamples[0].CookedValue, 1) } catch {}
  $comp = $null
  try { $comp = Get-MMAgent | ForEach-Object { "MemoryCompression=$($_.MemoryCompression) PageCombining=$($_.PageCombining)" } } catch {}
  $top = Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 15 | ForEach-Object {
    [ordered]@{ nome = $_.ProcessName; pid = $_.Id; wsMB = MB $_.WorkingSet64; privadoMB = MB $_.PrivateMemorySize64 }
  }
  $grupos = Get-Process | Group-Object ProcessName | ForEach-Object {
    [ordered]@{ nome = $_.Name; qtd = $_.Count; wsMB = MB (($_.Group | Measure-Object WorkingSet64 -Sum).Sum) }
  } | Sort-Object { $_.wsMB } -Descending | Select-Object -First 12
  $out.memoria = [ordered]@{
    totalGB = [math]::Round($totalKB / 1MB, 2); livreGB = [math]::Round($livreKB / 1MB, 2)
    usoPct = [math]::Round(100 * ($totalKB - $livreKB) / $totalKB, 1)
    pagefile = @($pf); pagefileGerenciadoPeloWindows = $pfAuto
    paginasPorSeg = $pages; compressao = $comp
    topProcessos = @($top); topPorNome = @($grupos)
    moduloRAM = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object { "$(GB $_.Capacity)GB $($_.Speed)MHz $($_.Manufacturer)" })
  }
}

# ---------------- DISCO ----------------
if ($todos -or $Modulo -eq 'disco') {
  $vols = Get-Volume | Where-Object { $_.DriveLetter } | ForEach-Object {
    [ordered]@{ letra = $_.DriveLetter; fs = $_.FileSystem; totalGB = GB $_.Size; livreGB = GB $_.SizeRemaining; livrePct = $(if ($_.Size) { [math]::Round(100 * $_.SizeRemaining / $_.Size, 1) }); saude = "$($_.HealthStatus)" }
  }
  $fis = Get-PhysicalDisk | ForEach-Object {
    $rel = $_ | Get-StorageReliabilityCounter
    [ordered]@{ nome = $_.FriendlyName; tipo = "$($_.MediaType)"; barramento = "$($_.BusType)"; saude = "$($_.HealthStatus)"; tamanhoGB = GB $_.Size; desgastePct = $rel.Wear; tempC = $rel.Temperature; errosLeitura = $rel.ReadErrorsTotal; errosEscrita = $rel.WriteErrorsTotal }
  }
  $fila = $null; $lat = $null
  try {
    $c = Get-Counter '\PhysicalDisk(_Total)\Avg. Disk Queue Length', '\PhysicalDisk(_Total)\Avg. Disk sec/Transfer', '\PhysicalDisk(_Total)\% Disk Time' -ErrorAction Stop
    $fila = [math]::Round($c.CounterSamples[0].CookedValue, 2); $lat = [math]::Round($c.CounterSamples[1].CookedValue * 1000, 2)
    $busy = [math]::Round($c.CounterSamples[2].CookedValue, 1)
  } catch {}
  $temp = @{
    tempUsuarioMB = DirMB $env:TEMP
    windowsTempMB = DirMB "$env:SystemRoot\Temp"
    windowsUpdateCacheMB = DirMB "$env:SystemRoot\SoftwareDistribution\Download"
    crashDumpsMB = DirMB "$env:LOCALAPPDATA\CrashDumps"
    lixeiraMB = $null
  }
  $trim = $null
  try { $trim = (fsutil behavior query DisableDeleteNotify) -join ' ' } catch {}
  $out.disco = [ordered]@{ volumes = @($vols); fisicos = @($fis); filaMedia = $fila; latenciaMs = $lat; ocupadoPct = $busy; limpavel = $temp; trim = $trim }
}

# ---------------- REDE ----------------
if ($todos -or $Modulo -eq 'rede') {
  $ad = Get-NetAdapter | Where-Object Status -eq 'Up' | ForEach-Object {
    [ordered]@{ nome = $_.Name; tipo = $_.InterfaceDescription; velocidade = $_.LinkSpeed; media = "$($_.PhysicalMediaType)" }
  }
  $cfg = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway }
  $gw = $cfg | Select-Object -First 1 -ExpandProperty IPv4DefaultGateway | Select-Object -ExpandProperty NextHop
  $dns = ($cfg | ForEach-Object { $_.DNSServer.ServerAddresses }) | Select-Object -Unique
  function Ping3($alvo) {
    if (-not $alvo) { return $null }
    $r = Test-Connection -ComputerName $alvo -Count 4 -ErrorAction SilentlyContinue
    if (-not $r) { return [ordered]@{ alvo = $alvo; perda = '100%' } }
    $t = $r | ForEach-Object { if ($_.ResponseTime) { $_.ResponseTime } else { $_.Latency } }
    [ordered]@{ alvo = $alvo; mediaMs = [math]::Round(($t | Measure-Object -Average).Average, 1); maxMs = ($t | Measure-Object -Maximum).Maximum; perda = "$([math]::Round(100 * (4 - @($r).Count) / 4))%" }
  }
  function DnsMs($nome) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $ok = Resolve-DnsName $nome -Type A -DnsOnly -NoHostsFile -ErrorAction SilentlyContinue
    $sw.Stop()
    [ordered]@{ nome = $nome; ms = $sw.ElapsedMilliseconds; resolveu = [bool]$ok }
  }
  $sites = 'claude.ai', 'api.anthropic.com', 'chatgpt.com', 'www.google.com'
  $tcp = $sites | ForEach-Object {
    $t = Test-NetConnection -ComputerName $_ -Port 443 -WarningAction SilentlyContinue
    [ordered]@{ host = $_; tcp443 = $t.TcpTestSucceeded; rttMs = $t.PingReplyDetails.RoundtripTime }
  }
  $ret = $null
  try { $ret = (Get-NetTCPConnection -State Established | Measure-Object).Count } catch {}
  $wifi = $null
  try { $wifi = (netsh wlan show interfaces) -join "`n" -replace '(?m)^\s*(BSSID|GUID|Physical address|Endere.o f.sico).*$', '' } catch {}
  $prox = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings').ProxyEnable
  $out.rede = [ordered]@{
    adaptadores = @($ad); gateway = $gw; dns = @($dns); proxyHabilitado = $prox
    pingGateway = Ping3 $gw; ping1111 = Ping3 '1.1.1.1'; ping8888 = Ping3 '8.8.8.8'
    dnsResolucao = @($sites | ForEach-Object { DnsMs $_ }); tcp443 = @($tcp)
    conexoesTcpEstabelecidas = $ret; wifi = $wifi
  }
}

# ---------------- INICIALIZACAO ----------------
if ($todos -or $Modulo -eq 'inicializacao') {
  $runKeys = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'
  $run = foreach ($k in $runKeys) {
    $p = Get-ItemProperty $k
    if ($p) { $p.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { [ordered]@{ chave = $k -replace 'HKCU:|HKLM:', ''; escopo = $k.Substring(0,4); nome = $_.Name; comando = Mascara "$($_.Value)" } } }
  }
  $pastas = @("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup", "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp") | ForEach-Object { Get-ChildItem $_ -File -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName } }
  $tarefas = Get-ScheduledTask | Where-Object { $_.State -ne 'Disabled' -and $_.Triggers | Where-Object { $_.CimClass.CimClassName -match 'Logon|Boot' } } |
    Where-Object { $_.TaskPath -notmatch '^\\Microsoft\\Windows\\' } | ForEach-Object { "$($_.TaskPath)$($_.TaskName)" }
  $srv = Get-CimInstance Win32_Service | Where-Object { $_.StartMode -eq 'Auto' -and $_.State -ne 'Running' } | ForEach-Object { "$($_.Name) ($($_.State))" }
  $srvTerceiros = Get-CimInstance Win32_Service | Where-Object { $_.StartMode -eq 'Auto' -and $_.State -eq 'Running' -and $_.PathName -notmatch 'System32|SysWOW64|Windows Defender|WindowsApps' } | ForEach-Object { "$($_.Name): $(Mascara $_.PathName)" }
  $bootMs = $null
  try {
    $e = Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-Diagnostics-Performance/Operational'; Id = 100 } -MaxEvents 5
    $bootMs = $e | ForEach-Object { $x = [xml]$_.ToXml(); [ordered]@{ quando = $_.TimeCreated.ToString('s'); bootMs = ($x.Event.EventData.Data | Where-Object Name -eq 'BootTime').'#text'; mainPathMs = ($x.Event.EventData.Data | Where-Object Name -eq 'MainPathBootTime').'#text' } }
  } catch {}
  $out.inicializacao = [ordered]@{
    runKeys = @($run); pastasStartup = @($pastas); tarefasLogonTerceiros = @($tarefas)
    servicosAutoParados = @($srv); servicosTerceirosRodando = @($srvTerceiros); ultimosBoots = @($bootMs)
    obs = 'Para impacto por item: Get-CimInstance Win32_StartupCommand e Gerenciador de Tarefas > Inicializar (impacto). Autoruns (Sysinternals) so se ja instalado.'
  }
}

# ---------------- CHROME ----------------
if ($todos -or $Modulo -eq 'chrome') {
  $ch = Get-Process chrome -ErrorAction SilentlyContinue
  $ids = @($ch | ForEach-Object { $_.Id })
  $cpu = if ($ids.Count) { Cpu2 $ids } else { @{} }
  $lista = foreach ($p in ($procs | Where-Object { $_.Name -eq 'chrome.exe' })) {
    $tipo = if ($p.CommandLine -match '--type=([\w-]+)') { $Matches[1] } else { 'browser' }
    $gp = $ch | Where-Object Id -eq $p.ProcessId
    $ext = if ($p.CommandLine -match '--extension-process') { $true } else { $false }
    [ordered]@{ pid = $p.ProcessId; ppid = $p.ParentProcessId; tipo = $tipo; extensao = $ext; wsMB = MB $gp.WorkingSet64; cpuPct = $cpu[[int]$p.ProcessId] }
  }
  $porTipo = $lista | Group-Object { $_.tipo } | ForEach-Object { [ordered]@{ tipo = $_.Name; qtd = $_.Count; wsMB = [math]::Round(($_.Group | Measure-Object wsMB -Sum).Sum, 1); cpuPct = [math]::Round(($_.Group | Measure-Object cpuPct -Sum).Sum, 1) } }
  $pidsVivos = @($procs | ForEach-Object { $_.ProcessId })
  # orfao = processo filho (renderer/gpu/utility) cujo pai ja nao existe
  $orfaosReais = $lista | Where-Object { $_.tipo -ne 'browser' -and ($pidsVivos -notcontains $_.ppid) }
  $base = "$env:LOCALAPPDATA\Google\Chrome\User Data"
  $perfis = Get-ChildItem $base -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' } | ForEach-Object {
    $extDir = Join-Path $_.FullName 'Extensions'
    $extNomes = @()
    if (Test-Path $extDir) {
      $extNomes = Get-ChildItem $extDir -Directory | ForEach-Object {
        $v = Get-ChildItem $_.FullName -Directory | Sort-Object Name -Descending | Select-Object -First 1
        $m = if ($v) { Get-Content (Join-Path $v.FullName 'manifest.json') -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json }
        $nome = "$($m.name)"; if ($nome -like '__MSG_*') { $nome = "$($_.Name) (nome localizado)" }
        $nome
      }
    }
    [ordered]@{ perfil = $_.Name; extensoes = @($extNomes); qtdExtensoes = @($extNomes).Count; cacheMB = DirMB "$($_.FullName)\Cache"; codeCacheMB = DirMB "$($_.FullName)\Code Cache"; gpuCacheMB = DirMB "$($_.FullName)\GPUCache"; totalPerfilMB = DirMB $_.FullName }
  }
  $ls = $null
  try { $ls = Get-Content "$base\Local State" -Raw | ConvertFrom-Json } catch {}
  $hw = $null
  if ($ls) { $hw = [ordered]@{ hardwareAccelerationModeEnabled = $ls.hardware_acceleration_mode_previous; efficiencyMode = $ls.performance_tuning.high_efficiency_mode.state; memorySaver = $ls.performance_tuning.high_efficiency_mode } }
  $crashes = $null
  $cd = "$base\Crashpad\reports"
  if (Test-Path $cd) { $crashes = (Get-ChildItem $cd -File | Where-Object LastWriteTime -gt (Get-Date).AddDays(-14) | Measure-Object).Count }
  $evt = $null
  try { $evt = (Get-WinEvent -FilterHashtable @{ LogName = 'Application'; ProviderName = 'Application Error'; StartTime = (Get-Date).AddDays(-14) } -MaxEvents 200 | Where-Object { $_.Message -match 'chrome\.exe' } | Measure-Object).Count } catch {}
  $ver = (Get-Item "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" -ErrorAction SilentlyContinue).VersionInfo.ProductVersion
  $debugPort = $null
  try { $debugPort = [bool](Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction Stop) } catch { $debugPort = $false }
  $out.chrome = [ordered]@{
    versao = $ver; processos = $lista.Count; porTipo = @($porTipo)
    totalWsMB = [math]::Round(($lista | Measure-Object wsMB -Sum).Sum, 1)
    top5 = @($lista | Sort-Object { $_.wsMB } -Descending | Select-Object -First 5)
    possiveisOrfaos = @($orfaosReais).Count
    perfis = @($perfis); aceleracao = $hw
    crashpad14d = $crashes; erros14dEventLog = $evt; depuracaoRemota9222Ativa = $debugPort
    obs = 'Nao le URLs, historico, cookies nem senhas. Abas e traces: usar Chrome DevTools MCP (ver .claude/skills/diagnosticar-chrome).'
  }
}

# ---------------- CLAUDE / CLAUDE CODE / CHATGPT ----------------
if ($todos -or $Modulo -eq 'claude') {
  $alvo = $procs | Where-Object { $_.Name -match '^(claude|ChatGPT|Codex)\.exe$' -or ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'claude|mcp|@anthropic|codex') -or ($_.CommandLine -match 'claude-code|\\claude\\') }
  $ids = @($alvo | ForEach-Object { $_.ProcessId })
  $cpu = if ($ids.Count) { Cpu2 $ids } else { @{} }
  $vivos = @($procs | ForEach-Object { $_.ProcessId })
  $lista = foreach ($p in $alvo) {
    $gp = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
    [ordered]@{
      pid = $p.ProcessId; ppid = $p.ParentProcessId; nome = $p.Name
      paiVivo = ($vivos -contains $p.ParentProcessId)
      idadeMin = $(if ($p.CreationDate) { [math]::Round(((Get-Date) - $p.CreationDate).TotalMinutes) })
      wsMB = MB $gp.WorkingSet64; cpuPct = $cpu[[int]$p.ProcessId]; cmd = Mascara $p.CommandLine
    }
  }
  $orf = $lista | Where-Object { -not $_.paiVivo -and $_.nome -eq 'node.exe' }
  $cl = "$env:USERPROFILE\.claude"
  $pastas = 'projects', 'file-history', 'shell-snapshots', 'session-env', 'telemetry', 'cache', 'plugins' | ForEach-Object { [ordered]@{ pasta = $_; mb = DirMB "$cl\$_" } }
  $mcps = @()
  try {
    $j = Get-Content "$env:USERPROFILE\.claude.json" -Raw | ConvertFrom-Json
    $mcps = @($j.mcpServers.PSObject.Properties.Name)
  } catch {}
  $desk = @("$env:APPDATA\Claude", "$env:LOCALAPPDATA\AnthropicClaude", "$env:LOCALAPPDATA\Packages") | Where-Object { $_ -notmatch 'Packages' } | ForEach-Object { [ordered]@{ pasta = $_; mb = DirMB $_ } }
  $logs = Get-ChildItem "$env:APPDATA\Claude\logs" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 3 | ForEach-Object { "$($_.Name) $(MB $_.Length)MB" }
  $out.claude = [ordered]@{
    processos = @($lista); qtd = $lista.Count
    totalWsMB = [math]::Round(($lista | Measure-Object wsMB -Sum).Sum, 1)
    nodeOrfaos = @($orf).Count
    pastasDotClaude = @($pastas); mcpsUsuario = @($mcps); desktop = @($desk); logsRecentes = @($logs)
    nodeInstalado = [bool](Get-Command node -ErrorAction SilentlyContinue)
    obs = 'ChatGPT: avaliado via Chrome (modulo chrome) e app desktop, se existir (entra em processos).'
  }
}

# ---------------- SALVAR ----------------
if (-not $Saida) {
  $dir = Join-Path $env:USERPROFILE '.claude\agent-memory\performance-pc\snapshots'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $Saida = Join-Path $dir ("{0}_{1}.json" -f (Get-Date -Format 'yyyy-MM-dd_HHmm'), ($Rotulo -replace '[^\w-]', '_'))
}
$out | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Saida -Encoding UTF8
Write-Output "SNAPSHOT: $Saida"

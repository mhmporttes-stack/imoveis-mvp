<#
  comparar.ps1 - compara dois snapshots JSON do coletar.ps1 (ANTES x DEPOIS). SOMENTE LEITURA.
  Uso: powershell -NoProfile -ExecutionPolicy Bypass -File comparar.ps1 -Antes <a.json> -Depois <b.json>
  Sem parametros: compara os dois snapshots mais recentes da pasta padrao.
#>
param([string]$Antes, [string]$Depois)
$dir = Join-Path $env:USERPROFILE '.claude\agent-memory\performance-pc\snapshots'
if (-not $Antes -or -not $Depois) {
  $f = Get-ChildItem $dir -Filter *.json | Sort-Object LastWriteTime -Descending | Select-Object -First 2
  if ($f.Count -lt 2) { Write-Output 'Precisa de ao menos 2 snapshots.'; exit 1 }
  $Depois = $f[0].FullName; $Antes = $f[1].FullName
}
$a = Get-Content $Antes -Raw | ConvertFrom-Json
$b = Get-Content $Depois -Raw | ConvertFrom-Json

function Get-Path($o, $p) { foreach ($k in $p -split '\.') { if ($null -eq $o) { return $null }; $o = $o.$k }; $o }
# caminho | rotulo | menor_e_melhor
$metricas = @(
  @('hardware.cpu.usoPct', 'CPU uso %', $true), @('hardware.uptimeHoras', 'Uptime (h)', $null),
  @('memoria.usoPct', 'RAM uso %', $true), @('memoria.livreGB', 'RAM livre GB', $false), @('memoria.paginasPorSeg', 'Paginas/seg', $true),
  @('disco.ocupadoPct', 'Disco ocupado %', $true), @('disco.latenciaMs', 'Disco latencia ms', $true), @('disco.filaMedia', 'Disco fila', $true),
  @('disco.limpavel.tempUsuarioMB', 'Temp usuario MB', $true), @('disco.limpavel.windowsUpdateCacheMB', 'Cache WU MB', $true),
  @('rede.pingGateway.mediaMs', 'Ping gateway ms', $true), @('rede.ping1111.mediaMs', 'Ping 1.1.1.1 ms', $true), @('rede.ping8888.mediaMs', 'Ping 8.8.8.8 ms', $true),
  @('rede.conexoesTcpEstabelecidas', 'Conexoes TCP', $null),
  @('chrome.processos', 'Chrome processos', $true), @('chrome.totalWsMB', 'Chrome RAM MB', $true), @('chrome.possiveisOrfaos', 'Chrome orfaos', $true),
  @('claude.qtd', 'Claude/Node processos', $true), @('claude.totalWsMB', 'Claude RAM MB', $true), @('claude.nodeOrfaos', 'Node orfaos', $true)
)
Write-Output ("ANTES : {0} ({1})" -f $a.rotulo, $a.coletadoEm)
Write-Output ("DEPOIS: {0} ({1})" -f $b.rotulo, $b.coletadoEm)
Write-Output ''
'{0,-26}{1,14}{2,14}{3,12}  {4}' -f 'Metrica', 'Antes', 'Depois', 'Delta', 'Veredito'
foreach ($m in $metricas) {
  $x = Get-Path $a $m[0]; $y = Get-Path $b $m[0]
  if ($null -eq $x -or $null -eq $y) { continue }
  $d = [math]::Round(([double]$y - [double]$x), 2)
  $v = if ($null -eq $m[2] -or $d -eq 0) { '=' } elseif (($d -lt 0) -eq $m[2]) { 'melhorou' } else { 'piorou' }
  '{0,-26}{1,14}{2,14}{3,12}  {4}' -f $m[1], $x, $y, $d, $v
}
# inicializacao: itens adicionados/removidos
$ra = @($a.inicializacao.runKeys | ForEach-Object { $_.nome }); $rb = @($b.inicializacao.runKeys | ForEach-Object { $_.nome })
$add = $rb | Where-Object { $ra -notcontains $_ }; $rem = $ra | Where-Object { $rb -notcontains $_ }
Write-Output ''
Write-Output ("Inicializacao (Run): +{0} / -{1}" -f @($add).Count, @($rem).Count)
if ($add) { Write-Output ("  adicionados: " + ($add -join ', ')) }
if ($rem) { Write-Output ("  removidos:   " + ($rem -join ', ')) }
Write-Output 'Obs: variacoes pequenas (<10%) em CPU/rede sao ruido; repita a medicao antes de concluir.'

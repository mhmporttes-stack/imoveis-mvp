# Vigia do CRM neste PC (dono, 2026-11-08). Roda a cada 1 minuto (Agendador de Tarefas). Se http://127.0.0.1:3000/ nao responder
# 3 vezes seguidas, reinicia o servico MMCRM (mata o processo se estiver preso). Registro em C:\MMCRM\logs\watchdog.log.
# Arquivo SEM acentos de proposito (PowerShell 5.1).
$ErrorActionPreference = "Stop"
$Url = "http://127.0.0.1:3000/"
$State = "C:\MMCRM\logs\watchdog.state"
$Log = "C:\MMCRM\logs\watchdog.log"
$ServiceName = "MMCRM"
$MaxFails = 3
function Write-Log($msg) { Add-Content -Path $Log -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg) }
try {
  $ok = $false
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 20
    $ok = ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
  } catch { $ok = $false }
  $fails = 0
  if (Test-Path $State) {
    $raw = [string](Get-Content $State -Raw -ErrorAction SilentlyContinue)
    $parsed = 0
    if ([int]::TryParse($raw.Trim(), [ref]$parsed) -and $parsed -ge 0) { $fails = $parsed }
  }
  if ($ok) {
    if ($fails -gt 0) { Write-Log "voltou ao normal (falhas seguidas: $fails)" }
    Set-Content -Path $State -Value 0
    exit 0
  }
  $fails++
  Set-Content -Path $State -Value $fails
  Write-Log "CRM sem resposta ($fails/$MaxFails)"
  if ($fails -ge $MaxFails) {
    $cim = Get-CimInstance Win32_Service -Filter ("Name='{0}'" -f $ServiceName)
    if ($null -eq $cim) { Write-Log "servico nao encontrado"; exit 1 }
    Write-Log ("reiniciando servico (estado {0})" -f $cim.State)
    if ($cim.ProcessId -gt 0) { Stop-Process -Id $cim.ProcessId -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 3 }
    Start-Service -Name $ServiceName -ErrorAction Stop
    Set-Content -Path $State -Value 0
    Write-Log "servico iniciado"
  }
} catch {
  Write-Log ("erro do vigia: " + $_.Exception.Message)
  exit 1
}

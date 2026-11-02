# Vigia do WhatsApp no computador do escritório (dono, 2026-11-02).
# Roda a cada 1 minuto (Agendador de Tarefas). Se http://localhost:3100/health não responder 3 vezes seguidas, reinicia o
# serviço "MM WhatsApp dos corretores" (NSSM). Registro em C:\MMWhatsApp\watchdog.log. Não envia nada, não mexe em sessões.
$ErrorActionPreference = "Stop"
$Url = "http://localhost:3100/health"
$State = "C:\MMWhatsApp\watchdog.state"
$Log = "C:\MMWhatsApp\watchdog.log"
$MaxFails = 3
function Write-Log($msg) { Add-Content -Path $Log -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg) }
try {
  $ok = $false
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 8
    $ok = ($r.StatusCode -eq 200 -and $r.Content -match '"ok"\s*:\s*true')
  } catch { $ok = $false }
  $fails = 0
  if (Test-Path $State) { $fails = [int](Get-Content $State -ErrorAction SilentlyContinue) }
  if ($ok) {
    if ($fails -gt 0) { Write-Log "voltou ao normal (falhas seguidas: $fails)" }
    Set-Content -Path $State -Value 0
    exit 0
  }
  $fails++
  Set-Content -Path $State -Value $fails
  Write-Log "health sem resposta ($fails/$MaxFails)"
  if ($fails -ge $MaxFails) {
    $svc = Get-Service | Where-Object { $_.DisplayName -like "MM WhatsApp*" -or $_.Name -eq "MMWhatsApp" } | Select-Object -First 1
    if ($null -eq $svc) { Write-Log "serviço não encontrado"; exit 1 }
    Write-Log ("reiniciando serviço {0} (status {1})" -f $svc.Name, $svc.Status)
    Restart-Service -Name $svc.Name -Force
    Set-Content -Path $State -Value 0
    Write-Log "serviço reiniciado"
  }
} catch {
  Write-Log ("erro do vigia: " + $_.Exception.Message)
  exit 1
}

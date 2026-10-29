# Confere o servico: Windows (NSSM), resposta local, resposta pelo tunel, segredo exigido, fim do log.
. (Join-Path $PSScriptRoot "comum.ps1")
Assert-Admin $PSCommandPath
$Port = Get-ServicePort

Say "== Servico do Windows ($ServiceName)" Cyan
if (Test-Path $Nssm) { & $Nssm status $ServiceName } else { Say "NSSM nao encontrado: rode o INSTALAR." Red }

function Check($label, $base) {
  try {
    $h = Invoke-RestMethod -UseBasicParsing -Uri "$base/health" -TimeoutSec 15
    $color = if ($h.serving) { "Green" } else { "Yellow" }
    Say ("$label OK  lease=" + $h.lease + "  atendendo=" + $h.serving) $color
    if ($h.lease -eq "waiting") { Say "  Outra instancia (Railway?) tem o lease. Se o Railway estiver ligado, desligue-o." Yellow }
    if ($h.lease -eq "unleased") { Say "  Rodando SEM lease (CRM inacessivel?). Confira APP_WEBHOOK_URL e a internet." Yellow }
  } catch { Say "$label FALHOU: $($_.Exception.Message)" Red }
}

Say "== Local" Cyan
Check "Local (127.0.0.1:$Port)" "http://127.0.0.1:$Port"

Say "== Tunel" Cyan
$url = Get-FunnelUrl
if ($url) {
  Check "Tunel ($url)" $url
  # Sem o segredo, rota de sessao TEM que responder 401 (prova que o segredo esta sendo exigido).
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "$url/sessions/verificacao/status" -TimeoutSec 15 | Out-Null
    Say "ATENCAO: rota de sessao respondeu SEM segredo!" Red
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 401) { Say "Segredo exigido pelo tunel: OK (401 sem segredo)" Green } else { Say "Rota de sessao sem segredo respondeu $code (esperado 401)" Yellow }
  }
} else { Say "Tailscale nao configurado: rode o TUNEL." Yellow }

Say "== Ultimas linhas do log ($Logs\servico.log)" Cyan
if (Test-Path "$Logs\servico.log") { Get-Content "$Logs\servico.log" -Tail 30 } else { Say "Sem log ainda." Yellow }
Read-Host "Aperte Enter para fechar"

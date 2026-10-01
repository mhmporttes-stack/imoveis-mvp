<#
  limpar-temp.ps1 - limpeza SEGURA de temporarios do usuario. Padrao = DRY-RUN (so lista o que seria apagado).
  Uso: ... -File limpar-temp.ps1            (simulacao)
       ... -File limpar-temp.ps1 -Aplicar   (apaga)
  Escopo: %TEMP% do usuario, apenas ARQUIVOS com mais de -Dias dias (padrao 7), nada em uso (falhas sao ignoradas).
  NAO toca: Documentos, Downloads, Lixeira, Registro, Windows\Temp, SoftwareDistribution, perfil do Chrome.
#>
param([switch]$Aplicar, [int]$Dias = 7)
$ErrorActionPreference = 'SilentlyContinue'
$raiz = $env:TEMP
if (-not $raiz -or $raiz.Length -lt 10) { Write-Output 'TEMP invalido, abortando.'; exit 1 }
$corte = (Get-Date).AddDays(-$Dias)
$arqs = Get-ChildItem -LiteralPath $raiz -Recurse -Force -File | Where-Object { $_.LastWriteTime -lt $corte }
$mb = [math]::Round((($arqs | Measure-Object Length -Sum).Sum) / 1MB, 1)
Write-Output ("{0}: {1} arquivos, {2} MB (mais antigos que {3} dias) em {4}" -f $(if ($Aplicar) { 'APLICANDO' } else { 'DRY-RUN' }), @($arqs).Count, $mb, $Dias, $raiz)
if ($Aplicar) {
  $ok = 0
  foreach ($f in $arqs) { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue; if (-not (Test-Path -LiteralPath $f.FullName)) { $ok++ } }
  Get-ChildItem -LiteralPath $raiz -Recurse -Force -Directory | Sort-Object FullName -Descending | Where-Object { -not (Get-ChildItem -LiteralPath $_.FullName -Force) } | Remove-Item -Force -ErrorAction SilentlyContinue
  Write-Output ("Removidos: {0} de {1}" -f $ok, @($arqs).Count)
}

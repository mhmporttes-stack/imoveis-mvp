# Vigia do WhatsApp (reinicia sozinho quando travar)

Instalar UMA vez no computador do escritório (PowerShell como Administrador):

1. Copie `watchdog.ps1` para `C:\MMWhatsApp\watchdog.ps1`.
2. Crie a tarefa que roda a cada 1 minuto, como SYSTEM:

```powershell
$acao = New-ScheduledTaskAction -Execute "powershell.exe" -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\MMWhatsApp\watchdog.ps1"'
$gatilho = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "MMWhatsApp-Vigia" -Action $acao -Trigger $gatilho -User "SYSTEM" -RunLevel Highest -Force
```

3. Conferir: `Get-Content C:\MMWhatsApp\watchdog.log -Tail 20` (só escreve quando há falha ou reinício).

Remover: `Unregister-ScheduledTask -TaskName "MMWhatsApp-Vigia" -Confirm:$false`.

O que faz: testa `http://localhost:3100/health`; 3 falhas seguidas (3 minutos) = reinicia o serviço "MM WhatsApp dos corretores".
Não envia mensagem, não apaga sessão, não mexe no Tailscale.

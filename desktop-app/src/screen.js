// Liga/desliga o monitor pelo Windows (WM_SYSCOMMAND / SC_MONITORPOWER), por um script FIXO do PowerShell, sem
// dependência externa. Nada vindo da página entra no script: só "off" ou "on".
"use strict";

const { execFile } = require("node:child_process");

const HEADER = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -TypeDefinition @'",
  "using System;",
  "using System.Runtime.InteropServices;",
  "public static class MmMonitor {",
  '  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);',
  '  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);',
  "}",
  "'@"
];
// PostMessage (e não SendMessage) para a mensagem a todas as janelas: SendMessage espera cada janela responder e pode
// travar o script se alguma estiver parada. 2 = desligar; -1 = ligar (+ um movimento mínimo do mouse, que é o que
// realmente acorda o monitor nas versões novas do Windows).
const SCRIPTS = Object.freeze({
  off: [...HEADER, "[void][MmMonitor]::PostMessage([IntPtr]0xFFFF, 0x0112, [IntPtr]0xF170, [IntPtr]2)"].join("\n"),
  on: [
    ...HEADER,
    "[void][MmMonitor]::PostMessage([IntPtr]0xFFFF, 0x0112, [IntPtr]0xF170, [IntPtr](-1))",
    "[MmMonitor]::mouse_event(1, 0, 1, 0, [UIntPtr]::Zero)",
    "[MmMonitor]::mouse_event(1, 0, -1, 0, [UIntPtr]::Zero)"
  ].join("\n")
});

function setMonitorPower(state) {
  const script = SCRIPTS[state];
  if (!script) return Promise.reject(new Error("estado_invalido"));
  if (process.platform !== "win32") return Promise.reject(new Error("so_no_windows"));
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-EncodedCommand", encoded],
      { windowsHide: true, timeout: 15000 },
      (error) => (error ? reject(error) : resolve())
    );
  });
}

module.exports = { setMonitorPower };

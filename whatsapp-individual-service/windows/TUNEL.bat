@echo off
rem Duplo clique: liga o tunel publico (Tailscale Funnel) e mostra a URL para a Vercel.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tunel.ps1"

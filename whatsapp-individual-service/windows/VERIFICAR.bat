@echo off
rem Duplo clique: confere se o servico responde (local e pelo tunel) e mostra o fim do log.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0verificar.ps1"

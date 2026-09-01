@echo off
setlocal
cd /d "%~dp0"
title Anvil stoppen
echo Anvil beenden...

taskkill /IM Anvil.exe /F >nul 2>&1
taskkill /IM electron.exe /F >nul 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$pids = Get-NetTCPConnection -LocalPort 8080,7845,7847,7848 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; ^
   foreach ($p in $pids) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }; ^
   Get-CimInstance Win32_Process -Filter \"name='node.exe'\" -ErrorAction SilentlyContinue | ^
     Where-Object { $_.CommandLine -match 'vite.js|with-app-env|companion\\\\server' } | ^
     ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

echo Fertig.
timeout /t 2 >nul

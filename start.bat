@echo off
setlocal
cd /d "%~dp0"
title Anvil

where node >nul 2>&1
if errorlevel 1 (
  echo Einmalig Node.js LTS: https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
  echo Erster Start: install.bat laeuft jetzt...
  call "%~dp0install.bat" /q
  if not exist "node_modules\vite\bin\vite.js" exit /b 1
)

if not exist "node_modules\electron\package.json" (
  echo Electron laden...
  call npm install electron --save --ignore-scripts=false
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron-Binary herunterladen...
  call npm install-scripts approve electron 2>nul
  if exist "node_modules\electron\install.js" (
    call node "node_modules\electron\install.js"
  )
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron.exe fehlt. In diesem Ordner:
  echo   npm install-scripts approve electron
  echo   node node_modules\electron\install.js
  pause
  exit /b 1
)

if exist "scripts\brand-electron.mjs" (
  node "scripts\brand-electron.mjs" 2>nul
)

set EXE=%~dp0node_modules\electron\dist\Anvil.exe
if not exist "%EXE%" set EXE=%~dp0node_modules\electron\dist\electron.exe

tasklist /FI "IMAGENAME eq Anvil.exe" 2>nul | find /I "Anvil.exe" >nul
if not errorlevel 1 (
  echo Anvil laeuft bereits — Fenster nach vorn.
  start "" /D "%~dp0" "%EXE%" .
  exit /b 0
)
tasklist /FI "IMAGENAME eq electron.exe" 2>nul | find /I "electron.exe" >nul
if not errorlevel 1 (
  echo Anvil laeuft bereits — Fenster nach vorn.
  start "" /D "%~dp0" "%EXE%" .
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$pids = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; ^
   foreach ($p in $pids) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }" >nul 2>&1

echo Anvil startet...
start "" /D "%~dp0" "%EXE%" .
exit

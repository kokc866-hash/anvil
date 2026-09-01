@echo off
setlocal
cd /d "%~dp0"
title Anvil einrichten

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js LTS fehlt. Einmalig von https://nodejs.org installieren, dann dieses Skript nochmal.
  pause
  exit /b 1
)

echo Pakete laden. Beim ersten Mal ein paar Minuten.
call npm install --ignore-scripts=false
if errorlevel 1 (
  echo npm install fehlgeschlagen.
  pause
  exit /b 1
)

if not exist "node_modules\electron\package.json" (
  call npm install electron --save --ignore-scripts=false
)

if not exist "node_modules\electron\dist\electron.exe" (
  call npm install-scripts approve electron 2>nul
  if exist "node_modules\electron\install.js" call node "node_modules\electron\install.js"
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron fehlt noch. In diesem Ordner:
  echo   npm install-scripts approve electron
  echo   node node_modules\electron\install.js
  pause
  exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
  echo Vite fehlt nach npm install. Bitte Fehlermeldung oben pruefen.
  pause
  exit /b 1
)

echo.
echo Fertig. Als Naechstes start.bat — Anvil oeffnet ein eigenes Fenster.
echo Windows-Setup.exe spaeter: build-win.bat
if /i not "%~1"=="/q" pause

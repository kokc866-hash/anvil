@echo off
setlocal
cd /d "%~dp0"
title Anvil Windows-Setup bauen

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js LTS fehlt. https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
  echo Zuerst install.bat.
  call "%~dp0install.bat" /q
)

if not exist "node_modules\electron-builder\package.json" (
  echo electron-builder laden...
  call npm install electron-builder --save-dev --ignore-scripts=false
  if errorlevel 1 (
    echo electron-builder fehlgeschlagen.
    pause
    exit /b 1
  )
)

echo Baut die aktuelle Oberflaeche und den Hintergrundprozess.
echo Erstellt Setup.exe und portable ZIP nach dist-win\.
call npm run dist:win
if errorlevel 1 (
  echo Build fehlgeschlagen.
  pause
  exit /b 1
)

echo.
echo Fertig: dist-win\
echo Setup.exe installiert Anvil. Die portable ZIP entpacken und Anvil.exe starten.
echo Die fertigen Ausgaben benoetigen kein extern installiertes Node.js.
pause

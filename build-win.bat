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

echo Baut Anvil Setup.exe nach dist-win\  (Node muss auf dem PC bleiben)
call npx electron-builder --win nsis portable
if errorlevel 1 (
  echo Build fehlgeschlagen.
  pause
  exit /b 1
)

echo.
echo Fertig: dist-win\
echo Anvil Setup.exe installiert, Anvil.exe ist portabel. start.bat geht weiter.
pause

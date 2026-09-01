@echo off
title Anvil Companion
cd /d "%~dp0\.."
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js fehlt. Installieren: https://nodejs.org
  pause
  exit /b 1
)
echo Companion startet auf diesem PC  —  http://127.0.0.1:7845
echo Das ist kein Internet, nur dieser Rechner.
echo Token:  %USERPROFILE%\.anvil-companion-token
echo Fenster offen lassen. Zum Beenden: Ctrl+C
echo.
node companion\server.mjs
echo.
echo Companion beendet.
pause

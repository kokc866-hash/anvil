@echo off
setlocal
cd /d "%~dp0"
title Anvil - Langzeittest
rem Avoid focusing an already running development instance instead of testing.
powershell -NoProfile -NonInteractive -Command "$runtime=[IO.Path]::GetFullPath('node_modules\electron\dist\electron.exe'); if (Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $runtime }) { exit 1 }"
if errorlevel 1 (
  echo Anvil ist noch geoeffnet. Bitte normal schliessen und test.bat erneut starten.
  pause
  exit /b 1
)
echo Anvil-Testversion wird gebaut. Bitte Anvil vorher normal schliessen.
where node >nul 2>&1
if errorlevel 1 goto missing
if not exist "node_modules\electron\dist\electron.exe" goto missing
set "ANVIL_ELECTRON_BUILD=1"
call npm run build
if errorlevel 1 goto failed
node scripts\pack-ui.mjs
if errorlevel 1 goto failed
set "ANVIL_DESKTOP_MODE=production"
set "ANVIL_WATCHDOG=1"
set "ELECTRON_RUN_AS_NODE="
start "" /D "%~dp0" "%~dp0node_modules\electron\dist\electron.exe" .
exit /b 0
:missing
echo Die lokale Laufzeit fehlt. Bitte zuerst install.bat ausfuehren.
pause
exit /b 1
:failed
echo Der Build ist fehlgeschlagen. Die Testversion wurde nicht gestartet.
pause
exit /b 1

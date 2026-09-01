@echo off
echo Companion auf Port 7845 beenden...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":7845" ^| findstr "LISTENING"') do (
  taskkill /PID %%p /F >nul 2>&1
)
echo Fertig.
pause

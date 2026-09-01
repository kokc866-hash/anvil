@echo off
setlocal
cd /d "%~dp0"

if not exist "grok.anvil-patch" if exist "anvil\grok.anvil-patch" cd /d "%~dp0anvil"
if not exist "grok.mjs" if exist "anvil\grok.mjs" cd /d "%~dp0anvil"

if not exist "grok.anvil-patch" (
  echo grok.anvil-patch fehlt. Datei in denselben Ordner wie patch.bat legen.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js nicht gefunden. Node installieren, neues Fenster, nochmal.
  pause
  exit /b 1
)

echo Patch: %CD%\grok.anvil-patch
if exist "grok.mjs" (
  node grok.mjs
) else if exist "scripts\apply-patch.mjs" (
  node scripts\apply-patch.mjs grok.anvil-patch
) else (
  echo grok.mjs fehlt. Trotzdem Text-Dateien schreiben...
  node -e "const fs=require('fs');const path=require('path');const here=process.cwd();const plan=JSON.parse(fs.readFileSync(path.join(here,'grok.anvil-patch'),'utf8'));const root=fs.existsSync(path.join(here,'package.json'))?here:fs.existsSync(path.join(here,'anvil','package.json'))?path.join(here,'anvil'):here;let n=0;for (const rel of Object.keys(plan.files||{})){const c=plan.files[rel];if(typeof c!=='string')continue;const p=path.join(root,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,c.startsWith('b64:')?Buffer.from(c.slice(4),'base64'):c);console.log(rel);n++;}console.log('fertig',n);"
)

if errorlevel 1 (
  echo Patch fehlgeschlagen.
  pause
  exit /b 1
)

echo.
echo Danach stop.bat und start.bat.
pause

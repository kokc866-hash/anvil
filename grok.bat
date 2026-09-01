@echo off
cd /d "%~dp0"
node "%~dp0grok.mjs"
if errorlevel 1 pause

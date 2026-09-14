param([Parameter(Mandatory=$true)][string]$ConfigFile)
$ErrorActionPreference = 'Stop'
# A separate hidden console is essential: sharing Electron's console causes
# Windows to terminate the watcher when its parent is killed.
$worker = Join-Path $PSScriptRoot 'watchdog.ps1'
$arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $worker), '-ConfigFile', ('"{0}"' -f $ConfigFile))
Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments -WindowStyle Hidden | Out-Null

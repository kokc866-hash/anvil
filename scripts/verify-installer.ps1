$ErrorActionPreference = 'Stop'
$fixture = Join-Path $env:RUNNER_TEMP 'anvil-install-fixture'
if (Test-Path $fixture) { throw "Installer fixture already exists: $fixture" }
$installer = Get-ChildItem 'dist-win' -Filter '*.exe' | Where-Object { $_.Name -match 'Setup' } | Select-Object -First 1
if (-not $installer) { throw 'Setup installer missing' }
$process = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', "/D=$fixture") -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "Setup failed: $($process.ExitCode)" }
if (-not (Test-Path (Join-Path $fixture 'Anvil.exe'))) { throw 'Anvil.exe was not installed' }
$preserved = Join-Path $fixture 'runs\fixture\program.txt'
New-Item -ItemType Directory -Force (Split-Path $preserved) | Out-Null
Set-Content -LiteralPath $preserved -Value 'compiled user output'
$uninstaller = Join-Path $fixture 'Uninstall Anvil.exe'
$process = Start-Process -FilePath $uninstaller -ArgumentList @('/S', "_?=$fixture") -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "Uninstall failed: $($process.ExitCode)" }
if (-not (Test-Path $preserved)) { throw 'Uninstall removed user run files' }
if ((Get-Content -LiteralPath $preserved) -ne 'compiled user output') { throw 'User run content changed' }
if (Test-Path (Join-Path $fixture 'Anvil.exe')) { throw 'Application executable was not removed' }
Write-Host 'Installer passed: application removed, user Run files preserved.'

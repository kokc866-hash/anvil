param([string]$Directory = 'dist-win', [string]$Executable = 'Anvil.exe')
$ErrorActionPreference = 'Stop'
# Developer PCs require a distinct appId (app.anvil.installerqa) and executable.
if ($env:CI -ne 'true' -and $Executable -ne 'AnvilInstallerQA.exe') { throw 'Local installer acceptance requires the isolated AnvilInstallerQA package.' }
$installer = Get-ChildItem -LiteralPath $Directory -Filter '*.exe' | Where-Object { $_.Name -match 'Setup' } | Select-Object -First 1
if (-not $installer) { throw 'Setup installer missing' }
node (Join-Path $PSScriptRoot 'verify-installed-app.mjs') $installer.FullName $Executable
if ($LASTEXITCODE -ne 0) { throw "Installer acceptance failed: $LASTEXITCODE" }

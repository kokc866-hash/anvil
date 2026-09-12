param([string]$Directory = 'dist-win')
$ErrorActionPreference = 'Stop'
$config = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '../product-release.json') | ConvertFrom-Json
if (-not $config.signing.subjectName) { throw 'Public release needs a configured signing subject.' }
$files = @(Get-ChildItem -LiteralPath $Directory -Filter '*.exe')
$app = Join-Path $Directory 'win-unpacked/Anvil.exe'
if (-not $files.Count -or -not (Test-Path -LiteralPath $app)) { throw 'Setup or packaged app is missing.' }
$files += Get-Item -LiteralPath $app
foreach ($file in $files) {
  $sig = Get-AuthenticodeSignature -LiteralPath $file.FullName
  if ($sig.Status -ne 'Valid') { throw "Invalid signature: $($file.Name) ($($sig.Status))" }
  $subject = $sig.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  if ($subject -cne $config.signing.subjectName) { throw "Signing publisher mismatch: $($file.Name)" }
  if (-not $sig.TimeStamperCertificate) { throw "Signature needs a trusted timestamp: $($file.Name)" }
}
Write-Host 'Setup and packaged application have valid timestamped publisher signatures.'

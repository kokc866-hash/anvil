param([string]$NodePath, [string]$RunnerPath, [string]$JobPath)
$ErrorActionPreference = 'Stop'
# Keep the parent log pipes before allocating the program's console.
$logOut = [Console]::Out
$logErr = [Console]::Error
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AnvilConsole {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AllocConsole();
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
}
'@
  if ([AnvilConsole]::GetConsoleWindow() -eq [IntPtr]::Zero) {
    if (-not [AnvilConsole]::AllocConsole()) { throw 'Windows-Konsole konnte nicht angelegt werden.' }
  }
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $NodePath
  # These are paths to two controlled files, never shell code or program arguments.
  $info.Arguments = '"{0}" "{1}"' -f $RunnerPath, $JobPath
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $false
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $child = [System.Diagnostics.Process]::Start($info)
  $stdout = $child.StandardOutput.ReadToEndAsync()
  $stderr = $child.StandardError.ReadToEndAsync()
  $child.WaitForExit()
  $logOut.Write($stdout.GetAwaiter().GetResult())
  $logErr.Write($stderr.GetAwaiter().GetResult())
  $code = $child.ExitCode
  $child.Dispose()
  exit $code
} catch {
  $logErr.WriteLine('Terminal: ' + $_.Exception.Message)
  exit 1
}

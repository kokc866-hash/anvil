param([string]$JobPath)
$ErrorActionPreference = 'Stop'
# Preserve Anvil's log pipes, then give the program actual console handles.
$logOut = [Console]::Out
$logErr = [Console]::Error
try {
  $job = Get-Content -LiteralPath $JobPath -Raw -Encoding UTF8 | ConvertFrom-Json
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class AnvilConsole {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AllocConsole();
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetStdHandle(int kind, IntPtr handle);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  public static IntPtr Open(string name) {
    var handle = CreateFileW(name, 0xC0000000u, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    // Process.Start passes these handles through STARTF_USESTDHANDLES.
    if (handle != new IntPtr(-1) && !SetHandleInformation(handle, 1, 1)) {
      int error = Marshal.GetLastWin32Error(); CloseHandle(handle);
      throw new System.ComponentModel.Win32Exception(error);
    }
    return handle;
  }
  // Windows CRT argv quoting. No shell interprets program arguments.
  public static string Quote(string value) {
    var text = new StringBuilder("\"");
    int slashes = 0;
    foreach (char c in value) {
      if (c == '\\') { slashes++; continue; }
      text.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
      text.Append(c); slashes = 0;
    }
    text.Append('\\', slashes * 2); text.Append('"');
    return text.ToString();
  }
}
'@
  if ([AnvilConsole]::GetConsoleWindow() -eq [IntPtr]::Zero) {
    if (-not [AnvilConsole]::AllocConsole()) { throw 'Windows-Konsole konnte nicht angelegt werden.' }
  }
  $runInput = [AnvilConsole]::Open('CONIN$')
  $runOutput = [AnvilConsole]::Open('CONOUT$')
  if ($runInput -eq [IntPtr](-1) -or $runOutput -eq [IntPtr](-1)) { throw 'Windows-Konsolenhandles fehlen.' }
  if (-not [AnvilConsole]::SetStdHandle(-10, $runInput)) { throw 'Konsoleneingabe konnte nicht verbunden werden.' }
  if (-not [AnvilConsole]::SetStdHandle(-11, $runOutput)) { throw 'Konsolenausgabe konnte nicht verbunden werden.' }
  $runInfo = New-Object System.Diagnostics.ProcessStartInfo
  $runInfo.FileName = [string]$job.file
  $runInfo.WorkingDirectory = [string]$job.cwd
  $runInfo.Arguments = ($job.args | ForEach-Object { [AnvilConsole]::Quote([string]$_) }) -join ' '
  $runInfo.UseShellExecute = $false
  $runInfo.CreateNoWindow = $false
  $runInfo.RedirectStandardError = $true
  [System.IO.File]::WriteAllText($JobPath + '.launch', $runInfo.FileName + ' ' + $runInfo.Arguments)
  $runProcess = [System.Diagnostics.Process]::Start($runInfo)
  $runErrors = $runProcess.StandardError.ReadToEndAsync()
  $runProcess.WaitForExit()
  $runErrorText = $runErrors.GetAwaiter().GetResult()
  $logErr.Write($runErrorText)
  $runCode = $runProcess.ExitCode
  [System.IO.File]::WriteAllText($JobPath + '.result', "exit=$runCode`n" + $runErrorText)
  $runProcess.Dispose()
  [AnvilConsole]::CloseHandle($runInput) | Out-Null
  [AnvilConsole]::CloseHandle($runOutput) | Out-Null
  exit $runCode
} catch {
  $logErr.WriteLine('Terminal: ' + $_.Exception.Message)
  exit 1
}

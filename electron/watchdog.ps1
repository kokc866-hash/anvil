param([Parameter(Mandatory=$true)][string]$ConfigFile)
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
$directory = [IO.Path]::GetFullPath($config.directory)
$interval = [Math]::Max(1, [double]$config.intervalSeconds)
$grace = [Math]::Max(0, [double]$config.graceSeconds)
$parentId = [int]$config.parentPid
$started = [DateTime]::UtcNow
$sampleFile = Join-Path $directory 'samples.jsonl'
$summaryFile = Join-Path $directory 'summary.json'
$utf8 = New-Object Text.UTF8Encoding($false)
$summary = [ordered]@{ started = $started.ToString('o'); watchdogPid = $PID; parentPid = $parentId; version = $config.version; samples = 0; peakPrivateBytes = 0L; peakWorkingSetBytes = 0L; minAvailableBytes = $null; peakCommitBytes = 0L; mainStaleSamples = 0; rendererStaleSamples = 0; ended = $null; reason = $null }
function Save-Summary {
  [IO.File]::WriteAllText($summaryFile, ($summary | ConvertTo-Json -Depth 6), $utf8)
}
function Record($value) {
  if ((Test-Path -LiteralPath $sampleFile) -and (Get-Item -LiteralPath $sampleFile).Length -ge 16MB) {
    # Only these two known files inside this session directory are rotated.
    $previous = Join-Path $directory 'samples.previous.jsonl'
    if (Test-Path -LiteralPath $previous) { Remove-Item -LiteralPath $previous -Force }
    Move-Item -LiteralPath $sampleFile -Destination $previous
  }
  [IO.File]::AppendAllText($sampleFile, ($value | ConvertTo-Json -Depth 8 -Compress) + "`n", $utf8)
}
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AnvilWatchMemory {
  [StructLayout(LayoutKind.Sequential)] public struct Performance {
    public uint cb; public UIntPtr CommitTotal, CommitLimit, CommitPeak, PhysicalTotal,
      PhysicalAvailable, SystemCache, KernelTotal, KernelPaged, KernelNonpaged, PageSize;
    public uint HandleCount, ProcessCount, ThreadCount;
  }
  [DllImport("psapi.dll", SetLastError=true)] public static extern bool GetPerformanceInfo(ref Performance info, uint size);
  public static long[] Read() {
    var p = new Performance(); p.cb = (uint)Marshal.SizeOf(p);
    if (!GetPerformanceInfo(ref p, p.cb)) throw new System.ComponentModel.Win32Exception();
    long page = (long)p.PageSize.ToUInt64();
    return new long[] { (long)p.PhysicalAvailable.ToUInt64()*page, (long)p.PhysicalTotal.ToUInt64()*page,
      (long)p.CommitTotal.ToUInt64()*page, (long)p.CommitLimit.ToUInt64()*page };
  }
}
'@
  $parent = Get-Process -Id $parentId -ErrorAction SilentlyContinue
  $parentStart = if ($parent) { $parent.StartTime.ToUniversalTime().Ticks } else { 0 }
  $missingSince = $null
  $eventSince = $started.ToLocalTime()
  $lastEvents = [DateTime]::MinValue
  while ($true) {
    $now = [DateTime]::UtcNow
    $errors = @()
    $parent = Get-Process -Id $parentId -ErrorAction SilentlyContinue
    $alive = $parent -and $parent.StartTime.ToUniversalTime().Ticks -eq $parentStart
    if (!$alive -and !$missingSince) { $missingSince = $now; Record @{ at=$now.ToString('o'); event='parent-exited' } }
    $telemetry = $null
    try { $telemetry = Get-Content -LiteralPath (Join-Path $directory 'main.json') -Raw | ConvertFrom-Json } catch { $errors += 'main-telemetry-unavailable' }
    $ids = @{}; if ($alive) { $ids[$parentId] = 'main' }
    if ($telemetry) { foreach ($p in $telemetry.processes) { $ids[[int]$p.pid] = [string]$p.type } }
    # Enumerate descendants independently: this still works if Electron's main loop stops.
    try {
      $all = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name -OperationTimeoutSec 3)
      for ($depth=0; $depth -lt 8; $depth++) {
        $added = 0
        foreach ($p in $all) {
          $id = [int]$p.ProcessId
          if ($id -ne $PID -and !$ids.ContainsKey($id) -and $ids.ContainsKey([int]$p.ParentProcessId)) { $ids[$id] = 'child'; $added++ }
        }
        if (!$added) { break }
      }
    } catch { $errors += 'process-tree-unavailable' }
    $processes = @()
    foreach ($id in @($ids.Keys)) {
      $p = Get-Process -Id $id -ErrorAction SilentlyContinue
      if (!$p) { continue }
      try {
        $processes += @{ pid=$id; role=$ids[$id]; started=$p.StartTime.ToUniversalTime().ToString('o'); workingSetBytes=$p.WorkingSet64; privateBytes=$p.PrivateMemorySize64; cpuSeconds=$p.TotalProcessorTime.TotalSeconds; handles=$p.HandleCount; threads=$p.Threads.Count }
      } catch { $errors += 'process-sample-unavailable' }
    }
    $memory = $null
    try {
      $m = [AnvilWatchMemory]::Read()
      $memory = @{ availableBytes=$m[0]; totalBytes=$m[1]; commitBytes=$m[2]; commitLimitBytes=$m[3] }
      if ($null -eq $summary.minAvailableBytes -or $m[0] -lt $summary.minAvailableBytes) { $summary.minAvailableBytes = $m[0] }
      $summary.peakCommitBytes = [Math]::Max($summary.peakCommitBytes, $m[2])
    } catch { $errors += 'system-memory-unavailable' }
    $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $mainAge = if ($telemetry) { $nowMs - [long]$telemetry.at } else { $null }
    $rendererAge = if ($telemetry -and $telemetry.renderer) { $nowMs - [long]$telemetry.renderer.at } else { $null }
    if ($null -eq $mainAge -or $mainAge -gt 30000) { $summary.mainStaleSamples++ }
    if ($null -eq $rendererAge -or $rendererAge -gt 30000) { $summary.rendererStaleSamples++ }
    $private = 0L; $working = 0L
    foreach ($p in $processes) { $private += [long]$p.privateBytes; $working += [long]$p.workingSetBytes }
    $summary.peakPrivateBytes = [Math]::Max($summary.peakPrivateBytes, [long]$private)
    $summary.peakWorkingSetBytes = [Math]::Max($summary.peakWorkingSetBytes, [long]$working)
    Record @{ at=$now.ToString('o'); event='sample'; parentAlive=[bool]$alive; system=$memory; processes=@($processes); mainAgeMs=$mainAge; rendererAgeMs=$rendererAge; telemetry=$telemetry; errors=@($errors) }
    $summary.samples++
    if (($now - $lastEvents).TotalSeconds -ge 60 -or !$alive) {
      try {
        $events = @(Get-WinEvent -FilterHashtable @{ LogName='Application'; Id=1000,1001,1002; StartTime=$eventSince } -MaxEvents 100 -ErrorAction SilentlyContinue)
        foreach ($e in $events) {
          if ($e.Message -match '(?i)\b(anvil|electron)\.exe\b') { Record @{ at=$now.ToString('o'); event='windows-event'; eventAt=$e.TimeCreated.ToUniversalTime().ToString('o'); id=$e.Id; recordId=$e.RecordId; provider=$e.ProviderName } }
        }
        $eventSince = $now.ToLocalTime()
      } catch { Record @{ at=$now.ToString('o'); event='windows-events-unavailable' } }
      $lastEvents = $now
    }
    Save-Summary
    if (Test-Path -LiteralPath (Join-Path $directory 'stop')) { $summary.reason = 'stop-requested'; break }
    if ($missingSince -and ($now - $missingSince).TotalSeconds -ge $grace) { $summary.reason = 'parent-exited'; break }
    Start-Sleep -Seconds $interval
  }
} catch {
  $summary.reason = 'watchdog-error'
  try { Record @{ at=[DateTime]::UtcNow.ToString('o'); event='watchdog-error'; code=$_.FullyQualifiedErrorId } } catch {}
} finally {
  $summary.ended = [DateTime]::UtcNow.ToString('o')
  Save-Summary
}

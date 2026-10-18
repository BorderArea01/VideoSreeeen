param(
  [Parameter(Mandatory=$true)][string]$File,
  [string[]]$Arguments = @(),
  [switch]$PrioritizeBuildWhenNoGame,
  # Use only with explicit authorization for the current game-running session.
  # This does not bypass memory checks and is never persisted between runs.
  [switch]$AllowGameThisRun,
  [int]$MinFreeMiB = 1536
)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
function Assert-Resources {
  if (-not $AllowGameThisRun -and (Get-Process -Name 'NRC-Win64-Shipping' -ErrorAction SilentlyContinue)) { throw '真实游戏进程 NRC-Win64-Shipping 正在运行，停止本任务。' }
  $free = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024
  if ($free -lt $MinFreeMiB) { throw "可用内存 $([math]::Round($free)) MiB，低于 $MinFreeMiB MiB，停止本任务。" }
}
Assert-Resources
$guardDir = Join-Path $workspace '.local'
New-Item -ItemType Directory -Path $guardDir -Force | Out-Null
$lock = $null
$owned = @{}
$proc = $null
try {
  $lock = [IO.File]::Open((Join-Path $guardDir 'build.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
  $env:NODE_OPTIONS = '--max-old-space-size=384'
  $env:WRANGLER_SEND_METRICS = 'false'
  $env:GRADLE_OPTS = '-Dorg.gradle.daemon=false -Dorg.gradle.workers.max=1 -Dorg.gradle.parallel=false'
  $env:CARGO_BUILD_JOBS = '1'
  $env:ELECTRON_BUILDER_COMPRESSION_LEVEL = '5'
  $resolved = (Get-Command $File -ErrorAction Stop).Source
  $quoted = $Arguments | ForEach-Object { '"' + $_.Replace('"','\"') + '"' }
  $start = @{FilePath=$resolved; WorkingDirectory=$workspace; PassThru=$true; WindowStyle='Hidden'; RedirectStandardOutput=(Join-Path $guardDir 'task.stdout.log'); RedirectStandardError=(Join-Path $guardDir 'task.stderr.log')}
  if ($quoted.Count -gt 0) { $start.ArgumentList = $quoted -join ' ' }
  $proc = Start-Process @start
  $owned[[int]$proc.Id] = $proc.StartTime.ToUniversalTime()
  if ($PrioritizeBuildWhenNoGame -and -not (Get-Process -Name 'NRC-Win64-Shipping' -ErrorAction SilentlyContinue)) { try { $proc.PriorityClass = 'AboveNormal' } catch {} }
  while (-not $proc.HasExited) {
    $all = @(Get-CimInstance Win32_Process)
    do {
      $added = $false
      foreach ($entry in $all) {
        if ($owned.ContainsKey([int]$entry.ParentProcessId) -and -not $owned.ContainsKey([int]$entry.ProcessId)) {
          if ($entry.CreationDate.ToUniversalTime() -ge $owned[[int]$entry.ParentProcessId]) {
            $owned[[int]$entry.ProcessId] = $entry.CreationDate.ToUniversalTime(); $added = $true
          }
        }
      }
    } while ($added)
    Assert-Resources
    Start-Sleep -Milliseconds 900
    $proc.Refresh()
  }
  $proc.WaitForExit()
  Get-Content -LiteralPath (Join-Path $guardDir 'task.stdout.log') -ErrorAction SilentlyContinue
  Get-Content -LiteralPath (Join-Path $guardDir 'task.stderr.log') -ErrorAction SilentlyContinue
  if ($proc.ExitCode -ne 0) { throw "任务退出码：$($proc.ExitCode)" }
} finally {
  foreach ($taskPid in @($owned.Keys)) {
    $candidate = Get-Process -Id $taskPid -ErrorAction SilentlyContinue
    if ($candidate -and [math]::Abs(($candidate.StartTime.ToUniversalTime() - $owned[$taskPid]).TotalSeconds) -lt 1) {
      Stop-Process -InputObject $candidate -Force -ErrorAction SilentlyContinue
    }
  }
  if ($lock) { $lock.Dispose() }
}

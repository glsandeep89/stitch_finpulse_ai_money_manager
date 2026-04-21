# Free port 3001 (FinPulse API) and start the backend dev server in this terminal.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$pids = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique
if ($pids) {
  $pids | ForEach-Object {
    Write-Host "Stopping process on port 3001 (PID $_)"
    Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 1
}

Set-Location (Join-Path $root "backend")
Write-Host "Starting backend (npm run dev)..."
& npm run dev

# List FinPulse Render services and env var *names* (values masked). Requires a valid API key.
# Create one: Render Dashboard → Account Settings → API Keys
# Usage: .\scripts\verify-render-env.ps1
#    or:  $env:RENDER_API_KEY = "rnd_..." ; .\scripts\verify-render-env.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Get-RenderApiKey {
  if ($env:RENDER_API_KEY) { return $env:RENDER_API_KEY.Trim() }
  $ef = Join-Path $root ".env"
  if (-not (Test-Path $ef)) { return $null }
  foreach ($line in Get-Content $ef) {
    if ($line -match '^\s*RENDER_API_KEY\s*=\s*(.+)\s*$') {
      return $Matches[1].Trim().Trim('"')
    }
  }
  return $null
}

function Mask-Value([string]$s) {
  if ([string]::IsNullOrWhiteSpace($s)) { return "(empty)" }
  if ($s.Length -le 6) { return "****" }
  return $s.Substring(0, [Math]::Min(4, $s.Length)) + "..." + $s.Substring([Math]::Max(0, $s.Length - 4))
}

$apiKey = Get-RenderApiKey
if (-not $apiKey) {
  Write-Host "Set RENDER_API_KEY in .env or `$env:RENDER_API_KEY (Render Dashboard → Account → API Keys)." -ForegroundColor Red
  exit 1
}

$headers = @{ Authorization = "Bearer $apiKey" }
$base = "https://api.render.com/v1"

try {
  $list = Invoke-RestMethod -Uri "$base/services?limit=100" -Headers $headers -Method Get
} catch {
  Write-Host "Render API request failed: $_" -ForegroundColor Red
  Write-Host "If status is 401, create a new API key in Render and update RENDER_API_KEY." -ForegroundColor Yellow
  exit 1
}

$services = @()
if ($null -ne $list.service) { $services = @($list.service) }
elseif ($null -ne $list.services) { $services = @($list.services) }

$finpulse = $services | Where-Object { $_.name -match "finpulse" }
if ($finpulse.Count -eq 0) {
  Write-Host "No services with 'finpulse' in the name. All services:" -ForegroundColor Yellow
  $services | ForEach-Object { Write-Host "  - $($_.name) ($($_.id))" }
  exit 0
}

# NODE_ENV is often injected by Render; may not appear in this API list.
$requiredApi = @(
  "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_SCHEMA",
  "FRONTEND_URLS", "GEMINI_API_KEY"
)
$requiredWeb = @("VITE_API_URL", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY")

foreach ($svc in $finpulse) {
  Write-Host ""
  Write-Host "=== $($svc.name) ($($svc.type)) [$($svc.id)] ===" -ForegroundColor Cyan
  try {
    $ev = Invoke-RestMethod -Uri "$base/services/$($svc.id)/env-vars?limit=100" -Headers $headers -Method Get
  } catch {
    Write-Host "  (could not read env vars: $_)" -ForegroundColor Red
    continue
  }

  # Render returns a JSON array of { envVar: { key, value }, cursor } for this endpoint.
  $rows = @()
  if ($ev -is [System.Array]) {
    $rows = @($ev)
  } elseif ($null -ne $ev.envVars) {
    $rows = @($ev.envVars)
  }

  $keys = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($row in $rows) {
    $k = $null
    $v = $null
    if ($row.PSObject.Properties.Name -contains "envVar") {
      $k = $row.envVar.key
      $v = $row.envVar.value
    }
    elseif ($row.key) {
      $k = $row.key
      $v = $row.value
    }
    if (-not $k) { continue }
    [void]$keys.Add($k)
    Write-Host ("  {0,-40} {1}" -f $k, (Mask-Value $v))
  }

  if ($svc.name -eq "finpulse-api") {
    foreach ($r in $requiredApi) {
      if (-not $keys.Contains($r)) {
        Write-Host ("  {0,-40} {1}" -f $r, "(MISSING)") -ForegroundColor Red
      }
    }
  }
  if ($svc.name -eq "finpulse-web") {
    foreach ($r in $requiredWeb) {
      if (-not $keys.Contains($r)) {
        Write-Host ("  {0,-40} {1}" -f $r, "(MISSING)") -ForegroundColor Red
      }
    }
  }
}

Write-Host ""
Write-Host "Done. Values are masked. Fix any MISSING rows in Render → Service → Environment." -ForegroundColor Green

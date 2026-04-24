# Reproduce the SimpleFIN Bridge flow from https://beta-bridge.simplefin.org/info/developers
# without FinPulse: decode setup token → POST claim → GET /accounts?version=2
#
# Usage:
#   $env:SIMPLEFIN_SETUP_TOKEN = "aHR0cHM6Ly8..." ; .\scripts\smoke-simplefin-bridge.ps1
#   .\scripts\smoke-simplefin-bridge.ps1 -SetupToken "aHR0cHM6Ly8..."
#
# Use a brand-new token from Bridge (one-time claim). Complete bank login/MFA in Bridge first.

param(
  [string] $SetupToken = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $SetupToken) { $SetupToken = $env:SIMPLEFIN_SETUP_TOKEN }
if (-not $SetupToken) {
  Write-Host "Set -SetupToken or env SIMPLEFIN_SETUP_TOKEN to your base64 setup token." -ForegroundColor Red
  exit 1
}

function Split-AccessUrl([string]$raw) {
  $raw = $raw.Trim().Trim([char]0xFEFF)
  $i = $raw.IndexOf("//")
  if ($i -lt 0) { throw "Not a URL" }
  $scheme = $raw.Substring(0, $i + 2)
  $rest = $raw.Substring($i + 2)
  $at = $rest.IndexOf("@")
  if ($at -lt 0) { throw "No userinfo in access URL" }
  $auth = $rest.Substring(0, $at)
  $hp = $rest.Substring($at + 1)
  $c0 = $auth.IndexOf(":")
  if ($c0 -lt 0) { throw "No colon in userinfo" }
  $user = $auth.Substring(0, $c0)
  $pass = $auth.Substring($c0 + 1)
  $sl = $hp.IndexOf("/")
  if ($sl -lt 0) {
    $hostOnly = $hp
    $path = ""
  } else {
    $hostOnly = $hp.Substring(0, $sl)
    $path = $hp.Substring($sl).TrimEnd("/")
  }
  $base = "$scheme$hostOnly$path"
  return @{ Base = $base; User = $user; Pass = $pass }
}

$tok = ($SetupToken -replace "\s", "")
$claim = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($tok))
Write-Host "1) Decoded claim host: $([Uri]$claim).Host" -ForegroundColor Cyan
Write-Host "2) POST claim (one-time)..." -ForegroundColor Cyan
$claimResp = Invoke-WebRequest -Uri $claim -Method Post -Headers @{ "Content-Length" = "0" } -UseBasicParsing
if (-not $claimResp.IsSuccessStatusCode) {
  Write-Host "Claim failed: $($claimResp.StatusCode)" -ForegroundColor Red
  exit 1
}
$access = $claimResp.Content.Trim()
if ($access -notmatch "^https?://") {
  Write-Host "Unexpected claim body: $($access.Substring(0, [Math]::Min(120, $access.Length)))" -ForegroundColor Red
  exit 1
}
Write-Host "3) GET /accounts?version=2 (beta guide)..." -ForegroundColor Cyan
$sp = Split-AccessUrl $access
$pair = "{0}:{1}" -f $sp.User, $sp.Pass
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pair))
$accUrl = "$($sp.Base)/accounts?version=2"
$data = Invoke-RestMethod -Uri $accUrl -Headers @{ Authorization = "Basic $b64"; Accept = "application/json" } -Method Get
$data | ConvertTo-Json -Depth 6
Write-Host ""
Write-Host "OK. If errlist contains gen.auth here, FinPulse will see the same — use a fresh token and finish Bridge bank auth." -ForegroundColor Green

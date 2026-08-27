# one-click installer for DSH Desktop
param(
  [string]$Owner = "cbc091111",
  [string]$Repo  = "dsh-desktop",
  [string]$Tag   = "v0.1.0",
  [string]$Exe   = "dsh-desktop-setup-0.1.0-x64.exe",
  [string]$SetupUrl = ""
)
$ErrorActionPreference = "Stop"
Write-Host "DSH Desktop one-click install start..." -ForegroundColor Cyan

if (-not $SetupUrl) { $SetupUrl = "https://github.com/$Owner/$Repo/releases/download/$Tag/$Exe" }
$tmp = Join-Path $env:TEMP "dsh-setup.exe"
Write-Host "Downloading $SetupUrl ..." -ForegroundColor Yellow
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $SetupUrl -OutFile $tmp -UseBasicParsing
if (-not (Test-Path $tmp)) { throw "download failed" }
Write-Host "Running installer..." -ForegroundColor Cyan
Start-Process -FilePath $tmp -Wait
Write-Host ""
Write-Host "Done. DSH Desktop installed. First run detects DeepSeek Harness." -ForegroundColor Green

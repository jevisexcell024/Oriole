$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$zipPath = Join-Path (Split-Path $root -Parent) "orcalis-v2-deploy.zip"

if (-not (Test-Path "dist") -or -not (Test-Path "dist-server\server.mjs")) {
    Write-Error "dist/ or dist-server/server.mjs missing. Run 'npm run build:cpanel' first."
    exit 1
}

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$staging = Join-Path $env:TEMP "orcalis-deploy-staging"
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging | Out-Null

Copy-Item "dist" (Join-Path $staging "dist") -Recurse
New-Item -ItemType Directory -Path (Join-Path $staging "dist-server") | Out-Null
Copy-Item "dist-server\server.mjs" (Join-Path $staging "dist-server\server.mjs")
Copy-Item "package.json" (Join-Path $staging "package.json")
Copy-Item "package-lock.json" (Join-Path $staging "package-lock.json")

Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zipPath -CompressionLevel Optimal

Remove-Item $staging -Recurse -Force

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$entries = $archive.Entries
$count = $entries.Count
$sizeMB = [Math]::Round((Get-Item $zipPath).Length / 1MB, 2)
$leaks = $entries | Where-Object { $_.FullName -match "node_modules|\.pgdata" }
$hasPkg = $entries | Where-Object { $_.FullName -eq "package.json" }
$hasLock = $entries | Where-Object { $_.FullName -eq "package-lock.json" }
$archive.Dispose()

Write-Host ""
Write-Host "Deploy zip created: $zipPath"
Write-Host "Entries: $count"
Write-Host "Size: $sizeMB MB"

if ($leaks) {
    Write-Host "WARNING: forbidden entries found (node_modules/.pgdata):" -ForegroundColor Red
    $leaks | ForEach-Object { Write-Host "  $($_.FullName)" -ForegroundColor Red }
    exit 1
}
if (-not $hasPkg -or -not $hasLock) {
    Write-Host "WARNING: package.json or package-lock.json missing from zip." -ForegroundColor Red
    exit 1
}

Write-Host "OK: no node_modules/.pgdata leaks; package.json + package-lock.json included." -ForegroundColor Green

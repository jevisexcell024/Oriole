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
# Ship a LEAN package.json (only what the pre-built server actually imports, ~14 packages)
# instead of the full build-time list (50+ packages, ~350 MB), so "Run NPM Install" on the
# host does a fraction of the work. See scripts/make-deploy-package.mjs. Append
# --with-embedded-db to that command only for a host that has no PostgreSQL.
node "scripts\make-deploy-package.mjs" $staging
if ($LASTEXITCODE -ne 0) { Write-Error "Could not generate the deploy package.json."; exit 1 }

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
if (-not $hasPkg) {
    Write-Host "WARNING: package.json missing from zip." -ForegroundColor Red
    exit 1
}
if (-not $hasLock) {
    Write-Host "NOTE: no package-lock.json in the zip (the npm registry was unreachable while packaging); the host will resolve the pinned versions itself." -ForegroundColor Yellow
}

Write-Host "OK: no node_modules/.pgdata leaks; lean package.json included." -ForegroundColor Green

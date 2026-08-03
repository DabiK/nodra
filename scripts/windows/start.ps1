<#
.SYNOPSIS
    Starts the Nodra stack on native Windows (PowerShell), without the POSIX-only
    runtime supervisor.

.DESCRIPTION
    Launches Temporal, OpenCode, the API and the worker, each in its own titled
    PowerShell window so their logs stay separate and any of them can be stopped
    individually (Ctrl+C in the window, or scripts\windows\stop.ps1).

    On Windows the runtime supervisor (npm run runtime:start) is not supported
    because it relies on Unix process groups and ps/lsof. This script is the
    native-Windows equivalent.

.PARAMETER Web
    Also start the Vite web dev server (http://127.0.0.1:5174).

.PARAMETER SkipTemporal
    Do not start Temporal (use an already-running server).

.PARAMETER SkipOpenCode
    Do not start OpenCode (agents will be unavailable, but the UI/API still run).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\windows\start.ps1 -Web
#>

[CmdletBinding()]
param(
    [switch]$Web,
    [switch]$SkipTemporal,
    [switch]$SkipOpenCode
)

$ErrorActionPreference = "Stop"

# Repository root = two levels up from this script (scripts\windows\).
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repoRoot

function Resolve-NodraBinary($environmentVariable, $defaultName, $hint) {
    $configured = [Environment]::GetEnvironmentVariable($environmentVariable)
    if ($configured) {
        if (-not (Test-Path -LiteralPath $configured -PathType Leaf)) {
            throw "'$environmentVariable' points to '$configured', which does not exist. $hint"
        }
        return (Resolve-Path -LiteralPath $configured).Path
    }

    $command = Get-Command $defaultName -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "'$defaultName' was not found on PATH. $hint"
    }
    return $command.Source
}

Write-Host "Nodra — starting on Windows from $repoRoot" -ForegroundColor Cyan

$npmBinary = Resolve-NodraBinary "NODRA_NPM_BINARY" "npm" "npm ships with Node.js."
if (-not $SkipTemporal) {
    $temporalBinary = Resolve-NodraBinary "NODRA_TEMPORAL_BINARY" "temporal" "Install the Temporal CLI or set NODRA_TEMPORAL_BINARY, or pass -SkipTemporal."
}
if (-not $SkipOpenCode) {
    $opencodeBinary = Resolve-NodraBinary "NODRA_OPENCODE_BINARY" "opencode" "Install OpenCode or set NODRA_OPENCODE_BINARY, or pass -SkipOpenCode."
}

# Ensure the local data directories exist.
$temporalDbDir = Join-Path $repoRoot "data\local\temporal"
New-Item -ItemType Directory -Force -Path $temporalDbDir | Out-Null

# Make sure the SQLite database is migrated before the API/worker boot.
Write-Host "Preparing the local database (npm run db:setup)..." -ForegroundColor DarkGray
& $npmBinary run db:setup | Out-Null

function Start-Component($title, $command) {
    # Each component runs in its own PowerShell window, in the repo root.
    $inner = "Set-Location `"$repoRoot`"; `$Host.UI.RawUI.WindowTitle = `"$title`"; Write-Host `"$title`" -ForegroundColor Green; $command"
    Start-Process -FilePath "powershell.exe" `
        -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $inner) `
        -WorkingDirectory $repoRoot | Out-Null
    Write-Host "  started: $title" -ForegroundColor DarkGray
}

if (-not $SkipTemporal) {
    Start-Component "nodra-temporal" `
        "& `"$temporalBinary`" server start-dev --namespace nodra --ip 127.0.0.1 --port 7233 --db-filename `"data\local\temporal\dev-server.db`""
    Start-Sleep -Seconds 3
}

if (-not $SkipOpenCode) {
    Start-Component "nodra-opencode" "& `"$opencodeBinary`" serve --hostname 127.0.0.1 --port 4096"
    Start-Sleep -Seconds 2
}

Start-Component "nodra-api"    "& `"$npmBinary`" run dev"
Start-Sleep -Seconds 2
Start-Component "nodra-worker" "& `"$npmBinary`" run worker"

if ($Web) {
    Start-Sleep -Seconds 1
    Start-Component "nodra-web" "& `"$npmBinary`" run web"
}

Write-Host ""
Write-Host "Nodra is starting. Endpoints:" -ForegroundColor Cyan
Write-Host "  API health : http://127.0.0.1:4100/health"
Write-Host "  Temporal   : 127.0.0.1:7233"
Write-Host "  OpenCode   : http://127.0.0.1:4096"
if ($Web) { Write-Host "  Web UI     : http://127.0.0.1:5174" }
Write-Host ""
Write-Host "Stop everything with: powershell -ExecutionPolicy Bypass -File scripts\windows\stop.ps1" -ForegroundColor DarkGray

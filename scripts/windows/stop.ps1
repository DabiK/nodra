<#
.SYNOPSIS
    Stops the Nodra components started by scripts\windows\start.ps1.

.DESCRIPTION
    Terminates whatever is listening on the Nodra ports (Temporal 7233,
    OpenCode 4096, API 4100, web 5174). Port-based so it targets exactly the
    Nodra processes without guessing window titles or process names.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\windows\stop.ps1
#>

[CmdletBinding()]
param(
    [int[]]$Ports = @(7233, 4096, 4100, 5174)
)

$ErrorActionPreference = "SilentlyContinue"

Write-Host "Nodra - stopping components on ports: $($Ports -join ', ')" -ForegroundColor Cyan

$stopped = @{}
foreach ($port in $Ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($connection in $connections) {
        $processId = $connection.OwningProcess
        if ($processId -and -not $stopped.ContainsKey($processId)) {
            $stopped[$processId] = $true
            $name = (Get-Process -Id $processId -ErrorAction SilentlyContinue).ProcessName
            Write-Host "  stopping PID $processId ($name) on port $port" -ForegroundColor DarkGray
            # Kill the process tree so npm-spawned children go down too.
            & taskkill.exe /PID $processId /T /F | Out-Null
        }
    }
}

if ($stopped.Count -eq 0) {
    Write-Host "Nothing was listening on the Nodra ports." -ForegroundColor Yellow
} else {
    Write-Host ("Stopped {0} process tree(s)." -f $stopped.Count) -ForegroundColor Green
}

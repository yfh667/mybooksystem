param(
    [int]$Port = 4321,
    [string]$ProjectRoot = ""
)

$ErrorActionPreference = "SilentlyContinue"

function Stop-Pid($ProcessIdValue, $why) {
    if (-not $ProcessIdValue) { return }
    $n = 0
    if (-not [int]::TryParse("$ProcessIdValue", [ref]$n)) { return }
    if ($n -le 0 -or $n -eq $PID) { return }
    try {
        Stop-Process -Id $n -Force -ErrorAction Stop
        Write-Host "Stopped PID $n ($why)"
    } catch {}
}

function Stop-LockFile($lock) {
    if (-not (Test-Path -LiteralPath $lock)) { return }
    Get-Content -LiteralPath $lock -ErrorAction SilentlyContinue | ForEach-Object {
        Stop-Pid $_ "watcher lock"
    }
    Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue
}

if ($ProjectRoot) {
    Stop-LockFile (Join-Path $ProjectRoot ".watcher.lock")
}

$desktop = Join-Path $env:USERPROFILE "Desktop"
if (Test-Path -LiteralPath $desktop) {
    Get-ChildItem -LiteralPath $desktop -Recurse -Filter ".watcher.lock" -ErrorAction SilentlyContinue | ForEach-Object {
        Stop-LockFile $_.FullName
    }
}

try {
    Get-NetTCPConnection -LocalPort $Port -ErrorAction Stop | ForEach-Object {
        Stop-Pid $_.OwningProcess "port $Port"
    }
} catch {}

try {
    netstat -ano | Select-String (":$Port\s") | ForEach-Object {
        $parts = ($_ -split "\s+") | Where-Object { $_ }
        if ($parts.Length -gt 0) {
            Stop-Pid $parts[$parts.Length - 1] "netstat port $Port"
        }
    }
} catch {}

try {
    Get-CimInstance Win32_Process -ErrorAction Stop |
        Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -match "serve\.js" } |
        ForEach-Object { Stop-Pid $_.ProcessId "qmdtool serve.js" }
} catch {}

Start-Sleep -Milliseconds 500

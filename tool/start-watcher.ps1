param(
    [Parameter(Mandatory=$true)][string]$ProjectRoot,
    [Parameter(Mandatory=$true)][string]$ToolDir
)

$watcher = Join-Path $ToolDir "watch-render.ps1"
$outLog = Join-Path $ProjectRoot "watcher.log"
$errLog = Join-Path $ProjectRoot "watcher.err.log"

$env:PROJECT_ROOT = $ProjectRoot
Remove-Item -LiteralPath $outLog, $errLog -Force -ErrorAction SilentlyContinue

Start-Process `
    -FilePath "powershell" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $watcher) `
    -WorkingDirectory $ProjectRoot `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -WindowStyle Hidden

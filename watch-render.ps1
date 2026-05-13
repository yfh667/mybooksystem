# This script lives in <project-root>/tool/. Derive the project root from $PSScriptRoot.
$toolDir = $PSScriptRoot
$root    = (Get-Item $toolDir).Parent.FullName
$port    = 4321
$quartoExe = "C:\Program Files\Quarto\bin\quarto.exe"
$lockFile  = Join-Path $root ".watcher.lock"

Set-Location $root

# Check lock file - if another watcher is running, kill it first
if (Test-Path $lockFile) {
    $oldPid = Get-Content $lockFile -ErrorAction SilentlyContinue
    if ($oldPid -and ($p = Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
        Write-Host "Killing previous watcher PID $oldPid" -ForegroundColor DarkYellow
        Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
}
Set-Content -Path $lockFile -Value $PID -Force

# Kill stale render/serve helpers (not other powershell sessions!)
Get-Process | Where-Object { $_.Name -match "quarto|deno" } | Stop-Process -Force -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}
Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq "node.exe" -and $_.CommandLine -match "serve\.js"
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

# Clean up any stray html files in project root (leftovers from interrupted renders)
Remove-Item (Join-Path $root "index.html"), `
            (Join-Path $root "intro.html"), `
            (Join-Path $root "summary.html"), `
            (Join-Path $root "references.html") -ErrorAction SilentlyContinue

Remove-Item (Join-Path $root ".quarto\project-cache") -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Initial render..." -ForegroundColor Cyan
& $quartoExe render --to html 2>$null | Out-Null
Write-Host "Initial render done." -ForegroundColor Green

Write-Host "Starting static server on port $port..." -ForegroundColor Cyan
$serverProc = Start-Process -FilePath "node" -ArgumentList "serve.js" `
    -WorkingDirectory $toolDir -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
Write-Host "Server at http://localhost:$port/  (PID $($serverProc.Id))" -ForegroundColor Green

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $root
$watcher.Filter = "*.qmd"
$watcher.IncludeSubdirectories = $true
$watcher.EnableRaisingEvents = $true
$watcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite -bor `
    [System.IO.NotifyFilters]::FileName -bor `
    [System.IO.NotifyFilters]::CreationTime -bor `
    [System.IO.NotifyFilters]::Size

Write-Host "Watching *.qmd in $root" -ForegroundColor Cyan
Write-Host "" -ForegroundColor Cyan

function Drain-WatcherEvents {
    param($w, [int]$WindowMs = 200)
    $count = 0
    while ($true) {
        $c = $w.WaitForChanged([System.IO.WatcherChangeTypes]::All, $WindowMs)
        if ($c.TimedOut) { return $count }
        $count++
    }
}

function Wait-FileQuiet {
    param([string]$Path, [int]$QuietMs = 600, [int]$MaxWaitMs = 4000)
    $waited = 0
    $lastLen = -1; $lastMtime = [DateTime]::MinValue
    $quietSince = $null
    while ($waited -lt $MaxWaitMs) {
        try {
            $f = Get-Item -LiteralPath $Path -ErrorAction Stop
            if ($f.Length -eq $lastLen -and $f.LastWriteTime -eq $lastMtime) {
                if ($quietSince -eq $null) { $quietSince = Get-Date }
                if (((Get-Date) - $quietSince).TotalMilliseconds -ge $QuietMs) { return }
            } else {
                $quietSince = $null
                $lastLen = $f.Length
                $lastMtime = $f.LastWriteTime
            }
        } catch {}
        Start-Sleep -Milliseconds 150
        $waited += 150
    }
}

try {
    while ($true) {
        # Block until first event
        $change = $watcher.WaitForChanged([System.IO.WatcherChangeTypes]::All, 1000)
        if ($change.TimedOut) { continue }

        $now = Get-Date
        Write-Host "[$($now.ToString('HH:mm:ss'))] event: $($change.ChangeType) $($change.Name)" -ForegroundColor DarkYellow

        # Drain any rapid follow-up events (atomic save can fire several events back-to-back)
        $drained = Drain-WatcherEvents -w $watcher -WindowMs 250
        if ($drained -gt 0) {
            Write-Host "         (drained $drained extra event(s))" -ForegroundColor DarkGray
        }

        # Wait until ALL qmd files are quiet (no writes in last 600ms)
        $changedPath = Join-Path $root $change.Name
        Wait-FileQuiet -Path $changedPath

        # --- Step 0: regenerate auto-includes from folder structure ---
        Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] gen-includes..." -ForegroundColor DarkGray
        & node "$toolDir\gen-includes.js" 2>&1 | Out-Null

        # --- Step 1: HTML render (fast, updates live preview) ---
        Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] rendering HTML..." -ForegroundColor Yellow
        $htmlOut = & $quartoExe render --to html 2>&1
        $htmlCode = $LASTEXITCODE
        $stamp = (Get-Date).ToString('HH:mm:ss')
        if ($htmlCode -eq 0) {
            Write-Host "[$stamp] HTML OK" -ForegroundColor Green
        } else {
            Write-Host "[$stamp] HTML FAILED (exit=$htmlCode)" -ForegroundColor Red
            $htmlOut | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkRed }
        }

        # Drain Quarto's self-touches before PDF
        Drain-WatcherEvents -w $watcher -WindowMs 300 | Out-Null

        # --- Step 2: PDF render (slow, to separate dir to keep _book/ HTML intact) ---
        # Skip PDF if HTML failed - source has issues, no point burning xelatex on it
        if ($htmlCode -eq 0) {
            Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] rendering PDF (background)..." -ForegroundColor DarkGray
            $pdfOut = & $quartoExe render --to pdf --output-dir _pdf 2>&1
            $pdfCode = $LASTEXITCODE
            $stamp = (Get-Date).ToString('HH:mm:ss')
            if ($pdfCode -eq 0) {
                Write-Host "[$stamp] PDF OK -> _pdf/test.pdf`n" -ForegroundColor Green
            } else {
                Write-Host "[$stamp] PDF FAILED (exit=$pdfCode)" -ForegroundColor Red
                $pdfOut | Select-Object -Last 10 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkRed }
                Write-Host ""
            }
        }

        # Drain events caused by Quarto writing/touching files during render
        Drain-WatcherEvents -w $watcher -WindowMs 400 | Out-Null
    }
}
finally {
    Write-Host "Stopping server..." -ForegroundColor Cyan
    if ($serverProc -and -not $serverProc.HasExited) {
        Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
    }
    $watcher.Dispose()
    Remove-Item $lockFile -ErrorAction SilentlyContinue
}

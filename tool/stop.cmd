@echo off
setlocal

set "TOOL=%~dp0"
if "%~1"=="" (
    for %%I in ("%TOOL%..") do set "ROOT=%%~fI"
) else if "%~1"=="." (
    set "ROOT=%CD%"
) else (
    set "ROOT=%~f1"
)

echo Stopping watcher for: %ROOT%
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root='%ROOT%'; $lock=Join-Path $root '.watcher.lock'; Get-Content $lock -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }; try { Get-NetTCPConnection -LocalPort 4321 -ErrorAction Stop | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } } catch {}; try { Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'serve\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } } catch {}; Remove-Item $lock -ErrorAction SilentlyContinue"

echo Stopped.
ping 127.0.0.1 -n 2 >nul
endlocal

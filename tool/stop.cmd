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
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content '%ROOT%\.watcher.lock' -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'serve\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Remove-Item '%ROOT%\.watcher.lock' -ErrorAction SilentlyContinue"

echo Stopped.
timeout /t 2 >nul
endlocal

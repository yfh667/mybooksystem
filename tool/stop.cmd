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
powershell -NoProfile -ExecutionPolicy Bypass -File "%TOOL%kill-port.ps1" -ProjectRoot "%ROOT%" -Port 4321

echo Stopped.
ping 127.0.0.1 -n 2 >nul
endlocal

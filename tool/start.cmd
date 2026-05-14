@echo off
setlocal

REM This script lives in <project>/tool/. The watcher targets the project root (parent).
set "TOOL=%~dp0"
for %%I in ("%TOOL%..") do set "ROOT=%%~fI"

cd /d "%ROOT%"

echo Starting watcher and preview server...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%TOOL%watch-render.ps1' -WorkingDirectory '%ROOT%' -WindowStyle Hidden -RedirectStandardOutput '%ROOT%\watcher.log' -RedirectStandardError '%ROOT%\watcher.err.log'"

echo.
echo Watcher started in background.
echo.
echo   * Open the preview in Simple Browser:
echo     http://localhost:4321/split
echo.
echo   * Live log:  Get-Content "%ROOT%\watcher.log" -Wait -Tail 20
echo   * Stop:      double-click tool\stop.cmd
echo.
timeout /t 4 >nul
endlocal

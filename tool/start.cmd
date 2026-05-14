@echo off
setlocal

REM Three ways to invoke:
REM   tool\start.cmd                 → uses parent of tool/ (EMBEDDED mode)
REM   tool\start.cmd <project-path>  → uses given path (CENTRAL mode)
REM   tool\start.cmd .               → uses current directory (CENTRAL mode)

set "TOOL=%~dp0"
if "%~1"=="" (
    for %%I in ("%TOOL%..") do set "ROOT=%%~fI"
) else if "%~1"=="." (
    set "ROOT=%CD%"
) else (
    set "ROOT=%~f1"
)

if not exist "%ROOT%\_quarto.yml" (
    echo No _quarto.yml found at %ROOT%
    echo Run new-project.cmd first, or provide a valid project path.
    exit /b 1
)

cd /d "%ROOT%"
set PROJECT_ROOT=%ROOT%

echo Starting watcher for project: %ROOT%
start "qmdtool watcher" /min cmd /d /c "cd /d "%ROOT%" && set "PROJECT_ROOT=%ROOT%" && powershell -NoProfile -ExecutionPolicy Bypass -File "%TOOL%watch-render.ps1" > "%ROOT%\watcher.log" 2> "%ROOT%\watcher.err.log""

echo.
echo Watcher started in background.
echo.
echo   * Project:    %ROOT%
echo   * Preview:    http://localhost:4321/split
echo   * Live log:   Get-Content "%ROOT%\watcher.log" -Wait -Tail 20
echo   * Stop:       "%TOOL%stop.cmd" "%ROOT%"
echo.
ping 127.0.0.1 -n 4 >nul
endlocal

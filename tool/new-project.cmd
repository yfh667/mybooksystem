@echo off
setlocal

@rem Bootstrap a new Quarto knowledge project at the target folder.
@rem Copies the per-project template files only - not the tool folder -
@rem so that the central tool in this mukuai folder is shared across projects.
@rem
@rem Usage:
@rem   tool\new-project.cmd ^<target-dir^>
@rem   tool\new-project.cmd .       to use current directory
@rem   tool\new-project.cmd         no arg = current directory

set "TOOL=%~dp0"
for %%I in ("%TOOL%..") do set "MUKUAI=%%~fI"

if "%~1"=="" (
    set "TARGET=%CD%"
) else if "%~1"=="." (
    set "TARGET=%CD%"
) else (
    set "TARGET=%~f1"
)

if not exist "%TARGET%" mkdir "%TARGET%"

if exist "%TARGET%\_quarto.yml" (
    echo Refuse to overwrite existing _quarto.yml at:
    echo   %TARGET%
    echo Delete or move it first if you want a fresh project.
    exit /b 1
)

echo.
echo Bootstrapping project:
echo   Target:    %TARGET%
echo   Templates: %MUKUAI%
echo.

copy /y "%MUKUAI%\_quarto.yml"     "%TARGET%\" >nul && echo   [OK] _quarto.yml
copy /y "%MUKUAI%\index.qmd"        "%TARGET%\" >nul && echo   [OK] index.qmd
copy /y "%MUKUAI%\references.bib"   "%TARGET%\" >nul && echo   [OK] references.bib
copy /y "%MUKUAI%\ieee.csl"         "%TARGET%\" >nul && echo   [OK] ieee.csl
copy /y "%MUKUAI%\.gitignore"       "%TARGET%\" >nul && echo   [OK] .gitignore
copy /y "%TOOL%autoreload.html"     "%TARGET%\" >nul && echo   [OK] autoreload.html

if exist "%MUKUAI%\.vscode" (
    xcopy /e /i /q /y "%MUKUAI%\.vscode" "%TARGET%\.vscode\" >nul && echo   [OK] .vscode\settings.json
)

echo.
echo Done.
echo.
echo Next steps:
echo.
echo   1. Edit %TARGET%\_quarto.yml to set book.title / author / chapters
echo.
echo   2. Import a MinerU markdown ^(optional^):
echo        cd "%TARGET%"
echo        node "%TOOL%import-paper.js"    ^<some.md^> paper
echo        node "%TOOL%import-textbook.js" ^<some.md^> paper
echo.
echo   3. Start the watcher:
echo        "%TOOL%start.cmd" "%TARGET%"
echo.
echo      Then open Simple Browser:  http://localhost:4321/split
echo.
endlocal

@echo off
setlocal

@rem One-shot wrapper that turns a MinerU output folder into a Quarto project.
@rem
@rem Usage:
@rem   tool\convert-mineru.cmd ^<target-folder^>
@rem
@rem Example:
@rem   C:\mukuai\tool\convert-mineru.cmd C:\Users\Administrator\Desktop\paper2

if "%~1"=="" (
    echo Usage: convert-mineru ^<target-folder^>
    exit /b 1
)

node "%~dp0convert-mineru.js" "%~f1"
endlocal

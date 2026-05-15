@echo off
setlocal

@rem Archive MinerU output and delete intermediates / duplicate images.
@rem
@rem Usage:
@rem   tool\cleanup-after-import.cmd                  ^| use cwd (or PROJECT_ROOT)
@rem   tool\cleanup-after-import.cmd ^<project-folder^>

node "%~dp0cleanup-after-import.js" %*
endlocal

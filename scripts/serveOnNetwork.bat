@echo off
rem Double-click to serve the tracker to your phone. Runs serveOnNetwork.py from
rem the repo root and prints the address to open; press Ctrl+C or close the
rem window to stop. See README.md, Running it locally.
cd /d "%~dp0.."

where py >nul 2>nul
if %errorlevel%==0 (
    py -3 scripts\serveOnNetwork.py %*
) else (
    where python >nul 2>nul
    if errorlevel 1 (
        echo Python 3 is needed to run the tracker server: https://www.python.org/downloads/
    ) else (
        python scripts\serveOnNetwork.py %*
    )
)

echo.
pause

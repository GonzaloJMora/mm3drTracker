@echo off
rem Double-click to cut a release. Runs release.py from the repo root, then keeps
rem the window open so the result can be read. See README.md, Releasing.
cd /d "%~dp0.."

where py >nul 2>nul
if %errorlevel%==0 (
    py -3 scripts\release.py
) else (
    where python >nul 2>nul
    if errorlevel 1 (
        echo Python 3 is needed to run the release script: https://www.python.org/downloads/
    ) else (
        python scripts\release.py
    )
)

echo.
pause

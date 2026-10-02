@echo off
rem Double-click to build the site that gets published into _site\: only the files
rem the pages use, with script and stylesheet addresses stamped with the version.
rem Runs buildSite.py from the repo root, then keeps the window open so the result
rem can be read. See README.md, Releasing.
cd /d "%~dp0.."

where py >nul 2>nul
if %errorlevel%==0 (
    py -3 scripts\buildSite.py %*
) else (
    where python >nul 2>nul
    if errorlevel 1 (
        echo Python 3 is needed to run the build script: https://www.python.org/downloads/
    ) else (
        python scripts\buildSite.py %*
    )
)

echo.
pause

@echo off
rem Double-click to add anything new in data/ to the end of data/saveLayout.json.
rem Runs updateSaveLayout.py from the repo root, then keeps the window open so the
rem result can be read. See ARCHITECTURE.md, Saving.
cd /d "%~dp0.."

where py >nul 2>nul
if %errorlevel%==0 (
    py -3 scripts\updateSaveLayout.py
) else (
    where python >nul 2>nul
    if errorlevel 1 (
        echo Python 3 is needed to run the save layout script: https://www.python.org/downloads/
    ) else (
        python scripts\updateSaveLayout.py
    )
)

echo.
pause

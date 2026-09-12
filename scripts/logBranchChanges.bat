@echo off
rem Double-click to log this branch's changes. Runs logBranchChanges.py from the
rem repo root, then keeps the window open so the result can be read. See
rem README.md, Workflow.
cd /d "%~dp0.."

where py >nul 2>nul
if %errorlevel%==0 (
    py -3 scripts\logBranchChanges.py
) else (
    where python >nul 2>nul
    if errorlevel 1 (
        echo Python 3 is needed to run the branch changes script: https://www.python.org/downloads/
    ) else (
        python scripts\logBranchChanges.py
    )
)

echo.
pause

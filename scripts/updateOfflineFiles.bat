@echo off
rem Double-click to rewrite data/offline.json, the files the offline copy stores.
rem Runs updateOfflineFiles.py from the repo root, then keeps the window open so
rem the result can be read. See ARCHITECTURE.md, Offline.
cd /d "%~dp0.."

where py >nul 2>nul
if %errorlevel%==0 (
    py -3 scripts\updateOfflineFiles.py
) else (
    where python >nul 2>nul
    if errorlevel 1 (
        echo Python 3 is needed to run the offline files script: https://www.python.org/downloads/
    ) else (
        python scripts\updateOfflineFiles.py
    )
)

echo.
pause

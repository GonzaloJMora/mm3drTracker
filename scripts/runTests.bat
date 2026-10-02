@echo off
rem Double-click to run the test suite. Runs runTests.py from the repo root, which
rem installs what the tests need first, then keeps the window open so the result
rem can be read. See README.md, Testing.
cd /d "%~dp0.."

where py >nul 2>nul
if %errorlevel%==0 (
    py -3 scripts\runTests.py %*
) else (
    where python >nul 2>nul
    if errorlevel 1 (
        echo Python 3 is needed to run the tests script: https://www.python.org/downloads/
    ) else (
        python scripts\runTests.py %*
    )
)

echo.
pause

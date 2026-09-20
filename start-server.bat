@echo off
TITLE AP Debug Console - SQLite Server (Port 9117)
cd /d "%~dp0"

:: 1. Check if 'node' is accessible via PATH
where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    set "NODE_CMD=node"
    set "NPM_CMD=npm"
    goto RUN_SERVER
)

:: 2. Fallback check for standard 64-bit installation path
if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE_CMD=C:\Program Files\nodejs\node.exe"
    set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"
    goto RUN_SERVER
)

:: 3. Fallback check for 32-bit installation path
if exist "C:\Program Files (x86)\nodejs\node.exe" (
    set "NODE_CMD=C:\Program Files (x86)\nodejs\node.exe"
    set "NPM_CMD=C:\Program Files (x86)\nodejs\npm.cmd"
    goto RUN_SERVER
)

:: 4. Prompt error if Node.js is not installed
echo ============================================================
echo [ERROR] Node.js was not found on your system!
echo ============================================================
echo.
echo Please download and install Node.js (LTS Version) from:
echo https://nodejs.org/
echo.
echo If you just installed it, close this window and run the file again.
echo.
pause
exit /b 1

:RUN_SERVER
:: Automatically install dependencies if missing
if not exist "node_modules\" (
    echo Installing Express and SQLite3 dependencies...
    call "%NPM_CMD%" install express sqlite3
    echo.
)

:: Start Tailscale Serve asynchronously in the background
echo Starting Tailscale Serve...
if exist "C:\Program Files\Tailscale\tailscale.exe" (
    start "" /B "C:\Program Files\Tailscale\tailscale.exe" serve 9117
) else (
    start "" /B tailscale serve 9117
)
echo.

echo Starting SQLite Server on http://localhost:9117 ...
echo Press Ctrl+C in this window to stop the server.
echo.

"%NODE_CMD%" server.js

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Server process ended with error code %ERRORLEVEL%.
    pause
)
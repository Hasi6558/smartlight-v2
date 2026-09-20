@echo off
TITLE Smart Light React Server (Port 9118)
cd /d "%~dp0"

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js was not found on your system.
    echo Install Node.js LTS from https://nodejs.org/ and try again.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo Installing backend dependencies...
    call npm.cmd install
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Backend dependency installation failed.
        pause
        exit /b 1
    )
)

if not exist "frontend\node_modules\" (
    echo Installing React frontend dependencies...
    call npm.cmd run frontend:install
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] React dependency installation failed.
        pause
        exit /b 1
    )
)

echo Starting Express backend on http://localhost:9117 ...
start "Smart Light Backend 9117" /B cmd /c "node server.js"

echo Starting React frontend on http://localhost:9118 ...
echo API requests are proxied to http://localhost:9117
echo Press Ctrl+C in this window to stop the React server.
echo.

call npm.cmd --prefix frontend run dev

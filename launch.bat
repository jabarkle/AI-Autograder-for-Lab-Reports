@echo off
title Lab Grader
cd /d "%~dp0"

echo.
echo  ============================================
echo    CMU Lab Grader - Starting up...
echo  ============================================
echo.

REM --- Kill any existing servers on these ports ---
echo  [0/3] Cleaning up stale processes...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":9090 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":5173 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 2 /nobreak >nul

REM --- Start FastAPI backend in background ---
echo  [1/3] Starting backend (port 9090)...
start /b "" cmd /c "call C:\Users\jesse\anaconda3\Scripts\activate.bat lab-grader && uvicorn server:app --reload --port 9090" > nul 2>&1
set BACKEND_STARTED=1

REM --- Start React frontend in background ---
echo  [2/3] Starting frontend (port 5173)...
start /b "" cmd /c "cd /d "%~dp0frontend" && npm run dev" > nul 2>&1
set FRONTEND_STARTED=1

REM --- Wait for servers to boot ---
echo  [3/3] Waiting for servers...
timeout /t 5 /nobreak > nul

REM --- Open browser ---
start "" "http://localhost:5173"

echo.
echo  ============================================
echo    Lab Grader is running!
echo    http://localhost:5173
echo  ============================================
echo.
echo  Press any key to STOP all servers and exit.
echo.
pause >nul

REM --- Cleanup: kill all processes on our ports ---
echo.
echo  Shutting down servers...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":9090 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":5173 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
REM Also kill any child python/node processes that may linger
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":9090 "') do (
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":5173 "') do (
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 1 /nobreak >nul
echo  All servers stopped.
timeout /t 2 /nobreak >nul
exit

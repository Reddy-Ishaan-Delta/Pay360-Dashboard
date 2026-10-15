@echo off
REM Starts the Pay360 QM dashboard (DAX HTML replica) on http://localhost:8081 (local only).
REM Optional: start.bat -Port 8082   or   start.bat -NoBrowser
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" %*

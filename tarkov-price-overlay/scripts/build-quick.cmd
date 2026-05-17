@echo off
REM Double-clickable wrapper for build-quick.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-quick.ps1"
pause

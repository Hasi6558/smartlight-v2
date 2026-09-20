@echo off
cd /d "%~dp0"
nanomq.exe start --conf "%~dp0..\config\nanomq.conf"
pause
:::
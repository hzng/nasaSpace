@echo off
cd /d "%~dp0"
set PY=python
if exist "..\..\work\venv\Scripts\python.exe" set PY=..\..\work\venv\Scripts\python.exe
"%PY%" -X utf8 sync_featured.py
if errorlevel 1 goto failed
echo The observation list was refreshed. Images download when a view is opened. Refresh the app.
pause
exit /b 0
:failed
echo The update did not finish. The previous observation list is preserved. Run this again to retry.
pause
exit /b 1

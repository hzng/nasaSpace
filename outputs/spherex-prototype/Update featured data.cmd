@echo off
cd /d "%~dp0"
python -X utf8 sync_featured.py
if errorlevel 1 goto failed
python -X utf8 prepare_featured.py
if errorlevel 1 goto failed
echo Featured observations and all field views are ready. Refresh the app.
pause
exit /b 0
:failed
echo The update did not finish. Existing downloads are preserved. Run this again to resume.
pause
exit /b 1

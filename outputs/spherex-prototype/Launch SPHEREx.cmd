@echo off
cd /d "%~dp0"
echo Starting SPHEREx Observation Lab...
echo Open http://127.0.0.1:8765 once the server says ready.
set PY=python
if exist "..\..\work\venv\Scripts\python.exe" set PY=..\..\work\venv\Scripts\python.exe
"%PY%" -X utf8 server.py
if errorlevel 1 (
  echo The server stopped. See the error above and README.md for setup instructions.
  pause
)

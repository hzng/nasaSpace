$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$py = 'python'
if (Test-Path -LiteralPath '..\..\work\venv\Scripts\python.exe') { $py = '..\..\work\venv\Scripts\python.exe' }
& $py -X utf8 server.py

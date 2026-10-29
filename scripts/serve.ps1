$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
& "$projectRoot/.venv/Scripts/python.exe" -m uvicorn backend.main:app --host 127.0.0.1 --port 8000

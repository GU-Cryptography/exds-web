$ErrorActionPreference = "Stop"

$python = ".venv/Scripts/python"
if (-not (Test-Path $python)) {
    $python = "python"
}

& $python "scripts/check_auth_all.py"


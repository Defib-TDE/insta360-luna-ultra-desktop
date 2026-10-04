[CmdletBinding()]
param()
$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$BuildVenv = Join-Path $RepoRoot ".venv-webcam-build"
$Python = Join-Path $BuildVenv "Scripts\python.exe"
if (-not (Test-Path $Python)) {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        & py -3 -m venv $BuildVenv
    } elseif (Get-Command python -ErrorAction SilentlyContinue) {
        & python -m venv $BuildVenv
    } else {
        throw "Install Python 3.11 or newer to build the bundled webcam helper."
    }
    if ($LASTEXITCODE -ne 0) { throw "Install Python 3.11 or newer to build the bundled webcam helper." }
}
& $Python -m pip install --disable-pip-version-check -r (Join-Path $PSScriptRoot "webcam-requirements.txt") "pyinstaller>=6.16,<7"
if ($LASTEXITCODE -ne 0) { throw "Webcam build dependency installation failed." }
$Output = Join-Path $RepoRoot "src-tauri\resources\webcam"
$Work = Join-Path $RepoRoot ".webcam-build"
& $Python -m PyInstaller --noconfirm --clean --onedir --console --name webcam-bridge --collect-all av --collect-all pyvirtualcam --distpath $Output --workpath (Join-Path $Work "work") --specpath $Work (Join-Path $PSScriptRoot "webcam_bridge.py")
if ($LASTEXITCODE -ne 0) { throw "Webcam helper packaging failed." }
& (Join-Path $Output "webcam-bridge\webcam-bridge.exe") --check-runtime
if ($LASTEXITCODE -ne 0) { throw "Packaged webcam helper did not pass its launch check." }

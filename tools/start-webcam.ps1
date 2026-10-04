[CmdletBinding()]
param(
    [string]$Url = "http://127.0.0.1:49183/stream",
    [ValidateSet("h264", "hevc")]
    [string]$Codec = "h264",
    [ValidateSet("auto", "obs", "unitycapture")]
    [string]$Backend = "auto",
    [string]$Device,
    [double]$Fps = 0,
    [int]$Width = 0,
    [int]$Height = 0,
    [switch]$Mirror,
    [switch]$ProbeOnly
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Venv = Join-Path $RepoRoot ".venv-webcam"
$Python = Join-Path $Venv "Scripts\python.exe"

if (-not (Test-Path $Python)) {
    $Launcher = Get-Command py -ErrorAction SilentlyContinue
    if ($Launcher) {
        & $Launcher.Source -3 -m venv $Venv
    } else {
        $Launcher = Get-Command python -ErrorAction Stop
        & $Launcher.Source -m venv $Venv
    }
}

& $Python -m pip install --disable-pip-version-check -r (Join-Path $PSScriptRoot "webcam-requirements.txt")

$BridgeArgs = @(
    (Join-Path $PSScriptRoot "webcam_bridge.py"),
    "--url", $Url,
    "--codec", $Codec,
    "--backend", $Backend
)
if ($Device) { $BridgeArgs += @("--device", $Device) }
if ($Fps -gt 0) { $BridgeArgs += @("--fps", "$Fps") }
if ($Width -gt 0) { $BridgeArgs += @("--width", "$Width") }
if ($Height -gt 0) { $BridgeArgs += @("--height", "$Height") }
if ($Mirror) { $BridgeArgs += "--mirror" }
if ($ProbeOnly) { $BridgeArgs += "--probe-only" }

& $Python @BridgeArgs
exit $LASTEXITCODE

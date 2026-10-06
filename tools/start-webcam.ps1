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
    [ValidateRange(1, 100000)]
    [int]$ProbeFrames = 30,
    [ValidateRange(0, 60)]
    [double]$WarmupSeconds = 0,
    [ValidateRange(1, 120)]
    [double]$ProbeTimeout = 45,
    [ValidateSet("baseline", "1080p30", "1080p60", "4k30", "4k60")]
    [string]$ExpectProfile,
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
if ($ProbeOnly) {
    $BridgeArgs += @("--probe-only", "--probe-frames", "$ProbeFrames", "--warmup-seconds", "$WarmupSeconds", "--probe-timeout", "$ProbeTimeout")
}
if ($ExpectProfile) { $BridgeArgs += @("--expect-profile", $ExpectProfile) }

& $Python @BridgeArgs
exit $LASTEXITCODE

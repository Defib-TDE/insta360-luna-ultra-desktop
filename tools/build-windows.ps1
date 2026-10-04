[CmdletBinding()]
param()
$ErrorActionPreference = "Stop"
& bun run generate
if ($LASTEXITCODE -ne 0) { throw "Frontend generation failed." }
& (Join-Path $PSScriptRoot "package-webcam.ps1")

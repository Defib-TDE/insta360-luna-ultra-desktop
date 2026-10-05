[CmdletBinding()]
param(
    [ValidatePattern('^[a-zA-Z0-9_-]+$')]
    [string]$Label = 'snapshot'
)

# Read-only Windows inventory. Run before and after plugging in Luna.
# No driver changes, device enabling/disabling, route changes or camera RPCs.
$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ReportDir = Join-Path $RepoRoot 'probe-out'
$Issues = New-Object 'System.Collections.Generic.List[string]'
$Devices = @()
$Adapters = @()
$Routes = @()
$VideoDevices = @()

try {
    $Devices = @(Get-CimInstance Win32_PnPEntity | Where-Object {
        $_.Present -eq $true -and (
            $_.PNPDeviceID -like 'USB\*' -or
            $_.PNPClass -in @('Camera', 'Image', 'Net')
        )
    } | ForEach-Object {
        [ordered]@{
            name = $_.Name
            class = $_.PNPClass
            service = $_.Service
            status = $_.Status
            errorCode = $_.ConfigManagerErrorCode
            hardwareIds = @($_.HardwareID)
            compatibleIds = @($_.CompatibleID)
            # Preserve VID/PID and interface number, omit instance serial.
            interface = ($_.PNPDeviceID -replace '\\[^\\]*$', '\[instance omitted]')
        }
    })
} catch { $Issues.Add("PnP inventory: $($_.Exception.Message)") }

try {
    $Adapters = @(Get-NetAdapter | Select-Object Name, InterfaceDescription, ifIndex, Status, LinkSpeed)
    $Routes = @(Get-NetRoute -AddressFamily IPv4 | Where-Object {
        $_.DestinationPrefix -eq '0.0.0.0/0' -or $_.DestinationPrefix -like '192.168.42.*'
    } | Select-Object InterfaceIndex, DestinationPrefix, NextHop, RouteMetric)
} catch { $Issues.Add("Network inventory: $($_.Exception.Message)") }

if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
    # DirectShow enumeration intentionally exits nonzero after listing devices.
    # Start-Process keeps native stderr out of PowerShell's error pipeline.
    $Scratch = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
    try {
        $Process = Start-Process -FilePath (Get-Command ffmpeg).Source -ArgumentList @('-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy') -NoNewWindow -PassThru -RedirectStandardError $Scratch
        if (-not $Process.WaitForExit(10000)) {
            $Process.Kill()
            $Issues.Add('DirectShow enumeration timed out.')
        } else {
            $VideoDevices = @(Get-Content $Scratch | Where-Object { $_ -match '"(.+)" \(video\)' } | ForEach-Object {
                if ($_ -match '"(.+)" \(video\)') { $Matches[1] }
            })
        }
    } catch { $Issues.Add("DirectShow inventory: $($_.Exception.Message)") }
    finally { Remove-Item $Scratch -ErrorAction SilentlyContinue }
} else { $Issues.Add('FFmpeg not found; DirectShow enumeration skipped.') }

$OS = Get-CimInstance Win32_OperatingSystem
$Report = [ordered]@{
    schemaVersion = 1
    collectedAt = [DateTime]::UtcNow.ToString('o')
    label = $Label
    windows = [ordered]@{ caption = $OS.Caption; version = $OS.Version; build = $OS.BuildNumber }
    scope = 'Read-only PnP, network and DirectShow inventory. Interfaces do not establish Luna USB preview or SDK support. Local adapter addresses, instance serial numbers and SSIDs are omitted; relevant subnet and gateway routes are included.'
    devices = $Devices
    adapters = $Adapters
    relevantRoutes = $Routes
    directShowVideoDevices = $VideoDevices
    issues = @($Issues.ToArray())
}
New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
$ReportPath = Join-Path $ReportDir ("windows-devices-{0}-{1}.json" -f $Label, (Get-Date -Format 'yyyyMMdd-HHmmss'))
$Report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
Write-Host "Saved read-only device report: $ReportPath"
Write-Host 'Compare USB VID/PID, compatible IDs and network/camera devices before and after connecting Luna.'

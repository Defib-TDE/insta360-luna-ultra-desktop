# Read-only camera and Windows diagnostics

These tools collect evidence for preview quality, orientation, USB and portable
networking research. They do not discover every command, establish native
1080p/60fps or prove a USB video route.

## Camera options through the working session

After rebuilding the feature branch, connect Luna and open Studio. Expand
**Connection & diagnostics** and select **Export camera report**. The JSON is
saved to `Downloads/Luna Ultra/luna-camera-capabilities.json` in the desktop app.
Rename it before the next export if you want to keep several mode snapshots.

The app reads known device/photography option types and capture status through
the established session; it never sweeps unknown command numbers, starts capture
or writes settings. It includes mode, posture when returned, option acknowledgements,
recording settings and the current Studio source/output measurements. A mode
changed during the read is flagged. Reports omit Wi-Fi credentials, device serial,
authorization identifiers and licenses. Photography fields use the schema's names;
acknowledged settings can still have no effect on this camera.

For a useful comparison, keep **Match camera mode** off, select each mode on the
camera, let source measurements settle for at least five seconds, and export.
Record shooting orientation and firmware. Recording resolution is not preview
resolution. Do not run the older standalone TCP probes while this app owns the
camera session; those probes open a separate connection.

## Windows USB and network inventory

Close any camera file-transfer window first. Run PowerShell normally; no
administrator prompt or persistent execution-policy change is needed. Run
the following lines in order, starting with Luna's USB cable disconnected:

```powershell
Set-Location "C:\Users\auxny\Documents\Codex\2026-10-03\new-chat\luna-ultra-desktop"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\inspect-windows-devices.ps1 -Label before-usb
```

Connect Luna with a **data-capable** USB-C cable. Note the connection modes
the camera offers and what you choose; file-transfer mode may interrupt Wi-Fi
preview. Let Windows finish ordinary device detection, then run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\inspect-windows-devices.ps1 -Label after-usb
```

Reports are timestamped under `probe-out`, which is ignored by Git. The script
uses Windows CIM/PnP, adapter and route reads. If FFmpeg is installed, it also
lists DirectShow video devices. It does not install drivers, enable/disable
devices, change routing or send anything to the camera. USB instance serials,
local adapter addresses and Wi-Fi SSIDs are omitted; interface names, relevant
subnets and gateway routes remain, so review a report before sharing it.

Compare new USB VID/PID and interface numbers, compatible class IDs, driver
service and new camera/network entries. USB class `0E` is video; an actual
camera entry/DirectShow device helps assess usable UVC exposure. Storage/MTP/PTP
interfaces alone provide file transfer. A USB network interface would support
investigating TCP reachability, while a vendor-specific interface or WinUSB
driver does not establish a preview protocol. No driver replacement is proposed.

The official Luna computer guide currently says USB webcam use is unsupported.
Enumeration reports show this particular unit's interfaces; they cannot turn
an unsupported transport into an established feature. A later descriptor read
with Microsoft's USBView may be useful if this inventory shows relevant entries.

For MSI Claw networking, repeat the inventory with camera Wi-Fi plus USB-C
Ethernet, or two independent Wi-Fi adapters. It can show separate interfaces
and relevant routes, but camera reachability and actual internet upload still
need testing. The script makes no route changes or internet requests.

## Exam use

These tools do not establish WGU or Guardian approval. Use a physical external
USB webcam meeting WGU's requirements unless the institution and provider
confirm this exact Luna/virtual-camera setup. See [STUDIO_RESEARCH.md](STUDIO_RESEARCH.md).

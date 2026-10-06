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

User snapshots from 2026-10-05 (unplugged, plugged in and camera USB/file-transfer
selections) add one **USB Mass Storage Device**, VID `2E1A`, PID `1009`, with
class `08`/subclass `06`/protocol `50`. Windows uses `USBSTOR`, reports status
OK/error code 0, and adds no network adapter or DirectShow camera. All three
after snapshots expose the same profile. That supports file transfer for these
selections, with no observed webcam/network interface. USB mode is camera-side;
a Windows driver cannot create a video interface absent from its exposed USB
profile. This does not establish that no other firmware mode exists.

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

## Capture a video interruption

Open Studio → **Connection & diagnostics** → **Export connection report** just
after recovery starts, before closing the app. The desktop app saves
`Downloads/Luna Ultra/luna-connection-report.json`; rename successive reports
to retain them. This button works while disconnected and only reads local
app state, so it does not add camera command traffic. Keep capability export
for connected camera options; it is a separate report.

The report includes timestamped native control and relay events, source/client
encoded-payload backlog counts, codec-header changes, last valid/video arrival
ages and the helper's bounded recovery logs. Native timestamps and helper log
prefixes use Unix milliseconds; `collectedAt` uses UTC ISO time. Relay counters
span this app process; command timeout count spans the current control session.
History is bounded and resets when the app exits. A relay backlog is an app
consumer falling behind, not a measurement of radio packet loss.

Record the time, whether Windows remained joined to camera Wi-Fi, camera mode,
whether recording/USB transfer was active, and whether only webcam output or
also Studio preview froze. Use Landscape 720p30 with mode fixed for a timed
run. Compare two reports before and after an interruption. Successful automatic
recovery does not establish sustained reliability or distinguish firmware from
radio/decoder faults without these events.

### Screen sleep and video-only pauses

On 2026-10-05 the user observed a dark Luna screen, retained Wi-Fi, and a preview
that returned only after tapping the screen awake. The report contains four
decoder read retries over about 35 seconds and no control-session reconnect.
There is no logged source/client backlog or codec-header change. It was collected
after recovery, so its fresh arrival ages do not describe the pause itself.
This points to a camera display/power interaction but does not prove its mechanism.

The [official Luna settings guide](https://onlinemanual.insta360.com/lunaultra/en-us/operation-tutorials/system-operation/auto-power-off)
documents **Settings → General → Auto Power Off → Never** and a separate
**Screen Auto Sleep** duration. It promises recording with the screen off,
not uninterrupted control-session Wi-Fi preview. For comparison, disable screen
sleep if the camera offers that choice, or select its longest duration. Keep
Slow-mo, baseline and output fixed; compare normal sleep with this temporary
setting for 10–15 minutes each. Record original settings so they can be restored.
Do not infer a remote wake setter or the meaning of raw `standby_duration` from
the shared schema; this unit's report did not acknowledge that option.

Native recovery now monitors a previously running source for 12 seconds of
silence. With responsive control it tries at most two Stop/Start preview cycles,
at least 30 seconds apart, preserving the relay URL, source profile and camera
mode. It closes clients with stale GOP references so they rejoin at a fresh
keyframe. It leaves the relay open after the budget is exhausted, permitting
manual screen wake. Thirty seconds of continued video arrival restores the
budget; an isolated header burst does not. This has been simulated; its ability
to recover this camera's sleep pause remains a hardware test.

Reports include `appBuild` and native `connection.build`, plus relay
`stallRestarts`. Studio and Settings show the frontend revision. These distinguish
an old executable from a newly pulled source checkout. The uploaded report still
used pre-`3fac72b` “accepted” log wording and had no newer attempt-end summaries,
so rebuild and launch the intended Dev executable before comparing results.

## Exam use

These tools do not establish WGU or Guardian approval. Use a physical external
USB webcam meeting WGU's requirements unless the institution and provider
confirm this exact Luna/virtual-camera setup. See [STUDIO_RESEARCH.md](STUDIO_RESEARCH.md).

# Luna Studio setup

## Intended installation experience

The Windows build includes its own video engine. An installed user should not
need Python, FFmpeg, PowerShell, Git, Bun or Rust. Studio checks for the **OBS
Virtual Camera** driver and offers the official OBS download when it is missing.
Installing OBS is a separate, explicit user action; Luna does not silently
install drivers or change Windows script policy.

Public installer distribution remains blocked by the repository's missing
license and empty Cargo license field. Preserve the upstream author's credit.
Review bundled Python/PyAV/FFmpeg/numpy/pyvirtualcam notices before distribution.
The new installer flow still needs clean-Windows and coexistence testing.

## Test the new development build on your Windows checkout

Stop the existing command-line bridge with Ctrl+C. Close **Luna Ultra Webcam
Dev** before rebuilding it; leave the separately installed upstream application
intact. Do not run two virtual-camera publishers at once.

Run these commands **in order**, each as its own line:

```powershell
Set-Location "C:\Users\auxny\Documents\Codex\2026-10-03\new-chat\luna-ultra-desktop"
git status --short --branch
git pull --ff-only origin feature/webcam-bridge
bun install --frozen-lockfile
bun run build
& ".\src-tauri\target\release\Luna Ultra Webcam Dev.exe"
```

If Git reports overlapping local changes, stop and preserve them. Building
requires the existing Rust/MSVC prerequisites, Bun, Python 3.11+ and internet.
The build packages Python into the helper, tests its dependency imports, then
creates local Windows MSI/NSIS bundles. Do not install or distribute those
bundles yet. The native executable uses the same separate development identity.

Windows Tauri builds automatically select `tauri.windows.conf.json`, which runs
`tools/build-windows.ps1`. The helper is packaged one-directory rather than
one-file so the app supervises the actual process, not an extraction child.

## First run

1. Install OBS Studio from its official website if Studio reports a missing
   camera driver. Keep OBS's **Start Virtual Camera** publisher stopped.
2. Join the Luna Wi-Fi network, keep the camera mode fixed, and select
   **Connect Luna**. Open **Studio**.
3. Choose Landscape, Portrait or upscaled Full HD. Start with Landscape 720p30,
   the conservative general-purpose preset. Source dimensions and measured
   cadence appear once the decoder is running.
4. Click **Start webcam**. Select **OBS Virtual Camera** in Chrome or Discord.
   Navigation to Settings should not interrupt the output. Click **Stop webcam**
   to release the publisher. Closing Luna terminates its supervised helper.
   Clicking **Disconnect** also releases output; a Wi-Fi interruption preserves
   it for recovery. Windows Camera need not list a DirectShow virtual camera;
   use a browser, conferencing app or OBS for the acceptance test.
5. In Settings, choose the camera's white or black body once. The choice is
   remembered by serial and follows that camera when it reconnects. “Auto”
   follows app theme, not a verified camera-body detection field.

If this is an unbundled `bun run dev` build, the checklist instead offers
**Prepare webcam** to create a private runtime inside the app's local data
folder. It needs Python and internet once. The installed/build-bundled path does
not need this step.

## Streaming

Studio's **Take it live** guides cover calls, OBS and Whatnot. For OBS, add a
**Video Capture Device** source and select **OBS Virtual Camera**, then add your
microphone separately. Configure the destination in OBS and use OBS's **Start
Streaming** control. Do not start OBS's virtual-camera publisher, which would
compete with Luna for the same output.

For Whatnot, follow the broadcaster's current account/platform instructions;
availability and broadcast configuration can vary. Actual Whatnot broadcasting
has not been tested here. The app does not claim a show is live just because
its local webcam is publishing. Direct in-app RTMP and camera audio are later
phases, not features in this build.

## Acceptance pass on real hardware

- Start/stop three times; select the feed in Chrome and Discord.
- Switch Studio → Settings → Camera → Studio while output runs.
- Unplug/rejoin Wi-Fi; keep the consumer open. Check recovery and source metrics.
- Close Luna while output runs; verify no `webcam-bridge.exe` remains in Task
  Manager and a subsequent launch can publish again.
- Try portrait and landscape; confirm black bars, mirroring and no stretching.
- Run a timed 60-minute soak, then Teams/Zoom and an actual Whatnot session.
- Record firmware, source/output settings, latency method and failures. Separate
  these results from the earlier successful external Python-bridge tests.

The source preview's dimensions and cadence depend on mode and firmware. 1080p
is marked **upscaled**; it does not unlock extra camera detail. A 60fps virtual
camera would repeat frames unless a higher-cadence source is actually measured.
Existing probes do not establish the firmware's absolute preview maximum.

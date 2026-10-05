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
2. Join the Luna Wi-Fi network and select
   **Connect Luna**. Open **Studio**.
3. Choose Landscape, Portrait or upscaled Full HD. Start with Landscape 720p30,
   the conservative general-purpose preset. Source dimensions and measured
   cadence appear once the decoder is running.
4. Leave **Match camera mode** on to prepare the tested source mode, or turn it
   off to **Keep my camera settings**. Landscape and Full HD currently select
   **Slow-mo**; Portrait selects **Video**. These match the measured configuration,
   not a universal firmware capability. Shooting orientation is still set on
   the camera. Switching into Slow-mo also requests Standard color/no filter;
   an already matching mode keeps its settings. The app never starts recording.
   Click **Start webcam**. Select **OBS Virtual Camera** in Chrome or Discord.
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
its [official OBS guide](https://help.whatnot.com/hc/en-us/articles/5497980244749-Using-OBS-with-your-Livestream)
currently uses **Show Tools**, OBS WebSocket and **WHIP**, with a **1080×1920**
vertical canvas. Let Show Tools apply the required profile/settings and the
per-show bearer token. After initial profile setup, close/reopen OBS and reconnect
Show Tools as the official guide instructs; start the show from Show Tools.
Luna's 720×1280 portrait output can be scaled by OBS, but its native source detail
does not increase. Keep OBS's virtual-camera publisher stopped while Luna owns it.

Availability and broadcast configuration can vary. Actual Whatnot broadcasting
has not been tested here. Studio includes dedicated Show Tools guidance and a
link to the official instructions. The app does not claim a show is live just because
its local webcam is publishing. Direct in-app broadcasting and camera audio are
later phases, not features in this build.

## Camera quality, portable networking and exams

Full HD scales the landscape source to virtual-camera output size. Mode matching
is now implemented; native preview-resolution negotiation is still planned.
See [STUDIO_RESEARCH.md](STUDIO_RESEARCH.md) for evidence,
mode/orientation recommendations and the hardware test gates.

On an MSI Claw or another single-Wi-Fi PC, plan **camera Wi-Fi + USB-C Ethernet
for internet**, or **home Wi-Fi + a second USB Wi-Fi adapter for the camera**.
Wi-Fi 7 does not establish simultaneous access to two unrelated networks on one
adapter. Check both camera reachability and internet access before a live show.
Luna USB-C file transfer is supported; direct USB webcam use is officially
unsupported, and model-specific USB preview support is not established.

The Luna/OBS bridge is **not established as WGU-approved**. WGU specifies an
external webcam with microphone, placement/cable requirements and Guardian
Browser. Guardian may require background capture/streaming applications to close.
Use a physical external USB webcam meeting WGU's specifications for exams unless
WGU and the proctoring provider confirm this exact software-assisted setup.
Browser webcam tests do not establish exam-policy acceptance. Details and official
policy links are in [STUDIO_RESEARCH.md](STUDIO_RESEARCH.md#wgu--proctored-exams).

## Acceptance pass on real hardware

- Test a cold connection five times; record time to first picture and whether
  the automatic preview retry helps. The initial startup problem is not yet
  root-caused. A byte timeout is distinct from successful frame decoding.
- Start each profile with mode matching on. Check the camera's actual mode and
  orientation, source dimensions and measured cadence. Test matching off with
  the original working mode. Full HD must remain labeled upscaled.
- While recording on the camera, ask Studio to match a different mode: it must
  refuse to write settings. Stop during startup: no later dependent writes or
  publisher should start. A command already in flight may have reached Luna.
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

## Startup recovery and diagnostics

An elementary preview with no bytes after six seconds is stopped and restarted
once. Another six seconds without bytes ends automatic startup retries and
shows **Retry preview**. Camera connection remains separate. The webcam helper
waits up to twenty seconds for its first decoded frame, then reports a useful
error and releases its worker rather than waiting forever. After publication,
the existing slate/reconnect behavior still handles temporary Wi-Fi loss.

The preview reader retries an ended/broken HTTP stream twice, with a fresh
decoder. Changed codec headers or lost encoded packets close affected relay
clients so they can join the current headers and a clean keyframe. Stop also
cancels accepted HTTP clients, including a blocked writer.

In **Connection & diagnostics**, use **Export camera report** for acknowledged
option types, mode/posture metadata and source/output measurements. It uses
known GET commands through the current session and excludes device credentials.
Read [DEVICE_DIAGNOSTICS.md](DEVICE_DIAGNOSTICS.md) for the Windows USB/network
inventory script and before/after steps. These new changes are automated-tested;
real Luna/Windows acceptance is still pending.

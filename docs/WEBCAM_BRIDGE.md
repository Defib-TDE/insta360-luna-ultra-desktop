# Windows webcam bridge

This development branch exposes the camera's real Annex-B preview stream over
loopback and converts decoded frames into a Windows virtual camera. It does not
mirror a window or capture the screen.

## Prerequisites

1. Install Python 3.11 or newer.
2. Install OBS Studio with its **OBS Virtual Camera** component, or install
   Unity Capture. OBS supplies the virtual-camera driver; OBS does not need to
   capture the Luna app window.
3. Build and run **Luna Ultra Webcam Dev**, connect to the Luna Ultra over
   Wi-Fi, and leave the Camera page open.

The development app uses its own bundle identifier and display name and has no
auto-updater, so it can coexist with the upstream Luna Ultra Desktop install.

## Verify the camera stream first

The Camera toolbar exposes **Copy stream URL** once the control-session stream
is active. The relay prefers `http://127.0.0.1:49183/stream`; use the copied URL
if the app reports a fallback port.

From PowerShell at the repository root:

```powershell
.\tools\start-webcam.ps1 -Url http://127.0.0.1:49183/stream -ProbeOnly
```

Success is one JSON line containing `decodedFrames`, `width`, `height`, and the
decoder's frame-rate estimate. Record the output rather than assuming 1080p;
published testing found 1280×960 H.264, but the connected camera and firmware
are authoritative. On 2026-10-03, six fork hardware probes decoded HEVC at a
reported 25 fps across mode switches, with observed dimensions of 1280×720,
720×1280, and 1280×960. Select HEVC explicitly for that tested camera:

```powershell
.\tools\start-webcam.ps1 -Url http://127.0.0.1:49183/stream -Codec hevc -ProbeOnly
```

An independent FFmpeg check is also useful:

```powershell
ffprobe -hide_banner -f h264 -probesize 3M -analyzeduration 3M -show_streams http://127.0.0.1:49183/stream
```

If H.264 reports invalid data, retry with `-Codec hevc` and record the camera
mode with the result. Do not change the default globally until other modes and
firmware versions have been measured.

## Start the virtual camera

```powershell
.\tools\start-webcam.ps1 -Url http://127.0.0.1:49183/stream -Codec hevc -Backend obs
```

The launcher creates an isolated `.venv-webcam`, installs the locked-range
Python dependencies, and starts the bridge. It keeps only the freshest decoded
frame, so a late join or short decoder burst does not build lasting latency. If
the loopback stream disappears temporarily, it retries with bounded backoff.

Then select **OBS Virtual Camera** in Teams or Zoom. In OBS, add a Video Capture
Device source and choose **OBS Virtual Camera** only if OBS is consuming the
driver rather than already publishing its own scene to it.

The first fork hardware test successfully published 720×1280 at 25 fps through
the OBS backend and consumed 30 NV12 frames through Windows DirectShow. Chrome
also selected **OBS Virtual Camera** on webcamtests.com and displayed the live
Luna feed, and Discord selected the same camera and rendered the feed. The
Windows Camera app did not list that portrait-format device even though
DirectShow, Chrome, and Discord did, so use a standard 1280×720 output for the
broadest compatibility:

```powershell
.\tools\start-webcam.ps1 -Url http://127.0.0.1:49183/stream -Codec hevc -Backend obs -Width 1280 -Height 720 -Fps 25
```

The first 1280×720 Discord validation completed three Ctrl+C stop/restart
cycles and returned to live video each time. One start also recovered from
transient loopback-stream errors after bounded retries. A subsequent test left
the bridge and Discord running while the app stream was deliberately stopped
and restarted, then while the camera Wi-Fi was disconnected and reconnected;
moving video recovered without restarting the bridge or Discord in both cases.
The observed recovery was immediate, but it was not timed.

A browser test measured the virtual device as 1280×720, RGB, 25 fps, with no
built-in microphone. Setting `-Fps 60` makes the virtual camera submit its most
recent frame 60 times per second, but it does not create 60 unique camera frames.
With the currently observed 25 fps Luna preview, most of those submissions are
duplicates. True 60 fps motion requires the camera's elementary preview stream
itself to deliver approximately 60 newly decoded frames per second.

Likewise, `-Width 1920 -Height 1080` exposes a 1080p virtual-camera format but
does not add detail to a 1280×720 source. A 16:9 source is scaled to fill 1080p;
4:3 and portrait sources are scaled to fit with black bars instead of being
stretched. Test 1080p30 before 1080p60 because RGB submission cost grows with
both pixel count and output cadence.

Useful options:

```powershell
# Explicit virtual-camera cadence after measuring the real feed
.\tools\start-webcam.ps1 -Fps 30

# Letterbox into 1920×1080 without stretching a 4:3 camera feed
.\tools\start-webcam.ps1 -Width 1920 -Height 1080

# Unity Capture instead of the OBS virtual-camera driver
.\tools\start-webcam.ps1 -Backend unitycapture
```

Camera audio is not established and is not included. Select a separate
microphone in Teams, Zoom, or OBS.

## Hardware validation checklist

Keep camera mode fixed while running this sequence:

1. Cold start: connect the app, open Camera, probe the stream, then start the
   bridge and join a Teams/Zoom/OBS preview.
2. Late join: leave preview running for at least one minute, then start the
   bridge. Confirm the first clean picture appears without restarting preview.
3. Stop/restart: stop the bridge with Ctrl+C and start it again three times.
4. App stream restart: leave the bridge retrying, leave and re-enter Camera,
   and confirm the preferred loopback URL recovers.
5. Wi-Fi reconnect: interrupt the camera Wi-Fi long enough for the app to
   reconnect, then confirm video recovers without restarting the bridge.
6. Sustained run: operate for at least 60 minutes while watching memory, frame
   continuity, and glass-to-glass latency.

Record firmware, app version/commit, codec, profile, actual dimensions, actual
FPS, startup time, reconnect time, and latency method with every result.

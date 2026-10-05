# Studio quality, exam compatibility and transport research

Research checked 2026-10-04 (America/New_York). Application reviewed at
`bdf71570fa1d5f1cba9e9b623268af6bcdb6526d`; upstream inspected through
`11b1acb58ef0e0188f1ac5231d27b379ba617153` (`v0.3.3`).

## Recommendation and goal

Keep the working HEVC → supervised video engine → OBS Virtual Camera path.
Improve startup recovery and add verified camera preparation before pursuing
another decoder or virtual-camera backend. Treat framing, native source quality
and destination output as separate controls. Make the normal flow **connect →
choose a frame → Start webcam**, with readable progress and a fixed-mode option.

Investigate native 1080p through the preview request, rather than assigning a
different capture mode to every output resolution. Ordinary Video with an
explicit shooting orientation is the preferred hypothesis to test. Slow-mo is
a measured landscape fallback, not a universal quality upgrade. Neither native
1080p nor native 60fps has been established on this camera.

For WGU exams, recommend a physical external USB webcam that meets WGU's
requirements. Our Luna software bridge has no established institutional
approval. For the MSI Claw, plan camera Wi-Fi plus a separate internet adapter;
a USB-C Ethernet adapter is the simplest reliable layout to validate first.

This increment records research and corrects planning/setup documentation. It
does not change the running app, force camera settings, install drivers, alter
Windows routes, modify firmware or claim new hardware-test results.

## Evidence and research method

Exa returned 110 search results across 19 targeted queries, deduplicated to 92
URLs. Investigation covered preview negotiation, mode/orientation, recovery,
webcam backends, Whatnot, WGU, USB and handheld networking. Manufacturer,
university, proctoring-provider and API documentation were preferred. Third-party
protocol implementations identify experiments, not Luna firmware guarantees.
Search snippets were checked against full primary pages where material.

The latest Windows transcript proves a local Studio build, packaged engine
dependency check and MSI/NSIS creation at `bdf7157`. The user reports that the
integrated app worked well after reconnecting on the first attempt, looked good,
and kept the same native source size when Full HD was selected. This is a useful
integrated hardware pass; it does not establish repeatable cold starts, clean
installation, proctored-exam acceptance or a completed soak test.

Earlier 250-frame HEVC probes were run in this exact order:

| Camera mode | Decoded source | Observed decode fps | First frame |
| --- | --- | --- | --- |
| Slow-mo | 1280×720 | 29.981 | 0.528 s |
| Photo | 720×1280 | 29.992 | 1.288 s |
| Pano | 1280×720 | 30.013 | 0.531 s |
| Timelapse | 1280×960 | 23.700 | 1.919 s |
| PureVideo | 720×1280 | 29.966 | 1.854 s |
| Video | 720×1280 | 30.025 | 0.793 s |

These are observations of one camera configuration, not mode-wide limits.
Shooting orientation, per-mode recording settings, firmware, lighting and lens
state were not captured alongside every sample. Wall-clock decode cadence is
also affected by startup/GOP buffering; it is not a sensor-clock measurement.
FFmpeg's reported 25fps was a raw-stream heuristic. Chrome, Discord and
DirectShow consumption, external-bridge restart and Wi-Fi recovery are proven.
Actual Teams, Zoom, Whatnot, camera audio and a timed 60-minute soak remain open.

## Why Full HD did not change the source

There are three separate layers:

1. **Recording configuration:** mode, orientation, aspect, recording size/fps,
   exposure and color. Recorded 4K/8K/240fps support does not establish those
   qualities for a Wi-Fi preview [S1, S2].
2. **Camera preview request:** `build_start_live_stream_body()` in
   `src-tauri/src/liveview.rs` always sends command 1 with field 7 = 9
   (`RES_1440_720P30`), field 6 = 40, and the known-good secondary-stream fields.
   It currently accepts no Studio quality/profile argument. Despite that request,
   this Luna returned the mode-dependent dimensions above.
3. **Virtual-camera output:** `webcamProfiles.ts` passes output width/height/fps
   to the helper. `frame_pixels()` scales to fit, centers and adds black bars.
   It does not ask the camera to change its stream. Full HD therefore produces
   1920×1080 output from the same source. 60fps output would repeat fresh source
   images when the camera provides about 30fps.

Insta360's general SDK guide distinguishes adjustable preview resolutions on
some cameras from fixed preview on X4/X5 [S3]. Other-model implementations use
the same `StartLiveStream.resolution` field, sometimes requesting 1080p [S4].
This creates a credible test route, but is not evidence that Luna honors it.
Our schema names 29 as `RES_1920_1080P30` and 40 as `RES_1920_1080P60`; enum
existence alone proves neither preview support nor accepted frame cadence.
The field 6 value of 40 is preserved protocol data, not a measured 40Mbps rate.

### Controlled source-quality experiment

- Keep mode, orientation, lighting and recording settings fixed. First measure
  the existing field-7 value 9 with at least 300–600 decoded frames after warmup.
- Stop preview, request 29 (1080p30), then restart through the same established
  session. Keep all unrelated request fields unchanged. Inspect decoded frame
  dimensions, steady cadence, encoded bitrate, keyframe interval and latency.
- A command acknowledgement is insufficient. Report requested versus delivered
  quality, with explicit `unsupported`, `ignored`, `timed out` or `verified`
  outcomes. If bytes/decoded frames do not arrive within a finite deadline,
  restore the known-good request and restart once. Do not cycle settings forever.
- Only after 1080p30 works repeatedly, test the named 60fps preset with the same
  safeguards. Compare image detail and cadence, not just output dimensions or
  a consumer's configured frame rate.
- Reconnect, repeat cold starts, late joins and a sustained run before enabling
  a new quality in the normal UI. Persist successful capabilities by serial and
  firmware; invalidate the result when firmware changes.

## Automatic camera preparation

The official Luna orientation page documents separate Landscape, Portrait and
adaptive settings. Video and PureVideo support portrait; Slow-mo offers landscape
ratios [S1]. The portrait Video result may reflect saved orientation rather than
an intrinsic restriction of Video mode. Test Video in both orientations first.
No writable Luna orientation command/field is verified in our current schema.
`CAMERA_POSTURE` is posture information, not an established orientation setter.

| Studio choice | Preferred camera preparation to validate | Verified fallback / honest output |
| --- | --- | --- |
| Landscape 720p30 | Video + landscape orientation | Slow-mo yielded 1280×720/~30fps on this unit |
| Portrait 720p30 | Video + portrait orientation | Video yielded 720×1280/~30fps on this unit |
| Full HD 1080p30 | Video + landscape; request native 1080p only after calibration | Same landscape source, clearly labeled upscaled |

Timelapse produced more total native pixels (1280×960) but lower cadence and a
4:3 frame. At the current fit setting it occupies 1440×1080 inside a 1920×1080
canvas, leaving side bars. Cropping it to fill 16:9 discards pixels. It is not a
clear improvement for motion-heavy calls/live shows. Slow-mo also restricts
recording choices and continuous zoom [S2]; current mode code resets color/filter
when entering it. Automatically choosing it has settings consequences.

Implement a single preparation transaction owned by `useStudioSession`, rather
than separate page watchers writing modes:

1. On **Start webcam**, snapshot the requested profile and current camera state.
   Check capture status; refuse to change mode/orientation during a recording or
   when idleness cannot be confirmed. Existing `readCaptureStatus()` maps empty
   responses to idle, which is insufficient for this new guard.
2. If already suitable, leave the camera settings alone. Otherwise pause the
   relay, issue one supported mode write, check accepted option types and verify
   camera readback within a finite deadline. Handle proto3 zero-valued Video
   correctly; missing fields without supported-option evidence are not proof.
3. Refresh dependent settings. Expose any required color/filter reset instead
   of silently changing unrelated image preferences. Until the orientation
   setter is calibrated, offer a short camera-screen instruction and verify
   the resulting decoded aspect. Do not rotate a portrait frame and call it a
   landscape composition without the user's framing choice.
4. Restart preview with fresh headers/keyframes, confirm decoded video, and
   publish at stable consumer dimensions. Show “Preparing camera” followed by
   actual camera mode, source and output, not optimistic success.
5. Support **Keep my camera settings**, cancellation, and a manual fallback if
   the camera ignores a write. Apply preparation once per explicit Start;
   recovery verifies state rather than repeatedly forcing modes. Stop/Disconnect
   must cancel pending work. Any optional restoration checks that the user has
   not since changed the camera state and that no recording is active.

`useCameraCapture.selectMode()` currently ignores the returned accepted-option
list and immediately sets the selected mode before readback. It can also reset
color/filter after an ignored mode write. Fixing this shared behavior should
precede Studio automation; use bounded readback verification for both entry points.

## Startup and recovery priorities

The user's first-connect report is plausible given these concrete code paths;
the root cause is not yet proven:

- `useLiveView.start()` marks the relay active after the start acknowledgement.
  Its six-second no-byte timer shows an error but does not retry. The shell only
  retries when `live.active` is false, so an accepted-but-silent relay can remain
  active indefinitely.
- The helper waits for its first decoded frame with `latest.get()`. The decoder
  retries with backoff, but initial startup has no overall deadline.
- The UI's `LiveView.vue` read failure or clean EOF does not itself restart the
  HTTP reader while the active flag/URL remain unchanged. The separate Python
  decoder can be healthy while the visible preview is stuck.
- A source-pump `Lagged` event currently continues without invalidating its
  cached GOP. Missing encoded data can leave late-client bootstrap undecodable;
  discard the incomplete GOP and wait for a new keyframe. Do the same for
  changed codec headers/dimensions; test fragmented parameter sets separately.
- Connection success launches media-library refresh while Studio may be starting
  video. Measure this overlap before blaming it; consider deferring unnecessary
  gallery work while preparing webcam output.

Instrument connection, start acknowledgement, first byte, codec headers,
keyframe, first decoded frame and publication separately. Add one bounded
preview-only restart before asking for a full reconnect. Use operation/session
tokens so delayed timers cannot affect a new session. Preserve the fixed webcam
format and reconnect slate; Stop must remain responsive during every stage.
Review whether future lag policy should disconnect/re-bootstrap a reader rather
than appending a second copy of a GOP to an in-progress decode stream.

Studio currently renders the source in WebCodecs while the helper independently
decodes/composes output. Make the preview framing truthful for fit/fill/rotation
and show source versus output dimensions even before publishing. Measure Claw
CPU, memory, power and latency before considering native HEVC/GPU decoding or a
shared composed-frame preview. A rewrite is not justified by the current evidence.

## Streaming and virtual-camera backend choices

Stay with the working bundled engine and OBS driver initially. End users need
neither Python nor OBS running to use this virtual-camera backend, but the driver
must be installed. pyvirtualcam documents one OBS camera instance [S5]: Luna and
OBS cannot both publish to it. OBS may consume it and broadcast through its
network encoder. An OBS-composed virtual webcam would need a different input
backend (for example Unity Capture) or a future dedicated Luna camera.

Whatnot's current official guide uses its Show Tools page and OBS WebSocket to
apply required settings and a per-show bearer token. It specifies **WHIP** and a
**1080×1920** canvas, including an OBS restart after initial profile setup [S6].
Replace the current generic “Start Streaming in OBS” Whatnot instructions with
that workflow and a current official link. Our 720×1280 portrait camera can be
scaled by OBS; it does not become a native 1080×1920 source. Validate an actual
show and microphone synchronization before promising Whatnot compatibility.
Generic RTMP publishing is a later separate feature, not the assumed Whatnot path.

A native Windows Media Foundation virtual camera could eliminate OBS setup and
offer a dedicated Luna device visible to more Windows clients. Microsoft provides
`MFCreateVirtualCamera` from Windows build 22000 (Windows 11) and a full sample
with custom media-source, registration, installer and cleanup components [S7].
This is user-mode software, but still requires substantial COM/frame-server,
format and installation work. Prototype after the proven path is stable. A native
virtual camera would still be a virtual camera, with no implied exam approval.

## WGU / proctored exams

**Do not present the present Luna/OBS path as WGU-approved.** WGU's official
technology policy requires an external webcam, integrated microphone, elevation
at least eight inches above the desktop and a cable at least three feet long.
It literally lists “HD 720p (1366x768)” plus minimum width/vertical dimensions;
1366×768 is not the usual 1280×720 definition, so preserve the published wording
and confirm interpretation rather than declaring our 1280×720 output compliant.
The policy also specifies Guardian, one monitor and at least 5Mbps upload/download
[S8]. ProctorU's generic 640×480/3Mbps floor does not override WGU's stricter rules.

Guardian's official guidance says capture/recording/streaming applications can
be detected and required to close; the school controls session-specific rules
and the full denylist is not public [S9]. The published examples do not establish
an explicit universal OBS ban, but they also do not approve our separate Luna
application and helper. OBS need not run for this bridge; that fact alone does
not resolve approval of its virtual driver or the background bridge processes.
Passing Chrome webcamtests or even an equipment check is not policy approval.

Camera audio is absent from our bridge, and placement/stability still require
checking. Renaming the device, hiding the helper or changing backends would not
resolve these requirements. A conventional physical USB webcam with integrated
microphone and appropriate tripod/cable is the recommended exam setup today.

If the user wants Luna approved, obtain written confirmation from WGU Assessment
Services and the assigned proctoring provider before an exam, then run Guardian's
equipment test and any offered practice session. Suggested inquiry (not sent):

> May I use a physically external Insta360 Luna Ultra whose live Wi-Fi video is
> decoded by a companion application and published through OBS Virtual Camera?
> The companion app and video helper remain running; OBS Studio does not need to
> run. Camera audio is currently unavailable through the bridge. Would this meet
> the external-camera, microphone and permitted-software rules for my assessment?

The Claw's Windows 11/x86 platform, memory and screen resolution are promising,
but handheld branding is not proof of Guardian acceptance. Check the actual
device, scaling, CPU load, keyboard/mouse and microphone. WGU prohibits on-screen
keyboards and headphones for its objective assessments [S10]. Its listed 2.4GHz
CPU floor should be checked with support/equipment tests against this processor's
2.2GHz base/boost behavior, rather than declaring eligibility from boost speed.
Third-party certification exams may have different provider rules.

## USB-C feasibility

| Route | Evidence | Practical conclusion |
| --- | --- | --- |
| Luna directly as a USB UVC webcam | Luna computer guide explicitly says webcam use is unsupported [S11] | A USB-C cable alone does not provide an established webcam route |
| Official desktop SDK over USB | Preview exists for supported models; published model list is panoramic cameras, not Luna [S3, S12] | Ask/verify model support before building an SDK integration |
| Existing protocol over USB networking | No Luna USB Ethernet/RNDIS/NCM interface is established | Enumerate interfaces read-only; reuse TCP only if a usable network interface really exists |
| Proprietary USB preview protocol | No documented Luna transport or permission/driver flow found | Higher-effort research only after descriptors and support response |
| USB-C/HDMI capture adapter | No supported Luna HDMI/DisplayPort live output is documented in the reviewed model sources | Do not buy a capture adapter on the assumption that USB-C carries video out |
| USB-C powering Luna while video stays on Wi-Fi | Charging is documented; simultaneous preview under the exact powered setup is untested | Test camera-side connection choices and sustained temperature/battery behavior |
| USB-C Ethernet or second Wi-Fi for the PC | Claw has two Thunderbolt 4/USB-C ports [S13] | Solves internet connectivity without assuming a new camera transport |

The Luna phone/tablet guide documents USB **File Transfer**, not wired camera
control [S14]. File transfer mode might interrupt the shooting/preview session;
do not enter it during a live show. For discovery, snapshot Windows Camera,
Imaging, USB and network devices before/after connecting, record USB interface
class descriptors using USBView if needed, and record the camera's offered modes.
Do not replace drivers, enable root services or flash firmware for this test.
A successful future USB software feed would still need a virtual-camera sink
unless the camera itself exposes UVC; it would not automatically solve WGU approval.

## MSI Claw camera plus internet networking

MSI lists Windows 11 Home, an Intel Core Ultra 7 258V, 32GB RAM, 1920×1200 display,
Wi-Fi 7 and two Thunderbolt 4 ports for the A2VM-001US [S13]. Regional SKUs vary;
check the actual adapter rather than assuming every Claw uses an identical radio.

The current Luna camera AP is a local network at 192.168.42.1. Joining that AP
on a normal single Windows Wi-Fi interface replaces its home-Wi-Fi association.
Multi-band antennas and Wi-Fi 7 MLO do not establish a second independent network:
MLO links a station and an AP multi-link device, and both ends need MLO [S15].
Intel documents Double Connect on particular AX411/AX1690 parts; the reviewed
Claw/BE1750 material does not establish simultaneous associations to these two
unrelated APs. Killer DoubleShot combines Ethernet and Wi-Fi [S16]. Do not promise
“dual Wi-Fi” from that name or from the 2×2 spatial-stream specification.

| Layout | Feasibility | Recommendation |
| --- | --- | --- |
| Claw Wi-Fi → Luna; USB-C Ethernet → internet router | Two distinct network interfaces; requires cable/adapter | First validation target, especially for sustained broadcasting |
| Claw internal Wi-Fi → home internet; USB Wi-Fi → Luna | Two independent Wi-Fi adapters; drivers/bands must work together | Portable alternative; validate simultaneous capture and upload |
| Single adapter joining both home and Luna APs | Not established for this Claw/driver | Do not make it the standard setup |
| USB phone tether → internet; Wi-Fi → Luna | Possible internet transport, data/reliability costs | Backup for general use; WGU strongly discourages tethering/hotspots |
| Luna station mode on the home LAN | Generic camera-protocol precedents exist, Luna support unverified | Future experiment with explicit recovery; do not silently change camera Wi-Fi |
| USB video → Claw; Wi-Fi → internet | Desirable topology, camera USB video unavailable so far | Research goal, not a presently supported path |

Windows selects the most specific matching route, then uses metrics between
equal-prefix candidates [S17]. Keep the internet default route on the actual
internet adapter and the camera subnet on its adapter; inspect IPv4/IPv6 and DNS
if internet disappears. A home LAN/VPN using the same 192.168.42.0/24 subnet can
conflict. Separate adapters do not automatically cure overlapping addressing.
Prefer read-only diagnosis first; avoid automatic route, DNS or firewall changes.

Add a simple onboarding check: **Camera reachable** and **Internet reachable**
independently, with the relevant interface names and a specific adapter suggestion
when only the camera network is available. Do not require internet for offline
preview/webcam operation after installation. For a live show, validate simultaneous
camera decoding, upload, charging, thermals and recovery on the actual Claw.

## Prioritized delivery and gates

| Order | Concrete increment | Required evidence |
| --- | --- | --- |
| 1 | Instrument and recover initial preview; repair mode-write verification | Mock late/ignored/rejected replies, cancellation and stale sessions; 20 healthy-Wi-Fi cold starts without manual reconnect |
| 2 | Add camera preparation to Studio with fixed-mode fallback | Hardware readback and displayed mode agree; both orientations tested; no write during capture/unknown status; no unwanted filter resets |
| 3 | Add experimental preview quality negotiation and calibrated fallback | Native decoded 1080p/60fps measured if available; unsupported/ignored outcomes and rollback tested; defaults remain known-good |
| 4 | Exact output preview, fit/fill/rotation and accurate Whatnot guide | Matching consumer framing, keyboard/minimum-layout checks; actual Whatnot Show Tools/WHIP session and microphone sync |
| 5 | Network onboarding and Claw validation | Ethernet + Wi-Fi and dual-adapter scenarios; concurrent upload, source cadence, latency and 60-minute thermal/power soak |
| 6 | USB exploration / native Windows camera prototype | Model-specific USB support or interface evidence; backend registration, clean install/uninstall and client compatibility |

For step 1, aim for first decoded video within five seconds on a healthy local
network; this is a proposed target, not a result. Record percentiles and failures.
Software tests remain separate from physical camera/OBS/Guardian acceptance.
WGU suitability stays unclaimed pending institutional confirmation, even if a
different transport or native backend is implemented.

Upstream `v0.3.3` adds streaming large downloads to disk and transfer-aware
keepalive handling [S18]. Review the fix in a separate maintenance increment,
adapt it to our modified `luna.rs`, and test downloads while webcam output runs.
Do not blindly import upstream version/app identity/updater changes. The upstream
license is still absent; clean installer testing, signing, bundled notices and
redistribution rights remain separate distribution gates.

## Sources

- **S1 — Official Luna orientation and aspect guide:** [Landscape/Portrait](https://onlinemanual.insta360.com/lunaultra/en-us/operation-tutorials/shooting-preview/shooting-specs/screen-ratio). Model-specific controls and recording restrictions; does not describe Wi-Fi preview guarantees.
- **S2 — Official Luna recording specs:** [Photo & Video Specifications](https://onlinemanual.insta360.com/lunaultra/en-us/specs/shooting). Mode/fps/zoom table, not a preview capability table.
- **S3 — Official SDK integration guidance:** [Integration Guide](https://onlinemanual.insta360.com/developer/en-us/resource/integration). USB/preview distinction and model-dependent preview limits; Luna support cannot be inferred.
- **S4 — Practitioner protocol implementation:** [insta360ctl protocol](https://github.com/xaionaro-go/insta360ctl/blob/main/doc/protocol.md) and [Rigacci ONE RS implementation](https://github.com/RigacciOrg/insta360-wifi-api/blob/main/insta360.py). Concrete request fields; other models, not Luna quality validation.
- **S5 — Webcam engine maintainer:** [pyvirtualcam README](https://github.com/letmaik/pyvirtualcam/blob/master/README.md) and [API](https://letmaik.github.io/pyvirtualcam/). Installed-backend dependence and single OBS instance.
- **S6 — Whatnot Support:** [Using OBS with your Livestream](https://help.whatnot.com/hc/en-us/articles/5497980244749-Using-OBS-with-your-Livestream). WHIP, Show Tools/WebSocket, bearer-token lifecycle and vertical canvas; prefer over older generic RTMP tutorials.
- **S7 — Microsoft APIs and working sample:** [MFCreateVirtualCamera](https://learn.microsoft.com/en-us/windows/win32/api/mfvirtualcamera/nf-mfvirtualcamera-mfcreatevirtualcamera) and [Windows Camera sample](https://github.com/microsoft/Windows-Camera/blob/master/Samples/VirtualCamera/README.md). OS floor and implementation components; no proctoring endorsement.
- **S8 — WGU policy:** [Computer System and Technology Requirements](https://cm.wgu.edu/t5/WGU-Student-Policy-Handbook/Computer-System-and-Technology-Requirements/ta-p/78). Institution-specific webcam, microphone, placement, connection and Guardian requirements.
- **S9 — Proctoring provider:** [Unpermitted Applications](https://support.proctoru.com/hc/en-us/articles/46589198199565-Unpermitted-Applications). School-specific application checks, incomplete public list; does not explicitly approve/ban this exact bridge.
- **S10 — WGU assessment policy:** [Assessment Policies](https://cm.wgu.edu/t5/WGU-Student-Policy-Handbook/Assessment-Policies/ta-p/133). External camera, secure environment, single display, no on-screen keyboard/headphones.
- **S11 — Official Luna computer connection guide:** [Transferring Files from Camera to Computer](https://onlinemanual.insta360.com/lunaultra/en-us/operation-tutorials/connection/pc). USB file transfer and explicitly unsupported webcam use.
- **S12 — Official SDK model list:** [SDK Guide](https://onlinemanual.insta360.com/developer/en-us/resource/sdk) and [Desktop Camera SDK](https://github.com/Insta360Develop/Desktop-CameraSDK-Cpp). Published panoramic-model support; no verified Luna USB preview.
- **S13 — MSI exact US SKU:** [Claw 8 AI+ A2VM-001US](https://us-store.msi.com/Claw-8-A2VM-001US). Hardware specifications only; actual driver and exam acceptance need testing.
- **S14 — Official Luna phone connection guide:** [Phone/tablet transfer](https://onlinemanual.insta360.com/lunaultra/en-us/operation-tutorials/connection/phones-tablets). USB file transfer, not demonstrated wired shooting control.
- **S15 — Networking manufacturer explanation:** [TP-Link MLO](https://www.tp-link.com/us/blog/1067/). AP/STA multi-link scope and both-end support; vendor marketing performance numbers are not Claw measurements.
- **S16 — Intel feature definitions:** [Killer series](https://www.intel.com/content/www/us/en/products/details/wireless/killer-series.html) and [AX411/AX1690 Double Connect brief](https://cdrdv2-public.intel.com/638473/638473_Intel_Wi-Fi_6E_AX411_Garfield_Peak_4_Product_Brief_v1_1.pdf). Model-specific concurrency and Ethernet/Wi-Fi distinction.
- **S17 — Microsoft routing rules:** [Route metrics](https://learn.microsoft.com/en-us/windows-hardware/customize/desktop/unattend/microsoft-windows-tcpip-interfaces-interface-routes-route-metric) and [interface metric](https://learn.microsoft.com/en-us/windows-server/networking/technologies/network-subsystem/net-sub-interface-metric). Longest prefix and effective route/interface costs.
- **S18 — Upstream maintenance change:** [Large-download/keepalive fix](https://github.com/Ripwords/insta360-luna-ultra-desktop/commit/d9cfd0da52ccd13fd55a79ef67e7a43662466215). Original author reports a large-file hardware run; still requires adaptation and validation in our fork.

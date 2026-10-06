# Codex handoff: webcam bridge

Updated 2026-10-05 on branch `feature/webcam-bridge` from base
`696435417eac33d77c4d1fbbd1b4015df0933ca9` (`v0.3.2`). Phase 0 safety and
maintenance work is documented in [`ROADMAP.md`](ROADMAP.md).

## Goal

Deliver a separately identified, non-updating development build that exposes a
restart-safe, decoder-friendly real camera stream and provides the smallest
reliable Windows virtual-camera path, now integrated into an easy Studio UI.
Studio now offers verified profile-based camera preparation and an option to
keep the existing settings. Shooting orientation remains camera-controlled.
Guided OBS streaming is included; direct in-app broadcasting, camera
audio, and broader camera-control work remain later phases.
See [`STUDIO_PLAN.md`](STUDIO_PLAN.md) and [`STUDIO_SETUP.md`](STUDIO_SETUP.md).

## Video interruption investigation (2026-10-05)

- User reports intermittent video/webcam recovery with Luna about five feet
  away, directly connected over Wi-Fi. Windows stayed joined to Luna's Wi-Fi;
  the user identifies video recovery rather than a Windows disconnection.
  No dropout timeline was in the capabilities report, so the cause of this
  particular run remains unproven.
- Uploaded camera report establishes firmware **v1.1.15**, Slow-mo, HEVC source
  **1280×720 at observed 29.96fps**, and 1280×720/30 virtual output. The
  `RES_3840_2160P120` photography value describes recording, not preview.
  Hardware type remains unknown; posture is not a verified orientation setter.
- Four user Windows snapshots cover unplugged, plugged in and camera USB/file
  transfer selections. All three after snapshots add exactly one USB mass
  storage interface, **VID 2E1A / PID 1009**, USB class 08/subclass 06/protocol 50,
  `USBSTOR`, status OK/error code 0. Network adapters/routes and DirectShow
  camera lists do not change. There is no observed UVC or USB network route;
  the camera selects its USB profile and Windows loads the matching driver.
  These observations do not rule out an undiscovered firmware profile.
- Confirmed parser bug: a TCP read ending in `U`, `UC` or `UCD` discarded that
  header prefix, losing the following video/control frame. Preserve the prefix
  and verify every split point plus byte-by-byte delivery and resynchronization.
  This can disrupt decoding over healthy Wi-Fi; the report does not prove it
  caused the user's specific interruption.
- Authorization hello remains every three seconds. Valid incoming video,
  replies or keepalive echoes now prove control-session liveness without two
  extra status/options queries each tick. After twelve seconds without valid
  incoming frames, probe capture status with a two-second deadline. Actual EOF,
  read failure or a failed/stalled write retires the session. Socket writes are
  bounded, cancelled commands clean up pending requests, and obsolete sessions
  cannot remove a replacement. Disconnect invalidates in-flight connection setup.
- HTTP health checks consider native incoming traffic, have a five-second HTTP
  deadline and ignore stale failed probes after a newer successful response or
  rearm. A health-triggered teardown preserves automatic reconnect intent;
  explicit Disconnect cancels it. Late connect results cannot restore UI state.
- Studio adds **Export connection report**, a local-only snapshot available
  while disconnected. Timestamped control/relay/helper events, source/client
  backlog counters, codec-header changes and last-video ages distinguish socket
  loss from relay/decoder recovery. Bounded native history survives preview
  restarts in this app process. No camera GETs or writes are triggered by export.
- Local automated validation: **336 unit, 53 Nuxt and 28 Rust tests** passed;
  native tests included the real Node mock-server handshake/delete integration
  inside the isolated Linux test container. Optimized native build, TypeScript,
  lint and frontend generation passed. The new fragmentation regression fails
  against the old parser at split 1 and passes after the repair. Chromium at
  960×640 exported an offline report with native recovery evidence, no camera
  commands, page errors or horizontal overflow. Critical production dependency
  audit passed (five findings below the configured critical threshold remain).
  Windows CI and the user's real-camera timed run remain pending at this commit.
  This increment does not establish a resolved hardware dropout, native higher
  quality, camera audio or USB video.

## Reliability and camera preparation increment (2026-10-05)

- User approved proceeding after research and offered device/USB diagnostics.
  Implemented the first prioritized increment rather than speculative quality
  negotiation. The installed upstream application remains untouched.
- Shared camera mode writes now require readable mode/idle state, accepted
  options and bounded actual readback. Present proto3 zero is distinguished
  from missing/unsupported data. Dependent Standard color/filter resets only
  follow a verified mode and another idle check. Accepted color writes are not
  claimed as separate color readback verification.
- Studio's visible **Match camera mode** toggle defaults on. Landscape and
  upscaled Full HD select Slow-mo, matching the measured baseline; Portrait
  selects Video. Already matching modes keep settings. The toggle off preserves
  current mode/color/orientation. Native source dimensions/cadence and framing
  mismatch guidance remain distinct from virtual output. Firmware-wide mode
  suitability and orientation are not established by the existing measurement.
- Preparation occurs once per explicit Start, not on every Wi-Fi reconnect.
  Stop/disconnect cancels follow-up commands and output startup. It cannot undo
  a camera command already sent. Shared busy state prevents concurrent capture
  controls. Unsupported/ignored commands expose a useful manual-settings path.
- Preview native operations share a serialized queue and cancellation version.
  An elementary stream with no bytes at six seconds gets one restart; another
  timeout requires user retry. The helper has a twenty-second first-frame
  deadline with a structured error. Byte arrival is not proof of decoding.
- HTTP preview readers reconnect twice and reset their decoder. Changed H.264
  or HEVC headers/source lag invalidate cached references and close affected
  clients for a clean join. Slow client lag also closes its connection. The
  listener owns client tasks with JoinSet so teardown cancels blocked writers.
  Navigation guards prevent a queued refresh reclaiming a Gallery-bound stream.
- Studio's Whatnot guide now uses Show Tools/WebSocket/WHIP and fixed official
  help links. No Whatnot broadcast, Guardian approval, native USB video or
  camera-audio support is claimed.
- Added **Export camera report** using known GET commands through the current
  session, with credentials/identifiers omitted. Added a read-only Windows
  PnP/USB/network/DirectShow inventory script and CI smoke test. Before/after
  instructions are in [DEVICE_DIAGNOSTICS.md](DEVICE_DIAGNOSTICS.md).
- Automated results: 333 unit tests and 51 Nuxt runtime tests; six Python
  simulations with real dependency imports; 23 Rust tests and an optimized
  Linux build. Chromium simulated Start/Stop, mode preparation, manual setting
  preservation and minimum 960×640 layout with no page errors or horizontal
  overflow. This simulation did not receive the user's camera feed or publish
  to a real OBS device. A synthetic paced HEVC loopback decode also passed.
- [CI for code commit 18923b0](https://github.com/Defib-TDE/insta360-luna-ultra-desktop/actions/runs/37389201100)
  passed all three jobs: frontend, Linux native tests/audit, Windows native
  tests, Windows inventory smoke test, MSI/NSIS packaging, staged helper imports
  and all six Python simulations. No installer artifacts were published.
  This is not a clean-machine install or real USB/Luna test.
- Dependency versions were not changed in this increment. The Rust audit
  passed with zero vulnerability-class findings and eight informational
  warnings, including GTK/glib maintenance/unsoundness notices and a yanked
  chacha20 version. Review these in a separate dependency-maintenance change;
  passing CI is not a claim that the dependency tree has no advisories.
- New mode/recovery behavior and Windows diagnostics require the user's real
  camera/PC pass; prior hardware successes below apply to the earlier builds.
  Five cold starts, recording guard, all profiles, Stop during startup,
  reconnect, USB before/after and a 60-minute soak are documented in setup.

## Research and user feedback before this increment (2026-10-04)

- The user rebuilt `bdf7157` on Windows. The uploaded transcript confirms bundled
  engine imports, optimized native compilation and local MSI/NSIS creation.
  They report the integrated app worked well after manually reconnecting on
  initial startup and liked its appearance. Record this as a limited integrated
  hardware pass; repeated cold starts and the full acceptance suite remain open.
- Selecting Full HD kept the source size unchanged. This is expected: Studio
  changes output scaling, while Rust's preview request remains fixed at field
  7 = 9. Native preview 1080p/60fps have not been negotiated or measured.
- Read [STUDIO_RESEARCH.md](STUDIO_RESEARCH.md) before implementing automation.
  Official Luna docs separate shooting orientation from mode, so test ordinary
  Video in landscape/portrait before universally forcing Slow-mo. The shared
  mode switch at that point ignored accepted-option results and did not reliably
  verify actual mode; those checks are repaired in the increment above.
- Investigate accepted-but-silent preview recovery, the helper's unbounded
  first-frame wait, reader EOF/error recovery and incomplete GOP caching after
  source lag. The user's initial startup issue is not yet root-caused.
- Whatnot's current official path is Show Tools + OBS WebSocket + WHIP with a
  1080×1920 canvas and per-show token. Setup docs now reflect it; Studio's generic
  in-app guide needed a dedicated update, now implemented. No actual Whatnot show was tested.
- WGU acceptance of Luna/OBS is unestablished. Recommend a physical external USB
  webcam meeting WGU's microphone/placement requirements unless the institution
  and provider confirm this bridge. A native virtual camera or USB software
  transport would not by itself establish exam approval. Do not conceal the
  background helper or rename a virtual camera to imply physical hardware.
- MSI Claw networking should first validate camera Wi-Fi + USB-C Ethernet;
  dual physical Wi-Fi adapters are a portable alternative. A single Wi-Fi 7
  adapter is not verified to join both Luna and home networks. Native Luna UVC
  is officially unsupported; model-specific USB preview/USB networking remain
  research questions, not implemented routes.
- Fetched upstream read-only: `v0.3.3` at `11b1acb` adds the `d9cfd0d` large-file
  streaming/transfer-aware keepalive fix. It has not been merged. Adapt/review it
  separately against our modified `luna.rs`; preserve development identity,
  disabled updates and upstream push protection. Upstream still has no license.
- That research follow-up changed documentation only. The subsequent increment
  above changes app/bridge code; the installed upstream application stays intact.

## Current Studio increment (2026-10-04)

- Added Studio, conservative landscape/portrait 720p30 presets, labelled
  upscaled 1080p30, mirroring, source/output metrics, setup checklist, bounded
  diagnostics and OBS/Whatnot guidance. Remote broadcast state is never inferred
  from local output.
- Added a native process supervisor with serialized operations, fixed
  loopback/profile arguments, runtime isolation, driver detection, structured
  status and explicit kill/reap on Stop/application exit. Help links are fixed
  official URLs, not arbitrary shell commands.
- The shell owns stream lifetime: leaving Camera/Studio only stops preview
  when no webcam needs it. Output uses the established control-session relay;
  reconnect passes the actual URL if the fallback port changes.
  Wi-Fi loss preserves desired output; an explicit or health-forced Disconnect
  releases it rather than promising endless recovery.
- Windows builds bundle a one-directory PyInstaller engine and build local
  MSI/NSIS installers. End users should not need Python. Unbundled development
  builds retain explicit private-runtime setup. No public installer upload or
  release has been enabled; licensing remains unresolved.
- White/black model selection is remembered by camera serial. There is no
  verified body-color metadata; Auto is still theme-based. Output preferences
  persist but never start the webcam automatically on launch.
- The Python bridge reports measured decode cadence and sends a neutral slate
  after two seconds without a fresh frame, with recovery status events.
- The latest report above provides an initial integrated Windows pass; the
  earlier external-bridge tests below validate only that earlier path. Finish
  the integrated acceptance suite in STUDIO_SETUP.md and keep the installed
  upstream app intact.

### Studio verification in the managed environment

- 324 unit tests, 45 Nuxt-runtime tests and 18 Rust tests passed.
- Four Python simulations passed with PyAV 16.1/numpy/pyvirtualcam imports.
  They cover decoded-frame replacement, source cadence events, stale slates and
  recovery. A fake virtual-camera sink is not OBS hardware validation.
- Nuxt typecheck, lint, production generation and optimized Linux native build
  passed. Native dependencies were installed only in the isolated container,
  following the cloud-runtime skill; the host system was not changed.
- Chromium simulated native commands and decoded a generated H.264 fixture.
  Studio start/stop, Settings navigation, portrait profile and minimum-size
  layout worked with no page errors or horizontal overflow. Screenshots used a
  synthetic test pattern, not the user's camera.
- Windows CI now compiles native tests, builds the video engine and local
  installers, and checks the staged helper imports. No installer artifacts are
  uploaded. CI is separate from a clean-machine install or hardware test.
- [Windows CI for Studio commit 9a052d5](https://github.com/Defib-TDE/insta360-luna-ultra-desktop/actions/runs/37177816492)
  passed native tests, MSI/NSIS creation, the staged helper's `--check-runtime`
  and all four Python bridge simulations. OBS driver/camera use is not part of
  that runner test. A clean-machine installation is still unverified.

## Repository and remotes

- The original Windows checkout was not mounted in the managed environment, so
  the repository was reconstructed at `/workspace/luna-ultra-desktop` from the
  exact upstream base commit.
- Local branch: `feature/webcam-bridge`.
- `upstream` fetches
  `https://github.com/Ripwords/insta360-luna-ultra-desktop.git`; its push URL is
  `DISABLED`.
- `origin` fetches and pushes
  `https://github.com/Defib-TDE/insta360-luna-ultra-desktop.git`.
- The feature branch is published as `origin/feature/webcam-bridge`.
- Do not re-enable upstream pushes.

## Baseline established before implementation

Managed environment:

- Bun 1.4.2 installed under `/workspace/.tools/bun`.
- Rust/Cargo 1.99.0 and rustfmt installed under `/workspace/.tools`.
- Locked JavaScript dependencies installed.
- Linux Tauri headers supplied only in an isolated Docker test container; the
  host system was not modified.

Clean-base results:

- 319/319 frontend unit tests passed.
- 31/31 Nuxt-runtime tests passed after enabling Node 24 environment-proxy
  support (`NODE_USE_ENV_PROXY=1`).
- 12/12 Rust tests passed, including the vendored mock-camera integration test.
- `bun run typecheck`, `bun run lint`, and `bun run generate` passed.
- A full optimized Linux Tauri application compile passed with the final binary
  at `src-tauri/target/release/Luna Ultra Webcam Dev` (bundle generation was
  intentionally disabled for this environment check).
- A native Windows bundle was not possible from the Linux managed environment.
  A subsequent user-run Windows build at commit `38f6ef5` produced the native
  executable plus MSI and NSIS bundles successfully. The bundles remain local
  development artifacts and have not been installed or distributed.

## Implemented changes

### Coexistence-safe app identity

- Product: `Luna Ultra Webcam Dev`.
- Bundle identifier: `io.github.defib-tde.luna-ultra-webcam-dev`.
- Binary target: `LunaUltraWebcamDev`.
- Upstream updater dependency, native plugin, permission, endpoint, artifacts,
  composable, and banner were removed. This build cannot install upstream
  release updates over itself.
- Original protocol attribution is retained in source and documentation.
- Development version: `0.3.2-1`, whose numeric prerelease is accepted by the
  Windows MSI toolchain. The separate `webcam-dev` channel, source commit, and
  a visible DEV badge remain shown in the application.

### Hardened elementary-stream relay

`src-tauri/src/liveview.rs` now:

- prefers stable loopback port 49183 and falls back to an ephemeral port;
- caches H.264/H.265 parameter sets plus a bounded current GOP for late clients;
- starts late clients at a keyframe and re-bootstraps clients that lag;
- uses packet sequence numbers to avoid duplicating the live edge after a
  bootstrap snapshot;
- shuts down accepted HTTP clients as well as the accept loop;
- drops the listener, pump, and clients when START fails;
- detects a replaced camera session and discards stale relay state;
- labels the diagnostic counter `packets`, because UCD2 payloads are not proven
  to equal decoded frames.

The Camera toolbar exposes the returned URL with **Copy stream URL**.

### Minimal Windows virtual camera

- `tools/webcam_bridge.py`: PyAV/FFmpeg decoding, freshest-frame queue,
  letterboxing, mirroring, reconnect backoff, OBS/Unity Capture output, and a
  decoder-only probe mode. The probe reports both FFmpeg's elementary-stream
  rate estimate and wall-clock observed decode cadence, plus time to first
  frame; use a long sample before claiming a source FPS maximum.
- `tools/start-webcam.ps1`: isolated Windows venv bootstrap and launcher.
- `tools/webcam-requirements.txt`: bounded dependency versions.
- `docs/WEBCAM_BRIDGE.md`: setup, independent `ffprobe` check, and hardware
  test matrix.

## Evidence after implementation

- 15/15 Rust tests passed. New coverage proves late-client header/GOP bootstrap,
  replacement at the next keyframe, and closure of an already-connected HTTP
  client on shutdown.
- The Python bridge compiled under Python 3.12.
- A generated 640×480 H.264 Annex-B file was served over HTTP; PyAV 16.1 decoded
  30/30 frames through `--probe-only`. This is a simulated external-decoder
  proof, not Luna hardware evidence.

Re-run the complete suite after any further edit; final results may supersede
the numbers above.

## Hardware and Windows work still required

1. Record the camera firmware and the working upstream installed-app version.
2. Map exact camera-mode names to the observed codec and dimensions.
3. Confirm OBS Virtual Camera selection in Teams and Zoom.
4. Complete a timed late-join check and at least a 60-minute sustained run.
5. Measure glass-to-glass latency with a documented method. Do not infer latency
   from the UCD2 packet counter.
6. Camera audio remains unknown and absent from the bridge.
7. Installer identity and coexistence remain unverified because the locally
   built bundles are intentionally not being installed or distributed while
   licensing is unresolved.

## Hardware evidence reported 2026-10-03

- On the user's Luna Ultra, the first mode switches temporarily left stale
  still frames, but subsequent cycling produced moving previews in every mode
  tested. Firmware, exact mode-to-result labels, and the working upstream
  application version still need to be recorded.
- The control-session relay used `http://127.0.0.1:49183/stream`.
- PyAV 16.1 completed six 30/30-frame real-camera HEVC probes. Every probe
  carried FFmpeg's 25 fps elementary-stream estimate; observed dimensions were
  1280×720, 720×1280, and 1280×960, with completion times from 1.140 to 3.315
  seconds. The user had switched modes between probes, but the exact
  mode-to-result sequence was not recorded.
- Six later 250-frame HEVC probes covered Slow-mo, Photo, Pano, Timelapse, Pure,
  and Video in that order. Slow-mo and Pano produced 1280×720 at 29.981 and
  30.013 decoded fps; Photo, Pure, and Video produced 720×1280 at 29.992,
  29.966, and 30.025 decoded fps; Timelapse produced 1280×960 at 23.700 decoded
  fps. Time to first frame ranged from 0.528 to 1.919 seconds. This establishes
  an approximately 30 fps maximum across the tested previews; Timelapse appears
  closer to 24 fps. It also shows that FFmpeg's 25 fps value was only a
  raw-stream heuristic.
- This proves repeated external decoding of the real camera feed across the
  tested mode switches.
- `pyvirtualcam` 0.15 published a 720×1280, 25 fps feed through the OBS backend.
  Windows DirectShow enumerated **OBS Virtual Camera**, and FFmpeg consumed 30
  NV12 frames in 1.17 seconds. This proves real-camera virtual-device
  publication and external consumption. Chrome then selected **OBS Virtual
  Camera** on webcamtests.com and rendered the live Luna feed, proving browser
  WebRTC consumption as well. Discord also selected the OBS camera and rendered
  the live feed. The Windows Camera app did not list the device in this portrait
  configuration, so standard landscape output plus Teams and Zoom still need
  testing.
- A later webcamtests.com run measured the standard landscape output as
  1280×720, RGB, 25 fps, 0.92 megapixels, with no camera microphone or speaker.
  This independently confirms the requested virtual-device format; the absent
  audio matches the current video-only bridge design.
- A subsequent Discord test published 1280×720 at 25 fps four times. Three
  Ctrl+C stop/restart cycles returned to moving video, and the fourth instance
  remained active. One start encountered transient loopback-stream errors,
  backed off from 0.5 to 2 seconds, and recovered without restarting the Luna
  app or bridge. This verifies bridge restart and one short automatic-reconnect
  path.
- With the 1280×720 bridge and Discord session left running, deliberately
  leaving and re-entering the app's Camera page recovered moving video without
  restarting either consumer. Disconnecting and reconnecting the camera Wi-Fi
  also recovered immediately by visual observation. The bridge logged bounded
  0.5, 1, and 2 second retries during the interruption. Exact recovery time was
  not instrumented, so this is a qualitative recovery result.
- Sustained operation, audio, and glass-to-glass latency remain unproven.

## Phase 0 repository safeguards

- Public release automation is removed from the feature branch and the local
  release command fails closed.
- The Rust crate is marked `publish = false`.
- Compatible direct dependencies were refreshed and the critical JavaScript
  advisory gate was added to CI.
- CI now covers feature branches, generates the production frontend, validates
  the Python bridge, audits Rust dependencies, and pins actions/toolchains.
- `feature/webcam-bridge` is the fork's default branch and GitHub Actions is
  enabled. GitHub registers only the CI and Docs workflows from that branch;
  the inherited Release workflow is absent. Hosted CI run
  [`37158344680`](https://github.com/Defib-TDE/insta360-luna-ultra-desktop/actions/runs/37158344680)
  passed on 2026-10-03 at commit `250bc54`. The RustSec action has the narrow
  `checks: write` permission it needs to publish its audit result; all other
  workflow access remains read-only.
- See [`DISTRIBUTION.md`](DISTRIBUTION.md) for the release gate and
  [`ROADMAP.md`](ROADMAP.md) for phase boundaries. The exact remaining advisory
  baseline is recorded in [`DEPENDENCY_AUDIT.md`](DEPENDENCY_AUDIT.md).

## Licensing blocker

No repository license file exists and no license is declared for the Rust
package. Keep attribution, but do not distribute modified source or binaries
until the copyright holder grants or clarifies a license. The development work
and local testing can continue without representing the fork as distributable.

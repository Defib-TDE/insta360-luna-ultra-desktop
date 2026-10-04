# Codex handoff: webcam bridge

Updated 2026-10-04 on branch `feature/webcam-bridge` from base
`696435417eac33d77c4d1fbbd1b4015df0933ca9` (`v0.3.2`). Phase 0 safety and
maintenance work is documented in [`ROADMAP.md`](ROADMAP.md).

## Goal

Deliver a separately identified, non-updating development build that exposes a
restart-safe, decoder-friendly real camera stream and provides the smallest
reliable Windows virtual-camera path, now integrated into an easy Studio UI.
Camera mode remains fixed. Guided OBS streaming is included; direct in-app
broadcasting, camera audio, and broader camera-control work remain later phases.
See [`STUDIO_PLAN.md`](STUDIO_PLAN.md) and [`STUDIO_SETUP.md`](STUDIO_SETUP.md).

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
- Windows builds bundle a one-directory PyInstaller engine and build local
  MSI/NSIS installers. End users should not need Python. Unbundled development
  builds retain explicit private-runtime setup. No public installer upload or
  release has been enabled; licensing remains unresolved.
- White/black model selection is remembered by camera serial. There is no
  verified body-color metadata; Auto is still theme-based. Output preferences
  persist but never start the webcam automatically on launch.
- The Python bridge reports measured decode cadence and sends a neutral slate
  after two seconds without a fresh frame, with recovery status events.
- Existing external-bridge hardware results below do **not** validate the new
  integrated UI/supervisor. A Windows rebuild and hardware acceptance pass are
  still required. Follow STUDIO_SETUP.md and keep the installed upstream app.

### Studio verification in the managed environment

- 324 unit tests, 44 Nuxt-runtime tests and 18 Rust tests passed.
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

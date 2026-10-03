# Codex handoff: webcam bridge

Updated 2026-10-03 on branch `feature/webcam-bridge` from base
`696435417eac33d77c4d1fbbd1b4015df0933ca9` (`v0.3.2`).

## Goal

Deliver a separately identified, non-updating development build that exposes a
restart-safe, decoder-friendly real camera stream and provides the smallest
reliable Windows virtual-camera path. Camera mode remains fixed. Livestreaming,
camera audio, and broader camera-control work remain later phases.

## Repository and remotes

- The original Windows checkout was not mounted in the managed environment, so
  the repository was reconstructed at `/workspace/luna-ultra-desktop` from the
  exact upstream base commit.
- Local branch: `feature/webcam-bridge`.
- `upstream` fetches
  `https://github.com/Ripwords/insta360-luna-ultra-desktop.git`; its push URL is
  `DISABLED`.
- GitHub authentication identifies as `Defib-TDE`, but GitHub rejected the fork
  request with HTTP 403 `Resource not accessible by integration`. No `origin`
  remote exists yet. Create the fork in GitHub with an identity allowed to fork,
  then add it as `origin`; do not re-enable upstream pushes.

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
  This must be run on Windows before calling the Windows baseline complete.

## Implemented changes

### Coexistence-safe app identity

- Product: `Luna Ultra Webcam Dev`.
- Bundle identifier: `io.github.defib-tde.luna-ultra-webcam-dev`.
- Binary target: `LunaUltraWebcamDev`.
- Upstream updater dependency, native plugin, permission, endpoint, artifacts,
  composable, and banner were removed. This build cannot install upstream
  release updates over itself.
- Original protocol attribution is retained in source and documentation.

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
  decoder-only probe mode.
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

1. Run `bun run build` on Windows with Bun, Rust MSVC, WebView2, and the Tauri
   prerequisites. Confirm the resulting product name, executable, install path,
   and uninstall entry are distinct from the installed upstream app.
2. Record the camera firmware and the working upstream installed-app version.
3. Run the probe in `docs/WEBCAM_BRIDGE.md` against the actual copied URL and
   record codec, profile, dimensions, FPS, and time-to-first-frame.
4. Confirm OBS Virtual Camera publication and selection in Teams and Zoom.
5. Complete cold start, late join, repeated stop/restart, app stream restart,
   Wi-Fi reconnect, and at least a 60-minute sustained run.
6. Measure glass-to-glass latency with a documented method. Do not infer latency
   from the UCD2 packet counter.
7. Camera audio remains unknown and absent from the bridge.

## Licensing blocker

No repository license file exists and `Cargo.toml` still has an empty `license`
field. Keep attribution, but do not distribute modified source or binaries until
the copyright holder grants or clarifies a license. The development work and
local testing can continue without representing the fork as distributable.

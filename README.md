<p align="center">
  <img src="app-icon.png" alt="Luna Ultra Webcam Dev" width="160" height="160" />
</p>

<h1 align="center">Luna Ultra Webcam Dev</h1>

<p align="center">
  An unofficial development fork of the Insta360 Luna Ultra desktop companion,
  focused on reliable real-feed webcam and livestream workflows.
  <br />
  <a href="https://v2.tauri.app/">Tauri 2</a> ·
  <a href="https://nuxt.com/">Nuxt 4</a> ·
  <a href="https://ui.nuxt.com/">Nuxt UI</a> ·
  <a href="https://threejs.org/">Three.js</a>
</p>

> [!IMPORTANT]
> This fork is for local development and hardware testing. It has no public
> downloads or auto-updater. The upstream repository does not include a license,
> so modified source and binaries must not be distributed until the copyright
> and bundled-asset rights are clarified. See
> [Distribution status](docs/DISTRIBUTION.md).

## Goal and current status

The near-term goal is a dependable Windows virtual camera that consumes the
Luna Ultra's actual encoded video feed—never screen mirroring or window capture.
OBS, Teams, Zoom, and Whatnot are target applications. Livestream output,
portrait framing, audio, and expanded camera controls are later phases.

Development happens on **feature/webcam-bridge**. The fork's **master** branch
remains the upstream v0.3.2 baseline. The development application has a
separate name, bundle identifier, executable, prerelease version, and no
updater, so it is designed to coexist with an installed upstream application.

The current relay and decoder path has passed simulated external-decoder tests.
It still needs a native Windows build and full Luna Ultra hardware validation
before it can be called a reliable webcam.

See the [development roadmap](docs/ROADMAP.md), [webcam bridge
guide](docs/WEBCAM_BRIDGE.md), and [working handoff](docs/CODEX_HANDOFF.md).

## What is implemented

- **Real camera connection** over the Luna Ultra Wi-Fi network using its TCP
  control protocol and HTTP media interface.
- **Camera companion features** inherited from upstream: preview, capture,
  measured camera controls, gallery, downloads, delete, watermark composition,
  and an interactive camera model.
- **Decoder-friendly loopback relay** for the camera's elementary H.264/H.265
  stream, including cached codec parameter sets and keyframe-aligned late joins.
- **External stream URL** exposed from the Camera screen when the Annex-B
  control-session transport is active.
- **Windows bridge prototype** using PyAV/FFmpeg decoding and pyvirtualcam, with
  OBS and Unity Capture backends.
- **Freshest-frame output** with reconnect backoff, letterboxing, mirroring,
  and a decoder-only probe mode.
- **Development identity** shown in the app together with version, channel, and
  source commit.

Known webcam limitations are intentional and tracked:

- the stream currently belongs to the Camera page and stops on navigation;
- MJPEG preview selection can bypass the Annex-B URL needed by the bridge;
- silent health failures do not yet follow the full reconnect policy;
- camera audio has not been established;
- vertical Whatnot framing is not yet implemented.

The detailed upstream feature and protocol map remains in
[docs/FEATURES.md](docs/FEATURES.md). Items in that document describe upstream
camera measurements unless specifically labelled as fork hardware evidence.

<p align="center">
  <img src="screenshots/02-gallery.png" alt="Gallery" width="49%" />
  <img src="screenshots/08-camera.png" alt="Camera control" width="49%" />
</p>

## Development

Install [Bun](https://bun.sh/), [Rust](https://rustup.rs/), and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your
operating system. CI currently pins Bun 1.4.2 and Rust 1.99.0; the crate's
declared minimum Rust version remains 1.77.2.

```bash
bun install --frozen-lockfile
bun run dev      # Tauri desktop app and Nuxt frontend
bun run ui:dev   # browser-only UI; real camera control is unavailable
```

Useful checks:

```bash
bun run test
bun run typecheck
bun run lint
bun run generate
bun run audit:critical
cargo test --manifest-path src-tauri/Cargo.toml --lib
python -m py_compile tools/webcam_bridge.py
```

On Windows, build and bundle the isolated development application with:

```powershell
bun install --frozen-lockfile
bun run build
```

Do not uninstall or overwrite the working upstream application. Before using a
locally built installer, confirm that it identifies as **Luna Ultra Webcam Dev**
with bundle identifier **io.github.defib-tde.luna-ultra-webcam-dev**.

## Webcam bridge

Keep the camera mode fixed during the initial baseline:

1. Connect the desktop app to the Luna Ultra.
2. Open **Camera** and copy the local stream URL.
3. Probe the URL with FFmpeg or the Python bridge.
4. Install or enable an OBS Virtual Camera or Unity Capture backend.
5. Start the bridge and select its camera in the destination application.

The exact commands, setup, and hardware test matrix are in
[docs/WEBCAM_BRIDGE.md](docs/WEBCAM_BRIDGE.md).

## How the camera connection works

The Luna Ultra normally exposes:

- **TCP port 6666** for a UCD2-framed control session, authentication, device
  information, requests, notifications, and live encoded video payloads.
- **HTTP port 80** for media access after the control session unlocks it.

The Rust layer in **src-tauri/src/luna.rs** owns the TCP session.
**src-tauri/src/liveview.rs** relays recognized encoded video payloads through a
loopback-only HTTP endpoint. The Nuxt frontend reaches camera operations through
the CameraTransport abstraction in **app/utils/transport.ts**.

The vendored mock camera supports protocol and UI development without touching
the real camera:

```bash
node luna_mock_server/server.mjs \
  --root /path/to/media --host 127.0.0.1 --http-port 18080 --tcp-port 6666
```

Mock-server tests are simulated evidence and must not be reported as Luna Ultra
hardware results.

## Repository safety

- **upstream** fetches the original Ripwords repository and has its push URL
  disabled.
- **origin** is the Defib-TDE fork.
- tag-triggered binary publication is absent from the development branch.
- **bun run release** is deliberately blocked.
- the Rust crate is marked **publish = false**.
- upstream auto-update support is absent from the development application.

The fork still uses the unchanged **master** branch as its GitHub default. Before
enabling GitHub Actions, change the default branch to **feature/webcam-bridge**;
otherwise GitHub may register the inherited release workflow still present on
master.

CI is configured to block critical JavaScript production advisories once GitHub
Actions is enabled on the fork. Remaining advisories are tracked separately
because the available fixes require upstream dependency changes or a major
docs-site upgrade.
See the [dependency audit baseline](docs/DEPENDENCY_AUDIT.md).

## Project layout

```text
app/                         Nuxt UI, composables, and camera transport
src-tauri/src/luna.rs        UCD2 control session and camera protocol
src-tauri/src/liveview.rs    Loopback elementary-stream relay
tools/webcam_bridge.py       PyAV to pyvirtualcam bridge
tools/start-webcam.ps1       Windows virtual-environment launcher
luna_mock_server/            Vendored camera emulator
tests/                       Vitest and Nuxt runtime tests
docs/WEBCAM_BRIDGE.md        Windows bridge setup and hardware matrix
docs/ROADMAP.md              Phased development plan
docs/DISTRIBUTION.md         Licensing and release gate
```

## Attribution

This fork is based on
[Ripwords/insta360-luna-ultra-desktop](https://github.com/Ripwords/insta360-luna-ultra-desktop)
at commit **696435417eac33d77c4d1fbbd1b4015df0933ca9**. Camera protocol work and
inherited assets also cite
[diamondfsd/luna-ai-cut](https://github.com/diamondfsd/luna-ai-cut).

Insta360 and Luna Ultra are trademarks of their respective owners. This is an
unofficial community development project and is not affiliated with or endorsed
by Insta360.

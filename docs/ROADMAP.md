# Development roadmap

The project is being advanced in measured phases so camera behavior remains
testable and the currently working upstream installation stays intact.

## Phase 0 — safe development foundation

Scope: repository safety and maintainability only. Do not change the camera
protocol, stream format, capture mode, or webcam relay behavior.

- [x] Keep the development application identity separate from upstream.
- [x] Remove upstream auto-updates from the development build.
- [x] Block public releases while licensing is unresolved.
- [x] Give development versions their own prerelease identifier.
- [x] Display version, build channel, and commit in the application.
- [x] Show an obvious development badge in the application shell.
- [x] Update compatible direct dependencies and regenerate the lockfile.
- [x] Run critical JavaScript and Rust advisory checks in CI.
- [x] Record residual transitive advisory warnings without suppressing them.
- [x] Pin CI runtimes and actions and run CI on feature branches.
- [x] Correct fork, webcam, download, updater, and distribution documentation.
- [ ] Obtain or confirm a license and bundled-asset redistribution rights.

## Phase 1 — Windows and camera baseline

- Build the isolated application on Windows without changing the installed
  upstream application.
- Record camera firmware and the known-working upstream application version.
- Measure actual codec, profile, dimensions, frame rate, keyframe cadence,
  time-to-first-frame, and glass-to-glass latency.
- Prove late decoder joining with FFmpeg/PyAV against the real stream.
- Verify an OBS or Unity Capture virtual-camera backend in OBS, Teams, Zoom, and
  Whatnot.
- Exercise cold start, stop/restart, Wi-Fi loss/recovery, and a sustained run.

Hardware observations must be labelled separately from simulated tests.

## Phase 2 — stream reliability

- Move webcam stream ownership out of the Camera page.
- Select one explicit webcam source independently of the UI preview transport.
- Fix fragmented UCD2 magic handling and stale-session races.
- Add finite probe and request timeouts.
- Re-bootstrap at a keyframe after source or client lag.
- Make accepted-client shutdown cancellation-aware.
- Authenticate the loopback stream URL and bound local clients.
- Add fragmentation, lag, reconnect, slow-client, and decoder recovery tests.

## Phase 3 — integrated webcam experience

- Start and stop webcam output from the desktop interface.
- Detect supported Windows virtual-camera backends.
- Replace per-launch dependency installation with a controlled runtime.
- Report codec, source/output FPS, drops, clients, reconnects, and errors.
- Show a reconnect slate instead of holding a stale frame indefinitely.

## Phase 4 — livestream and Whatnot workflows

- Add portrait 9:16 crop/reframe, rotation, mirroring, and safe-area controls.
- Document OBS scene setup and validate the Whatnot workflow.
- Evaluate direct RTMP output only after webcam stability is established.
- Investigate camera audio as a separate, explicitly synchronized path.

## Phase 5 — expanded camera control

- Keep a fixed-mode compatibility option.
- Stabilize remote mode switching.
- Verify every new control on the camera display against the target firmware.
- Do not expose a control merely because the protocol acknowledges its write.

# Luna Studio product plan

## Goal

Turn the verified Luna Wi-Fi feed into a comfortable daily webcam and streaming
workflow: connect, choose a frame, start output, and select the camera in the
destination app. Keep the existing camera controls and gallery available.
Installation and first-run setup are product features, not developer chores.
The intended Windows flow is: install Luna, install the OBS driver if needed,
join camera Wi-Fi, connect, choose a profile, start webcam.

## Evidence and limits

- HEVC decoding, DirectShow, Chrome and Discord are hardware tested.
- Bridge stop/restart, app stream restart and Wi-Fi recovery passed on the
  user's Windows machine. The hour-long soak and measured latency remain open.
- The integrated Studio build at `bdf7157` also worked on Windows after an
  initially finicky connection was resolved by reconnecting. This is an initial
  hardware pass, not proof of repeatable cold starts or the full acceptance suite.
- The tested preview profiles span 1280×720, 720×1280 and 1280×960. Five modes
  deliver about 30 decoded fps; Timelapse delivered 23.7. These are observed
  configurations, not proof of the firmware's absolute maximum.
- Camera recording settings and preview settings are separate. Changing the
  virtual output to 1080p or 60 fps adds scaling or repeated frames.
- Camera audio is unverified. Conferencing apps and OBS should use a separate
  microphone. Actual Teams, Zoom and Whatnot sessions still require validation.

## First implementation: Studio and managed webcam output

1. Add Studio to navigation and the connected home screen. Use a large, quiet
   viewfinder, generous spacing, restrained violet accents, readable status,
   strong focus states and reduced-motion support.
2. Present landscape 720p30, portrait 720p30, and upscaled 1080p30 presets.
   Preserve aspect ratio, offer mirroring, and show source versus output clearly.
   Initially kept camera mode fixed; the subsequent reliability increment now
   offers explicit mode matching and a compatibility option to keep settings.
3. Bundle a PyInstaller **one-directory** video engine in Windows builds, so
   end users do not need Python, Git, Bun, Rust or FFmpeg. Keep an explicit
   isolated Python setup as a development-build fallback. Detect the OBS
   virtual-camera driver and link to its official installer. Start and stop
   the supervised decoder from the UI; no per-start pip install.
4. Keep the elementary relay alive while webcam output is active, even when
   moving to Settings or Camera. Restart it after camera reconnection and pass
   the actual bound port to the decoder. Stop the child on application exit.
5. Show starting, publishing, reconnecting and failed states, measured source
   dimensions/cadence, output profile and bounded diagnostic history. Show a
   neutral reconnect frame rather than silently freezing the last image.
6. Include an OBS/Whatnot streaming guide in Studio: add the virtual camera as
   a capture source, choose the microphone in OBS, set the canvas orientation,
   and configure the destination there. Publishing a virtual camera does not
   itself mean a broadcast is live.
7. Reuse the existing interactive Luna model. Offer white/black selections
   remembered per camera serial, applied when that camera reconnects. No
   verified device-info field identifies the body color, so do not present
   theme-based appearance as hardware detection. Remember output profile,
   mirroring and codec, but never auto-start output on app launch.

## Next iterations

- Follow the source-backed recommendations in [STUDIO_RESEARCH.md](STUDIO_RESEARCH.md).
  Profile-based camera preparation now verifies accepted mode writes and actual
  readback, requires an idle response before changing settings and preserves a
  fixed-mode compatibility option. Its new hardware acceptance pass is pending.
- Test ordinary Video in both shooting orientations before making Slow-mo the
  default landscape mode. Investigate the preview request's resolution field
  with known-good fallback; native 1080p/60fps remain unverified.
- Bounded silent-preview and first-frame recovery is implemented. Validate
  repeated cold starts, then Teams/Zoom, Whatnot and the hour-long soak.
- Preview the exact composed output; add rotate, crop-to-fill, framing guides
  and saved per-destination scenes after the native source orientation is
  checked against the camera display.
- Validate the bundled helper and local MSI/NSIS builds on Windows, then test
  installation on a clean machine without Python and side-by-side identity.
  Review bundled notices, signing, WebView2 provisioning and uninstall cleanup.
  Publish installers only after upstream licensing is resolved.
- Studio now guides Whatnot through Show Tools/OBS WebSocket/WHIP and a
  1080×1920 OBS canvas. Validate a real show; generic RTMP is not its assumed path.
- Add generic direct RTMP only with explicit destination configuration, secure stream
  key storage, microphone capture, synchronization, encoder metrics and
  reconnection rules. Never infer remote broadcast state from local output.
- Audit and stabilize camera mode/control writes using hardware evidence.
- Add separate camera/internet reachability checks. Validate the MSI Claw using
  camera Wi-Fi plus USB-C Ethernet, then a second Wi-Fi adapter if needed.
  Native Luna USB webcam/preview support has not been established.
- Keep proctored-exam suitability unclaimed. WGU requires an external camera,
  microphone and placement specifications; Guardian software acceptance needs
  confirmation from the institution/provider. Recommend a physical USB webcam
  for exams until that is resolved.
- Review upstream `v0.3.3` large-download and transfer-aware keepalive changes
  separately, adapting them to the fork's session/relay code and app identity.

## Acceptance checks

- No terminal needed after one-time setup; errors identify the missing step.
- Navigation does not stop a running webcam. Wi-Fi reconnection restarts the
  relay and reconnects output, including a fallback loopback port.
- Start/stop cannot spawn duplicate workers; app exit terminates its child.
- Consumer-facing profile remains stable if source dimensions change.
- Layout works at the app's 960×640 minimum and keyboard focus stays visible.
- Automated process/state/lifecycle tests and native/frontend builds pass.
- Hardware evidence is recorded separately from mocks and Linux checks.

## Phased delivery

| Phase | Outcome | Gate |
| --- | --- | --- |
| 0 — Safe foundation | Separate identity, disabled updater, hardened relay | Already implemented; installed app preserved |
| 1 — Webcam proof | Decode real HEVC and publish to OBS Virtual Camera | Chrome/Discord, restart and Wi-Fi checks passed |
| 2 — Studio experience | Integrated output, framing presets, recovery, setup checklist | Automated checks plus new Windows hardware pass |
| 3 — Installation polish | Bundled engine, local installers, clean-machine onboarding | Windows builds, licensing, notices and coexistence |
| 4 — Livestreaming | Guided OBS now; later secure in-app broadcasting with microphone | Actual Whatnot test, audio and RTMP acceptance |
| 5 — Camera polish | Better mode/control reliability and advanced framing | Evidence-backed protocol changes, no blind mode writes |

Phase 2 implementation and the Phase 3 packaging pipeline are included in this
change. The user reports an initial integrated Windows hardware pass, including
recovery after a manual reconnect. The complete acceptance suite remains open.

# Build review — October 14, 2026

## Starting point

Fresh checkout of `Defib-TDE/insta360-luna-ultra-desktop`, branch
`feature/webcam-bridge`, at `c70d94d`. The fork has no commits after the last
handoff. Its `master` branch remains at the original base; development lives
on `feature/webcam-bridge` (35 commits ahead at review start).

Upstream `master` is `11b1acb` / v0.3.3, two commits after our original base.
The functional change is `d9cfd0d` by david-ftx1 / Ripwords, which streams large
video downloads and tolerates busy-camera transfers. It is adapted here with
attribution rather than merging upstream release identity or replacing the
fork's newer connection recovery. Upstream push remains disabled locally.

## Findings and changes

| Area | Evidence | Change |
| --- | --- | --- |
| Downloads | The fork called `response.blob()` for multi-GB videos. Upstream fixed this. | Incremental file writes, byte progress, bounded stalled reads, `.part` cleanup and atomic completion; preserve photos/watermarks. Transfer liveness is scoped to the original connection. |
| Webcam processing | Conversion ran before selecting the latest frame; same-aspect resizing allocated and copied an unnecessary full canvas. | Convert selected decoded frames once, reuse repeated output, skip unnecessary letterbox allocation, retain recovery on a bad conversion. |
| Relay startup | A client joining before codec headers received a keyframe without those headers. Reproduced by a real TCP test. | Send a coherent header/keyframe bootstrap for early joins as well as late joins, for H.264 and HEVC. |
| Engine setup | Executable presence alone meant “ready.” | Bounded helper launch/import check with actionable repair information; Python/package scripts fail early on invalid prerequisites. |
| Studio | Start/Stop and errors were low on the page; source experiments dominated normal setup. | Visible readiness/action card, nearby errors, compact setup, advanced source controls, correct stopped-state measurements, explicit upscaling. |
| Connect/model | Unmount during the 59 MB model load caused a null-renderer exception and leaked late resources. Reduced-motion still scheduled frames. | Dispose late results, skip fallback loads after unmount, idle non-animated scenes until a redraw is needed. |
| Offline UI | Automatic font providers attempted remote requests; icons referenced only in TypeScript were missed by template scanning. | Bundle Geist fonts and dynamic Studio icons. No internet is needed to resolve them. |
| Dependencies | Fresh production audit: 10 findings (1 critical, 5 high, 4 moderate). | Compatible security updates; 5 remain (2 high, 3 moderate), documented without suppressions. |
| Documentation | README/roadmap still described navigation-bound external webcam and absent portrait output. | Reconcile docs with integrated Studio and separate software verification from hardware acceptance. |

## Camera sleep: evidence and next investigation

The user confirmed on October 14 that changing the camera's sleep/power settings
stopped the reported video dropouts. Original settings were Screen Auto Sleep
90 seconds and Auto Power Off 3 minutes; replacement values and elapsed test
duration were not supplied. This is not proof that every dropout cause is fixed.

Automatic session keep-awake is a product goal, but no supported Luna command
has been verified. Existing three-second authorization keepalives did not prevent
the observed sleep-related interruption. A schema field or a command reply alone
is not proof of a working setting; do not send guessed setters or more pings.

- [Official sleep controls](https://onlinemanual.insta360.com/lunaultra/en-us/operation-tutorials/system-operation/auto-power-off)
  distinguish screen sleep and power off; Never is documented for power off.
- [Official Bluetooth wake](https://onlinemanual.insta360.com/lunaultra/en-us/operation-tutorials/system-operation/bluetooth-wakeup)
  documents waking Luna with the iOS app. It does not establish a Windows
  keep-awake lease.
- [USB charging](https://onlinemanual.insta360.com/lunaultra/en-us/operation-tutorials/charging/battery-charging)
  supports shooting while powered, but does not promise to bypass sleep timers.
- Extracted `PHONE_COMMAND_REQUEST_WAKEUP` / `RELEASE_WAKEUP` names are a lead;
  Luna numeric codes, payload and lifetime remain unknown.

Next hardware investigation: restore original timers temporarily and compare
an official-app preview. If it stays awake, inspect its preview start/end control
traffic to identify the wake request and release. A future implementation must
verify readback/behavior, scope the override to an active Studio session, and
restore the original setting. No experimental power writes are added here.

## Verification and remaining acceptance

Baseline: 338 unit tests and 62 Nuxt tests passed before implementation.
Final verification is recorded in `CODEX_HANDOFF.md` after checks complete.

A paired local synthetic conversion benchmark used a generated 1280×720 YUV420p
frame scaled to 1920×1080 RGB: six alternating 75-frame batches produced median
10.87 ms before and 6.94 ms after (about 36% lower conversion time, identical
pixels). This is cloud CPU timing during other build activity, not a measurement
of Windows latency or camera throughput.

Hardware remains HEVC around 720p/~30fps in the tested landscape modes. Higher
native requests did not improve delivered video on firmware v1.1.15; upscaled
1080p or repeated 60fps output does not add source detail or motion. USB snapshots
showed storage only. Direct in-app broadcast, camera audio, WGU acceptance and
automatic hardware body-color detection are not established.

Next acceptance: rebuild the separate Dev executable, check cold connect and
Start/Stop, run a 60-minute webcam session with the working power settings, test
navigation/reconnect, then verify clean Windows installation and Teams/Zoom/
Whatnot. Keep the working upstream application intact. Public binary release
still depends on licensing, notices and installer acceptance.

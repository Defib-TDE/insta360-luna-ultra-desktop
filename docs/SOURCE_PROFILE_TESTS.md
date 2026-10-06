# Measure Luna's native preview profiles

The source selector changes the camera's preview request, not just output size.
Only the baseline has passed this user's hardware tests. Schema enum names are
experimental requests, not a list of supported Luna capabilities.

| Source choice | Primary resolution enum | Expected delivered sample |
| --- | --- | --- |
| Tested baseline | 9, `RES_1440_720P30` | This unit delivered 1280×720/~30fps in Slow-mo |
| 1080p30 | 29, `RES_1920_1080P30` | 1920×1080/~30fps |
| 1080p60 | 40, `RES_1920_1080P60` | 1920×1080/~60fps |
| 4K30 | 24, `RES_3840_2160P30` | 3840×2160/~30fps |
| 4K60 | 23, `RES_3840_2160P60` | 3840×2160/~60fps |

Only primary preview resolution changes; bitrate and secondary-stream fields
remain at their working values. No recording-resolution or orientation setter
is sent. There is no named 720p60 enum in this schema, so none is fabricated.
The source selector starts at baseline on every app launch. Stop webcam before
changing it. Rejected or silent requests fall back to baseline; an experimental
decoder startup failure also restores baseline. A request that produces a lower
quality stays visible as a mismatch. **Use tested baseline** restores it manually.

Source requests for 60fps also set virtual output to 60fps. If the actual source
remains at 30fps, that output repeats pictures. Full HD is a 1920×1080 output
shape; a delivered 720p source is enlarged, and a delivered 4K source is reduced.
Use the separate **Source**, **Decoded** and **Output** readings to distinguish
them. Source cadence describes this PC's wall-clock decode, not a sensor clock.

## Controlled hardware comparison

1. Rebuild the new development app using [STUDIO_SETUP.md](STUDIO_SETUP.md).
   Keep the upstream installed app intact and run only one webcam publisher.
2. Connect Luna, open Studio and turn **Match camera mode** off. Set the known
   working Slow-mo landscape configuration on the camera, then keep mode,
   orientation, lighting and distance fixed throughout this comparison.
3. Start with **Native camera source → 720p · 30 fps · tested**. Start webcam
   for in-app source measurements. Save a camera report and connection report.
4. Stop webcam, select 1080p30, then start again. Compare source dimensions and
   decoded cadence. Repeat for 1080p60, then 4K30/60 if practical. Acknowledgement
   alone is not a pass. Do not change camera mode between candidates.
5. A source that matches a short sample still needs moving-image inspection,
   CPU/load observation, restart/late-join checks, Wi-Fi recovery and a timed
   soak before it becomes a normal default. These candidates do not establish
   the camera's absolute maximum preview quality.

## Verify a source with the decoder script

Select the source in Studio first. Keep Studio open; its preview starts even
with webcam output stopped. The probe joins the established app relay and does
not change the camera request or open another control connection.

At the Windows repository root, run each command as one complete line. Replace
the URL if Studio shows a fallback port. First measure baseline:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\start-webcam.ps1 -Url "http://127.0.0.1:49183/stream" -Codec hevc -ProbeOnly -ProbeFrames 300 -WarmupSeconds 5 -ExpectProfile baseline
```

Then select 1080p60 in Studio and test that request:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\start-webcam.ps1 -Url "http://127.0.0.1:49183/stream" -Codec hevc -ProbeOnly -ProbeFrames 300 -WarmupSeconds 5 -ExpectProfile 1080p60
```

Use `1080p30`, `4k30` or `4k60` in `-ExpectProfile` for the other selections.
The script discards five seconds of initial decoded output, including buffered
GOPs, then measures 300 frames with a total 45-second deadline. It reports
`width`, `height`, `observedDecodeFps`, warmup counts and a verification result.
Rotated dimensions are accepted. A ±10% cadence window is a short-sample
criterion, not a proof of sustained or unique sensor frames.

- `matched_sample`, exit 0: requested dimensions and cadence matched this sample.
- `different_output`, exit 2: lower/different dimensions or decoded cadence.
  Slow software decoding or Wi-Fi stalls can lower cadence too; do not infer
  a firmware ceiling from this result alone.
- Exit 1: timeout, incomplete sample or decode/connection error. Preserve the
  error and connection report, then return to tested baseline in Studio.

`fps: 25` can remain in a raw HEVC probe as an FFmpeg heuristic. The verifier
uses `observedDecodeFps`, not that estimate. Save reports for each candidate with
firmware, source/profile selection and PC/connection conditions. No new native
resolution or frame rate is hardware-verified by the simulated automated tests.

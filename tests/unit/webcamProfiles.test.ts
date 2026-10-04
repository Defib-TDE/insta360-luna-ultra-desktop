import { describe, expect, it } from "vitest";
import {
  initialWebcamStatus,
  webcamProfile,
  readWebcamPreferences,
  WEBCAM_PROFILES,
} from "../../app/utils/webcamProfiles";

describe("webcam profiles", () => {
  it("uses conservative 30fps profiles, labels scaling and preserves portrait orientation", () => {
    expect(WEBCAM_PROFILES.every((profile) => profile.fps === 30)).toBe(true);
    expect(webcamProfile("portrait")).toMatchObject({ width: 720, height: 1280 });
    expect(webcamProfile("fullhd").detail).toContain("Upscaled");
    expect(webcamProfile("unknown").id).toBe("landscape");
  });
  it("initializes source and output metrics independently", () => {
    const status = initialWebcamStatus();
    expect(status.phase).toBe("stopped");
    expect(status.sourceFps).toBeNull();
    expect(status.outputFps).toBeNull();
    expect(initialWebcamStatus().logs).not.toBe(status.logs);
  });
  it("restores only safe output preferences, never starts output automatically", () => {
    expect(readWebcamPreferences('{"profileId":"portrait","mirror":true,"codec":"h264"}')).toEqual({
      profileId: "portrait",
      mirror: true,
      codec: "h264",
    });
    expect(readWebcamPreferences('{"profileId":"8k","mirror":"true","codec":"unknown"}')).toEqual({
      profileId: "landscape",
      mirror: false,
      codec: "hevc",
    });
    expect(readWebcamPreferences("null").profileId).toBe("landscape");
    expect(readWebcamPreferences("bad JSON").profileId).toBe("landscape");
  });
});

import { expect, it } from "vitest";
import schema from "~/assets/luna-protocol-schema.json";
import { PREVIEW_PROFILES, previewProfile, previewVerdict } from "~/utils/previewProfiles";

it("requests only named schema resolutions and defaults to the tested baseline", () => {
  const resolutions = Object.entries(schema.enums).find(([name]) =>
    name.endsWith("VideoResolution"),
  )![1] as Record<string, string>;
  const expected = [
    "RES_1440_720P30",
    "RES_1920_1080P30",
    "RES_1920_1080P60",
    "RES_3840_2160P30",
    "RES_3840_2160P60",
  ];
  expect(PREVIEW_PROFILES.map((profile) => resolutions[profile.resolution])).toEqual(expected);
  expect(previewProfile("unknown").id).toBe("baseline");
  expect(PREVIEW_PROFILES.slice(1).every((profile) => profile.experimental)).toBe(true);
});

it("compares delivered source rather than the virtual output, including rotated dimensions", () => {
  expect(previewVerdict("1080p60", 1280, 720, 60)).toContain("different resolution");
  expect(previewVerdict("1080p60", 1920, 1080, 30)).toContain("cadence differs");
  expect(previewVerdict("1080p60", 1080, 1920, 59.9)).toContain("match");
  expect(previewVerdict("1080p60", 1920, 1080, null)).toContain("Measuring");
});

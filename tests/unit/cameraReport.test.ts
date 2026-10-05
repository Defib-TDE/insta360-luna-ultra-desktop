import { afterEach, expect, it, vi } from "vitest";
import { collectCameraReport } from "~/utils/cameraReport";
import { MSG, encodeMessage } from "~/utils/lunaProto";
import { resetCameraTransport, setCameraTransport } from "~/utils/transport";
import { makeFakeTransport } from "../helpers/fakeTransport";

afterEach(resetCameraTransport);

it("uses only known read commands and excludes device credentials and identifiers", async () => {
  const command = vi.fn(async (code: number) => {
    if (code === 8)
      return encodeMessage(MSG.GetOptionsResp, {
        option_types: ["VIDEO_SUB_MODE", "PHOTO_SUB_MODE"],
        value: {
          video_sub_mode: "VIDEO_NORMAL",
          photo_sub_mode: "PHOTO_NONE",
          serial_number: "private-serial",
          authorization_id: "private-auth",
          firmwareRevision: "1.0.238",
        },
      });
    if (code === 10)
      return encodeMessage(MSG.GetPhotographyOptionsResp, {
        option_types: ["RECORD_RESOLUTION"],
        value: {},
      });
    expect(code).toBe(15);
    return encodeMessage(MSG.GetCurrentCaptureStatusResp, { status: {} });
  });
  setCameraTransport(makeFakeTransport({ command }));
  const report = await collectCameraReport({ deviceName: "Luna Ultra", firmware: "1.0.238" });
  expect(report.mode).toBe("video");
  expect(report.modeUnchangedDuringRead).toBe(true);
  expect(report.device.values).toMatchObject({ firmwareRevision: "1.0.238" });
  expect(JSON.stringify(report)).not.toContain("private-");
  expect(command.mock.calls.every(([code]) => [8, 10, 15].includes(code))).toBe(true);
});

import { afterEach, expect, it, vi } from "vitest";
import { collectCameraReport, collectConnectionReport } from "~/utils/cameraReport";
import type { WebcamStatus } from "~/types/webcam";
import { MSG, encodeMessage } from "~/utils/lunaProto";
import { resetCameraTransport, setCameraTransport } from "~/utils/transport";
import { makeFakeTransport } from "../helpers/fakeTransport";

afterEach(resetCameraTransport);

it("exports local recovery evidence while disconnected without sending any camera commands", async () => {
  const transport = makeFakeTransport({
    connectionDiagnostics: vi.fn(async () => ({
      build: { version: "0.3.2-1", commit: "123456abcdef", profile: "release" },
      connected: false,
      lastReceiveAgeSeconds: null,
      lastVideoAgeSeconds: null,
      commandTimeouts: 0,
      events: [{ atUnixMs: 1000, message: "Camera closed the control socket." }],
    })),
    liveViewStats: vi.fn(async () => ({
      bytes: 0,
      packets: 0,
      firstBytesHex: "",
      seconds: 0,
      sourceLaggedPackets: 2,
      events: [{ atUnixMs: 900, message: "Source fell behind." }],
    })),
  });
  setCameraTransport(transport);
  const report = await collectConnectionReport(
    {
      phase: "reconnecting",
      sourceWidth: 1280,
      sourceHeight: 720,
      sourceFps: 29.96,
      outputFps: 30,
      reconnects: 1,
      error: null,
      logs: ["Stream ended"],
      url: "http://127.0.0.1:49183/stream",
      device: "OBS Virtual Camera",
    } as WebcamStatus,
    ["Preview retry"],
    "v1.1.15",
    { version: "0.3.2-1", commit: "frontend-revision", channel: "webcam-dev" },
  );
  expect(report.connection?.connected).toBe(false);
  expect(report.relay?.sourceLaggedPackets).toBe(2);
  expect(report.webcam.logs).toEqual(["Stream ended"]);
  expect(report.firmware).toBe("v1.1.15");
  expect(report.appBuild?.commit).toBe("frontend-revision");
  expect(report.connection?.build?.commit).toBe("123456abcdef");
  expect(transport.command).not.toHaveBeenCalled();
  expect(transport.probe).not.toHaveBeenCalled();
  expect(transport.connect).not.toHaveBeenCalled();
  expect(report.webcam).not.toHaveProperty("url");
});

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
          standby_duration: 60,
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
  const report = await collectCameraReport(
    { deviceName: "Luna Ultra", firmware: "1.0.238" },
    undefined,
    { version: "0.3.2-1", commit: "frontend-revision", channel: "webcam-dev" },
  );
  expect(report.mode).toBe("video");
  expect(report.modeUnchangedDuringRead).toBe(true);
  expect(report.device.values).toMatchObject({ firmwareRevision: "1.0.238" });
  expect(report.device.values).toHaveProperty("standby_duration", 60);
  expect(report.appBuild?.commit).toBe("frontend-revision");
  expect(JSON.stringify(report)).not.toContain("private-");
  expect(command.mock.calls.every(([code]) => [8, 10, 15].includes(code))).toBe(true);
});

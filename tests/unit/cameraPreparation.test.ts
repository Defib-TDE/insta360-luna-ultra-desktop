import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmCameraIdle, prepareCameraMode, readCameraMode } from "~/utils/cameraPreparation";
import { MSG, decodeMessage, encodeMessage } from "~/utils/lunaProto";
import { resetCameraTransport, setCameraTransport } from "~/utils/transport";
import { makeFakeTransport } from "../helpers/fakeTransport";

const modeResponse = (video: string) =>
  encodeMessage(MSG.GetOptionsResp, {
    option_types: ["VIDEO_SUB_MODE", "PHOTO_SUB_MODE"],
    value: { video_sub_mode: video, photo_sub_mode: "PHOTO_NONE" },
  });
const idle = () => encodeMessage(MSG.GetCurrentCaptureStatusResp, { status: {} });

afterEach(() => {
  resetCameraTransport();
  vi.useRealTimers();
});

describe("verified camera preparation", () => {
  it("distinguishes acknowledged enum zero from an unsupported or empty reply", async () => {
    const command = vi.fn(async () => new Uint8Array(0));
    setCameraTransport(makeFakeTransport({ command }));
    expect((await readCameraMode()).mode).toBeNull();
    command.mockResolvedValue(
      encodeMessage(MSG.GetOptionsResp, { option_types: ["VIDEO_SUB_MODE"], value: {} }),
    );
    expect((await readCameraMode()).mode?.id).toBe("video");
    command.mockResolvedValue(encodeMessage(MSG.GetOptionsResp, { value: {} }));
    expect((await readCameraMode()).mode).toBeNull();
  });

  it("requires a present idle status and rejects recording before any settings write", async () => {
    const command = vi.fn(async (code: number) =>
      code === 8 ? modeResponse("VIDEO_NORMAL") : new Uint8Array(0),
    );
    setCameraTransport(makeFakeTransport({ command }));
    await expect(prepareCameraMode("slowmo")).rejects.toThrow("Cannot confirm");
    expect(command.mock.calls.map(([code]) => code)).toEqual([8, 15]);
    command.mockImplementation(async (code) =>
      code === 8
        ? modeResponse("VIDEO_NORMAL")
        : encodeMessage(MSG.GetCurrentCaptureStatusResp, { status: { state: "NORMAL_CAPTURE" } }),
    );
    await expect(prepareCameraMode("slowmo")).rejects.toThrow("Stop recording");
    expect(command.mock.calls.every(([code]) => code === 8 || code === 15)).toBe(true);
    command.mockResolvedValue(idle());
    await expect(confirmCameraIdle()).resolves.toBeUndefined();
  });

  it("keeps an already matching camera untouched, including its color settings", async () => {
    const command = vi.fn(async () => modeResponse("VIDEO_NORMAL"));
    setCameraTransport(makeFakeTransport({ command }));
    expect(await prepareCameraMode("video")).toMatchObject({
      changed: false,
      mode: { id: "video" },
    });
    expect(command).toHaveBeenCalledOnce();
  });

  it("does not reset colors when a camera accepts but ignores the requested mode", async () => {
    vi.useFakeTimers();
    const command = vi.fn(async (code: number) => {
      if (code === 8) return modeResponse("VIDEO_PURE");
      if (code === 15) return idle();
      return encodeMessage(MSG.SetOptionsResp, { option_types: ["VIDEO_SUB_MODE"] });
    });
    setCameraTransport(makeFakeTransport({ command }));
    const verdict = expect(prepareCameraMode("slowmo")).rejects.toThrow("did not switch");
    await vi.runAllTimersAsync();
    await verdict;
    expect(command.mock.calls.filter(([code]) => code === 7)).toHaveLength(1);
    expect(command.mock.calls.some(([code]) => code === 9)).toBe(false);
  });

  it("verifies a delayed mode change before its dependent Standard reset", async () => {
    vi.useFakeTimers();
    let reads = 0;
    const order: number[] = [];
    const command = vi.fn(async (code: number, payload: Uint8Array) => {
      order.push(code);
      if (code === 8) return modeResponse(++reads < 3 ? "VIDEO_PURE" : "VIDEO_SLOW_MOTION");
      if (code === 15) return idle();
      if (code === 7)
        return encodeMessage(MSG.SetOptionsResp, { option_types: ["VIDEO_SUB_MODE"] });
      expect(decodeMessage(MSG.SetPhotographyOptions, payload)).toMatchObject({
        value: { color_mode: "COLOR_MODE_NORMAL", gamma_mode: "FILTER_NONE" },
      });
      return encodeMessage(MSG.SetPhotographyOptionsResp, {
        success_types: ["COLOR_MODE", "VIDEO_GAMMA_MODE"],
      });
    });
    setCameraTransport(makeFakeTransport({ command }));
    const pending = prepareCameraMode("slowmo");
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ changed: true, mode: { id: "slowmo" } });
    expect(order).toEqual([8, 15, 7, 8, 8, 15, 9]);
  });

  it("stops dependent writes if recording starts after the mode change", async () => {
    let written = false;
    const command = vi.fn(async (code: number) => {
      if (code === 8) return modeResponse(written ? "VIDEO_SLOW_MOTION" : "VIDEO_PURE");
      if (code === 15)
        return written
          ? encodeMessage(MSG.GetCurrentCaptureStatusResp, { status: { state: "NORMAL_CAPTURE" } })
          : idle();
      written = true;
      return encodeMessage(MSG.SetOptionsResp, { option_types: ["VIDEO_SUB_MODE"] });
    });
    setCameraTransport(makeFakeTransport({ command }));
    await expect(prepareCameraMode("slowmo")).rejects.toThrow("Stop recording");
    expect(command.mock.calls.some(([code]) => code === 9)).toBe(false);
  });
});

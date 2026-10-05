import { findMode, modeForState } from "~/utils/cameraModes";
import { resetsToStandard } from "~/utils/cameraCapabilities";
import { MSG, decodeMessage, encodeMessage, type ProtoObject } from "~/utils/lunaProto";
import { writeDeviceOptions, writePhotographyOptions } from "~/utils/lunaSettings";
import { getCameraTransport } from "~/utils/transport";

function check(signal?: AbortSignal) {
  signal?.throwIfAborted();
}

/** Empty/unsupported responses must not be interpreted as an idle camera. */
export async function confirmCameraIdle(signal?: AbortSignal) {
  check(signal);
  const response = await getCameraTransport().command(15, new Uint8Array(0));
  check(signal);
  const status = decodeMessage(MSG.GetCurrentCaptureStatusResp, response).status;
  if (!status || typeof status !== "object" || Array.isArray(status)) {
    throw new Error("Cannot confirm the camera is idle. Keep your camera settings or try again.");
  }
  // A present empty status message legitimately represents proto3 state zero.
  if ((status.state ?? "NOT_CAPTURE") !== "NOT_CAPTURE") {
    throw new Error("Stop recording or shooting on the camera before changing its mode.");
  }
}

export async function readCameraMode(signal?: AbortSignal) {
  check(signal);
  const response = await getCameraTransport().command(
    8,
    encodeMessage(MSG.GetOptions, { option_types: ["VIDEO_SUB_MODE", "PHOTO_SUB_MODE"] }),
  );
  check(signal);
  const packet = decodeMessage(MSG.GetOptionsResp, response);
  const options = { ...(packet.value as ProtoObject | undefined) };
  const supported = (packet.option_types as string[] | undefined) ?? [];
  // An omitted enum is zero only when the camera explicitly reports support
  // for that requested option. Otherwise the active mode remains unknown.
  if (supported.includes("VIDEO_SUB_MODE")) options.video_sub_mode ??= "VIDEO_NORMAL";
  if (supported.includes("PHOTO_SUB_MODE")) options.photo_sub_mode ??= "PHOTO_SINGLE";
  const mode = modeForState(
    options.video_sub_mode === undefined ? undefined : String(options.video_sub_mode),
    options.photo_sub_mode === undefined ? undefined : String(options.photo_sub_mode),
  );
  return { mode, options };
}

async function pause(signal?: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason ?? new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, 250);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

let changing = false;

/** One write, bounded readback, and no dependent writes after a rejected mode. */
export async function prepareCameraMode(id: string, signal?: AbortSignal) {
  const target = findMode(id);
  if (!target) throw new Error("Unknown camera mode.");
  if (changing) throw new Error("Another camera mode change is still finishing. Try again.");
  changing = true;
  try {
    const before = await readCameraMode(signal);
    if (before.mode?.id === target.id) return { ...before, mode: target, changed: false };
    if (!before.mode)
      throw new Error("Cannot read the current camera mode. Try Keep my camera settings.");
    await confirmCameraIdle(signal);
    check(signal);
    const accepted = await writeDeviceOptions([target.optionType], {
      [target.field]: target.subMode,
    });
    check(signal);
    if (!accepted.includes(target.optionType)) {
      throw new Error(
        `The camera rejected ${target.label} mode. Choose it on the camera or keep your settings.`,
      );
    }
    let observed = before;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (attempt) await pause(signal);
      observed = await readCameraMode(signal);
      if (observed.mode?.id === target.id) break;
    }
    if (observed.mode?.id !== target.id) {
      throw new Error(
        `The camera did not switch to ${target.label}. It reports ${observed.mode?.label ?? "an unknown mode"}. Try camera controls or keep your settings.`,
      );
    }
    if (resetsToStandard(target.id)) {
      await confirmCameraIdle(signal);
      const acceptedColor = await writePhotographyOptions(
        target.functionMode,
        ["COLOR_MODE", "VIDEO_GAMMA_MODE"],
        {
          color_mode: "COLOR_MODE_NORMAL",
          gamma_mode: "FILTER_NONE",
        },
      );
      check(signal);
      if (!["COLOR_MODE", "VIDEO_GAMMA_MODE"].every((type) => acceptedColor.includes(type))) {
        throw new Error(
          `${target.label} is selected, but its Standard color/filter reset was not accepted. Check camera controls.`,
        );
      }
    }
    return { ...observed, mode: target, changed: true };
  } finally {
    changing = false;
  }
}

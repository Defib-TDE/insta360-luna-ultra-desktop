import { readCameraMode } from "~/utils/cameraPreparation";
import { readDeviceOptions, readPhotographyOptions } from "~/utils/lunaSettings";
import { MSG, decodeMessage, type ProtoObject } from "~/utils/lunaProto";
import { getCameraTransport } from "~/utils/transport";
import type { WebcamStatus } from "~/types/webcam";

const DEVICE_FIELDS = [
  "video_sub_mode",
  "photo_sub_mode",
  "camera_posture",
  "video_resolution",
  "second_stream_res",
  "video_encode_type",
  "video_bitrate",
  "photo_size",
  "camera_type",
  "hw_type",
  "firmwareRevision",
  "quality_setting",
  "television_system",
  "window_crop_info",
  "wifi_working_status",
];

/** Only existing GET commands through the established session; no code sweep. */
export async function collectCameraReport(
  identity: { deviceName?: string; firmware?: string },
  preview?: {
    codec: string;
    sourceWidth: number | null;
    sourceHeight: number | null;
    observedDecodeFps: number | null;
    outputWidth: number;
    outputHeight: number;
    outputFps: number;
  },
) {
  const current = await readCameraMode();
  const device = await readDeviceOptions();
  const photography = current.mode ? await readPhotographyOptions(current.mode.functionMode) : null;
  const capture = await getCameraTransport().command(15, new Uint8Array(0));
  const after = await readCameraMode();
  return {
    schemaVersion: 1,
    collectedAt: new Date().toISOString(),
    deviceName: identity.deviceName,
    firmware: identity.firmware,
    scope:
      "Known GET_OPTIONS, GET_PHOTOGRAPHY_OPTIONS and capture-status commands. Acknowledgement does not prove that an option changes this model's behavior; resolution values may describe recording rather than preview. This is not a complete list of functions or USB capabilities.",
    mode: current.mode?.id ?? null,
    preview,
    modeUnchangedDuringRead: current.mode !== null && current.mode.id === after.mode?.id,
    device: {
      acknowledgedOptionTypes: device.$supported,
      // Device options include Wi-Fi credentials, identifiers and licenses.
      // Export only fields relevant to preview/recording research.
      values: Object.fromEntries(
        DEVICE_FIELDS.filter((key) => device[key] !== undefined).map((key) => [key, device[key]]),
      ),
    },
    photography,
    captureStatus: decodeMessage(MSG.GetCurrentCaptureStatusResp, capture).status as
      | ProtoObject
      | undefined,
  };
}

/** Local snapshots only: works during a dropout and cannot add camera load. */
export async function collectConnectionReport(
  webcam: WebcamStatus,
  previewNotes: string[],
  firmware?: string,
) {
  const transport = getCameraTransport();
  const [connection, relay] = await Promise.all([
    transport.connectionDiagnostics?.().catch(() => null) ?? null,
    transport.liveViewStats().catch(() => null),
  ]);
  return {
    schemaVersion: 1,
    collectedAt: new Date().toISOString(),
    scope:
      "Local connection, relay and decoder diagnostics. No camera commands, device identifiers or Wi-Fi credentials. Relay recovery counters cover this app process; command timeouts cover the current control session.",
    firmware,
    connection,
    relay,
    previewNotes: previewNotes.slice(-80),
    webcam: {
      phase: webcam.phase,
      sourceWidth: webcam.sourceWidth,
      sourceHeight: webcam.sourceHeight,
      observedDecodeFps: webcam.sourceFps,
      outputFps: webcam.outputFps,
      reconnects: webcam.reconnects,
      error: webcam.error,
      logs: webcam.logs.slice(-60),
    },
  };
}

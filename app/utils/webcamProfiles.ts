export const WEBCAM_PROFILES = [
  {
    id: "landscape",
    label: "Landscape",
    detail: "Calls & OBS",
    width: 1280,
    height: 720,
    fps: 30,
    icon: "i-lucide-monitor",
    cameraMode: "slowmo",
    cameraModeLabel: "Slow-mo",
  },
  {
    id: "portrait",
    label: "Portrait",
    detail: "Vertical streams",
    width: 720,
    height: 1280,
    fps: 30,
    icon: "i-lucide-smartphone",
    cameraMode: "video",
    cameraModeLabel: "Video",
  },
  {
    id: "fullhd",
    label: "Full HD",
    detail: "1920 × 1080 output",
    width: 1920,
    height: 1080,
    fps: 30,
    icon: "i-lucide-expand",
    cameraMode: "slowmo",
    cameraModeLabel: "Slow-mo",
  },
] as const;

export type WebcamProfileId = (typeof WEBCAM_PROFILES)[number]["id"];

export const WEBCAM_PREFERENCES_KEY = "luna-studio-preferences";

export function readWebcamPreferences(saved: string | null) {
  const defaults: {
    profileId: WebcamProfileId;
    mirror: boolean;
    codec: "hevc" | "h264";
    matchCamera: boolean;
  } = {
    profileId: "landscape",
    mirror: false,
    codec: "hevc",
    matchCamera: true,
  };
  try {
    const value = JSON.parse(saved ?? "{}");
    if (!value || typeof value !== "object") return defaults;
    return {
      profileId: webcamProfile(value.profileId).id,
      mirror: value.mirror === true,
      codec: value.codec === "h264" ? ("h264" as const) : ("hevc" as const),
      matchCamera: value.matchCamera !== false,
    };
  } catch {
    return defaults;
  }
}

export function webcamProfile(id: string) {
  return WEBCAM_PROFILES.find((profile) => profile.id === id) ?? WEBCAM_PROFILES[0];
}

export function initialWebcamStatus(): import("~/types/webcam").WebcamStatus {
  return {
    phase: "stopped",
    url: null,
    device: null,
    sourceWidth: null,
    sourceHeight: null,
    sourceFps: null,
    outputFps: null,
    reconnects: 0,
    error: null,
    logs: [],
  };
}

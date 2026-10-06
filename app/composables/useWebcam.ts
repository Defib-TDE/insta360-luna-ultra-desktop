import { getWebcamClient } from "~/utils/webcamClient";
import {
  initialWebcamStatus,
  webcamProfile,
  readWebcamPreferences,
  WEBCAM_PREFERENCES_KEY,
  type WebcamProfileId,
} from "~/utils/webcamProfiles";
import type { WebcamEnvironment, WebcamStatus } from "~/types/webcam";

export function useWebcam() {
  const preferences = useState("webcam-preferences", () => {
    try {
      return readWebcamPreferences(localStorage.getItem(WEBCAM_PREFERENCES_KEY));
    } catch {
      return readWebcamPreferences(null);
    }
  });
  const environment = useState<WebcamEnvironment | null>("webcam-environment", () => null);
  const status = useState<WebcamStatus>("webcam-status", initialWebcamStatus);
  const wanted = useState("webcam-wanted", () => false);
  const request = useState("webcam-request", () => 0);
  const profileId = useState<WebcamProfileId>("webcam-profile", () => preferences.value.profileId);
  const mirror = useState("webcam-mirror", () => preferences.value.mirror);
  const codec = useState<"hevc" | "h264">("webcam-codec", () => preferences.value.codec);
  const matchCamera = useState("webcam-match-camera", () => preferences.value.matchCamera);
  const preparing = useState("webcam-preparing-camera", () => false);
  const cameraMode = useState<string | null>("webcam-camera-mode", () => null);
  const checking = useState("webcam-checking", () => false);
  const error = useState<string | null>("webcam-error", () => null);
  const profile = computed(() => webcamProfile(profileId.value));
  const publishing = computed(() => status.value.phase === "publishing");
  const running = computed(() =>
    ["starting", "publishing", "reconnecting"].includes(status.value.phase),
  );

  async function check() {
    checking.value = true;
    error.value = null;
    try {
      environment.value = await getWebcamClient().environment();
    } catch (cause) {
      error.value = String(cause);
    } finally {
      checking.value = false;
    }
  }

  async function setup() {
    error.value = null;
    status.value = { ...status.value, phase: "installing" };
    try {
      await getWebcamClient().setup();
      await check();
    } catch (cause) {
      error.value = String(cause);
    } finally {
      await refresh();
    }
  }

  async function refresh() {
    if (!environment.value?.supported) return;
    try {
      status.value = await getWebcamClient().status();
    } catch (cause) {
      error.value = String(cause);
    }
  }

  function start() {
    error.value = null;
    wanted.value = true;
    request.value += 1;
    status.value = {
      ...status.value,
      phase: "starting",
      error: null,
      sourceWidth: null,
      sourceHeight: null,
      sourceFps: null,
      outputFps: null,
    };
  }

  function stop() {
    wanted.value = false;
  }

  return {
    environment,
    status,
    wanted,
    request,
    profileId,
    profile,
    mirror,
    codec,
    matchCamera,
    preparing,
    cameraMode,
    checking,
    error,
    publishing,
    running,
    check,
    setup,
    refresh,
    start,
    stop,
  };
}

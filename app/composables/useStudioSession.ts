import { getWebcamClient } from "~/utils/webcamClient";
import { WEBCAM_PREFERENCES_KEY } from "~/utils/webcamProfiles";
import { prepareCameraMode } from "~/utils/cameraPreparation";
import type { ProtoObject } from "~/utils/lunaProto";

/** Mounted once in the shell. Navigation cannot steal an active webcam's stream. */
export function useStudioSession() {
  const route = useRoute();
  const router = useRouter();
  const camera = useCamera();
  const live = useLiveView();
  const webcam = useWebcam();
  let queue = Promise.resolve();
  let disposed = false;
  let startedRequest = -1;
  let preparedRequest = -1;
  let preparation: AbortController | undefined;
  let navigatingTo: string | undefined;
  const captureBusy = useState("camera-capture-busy", () => false);
  const settingsSaving = useState<string | null>("camera-settings-saving", () => null);
  const captureMode = useState("camera-capture-mode", () => "video");
  const settingsMode = useState("camera-settings-mode", () => "FUNCTION_MODE_NORMAL_VIDEO");
  const device = useState<ProtoObject>("camera-device-options", () => ({}));
  let timer: ReturnType<typeof setInterval> | undefined;
  // Release MJPEG before Gallery starts its camera HTTP requests. An active
  // webcam always uses the control-session relay and must survive navigation.
  const removeGuard = router.beforeEach(async (to) => {
    navigatingTo = to.path;
    if (!webcam.wanted.value && !["/camera", "/studio"].includes(to.path) && live.active.value) {
      await live.stop();
    }
  });
  const removeAfter = router.afterEach((_to, _from, failure) => {
    if (failure) {
      navigatingTo = undefined;
      schedule();
    }
  });
  watch(
    () => route.path,
    (path) => {
      if (path === navigatingTo) navigatingTo = undefined;
    },
  );

  // Cancel immediately, even while the serialized queue awaits camera RPC.
  watch(
    [camera.isConnected, webcam.wanted],
    ([connected, wanted]) => {
      if (!connected || !wanted) preparation?.abort();
    },
    { flush: "sync" },
  );

  async function prepare() {
    const request = webcam.request.value;
    if (preparedRequest === request) return;
    if (!webcam.matchCamera.value) {
      webcam.cameraMode.value = null;
      preparedRequest = request;
      return;
    }
    if (captureBusy.value || settingsSaving.value)
      throw new Error("Finish the current camera operation, then start webcam again.");
    const controller = new AbortController();
    preparation = controller;
    webcam.preparing.value = true;
    captureBusy.value = true;
    try {
      await live.stop();
      controller.signal.throwIfAborted();
      const result = await prepareCameraMode(webcam.profile.value.cameraMode, controller.signal);
      controller.signal.throwIfAborted();
      if (request !== webcam.request.value) return;
      captureMode.value = result.mode.id;
      settingsMode.value = result.mode.functionMode;
      device.value = { ...device.value, ...result.options };
      webcam.cameraMode.value = result.mode.label;
      preparedRequest = request;
    } catch (cause) {
      controller.signal.throwIfAborted();
      throw cause;
    } finally {
      webcam.preparing.value = false;
      captureBusy.value = false;
      if (preparation === controller) preparation = undefined;
    }
  }

  async function reconcile() {
    if (disposed) return;
    // Nuxt's route can still refer to the old page during a navigation guard.
    const preview = ["/camera", "/studio"].includes(navigatingTo ?? route.path);
    if (!webcam.wanted.value && (webcam.running.value || webcam.status.value.url)) {
      await getWebcamClient().stop();
      await webcam.refresh();
      startedRequest = -1;
    }
    if (!camera.isConnected.value) {
      if (live.active.value) await live.stop();
      // Wi-Fi loss keeps the user's connection intent; an explicit Disconnect
      // (or a health-forced disconnect) must release output, not retry forever.
      if (!camera.wantConnection.value && webcam.wanted.value) {
        webcam.wanted.value = false;
        await getWebcamClient().stop();
        await webcam.refresh();
        startedRequest = -1;
      }
      return;
    }
    if (!preview && !webcam.wanted.value) {
      if (live.active.value) await live.stop();
      return;
    }
    if (webcam.wanted.value) await prepare();
    if (disposed || !camera.isConnected.value || (!preview && !webcam.wanted.value)) return;
    const request = webcam.request.value;
    await live.start({ elementary: webcam.wanted.value });
    if (webcam.wanted.value && live.failed.value)
      throw new Error(live.error.value ?? "Preview could not start. Try again.");
    if (
      webcam.wanted.value &&
      request === webcam.request.value &&
      live.streamUrl.value &&
      live.transport.value === "annexb"
    ) {
      if (
        startedRequest !== webcam.request.value ||
        (webcam.running.value && webcam.status.value.url !== live.streamUrl.value)
      ) {
        const profile = webcam.profile.value;
        await getWebcamClient().start({
          url: live.streamUrl.value,
          codec: webcam.codec.value,
          width: profile.width,
          height: profile.height,
          fps: profile.fps,
          mirror: webcam.mirror.value,
        });
        startedRequest = request;
        await webcam.refresh();
      }
    }
  }

  function schedule() {
    queue = queue.then(reconcile).catch((cause) => {
      if (cause instanceof Error && cause.name === "AbortError") return;
      webcam.error.value = String(cause);
      webcam.status.value = { ...webcam.status.value, phase: "error" };
      webcam.wanted.value = false;
    });
  }

  watch(
    [() => route.path, camera.isConnected, webcam.wanted, webcam.request, live.streamUrl],
    schedule,
    {
      immediate: true,
    },
  );
  watch(
    camera.isConnected,
    (connected) => {
      if (connected) live.resetRecovery();
    },
    { flush: "sync" },
  );
  watch(
    webcam.request,
    () => {
      if (live.failed.value) live.resetRecovery();
    },
    { flush: "sync" },
  );
  watch(
    [webcam.profileId, webcam.mirror, webcam.codec, webcam.matchCamera],
    ([profileId, mirror, codec, matchCamera]) => {
      try {
        localStorage.setItem(
          WEBCAM_PREFERENCES_KEY,
          JSON.stringify({ profileId, mirror, codec, matchCamera }),
        );
      } catch {
        /* Output still works when local storage is unavailable. */
      }
    },
  );
  onMounted(() => {
    void webcam.check();
    timer = setInterval(() => {
      void webcam.refresh();
      if (camera.isConnected.value && webcam.wanted.value && !live.active.value) schedule();
    }, 1000);
  });
  onBeforeUnmount(() => {
    disposed = true;
    preparation?.abort();
    void live.stop();
    clearInterval(timer);
    removeGuard();
    removeAfter();
  });
}

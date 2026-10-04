import { getWebcamClient } from "~/utils/webcamClient";
import { WEBCAM_PREFERENCES_KEY } from "~/utils/webcamProfiles";

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
  let timer: ReturnType<typeof setInterval> | undefined;
  // Release MJPEG before Gallery starts its camera HTTP requests. An active
  // webcam always uses the control-session relay and must survive navigation.
  const removeGuard = router.beforeEach(async (to) => {
    if (!webcam.wanted.value && !["/camera", "/studio"].includes(to.path) && live.active.value) {
      await live.stop();
    }
  });

  async function reconcile() {
    if (disposed) return;
    const preview = ["/camera", "/studio"].includes(route.path);
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
    await live.start({ elementary: webcam.wanted.value });
    if (webcam.wanted.value && live.streamUrl.value && live.transport.value === "annexb") {
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
        startedRequest = webcam.request.value;
        await webcam.refresh();
      }
    }
  }

  function schedule() {
    queue = queue.then(reconcile).catch((cause) => {
      webcam.error.value = String(cause);
      webcam.status.value = { ...webcam.status.value, phase: "error" };
      webcam.wanted.value = false;
    });
  }

  watch([() => route.path, camera.isConnected, webcam.wanted, webcam.request], schedule, {
    immediate: true,
  });
  watch([webcam.profileId, webcam.mirror, webcam.codec], ([profileId, mirror, codec]) => {
    try {
      localStorage.setItem(WEBCAM_PREFERENCES_KEY, JSON.stringify({ profileId, mirror, codec }));
    } catch {
      /* Output still works when local storage is unavailable. */
    }
  });
  onMounted(() => {
    void webcam.check();
    timer = setInterval(() => {
      void webcam.refresh();
      if (camera.isConnected.value && webcam.wanted.value && !live.active.value) schedule();
    }, 1000);
  });
  onBeforeUnmount(() => {
    disposed = true;
    clearInterval(timer);
    removeGuard();
  });
}

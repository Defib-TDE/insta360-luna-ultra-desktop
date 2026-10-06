import type { LiveViewStats } from "~/types/media";
import { getCameraTransport } from "~/utils/transport";
import { previewProfile, type PreviewProfileId } from "~/utils/previewProfiles";

export type LiveTransport = "mjpeg" | "annexb";
const FIRST_BYTE_TIMEOUT_MS = 6000;
interface Runtime {
  queue: Promise<void>;
  version: number;
  retries: number;
  profile?: PreviewProfileId;
  timer?: ReturnType<typeof setTimeout>;
}
const runtimes = new WeakMap<object, Runtime>();

export function useLiveView() {
  const { host, isConnected } = useCamera();
  const app = useNuxtApp();
  let owner = runtimes.get(app);
  if (!owner) {
    owner = { queue: Promise.resolve(), version: 0, retries: 0 };
    runtimes.set(app, owner);
  }
  const runtime = owner;
  const active = useState<boolean>("liveview-active", () => false);
  const starting = useState<boolean>("liveview-starting", () => false);
  const transport = useState<LiveTransport | null>("liveview-transport", () => null);
  const streamUrl = useState<string | null>("liveview-url", () => null);
  const error = useState<string | null>("liveview-error", () => null);
  const failed = useState("liveview-failed", () => false);
  const revision = useState("liveview-revision", () => 0);
  const diagnostics = useState<string[]>("liveview-diagnostics", () => []);
  // Experimental source requests are deliberately not persisted across launches.
  const sourceProfile = useState<PreviewProfileId>("liveview-source-profile", () => "baseline");
  const sourceRequest = computed(() => previewProfile(sourceProfile.value));
  const note = (line: string) => {
    diagnostics.value = [...diagnostics.value, line].slice(-80);
  };
  // All consumers share native operations and timers, not just reactive flags.
  const enqueue = (work: () => Promise<void>) => {
    const pending = runtime.queue.then(work);
    runtime.queue = pending.catch(() => {});
    return pending;
  };
  function clearState() {
    clearTimeout(runtime.timer);
    runtime.timer = undefined;
    active.value = false;
    transport.value = null;
    streamUrl.value = null;
    runtime.profile = undefined;
  }
  function resetRecovery() {
    failed.value = false;
    runtime.retries = 0;
  }
  const stopNative = () =>
    getCameraTransport()
      .liveViewStop()
      .catch(() => {});

  async function watchFirstBytes(version: number, elementary: boolean) {
    const profile = runtime.profile;
    const current = () =>
      runtime.version === version &&
      active.value &&
      isConnected.value &&
      runtime.profile === profile &&
      sourceProfile.value === profile;
    if (!current()) return;
    const stats = await getCameraTransport()
      .liveViewStats()
      .catch(() => null);
    if (!current()) return;
    clearTimeout(runtime.timer);
    runtime.timer = undefined;
    if (stats && stats.bytes > 0) {
      note("Video bytes received (" + stats.bytes + ").");
      return;
    }
    clearState();
    runtime.version += 1;
    if (runtime.retries < 1) {
      runtime.retries += 1;
      if (profile && profile !== "baseline") {
        sourceProfile.value = "baseline";
        note("Experimental request sent no video. Restoring the tested baseline.");
      } else note("No video bytes yet. Restarting preview once.");
      const recoveryVersion = runtime.version;
      await enqueue(stopNative);
      if (!isConnected.value || runtime.version !== recoveryVersion) return;
      await start({ elementary });
    } else {
      failed.value = true;
      error.value =
        "The camera sent no video after a preview retry. Retry preview or reconnect the camera.";
      note(error.value);
      await enqueue(stopNative);
    }
  }

  function start({ elementary = false } = {}) {
    const requestedVersion = runtime.version;
    const requestedProfile = sourceProfile.value;
    elementary ||= requestedProfile !== "baseline";
    let fallback = false;
    return enqueue(async () => {
      if (requestedVersion !== runtime.version || failed.value) return;
      if (sourceProfile.value !== requestedProfile) return;
      if (active.value && runtime.profile !== requestedProfile) resetRecovery();
      if (
        active.value &&
        runtime.profile === requestedProfile &&
        (!elementary || transport.value === "annexb")
      )
        return;
      if (!isConnected.value) {
        error.value = "Connect to the camera first.";
        return;
      }
      const version = runtime.version;
      const current = () => runtime.version === version && isConnected.value;
      starting.value = true;
      error.value = null;
      if (!runtime.retries) diagnostics.value = [];
      try {
        if (active.value) {
          clearState();
          await stopNative();
          if (!current()) return;
        }
        const osc = elementary ? null : await getCameraTransport().probeOscPreview(host.value);
        if (!current()) return;
        if (osc) {
          note("OSC MJPEG preview available; using it.");
          transport.value = "mjpeg";
          streamUrl.value = osc;
          active.value = true;
          runtime.profile = requestedProfile;
          revision.value += 1;
          return;
        }
        note("Starting the control-session video stream.");
        const info = await getCameraTransport().liveViewStart(requestedProfile);
        if (!current()) return;
        if (sourceProfile.value !== requestedProfile) {
          await stopNative();
          return;
        }
        note(
          "START_LIVE_STREAM reply received. Requested quality is unverified. Serving on port " +
            info.port +
            ".",
        );
        note("External decoder URL: " + info.url);
        transport.value = "annexb";
        streamUrl.value = info.url;
        active.value = true;
        runtime.profile = requestedProfile;
        revision.value += 1;
        runtime.timer = setTimeout(
          () => void watchFirstBytes(version, elementary),
          FIRST_BYTE_TIMEOUT_MS,
        );
      } catch (cause) {
        if (!current()) return;
        error.value = cause instanceof Error ? cause.message : String(cause);
        note("Failed: " + error.value);
        if (requestedProfile !== "baseline") {
          sourceProfile.value = "baseline";
          note("Experimental request failed. Restoring the tested baseline.");
          runtime.retries = 1;
          fallback = true;
        } else failed.value = true;
        clearState();
        await stopNative();
      } finally {
        if (runtime.version === version) starting.value = false;
      }
    }).then(async () => {
      if (fallback && requestedVersion === runtime.version && isConnected.value)
        await start({ elementary: true });
    });
  }

  function stop() {
    runtime.version += 1;
    clearState();
    starting.value = false;
    resetRecovery();
    return enqueue(stopNative);
  }
  async function retry({ elementary = false } = {}) {
    await stop();
    await start({ elementary });
  }
  async function refreshStats(): Promise<LiveViewStats | null> {
    if (!active.value) return null;
    return getCameraTransport()
      .liveViewStats()
      .catch(() => null);
  }
  return {
    active,
    starting,
    transport,
    streamUrl,
    error,
    failed,
    revision,
    diagnostics,
    sourceProfile,
    sourceRequest,
    note,
    start,
    stop,
    retry,
    resetRecovery,
    refreshStats,
  };
}

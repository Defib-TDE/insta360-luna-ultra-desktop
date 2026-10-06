import type { CameraInfo, CameraStatus, MediaItem } from "~/types/media";
import { getCameraTransport } from "~/utils/transport";
import { armCameraHealth, disarmCameraHealth, FAILURE_THRESHOLD } from "~/utils/cameraHealth";

const DEFAULT_HOST = "192.168.42.1";
const HOST_STORAGE_KEY = "luna-camera-host";

/** Reconnect backoff schedule; the last delay repeats until reconnected. */
const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 15000];

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let networkWatcherInstalled = false;

export function useCamera() {
  const status = useState<CameraStatus>("camera-status", () => "disconnected");
  const info = useState<CameraInfo | null>("camera-info", () => null);
  const library = useState<MediaItem[]>("camera-library", () => []);
  const host = useState<string>("camera-host", () => {
    if (import.meta.client) {
      // Trim on read as well as on write: a blank stored value is treated as
      // absent so it falls back to the default instead of an empty address.
      const stored = localStorage.getItem(HOST_STORAGE_KEY)?.trim();
      if (stored) return stored;
    }
    return DEFAULT_HOST;
  });
  const error = useState<string | null>("camera-error", () => null);
  const loadingLibrary = useState<boolean>("camera-library-loading", () => false);
  /** True from a successful manual connect until a manual disconnect */
  const wantConnection = useState<boolean>("camera-want-connection", () => false);
  const retryAttempt = useState<number>("camera-retry-attempt", () => 0);
  const generation = useState("camera-attempt-generation", () => 0);

  // Persisted so the home page can ship a bare Connect button: a user on a
  // non-default gateway should not have to retype it every launch.
  if (import.meta.client) {
    watch(host, (value) => {
      localStorage.setItem(HOST_STORAGE_KEY, value.trim());
    });
  }

  const isConnected = computed(() => status.value === "connected");
  const isBusy = computed(() => status.value === "connecting");
  const available = computed(() => getCameraTransport().available);

  let disconnectUnlisten: (() => void) | null = null;

  function clearRetryTimer() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  async function tryReconnect() {
    if (!wantConnection.value || isConnected.value || isBusy.value) return;
    const attempt = ++generation.value;
    status.value = "connecting";
    try {
      const connectedInfo = await getCameraTransport().connect(host.value);
      if (attempt !== generation.value || !wantConnection.value) return;
      info.value = connectedInfo;
      status.value = "connected";
      error.value = null;
      retryAttempt.value = 0;
      armCameraHealth(
        () => {
          void forceDisconnect();
        },
        () => getCameraTransport().probe(host.value),
      );
      await refreshLibrary();
    } catch {
      if (attempt !== generation.value) return;
      status.value = "disconnected";
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (retryTimer || !wantConnection.value) return;
    const delay = RETRY_DELAYS_MS[Math.min(retryAttempt.value, RETRY_DELAYS_MS.length - 1)]!;
    retryAttempt.value += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void tryReconnect();
    }, delay);
  }

  /** Retry immediately when the OS reports the network came back (Wi-Fi rejoin, etc.). */
  function watchNetwork() {
    if (networkWatcherInstalled || !import.meta.client) return;
    networkWatcherInstalled = true;
    window.addEventListener("online", () => {
      if (!wantConnection.value || isConnected.value) return;
      clearRetryTimer();
      retryAttempt.value = 0;
      void tryReconnect();
    });
  }

  async function watchDisconnect() {
    const transport = getCameraTransport();
    if (!transport.available || disconnectUnlisten) return;
    disconnectUnlisten = await transport.onDisconnect(() => {
      if (!wantConnection.value || status.value === "disconnected") return;
      generation.value += 1;
      status.value = "disconnected";
      info.value = null;
      library.value = [];
      error.value = "Lost connection to the camera. Reconnecting…";
      retryAttempt.value = 0;
      // This is a known socket close, not a silently-unresponsive camera: disarm the
      // health detector so its failure count can't race scheduleReconnect() below and
      // trigger a second teardown. It re-arms itself
      // once tryReconnect() succeeds again.
      disarmCameraHealth();
      scheduleReconnect();
    });
  }

  async function refreshLibrary() {
    if (!isConnected.value) return;
    loadingLibrary.value = true;
    const attempt = generation.value;
    error.value = null;
    try {
      const items = await getCameraTransport().listMedia(host.value);
      if (attempt === generation.value && isConnected.value) library.value = items;
    } catch (e) {
      if (attempt === generation.value)
        error.value = e instanceof Error ? e.message : "Failed to read the media library.";
    } finally {
      loadingLibrary.value = false;
    }
  }

  async function connect() {
    if (isConnected.value || isBusy.value) return;
    error.value = null;
    if (!getCameraTransport().available) {
      error.value =
        "Camera control requires the desktop app. Run the packaged Luna Ultra app to connect.";
      return;
    }
    status.value = "connecting";
    const attempt = ++generation.value;
    try {
      await watchDisconnect();
      if (attempt !== generation.value) return;
      watchNetwork();
      const connectedInfo = await getCameraTransport().connect(host.value);
      if (attempt !== generation.value) return;
      info.value = connectedInfo;
      status.value = "connected";
      // Auto-reconnect only after a session the user established succeeds
      wantConnection.value = true;
      armCameraHealth(
        () => {
          void forceDisconnect();
        },
        () => getCameraTransport().probe(host.value),
      );
      retryAttempt.value = 0;
      await refreshLibrary();
    } catch (e) {
      if (attempt !== generation.value) return;
      status.value = "disconnected";
      info.value = null;
      error.value = e instanceof Error ? e.message : "Could not connect to the camera.";
    }
  }

  /**
   * Tear down the session without touching `wantConnection`. Shared by the
   * user-initiated disconnect and the health-detector disconnect.
   */
  async function teardown() {
    clearRetryTimer();
    disarmCameraHealth();
    await getCameraTransport().disconnect();
    status.value = "disconnected";
    info.value = null;
    library.value = [];
  }

  async function disconnect() {
    generation.value += 1;
    wantConnection.value = false;
    await teardown();
    error.value = null;
  }

  /**
   * Recover a silent connection while preserving the user's connection intent.
   * Only the explicit Disconnect action cancels automatic recovery.
   */
  async function forceDisconnect() {
    const attempt = ++generation.value;
    await teardown();
    if (attempt !== generation.value || !wantConnection.value) return;
    error.value = `Lost contact after ${FAILURE_THRESHOLD} failed requests and a failed health check. Reconnecting…`;
    scheduleReconnect();
  }

  /** Remove items locally after the camera confirms deletion. */
  function removeFromLibrary(cameraPaths: string[]) {
    const removing = new Set(cameraPaths);
    library.value = library.value.filter((item) => !removing.has(item.cameraPath));
  }

  return {
    status,
    info,
    library,
    host,
    error,
    loadingLibrary,
    wantConnection,
    isConnected,
    isBusy,
    available,
    connect,
    disconnect,
    refreshLibrary,
    removeFromLibrary,
  };
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCameraTransport, setCameraTransport } from "~/utils/transport";
import { makeFakeTransport } from "../helpers/fakeTransport";
import { makeMediaItem } from "../helpers/media";
import { mountComposable } from "./harness";
import { disarmCameraHealth, reportCameraFailure } from "~/utils/cameraHealth";

describe("useCamera", () => {
  beforeEach(() => {
    localStorage.clear();
    clearNuxtState(["camera-host"], { reset: true });
  });

  afterEach(() => {
    disarmCameraHealth();
    vi.useRealTimers();
    resetCameraTransport();
    clearNuxtState(
      [
        "camera-status",
        "camera-info",
        "camera-library",
        "camera-error",
        "camera-library-loading",
        "camera-want-connection",
        "camera-retry-attempt",
        "camera-attempt-generation",
      ],
      { reset: true },
    );
  });

  it("preserves automatic recovery after a failed HTTP health check", async () => {
    const transport = makeFakeTransport({ probe: vi.fn(async () => false) });
    setCameraTransport(transport);
    const camera = await mountComposable(() => useCamera());
    await camera.connect();
    vi.useFakeTimers();
    reportCameraFailure();
    reportCameraFailure();
    reportCameraFailure();
    await vi.advanceTimersByTimeAsync(0);
    expect(camera.isConnected.value).toBe(false);
    expect(camera.wantConnection.value).toBe(true);
    expect(camera.error.value).toContain("Reconnecting");
    await vi.advanceTimersByTimeAsync(1000);
    expect(transport.connect).toHaveBeenCalledTimes(2);
    expect(camera.isConnected.value).toBe(true);
    await camera.disconnect();
    await vi.advanceTimersByTimeAsync(16000);
    expect(transport.connect).toHaveBeenCalledTimes(2);
  });

  it("does not revive a connection that finishes after manual Disconnect", async () => {
    const transport = makeFakeTransport();
    const info = await transport.status();
    let release!: (value: NonNullable<typeof info>) => void;
    transport.connect = vi.fn(
      () =>
        new Promise<NonNullable<typeof info>>((resolve) => {
          release = resolve;
        }),
    );
    setCameraTransport(transport);
    const camera = await mountComposable(() => useCamera());
    const pending = camera.connect();
    await vi.waitFor(() => expect(transport.connect).toHaveBeenCalledOnce());
    await camera.disconnect();
    release(info!);
    await pending;
    expect(camera.isConnected.value).toBe(false);
    expect(camera.wantConnection.value).toBe(false);
    expect(transport.listMedia).not.toHaveBeenCalled();
  });

  it("connects through the active transport and loads the library", async () => {
    const transport = makeFakeTransport({
      listMedia: vi.fn(async () => [makeMediaItem()]),
    });
    setCameraTransport(transport);

    const camera = await mountComposable(() => useCamera());
    await camera.connect();

    expect(transport.connect).toHaveBeenCalledWith(camera.host.value);
    expect(camera.isConnected.value).toBe(true);
    expect(camera.library.value).toHaveLength(1);
  });

  it("reports unavailable transports instead of connecting", async () => {
    setCameraTransport(makeFakeTransport({ available: false }));

    const camera = await mountComposable(() => useCamera());
    await camera.connect();

    expect(camera.isConnected.value).toBe(false);
    expect(camera.error.value).toContain("desktop app");
  });

  it("surfaces a connect failure as an error, not a thrown exception", async () => {
    setCameraTransport(
      makeFakeTransport({
        connect: vi.fn(async () => {
          throw new Error("no route to host");
        }),
      }),
    );

    const camera = await mountComposable(() => useCamera());
    await expect(camera.connect()).resolves.toBeUndefined();
    expect(camera.error.value).toBe("no route to host");
    expect(camera.isConnected.value).toBe(false);
  });

  it("subscribes to disconnect through the transport, not Tauri directly", async () => {
    const transport = makeFakeTransport();
    setCameraTransport(transport);

    const camera = await mountComposable(() => useCamera());
    await camera.connect();

    expect(transport.onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("tears the session down on disconnect", async () => {
    const transport = makeFakeTransport();
    setCameraTransport(transport);

    const camera = await mountComposable(() => useCamera());
    await camera.connect();
    await camera.disconnect();

    expect(transport.disconnect).toHaveBeenCalled();
    expect(camera.isConnected.value).toBe(false);
    expect(camera.library.value).toEqual([]);
  });
});

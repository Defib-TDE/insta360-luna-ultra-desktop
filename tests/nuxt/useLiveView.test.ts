import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCameraTransport, setCameraTransport } from "~/utils/transport";
import { makeFakeTransport } from "../helpers/fakeTransport";
import { mountComposable } from "./harness";

describe("useLiveView", () => {
  let lastLive: ReturnType<typeof useLiveView> | undefined;
  async function mountLive() {
    return mountComposable(() => {
      lastLive = useLiveView();
      return { camera: useCamera(), live: lastLive };
    });
  }
  beforeEach(() => {
    localStorage.clear();
    clearNuxtState(["camera-host"], { reset: true });
  });

  afterEach(async () => {
    await lastLive?.stop();
    lastLive = undefined;
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
        "liveview-active",
        "liveview-starting",
        "liveview-transport",
        "liveview-url",
        "liveview-error",
        "liveview-failed",
        "liveview-revision",
        "liveview-diagnostics",
        "liveview-source-profile",
      ],
      { reset: true },
    );
  });

  it("restores baseline after an experimental camera request is rejected", async () => {
    const transport = makeFakeTransport({
      liveViewStart: vi.fn(async (profile) => {
        if (profile === "1080p60") throw new Error("request unsupported");
        return { url: "http://127.0.0.1:9000/live", port: 9000 };
      }),
    });
    setCameraTransport(transport);
    const { camera, live } = await mountLive();
    await camera.connect();
    live.sourceProfile.value = "1080p60";
    await live.start();
    expect(transport.liveViewStart).toHaveBeenNthCalledWith(1, "1080p60");
    expect(transport.liveViewStart).toHaveBeenNthCalledWith(2, "baseline");
    expect(live.sourceProfile.value).toBe("baseline");
    expect(live.active.value).toBe(true);
  });

  it("restores baseline instead of endlessly retrying a silent experimental source", async () => {
    const transport = makeFakeTransport();
    setCameraTransport(transport);
    const { camera, live } = await mountLive();
    await camera.connect();
    vi.useFakeTimers();
    live.sourceProfile.value = "4k60";
    await live.start();
    await vi.advanceTimersByTimeAsync(6000);
    expect(live.sourceProfile.value).toBe("baseline");
    expect(transport.liveViewStart).toHaveBeenNthCalledWith(2, "baseline");
    await vi.advanceTimersByTimeAsync(6000);
    expect(transport.liveViewStart).toHaveBeenCalledTimes(2);
    expect(live.failed.value).toBe(true);
  });

  it("prefers an OSC MJPEG preview when the camera offers one", async () => {
    const transport = makeFakeTransport({
      probeOscPreview: vi.fn(async () => "http://cam/osc/commands/execute"),
    });
    setCameraTransport(transport);

    const { camera, live } = await mountLive();
    await camera.connect();
    await live.start();

    expect(live.transport.value).toBe("mjpeg");
    expect(live.streamUrl.value).toBe("http://cam/osc/commands/execute");
    expect(transport.liveViewStart).not.toHaveBeenCalled();
  });

  it("falls back to the control-session annexb stream", async () => {
    const transport = makeFakeTransport();
    setCameraTransport(transport);

    const { camera, live } = await mountLive();
    await camera.connect();
    await live.start();

    expect(live.transport.value).toBe("annexb");
    expect(live.streamUrl.value).toBe("http://127.0.0.1:9000/live");
  });

  it("refuses to start when the camera is not connected", async () => {
    setCameraTransport(makeFakeTransport());

    const { live } = await mountLive();
    await live.start();

    expect(live.active.value).toBe(false);
    expect(live.error.value).toBe("Connect to the camera first.");
  });

  it("stops through the transport and clears the stream", async () => {
    const transport = makeFakeTransport();
    setCameraTransport(transport);

    const { camera, live } = await mountLive();
    await camera.connect();
    await live.start();
    await live.stop();

    expect(transport.liveViewStop).toHaveBeenCalled();
    expect(live.active.value).toBe(false);
    expect(live.streamUrl.value).toBeNull();
  });

  it("retries a silent camera once and requires an explicit retry after the second timeout", async () => {
    const transport = makeFakeTransport();
    setCameraTransport(transport);
    const { camera, live } = await mountLive();
    await camera.connect();
    vi.useFakeTimers();
    await live.start({ elementary: true });
    await vi.advanceTimersByTimeAsync(12000);
    expect(transport.liveViewStart).toHaveBeenCalledTimes(2);
    expect(live.failed.value).toBe(true);
    expect(live.active.value).toBe(false);
    await live.start();
    expect(transport.liveViewStart).toHaveBeenCalledTimes(2);
    await live.retry({ elementary: true });
    expect(transport.liveViewStart).toHaveBeenCalledTimes(3);
  });

  it("does not restart a stream that is already receiving camera bytes", async () => {
    const transport = makeFakeTransport({
      liveViewStats: vi.fn(async () => ({ bytes: 128, packets: 2, firstBytesHex: "", seconds: 6 })),
    });
    setCameraTransport(transport);
    const { camera, live } = await mountLive();
    await camera.connect();
    vi.useFakeTimers();
    await live.start({ elementary: true });
    await vi.advanceTimersByTimeAsync(18000);
    expect(transport.liveViewStart).toHaveBeenCalledOnce();
    expect(live.active.value).toBe(true);
  });

  it("serializes Stop from another consumer behind a pending native startup", async () => {
    let finish!: (value: { url: string; port: number }) => void;
    const transport = makeFakeTransport({
      liveViewStart: vi.fn(
        () =>
          new Promise<{ url: string; port: number }>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    setCameraTransport(transport);
    const { camera, live, second } = await mountComposable(() => {
      lastLive = useLiveView();
      return { camera: useCamera(), live: lastLive, second: useLiveView() };
    });
    await camera.connect();
    const pending = live.start({ elementary: true });
    await vi.waitFor(() => expect(transport.liveViewStart).toHaveBeenCalledOnce());
    const stopping = second.stop();
    expect(transport.liveViewStop).not.toHaveBeenCalled();
    finish({ url: "http://127.0.0.1:9000/live", port: 9000 });
    await pending;
    await stopping;
    expect(transport.liveViewStop).toHaveBeenCalledOnce();
    expect(live.active.value).toBe(false);
    expect(live.streamUrl.value).toBeNull();
  });
});

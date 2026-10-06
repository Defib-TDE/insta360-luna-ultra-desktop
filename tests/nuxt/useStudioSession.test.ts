import { mountSuspended, mockNuxtImport } from "@nuxt/test-utils/runtime";
import { defineComponent, reactive } from "vue";
import type { VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeTransport } from "../helpers/fakeTransport";
import { resetCameraTransport, setCameraTransport } from "~/utils/transport";
import { initialWebcamStatus, WEBCAM_PREFERENCES_KEY } from "~/utils/webcamProfiles";
import { MSG, encodeMessage } from "~/utils/lunaProto";
import { resetWebcamClient, setWebcamClient, type WebcamClient } from "~/utils/webcamClient";
import type { WebcamStatus } from "~/types/webcam";

const routing = vi.hoisted(() => ({ route: { path: "/studio" } }));
mockNuxtImport("useRoute", () => () => routing.route);

describe("Studio session ownership", () => {
  let wrapper: VueWrapper;
  let vm: {
    camera: ReturnType<typeof useCamera>;
    live: ReturnType<typeof useLiveView>;
    webcam: ReturnType<typeof useWebcam>;
  };
  let transport: ReturnType<typeof makeFakeTransport>;
  let client: WebcamClient;
  let status: WebcamStatus;

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem(WEBCAM_PREFERENCES_KEY, JSON.stringify({ matchCamera: false }));
    clearNuxtState(undefined, { reset: true });
    routing.route = reactive({ path: "/studio" });
    status = initialWebcamStatus();
    transport = makeFakeTransport({
      liveViewStart: vi.fn(async () => ({ url: "http://127.0.0.1:49183/stream", port: 49183 })),
    });
    setCameraTransport(transport);
    client = {
      environment: vi.fn(async () => ({
        supported: true,
        pythonFound: true,
        runtimeReady: true,
        obsInstalled: true,
        bundled: true,
      })),
      status: vi.fn(async () => ({ ...status })),
      setup: vi.fn(async () => {}),
      start: vi.fn(async (options) => {
        status = { ...initialWebcamStatus(), phase: "publishing", url: options.url };
      }),
      stop: vi.fn(async () => {
        status = initialWebcamStatus();
      }),
    };
    setWebcamClient(client);
    wrapper = await mountSuspended(
      defineComponent({
        setup() {
          useStudioSession();
          vm = { camera: useCamera(), live: useLiveView(), webcam: useWebcam() };
          return () => null;
        },
      }),
    );
  });

  afterEach(async () => {
    wrapper.unmount();
    await vm.live.stop();
    vi.useRealTimers();
    resetCameraTransport();
    resetWebcamClient();
    clearNuxtState(undefined, { reset: true });
  });

  async function connectAndStart() {
    vm.camera.wantConnection.value = true;
    vm.camera.status.value = "connected";
    await vi.waitFor(() => expect(vm.live.active.value).toBe(true));
    vm.webcam.start();
    await vi.waitFor(() => expect(client.start).toHaveBeenCalledOnce());
  }

  it("requests experimental source quality and publishes 60fps without changing the fixed camera mode", async () => {
    vm.live.sourceProfile.value = "1080p60";
    vm.webcam.profileId.value = "fullhd";
    await connectAndStart();
    expect(transport.liveViewStart).toHaveBeenCalledWith("1080p60");
    expect(client.start).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1920, height: 1080, fps: 60 }),
    );
    expect(transport.command).not.toHaveBeenCalled();
  });

  it("also restores the publisher frame rate when a silent 60fps request falls back to baseline", async () => {
    vi.useFakeTimers();
    vm.live.sourceProfile.value = "1080p60";
    await connectAndStart();
    await vi.advanceTimersByTimeAsync(6000);
    expect(vm.live.sourceProfile.value).toBe("baseline");
    expect(client.start).toHaveBeenLastCalledWith(expect.objectContaining({ fps: 30 }));
  });

  it("restores baseline when experimental bytes arrive but the decoder cannot start output", async () => {
    vm.live.sourceProfile.value = "1080p60";
    client.start = vi.fn(async (options) => {
      status = {
        ...initialWebcamStatus(),
        phase: options.fps === 60 ? "error" : "publishing",
        url: options.url,
        error: options.fps === 60 ? "No decoded video before startup deadline" : null,
      };
    });
    vm.camera.wantConnection.value = true;
    vm.camera.status.value = "connected";
    await vi.waitFor(() => expect(vm.live.active.value).toBe(true));
    vm.webcam.start();
    await vi.waitFor(() => expect(client.start).toHaveBeenCalledTimes(2));
    expect(vm.live.sourceProfile.value).toBe("baseline");
    expect(client.start).toHaveBeenLastCalledWith(expect.objectContaining({ fps: 30 }));
    expect(
      vm.live.diagnostics.value.some(
        (line) => line.includes("decoder") || line.includes("No decoded"),
      ),
    ).toBe(true);
  });

  it("starts preview on Studio and releases it when leaving without webcam output", async () => {
    vm.camera.status.value = "connected";
    await vi.waitFor(() => expect(vm.live.active.value).toBe(true));
    routing.route.path = "/settings";
    await vi.waitFor(() => expect(vm.live.active.value).toBe(false));
    expect(client.start).not.toHaveBeenCalled();
  });

  it("keeps a trailing-slash Studio preview available for profile probes while output is stopped", async () => {
    routing.route.path = "/studio/";
    vm.camera.status.value = "connected";
    await vi.waitFor(() => expect(vm.live.active.value).toBe(true));
    transport.liveViewStart = vi.fn(async (profile) => {
      if (profile === "4k60") throw new Error("unsupported source");
      return { url: "http://127.0.0.1:49183/stream", port: 49183 };
    });
    vm.live.sourceProfile.value = "4k60";
    await vi.waitFor(() => expect(vm.live.sourceProfile.value).toBe("baseline"));
    expect(transport.liveViewStart).toHaveBeenCalledWith("4k60");
    await vi.waitFor(() => expect(vm.live.active.value).toBe(true));
    expect(client.start).not.toHaveBeenCalled();
  });

  it("releases a preview before Gallery navigation starts camera HTTP requests", async () => {
    vm.camera.status.value = "connected";
    await vi.waitFor(() => expect(vm.live.active.value).toBe(true));
    const router = wrapper.vm.$router;
    await router.push("/gallery");
    expect(transport.liveViewStop).toHaveBeenCalled();
    expect(vm.live.active.value).toBe(false);
  });

  it("keeps output alive across navigation, then releases the relay on Stop", async () => {
    await connectAndStart();
    routing.route.path = "/settings";
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(vm.live.active.value).toBe(true);
    expect(transport.liveViewStop).not.toHaveBeenCalled();
    expect(client.stop).not.toHaveBeenCalled();
    vm.webcam.stop();
    await vi.waitFor(() => expect(client.stop).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(vm.live.active.value).toBe(false));
  });

  it("uses the control stream in Studio before publishing even when MJPEG is available", async () => {
    transport.probeOscPreview = vi.fn(async () => "http://camera/preview");
    await connectAndStart();
    expect(vm.live.transport.value).toBe("annexb");
    expect(client.start).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://127.0.0.1:49183/stream",
        codec: "hevc",
        width: 1280,
        height: 720,
        fps: 30,
      }),
    );
    expect(transport.probeOscPreview).not.toHaveBeenCalled();
    expect(transport.liveViewStop).not.toHaveBeenCalled();
  });

  it("still allows the Camera page to choose an available MJPEG preview", async () => {
    routing.route.path = "/camera";
    transport.probeOscPreview = vi.fn(async () => "http://camera/preview");
    vm.camera.status.value = "connected";
    await vi.waitFor(() => expect(vm.live.active.value).toBe(true));
    expect(vm.live.transport.value).toBe("mjpeg");
    expect(transport.liveViewStart).not.toHaveBeenCalled();
    expect(client.start).not.toHaveBeenCalled();
  });

  it("preserves the existing worker through disconnect and restarts it for a new relay port", async () => {
    await connectAndStart();
    vm.camera.status.value = "disconnected";
    await vi.waitFor(() => expect(vm.live.active.value).toBe(false));
    expect(vm.webcam.wanted.value).toBe(true);
    expect(client.stop).not.toHaveBeenCalled();
    transport.liveViewStart = vi.fn(async () => ({
      url: "http://127.0.0.1:49184/stream",
      port: 49184,
    }));
    vm.camera.status.value = "connected";
    await vi.waitFor(() => expect(client.start).toHaveBeenCalledTimes(2));
    expect(client.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: "http://127.0.0.1:49184/stream" }),
    );
  });

  it("keeps a same-port reconnect in the decoder rather than spawning a duplicate", async () => {
    await connectAndStart();
    vm.camera.status.value = "disconnected";
    await vi.waitFor(() => expect(vm.live.active.value).toBe(false));
    vm.camera.status.value = "connected";
    await vi.waitFor(() => expect(vm.live.active.value).toBe(true));
    expect(client.start).toHaveBeenCalledOnce();
  });

  it("recovers a dropped experimental source at baseline and restores 30fps output", async () => {
    vm.live.sourceProfile.value = "4k60";
    await connectAndStart();
    vm.camera.status.value = "disconnected";
    expect(vm.live.sourceProfile.value).toBe("baseline");
    expect(vm.webcam.wanted.value).toBe(true);
    await vi.waitFor(() => expect(vm.live.active.value).toBe(false));
    vm.camera.status.value = "connected";
    await vi.waitFor(() => expect(client.start).toHaveBeenCalledTimes(2));
    expect(transport.liveViewStart).toHaveBeenLastCalledWith("baseline");
    expect(client.start).toHaveBeenLastCalledWith(expect.objectContaining({ fps: 30 }));
    expect(transport.command).not.toHaveBeenCalled();
  });

  it("does not replay a pending experimental start after a quick disconnect and reconnect", async () => {
    let finish!: (info: { url: string; port: number }) => void;
    transport.liveViewStart = vi.fn((profile) => {
      if (profile === "1080p60")
        return new Promise<{ url: string; port: number }>((resolve) => {
          finish = resolve;
        });
      return Promise.resolve({ url: "http://127.0.0.1:49183/stream", port: 49183 });
    });
    vm.live.sourceProfile.value = "1080p60";
    vm.camera.status.value = "connected";
    await vi.waitFor(() => expect(transport.liveViewStart).toHaveBeenCalledOnce());
    vm.camera.status.value = "disconnected";
    vm.camera.status.value = "connected";
    finish({ url: "http://127.0.0.1:49182/stream", port: 49182 });
    await vi.waitFor(() => expect(vm.live.active.value).toBe(true));
    expect(vm.live.sourceProfile.value).toBe("baseline");
    expect(transport.liveViewStart).toHaveBeenCalledTimes(2);
    expect(transport.liveViewStart).toHaveBeenLastCalledWith("baseline");
    expect(vm.live.streamUrl.value).toBe("http://127.0.0.1:49183/stream");
  });

  it("releases output on an explicit disconnect instead of promising automatic recovery", async () => {
    await connectAndStart();
    await vm.camera.disconnect();
    await vi.waitFor(() => expect(vm.webcam.wanted.value).toBe(false));
    await vi.waitFor(() => expect(client.stop).toHaveBeenCalledOnce());
    expect(vm.live.active.value).toBe(false);
  });

  it("surfaces native start failures and does not endlessly spawn workers", async () => {
    client.start = vi.fn(async () => {
      throw new Error("OBS camera is busy");
    });
    vm.camera.status.value = "connected";
    await vi.waitFor(() => expect(vm.live.active.value).toBe(true));
    vm.webcam.start();
    await vi.waitFor(() => expect(vm.webcam.error.value).toContain("OBS camera is busy"));
    expect(vm.webcam.wanted.value).toBe(false);
    expect(client.start).toHaveBeenCalledOnce();
  });

  it("prepares a verified mode once and preserves it across Wi-Fi recovery", async () => {
    vm.webcam.matchCamera.value = true;
    transport.command = vi.fn(async (code) => {
      expect(code).toBe(8);
      return encodeMessage(MSG.GetOptionsResp, {
        option_types: ["VIDEO_SUB_MODE", "PHOTO_SUB_MODE"],
        value: { video_sub_mode: "VIDEO_SLOW_MOTION", photo_sub_mode: "PHOTO_NONE" },
      });
    });
    await connectAndStart();
    expect(vm.webcam.cameraMode.value).toBe("Slow-mo");
    expect(transport.command).toHaveBeenCalledOnce();
    vm.camera.status.value = "disconnected";
    await vi.waitFor(() => expect(vm.live.active.value).toBe(false));
    vm.camera.status.value = "connected";
    await vi.waitFor(() => expect(vm.live.active.value).toBe(true));
    expect(transport.command).toHaveBeenCalledOnce();
  });

  it("cancels startup during a pending camera read without applying a mode or starting output", async () => {
    vm.webcam.matchCamera.value = true;
    let finish!: (bytes: Uint8Array) => void;
    transport.command = vi.fn(
      () =>
        new Promise<Uint8Array>((resolve) => {
          finish = resolve;
        }),
    );
    vm.camera.wantConnection.value = true;
    vm.camera.status.value = "connected";
    await vi.waitFor(() => expect(vm.live.active.value).toBe(true));
    vm.webcam.start();
    await vi.waitFor(() => expect(vm.webcam.preparing.value).toBe(true));
    await vi.waitFor(() => expect(transport.command).toHaveBeenCalledOnce());
    vm.webcam.stop();
    finish(encodeMessage(MSG.GetOptionsResp, { value: { video_sub_mode: "VIDEO_NORMAL" } }));
    await vi.waitFor(() => expect(vm.webcam.preparing.value).toBe(false));
    expect(transport.command).toHaveBeenCalledOnce();
    expect(client.start).not.toHaveBeenCalled();
    expect(vm.webcam.error.value).toBeNull();
  });

  it("shows an unsupported mode read once, then lets the user keep camera settings", async () => {
    vm.webcam.matchCamera.value = true;
    vm.camera.wantConnection.value = true;
    vm.camera.status.value = "connected";
    await vi.waitFor(() => expect(vm.live.active.value).toBe(true));
    vm.webcam.start();
    await vi.waitFor(() => expect(vm.webcam.wanted.value).toBe(false));
    expect(vm.webcam.error.value).toContain("Cannot read the current camera mode");
    expect(transport.command).toHaveBeenCalledOnce();
    expect(client.start).not.toHaveBeenCalled();
    vm.webcam.matchCamera.value = false;
    vm.webcam.start();
    await vi.waitFor(() => expect(client.start).toHaveBeenCalledOnce());
    expect(transport.command).toHaveBeenCalledOnce();
  });
});

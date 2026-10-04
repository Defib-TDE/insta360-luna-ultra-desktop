import { mountSuspended, mockNuxtImport } from "@nuxt/test-utils/runtime";
import { defineComponent, reactive } from "vue";
import type { VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeTransport } from "../helpers/fakeTransport";
import { resetCameraTransport, setCameraTransport } from "~/utils/transport";
import { initialWebcamStatus } from "~/utils/webcamProfiles";
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

  it("starts preview on Studio and releases it when leaving without webcam output", async () => {
    vm.camera.status.value = "connected";
    await vi.waitFor(() => expect(vm.live.active.value).toBe(true));
    routing.route.path = "/settings";
    await vi.waitFor(() => expect(vm.live.active.value).toBe(false));
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

  it("forces elementary video even when MJPEG is available", async () => {
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
    expect(transport.liveViewStop).toHaveBeenCalledOnce();
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
});

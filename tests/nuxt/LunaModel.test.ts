import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LunaModel from "~/components/LunaModel.vue";

const doubles = vi.hoisted(() => ({
  loadStl: vi.fn(),
  loadGltf: vi.fn(),
  rendererDispose: vi.fn(),
  targetDispose: vi.fn(),
  pmremDispose: vi.fn(),
  render: vi.fn(),
}));

// Keep Three's scene graph, geometry and materials real. Only WebGL and asset
// I/O need substitutes in happy-dom; loader promises let navigation win the race.
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement("canvas");
      setPixelRatio() {}
      setSize() {}
      dispose = doubles.rendererDispose;
      render = doubles.render;
    },
    PMREMGenerator: class {
      fromScene() {
        const target = new actual.WebGLRenderTarget();
        target.addEventListener("dispose", doubles.targetDispose);
        return target;
      }
      dispose = doubles.pmremDispose;
    },
  };
});

vi.mock("three/examples/jsm/loaders/STLLoader.js", () => ({
  STLLoader: class {
    loadAsync = doubles.loadStl;
  },
}));
vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    loadAsync = doubles.loadGltf;
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("LunaModel asset lifecycle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("releases a late STL and the environment when navigation unmounts a loading model", async () => {
    const pending = deferred<THREE.BufferGeometry>();
    doubles.loadStl.mockReturnValueOnce(pending.promise);
    const errors = vi.fn();
    const wrapper = await mountSuspended(LunaModel, {
      global: { config: { errorHandler: errors } },
    });
    const geometry = new THREE.BoxGeometry();
    const geometryDisposed = vi.fn();
    geometry.addEventListener("dispose", geometryDisposed);

    wrapper.unmount();
    pending.resolve(geometry);
    await flushPromises();

    expect(errors).not.toHaveBeenCalled();
    expect(geometryDisposed).toHaveBeenCalledOnce();
    expect(doubles.targetDispose).toHaveBeenCalledOnce();
    expect(doubles.pmremDispose).toHaveBeenCalledOnce();
    expect(doubles.rendererDispose).toHaveBeenCalledOnce();
    expect(wrapper.emitted("ready")).toBeUndefined();
  });

  it("does not start a fallback download when the STL fails after unmount", async () => {
    const pending = deferred<THREE.BufferGeometry>();
    doubles.loadStl.mockReturnValueOnce(pending.promise);
    doubles.loadGltf.mockReturnValueOnce(new Promise(() => {}));
    const wrapper = await mountSuspended(LunaModel);

    wrapper.unmount();
    pending.reject(new Error("download failed"));
    await flushPromises();

    expect(doubles.loadGltf).not.toHaveBeenCalled();
  });

  it("releases geometry, materials and textures from a glTF that arrives after unmount", async () => {
    const pending = deferred<{ scene: THREE.Group }>();
    doubles.loadStl.mockRejectedValueOnce(new Error("STL unavailable"));
    doubles.loadGltf.mockReturnValueOnce(pending.promise);
    const errors = vi.fn();
    const wrapper = await mountSuspended(LunaModel, {
      global: { config: { errorHandler: errors } },
    });
    await flushPromises();
    expect(doubles.loadGltf).toHaveBeenCalledOnce();
    const scene = new THREE.Group();
    const texture = new THREE.Texture();
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshStandardMaterial({ map: texture });
    scene.add(new THREE.Mesh(geometry, material));
    const geometryDisposed = vi.fn();
    const materialDisposed = vi.fn();
    const textureDisposed = vi.fn();
    geometry.addEventListener("dispose", geometryDisposed);
    material.addEventListener("dispose", materialDisposed);
    texture.addEventListener("dispose", textureDisposed);

    wrapper.unmount();
    pending.resolve({ scene });
    await flushPromises();

    expect(errors).not.toHaveBeenCalled();
    expect(geometryDisposed).toHaveBeenCalledOnce();
    expect(materialDisposed).toHaveBeenCalledOnce();
    expect(textureDisposed).toHaveBeenCalledOnce();
    expect(wrapper.emitted("ready")).toBeUndefined();
  });

  it("still renders an active model and releases its scene on normal unmount", async () => {
    const geometry = new THREE.BoxGeometry();
    const geometryDisposed = vi.fn();
    geometry.addEventListener("dispose", geometryDisposed);
    doubles.loadStl.mockResolvedValueOnce(geometry);
    const wrapper = await mountSuspended(LunaModel);
    try {
      await flushPromises();
      expect(wrapper.emitted("ready")).toEqual([["stl"]]);
      expect(doubles.render).toHaveBeenCalled();
      expect(window.requestAnimationFrame).toHaveBeenCalled();
    } finally {
      wrapper.unmount();
    }
    expect(geometryDisposed).toHaveBeenCalledOnce();
    expect(doubles.targetDispose).toHaveBeenCalledOnce();
    expect(doubles.rendererDispose).toHaveBeenCalledOnce();
  });

  it.each(["reduced motion", "autoRotate off"])(
    "idles a stationary model with %s and redraws when its color changes",
    async (mode) => {
      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      Object.defineProperty(media, "matches", { value: mode === "reduced motion" });
      vi.spyOn(window, "matchMedia").mockReturnValue(media);
      doubles.loadStl.mockResolvedValueOnce(new THREE.BoxGeometry());
      const wrapper = await mountSuspended(LunaModel, {
        props: { autoRotate: mode !== "autoRotate off", colorway: "white" },
      });
      try {
        await flushPromises();
        expect(doubles.render).toHaveBeenCalled();
        expect(window.requestAnimationFrame).not.toHaveBeenCalled();
        const initialRenders = doubles.render.mock.calls.length;
        await wrapper.setProps({ colorway: "black" });
        expect(doubles.render.mock.calls.length).toBeGreaterThan(initialRenders);
        expect(window.requestAnimationFrame).not.toHaveBeenCalled();
      } finally {
        wrapper.unmount();
      }
    },
  );
});

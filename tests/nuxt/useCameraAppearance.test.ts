import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mountComposable } from "./harness";

describe("camera body appearance", () => {
  beforeEach(() => {
    localStorage.clear();
    clearNuxtState(undefined, { reset: true });
  });
  afterEach(() => clearNuxtState(undefined, { reset: true }));

  it("remembers a chosen color by serial without claiming to detect it", async () => {
    const { camera, appearance } = await mountComposable(() => ({
      camera: useCamera(),
      appearance: useCameraAppearance(),
    }));
    camera.info.value = { host: "192.168.42.1", deviceName: "Luna", serial: "WHITE-1" };
    expect(appearance.colorway.value).toBe("auto");
    appearance.colorway.value = "white";
    camera.info.value = { host: "192.168.42.1", deviceName: "Luna", serial: "BLACK-2" };
    expect(appearance.colorway.value).toBe("auto");
    appearance.colorway.value = "black";
    camera.info.value = { host: "192.168.42.1", deviceName: "Luna", serial: "WHITE-1" };
    expect(appearance.colorway.value).toBe("white");
    expect(JSON.parse(localStorage.getItem("luna-camera-appearances")!)).toEqual({
      "WHITE-1": "white",
      "BLACK-2": "black",
    });
  });

  it.each(["null", "[]", '"black"', '{"bad":"green"}', "not JSON"])(
    "ignores malformed stored preferences: %s",
    async (saved) => {
      localStorage.setItem("luna-camera-appearances", saved);
      const appearance = await mountComposable(() => useCameraAppearance());
      expect(appearance.colorway.value).toBe("auto");
    },
  );
});

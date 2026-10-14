import { describe, expect, it } from "vitest";
import { studioReadiness, type StudioReadinessInput } from "../app/utils/studioReadiness";
import type { WebcamEnvironment } from "../app/types/webcam";

const environment: WebcamEnvironment = {
  supported: true,
  pythonFound: true,
  runtimeReady: true,
  obsInstalled: true,
  bundled: true,
};

const idle: StudioReadinessInput = {
  environment,
  checking: false,
  phase: "stopped",
  connected: true,
  connecting: false,
  wanted: false,
  preparing: false,
};

describe("Studio readiness", () => {
  it("checks an unknown environment before suggesting a platform requirement", () => {
    expect(studioReadiness({ ...idle, environment: null })).toMatchObject({
      label: "Checking setup",
      ready: false,
      tone: "neutral",
    });
  });

  it("reports a failed initial setup check with its actionable error", () => {
    expect(
      studioReadiness({ ...idle, environment: null, error: "Could not reach webcam service" }),
    ).toMatchObject({
      label: "Setup check failed",
      description: "Could not reach webcam service",
      ready: false,
      tone: "error",
    });
  });

  it("disables starting while prerequisites are being checked again", () => {
    expect(
      studioReadiness({ ...idle, checking: true, error: "Previous check failed" }),
    ).toMatchObject({
      label: "Checking setup",
      ready: false,
    });
  });

  it.each([
    [{ supported: false, runtimeReady: false, obsInstalled: false }, "Windows desktop required"],
    [{ runtimeReady: false, obsInstalled: false, bundled: false }, "Prepare video engine"],
    [{ obsInstalled: false }, "Install OBS camera driver"],
  ] as const)("identifies the first missing prerequisite: %s", (missing, label) => {
    expect(
      studioReadiness({ ...idle, environment: { ...environment, ...missing }, connected: false }),
    ).toMatchObject({ label, ready: false, tone: "warning" });
  });

  it("reports a broken bundled engine without suggesting development setup", () => {
    expect(
      studioReadiness({
        ...idle,
        environment: { ...environment, runtimeReady: false },
      }),
    ).toMatchObject({
      label: "Video engine needs attention",
      description: "Reinstall the Windows app, then check setup again.",
      ready: false,
      tone: "error",
    });
  });

  it("preserves the diagnostic supplied by a failing bundled engine", () => {
    expect(
      studioReadiness({
        ...idle,
        environment: {
          ...environment,
          runtimeReady: false,
          runtimeError: "The bundled video engine could not launch",
        },
      }).description,
    ).toBe("The bundled video engine could not launch");
  });

  it("shows installation progress even when setup is being rechecked", () => {
    expect(studioReadiness({ ...idle, phase: "installing", checking: true })).toMatchObject({
      label: "Preparing video engine",
      ready: false,
    });
  });

  it.each([
    [false, "Connect Luna"],
    [true, "Connecting Luna"],
  ])("waits for a completed camera connection (connecting: %s)", (connecting, label) => {
    expect(studioReadiness({ ...idle, connected: false, connecting })).toMatchObject({
      label,
      ready: false,
    });
  });

  it("offers Start only after all prerequisites and the camera connection are ready", () => {
    expect(studioReadiness(idle)).toMatchObject({
      label: "Ready to start",
      ready: true,
      tone: "success",
    });
  });

  it("keeps a failed start retryable when the prerequisites remain ready", () => {
    expect(
      studioReadiness({ ...idle, phase: "error", error: "Decoder could not start" }),
    ).toMatchObject({
      label: "Webcam needs attention",
      description: "Decoder could not start",
      ready: true,
      tone: "error",
    });
  });

  it("does not let an error make an unavailable camera retryable", () => {
    expect(studioReadiness({ ...idle, phase: "error", connected: false }).ready).toBe(false);
  });

  it.each([
    ["starting", "Starting webcam"],
    ["publishing", "Webcam on"],
    ["reconnecting", "Recovering video"],
  ] as const)("preserves the active %s status during background setup checks", (phase, label) => {
    expect(studioReadiness({ ...idle, wanted: true, phase, checking: true })).toMatchObject({
      label,
    });
  });

  it("describes camera preparation before generic webcam startup", () => {
    expect(
      studioReadiness({ ...idle, wanted: true, phase: "starting", preparing: true }),
    ).toMatchObject({ label: "Preparing camera" });
  });

  it.each(["starting", "publishing", "reconnecting"] as const)(
    "reports camera reconnection before the stale %s output phase",
    (phase) => {
      expect(studioReadiness({ ...idle, wanted: true, connected: false, phase })).toMatchObject({
        label: "Reconnecting camera",
        ready: false,
        tone: "warning",
      });
    },
  );

  it("ignores stale running phases when output is no longer wanted", () => {
    expect(studioReadiness({ ...idle, phase: "publishing" }).label).toBe("Ready to start");
  });
});

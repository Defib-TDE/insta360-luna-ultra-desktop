import type { WebcamEnvironment, WebcamStatus } from "~/types/webcam";

export interface StudioReadinessInput {
  environment: WebcamEnvironment | null;
  checking: boolean;
  phase: WebcamStatus["phase"];
  connected: boolean;
  connecting: boolean;
  wanted: boolean;
  preparing: boolean;
  error?: string | null;
}

export interface StudioReadiness {
  label: string;
  description: string;
  ready: boolean;
  tone: "neutral" | "success" | "warning" | "error";
  icon: string;
}

export function studioReadiness({
  environment,
  checking,
  phase,
  connected,
  connecting,
  wanted,
  preparing,
  error,
}: StudioReadinessInput): StudioReadiness {
  // Errors remain retryable when the prerequisites are ready. Session ownership
  // decides whether the UI offers Stop; readiness only gates a new Start.
  const ready = Boolean(
    environment?.supported &&
    environment.runtimeReady &&
    environment.obsInstalled &&
    connected &&
    !checking &&
    phase !== "installing",
  );
  const state = (
    label: string,
    description: string,
    tone: StudioReadiness["tone"],
    icon: string,
  ): StudioReadiness => ({ label, description, ready, tone, icon });

  if (wanted && preparing)
    return state(
      "Preparing camera",
      "Applying the camera mode for your selected output. You can stop at any time.",
      "neutral",
      "i-lucide-loader-circle",
    );
  if (wanted && !connected)
    return state(
      "Reconnecting camera",
      "Waiting for Luna to reconnect. Webcam output will resume automatically.",
      "warning",
      "i-lucide-wifi-off",
    );
  if (wanted && phase === "starting")
    return state(
      "Starting webcam",
      "Preparing video for your webcam apps. You can stop at any time.",
      "neutral",
      "i-lucide-loader-circle",
    );
  if (wanted && phase === "publishing")
    return state(
      "Webcam on",
      "Select OBS Virtual Camera in your video app to use Luna.",
      "success",
      "i-lucide-video",
    );
  if (wanted && phase === "reconnecting")
    return state(
      "Recovering video",
      "The camera is connected. Webcam output is recovering automatically.",
      "warning",
      "i-lucide-refresh-cw",
    );
  if (phase === "installing")
    return state(
      "Preparing video engine",
      "Setup is in progress. Keep Luna open until it finishes.",
      "neutral",
      "i-lucide-loader-circle",
    );
  if (checking || (!environment && !error))
    return state(
      "Checking setup",
      "Checking the video engine and webcam driver.",
      "neutral",
      "i-lucide-loader-circle",
    );
  if (!environment)
    return state(
      "Setup check failed",
      error ?? "Check setup again to see what needs attention.",
      "error",
      "i-lucide-circle-alert",
    );
  if (error || phase === "error")
    return state(
      "Webcam needs attention",
      error ?? "Webcam output stopped. Check the error details and try again.",
      "error",
      "i-lucide-circle-alert",
    );
  if (!environment.supported)
    return state(
      "Windows desktop required",
      "Open the Windows desktop app to publish Luna as a webcam.",
      "warning",
      "i-lucide-monitor",
    );
  if (!environment.runtimeReady) {
    if (environment.bundled)
      return state(
        "Video engine needs attention",
        environment.runtimeError ?? "Reinstall the Windows app, then check setup again.",
        "error",
        "i-lucide-circle-alert",
      );
    return state(
      "Prepare video engine",
      "Run setup to prepare the video engine for webcam output.",
      "warning",
      "i-lucide-download",
    );
  }
  if (!environment.obsInstalled)
    return state(
      "Install OBS camera driver",
      "Install OBS Studio, then check setup again to enable its virtual camera driver.",
      "warning",
      "i-lucide-download",
    );
  if (!connected)
    return state(
      connecting ? "Connecting Luna" : "Connect Luna",
      connecting
        ? "Waiting for the camera connection to finish."
        : "Join the camera Wi-Fi and connect Luna before starting webcam output.",
      connecting ? "neutral" : "warning",
      connecting ? "i-lucide-loader-circle" : "i-lucide-wifi",
    );
  return state(
    "Ready to start",
    "Start webcam, then select OBS Virtual Camera in your video app.",
    "success",
    "i-lucide-circle-check",
  );
}

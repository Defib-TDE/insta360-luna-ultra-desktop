import type { WebcamEnvironment, WebcamOptions, WebcamStatus } from "~/types/webcam";
import { isTauri } from "~/utils/saveFile";

export interface WebcamClient {
  environment(): Promise<WebcamEnvironment>;
  status(): Promise<WebcamStatus>;
  setup(): Promise<void>;
  start(options: WebcamOptions): Promise<void>;
  stop(): Promise<void>;
}

async function invoke<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(name, args);
}

const defaultClient: WebcamClient = {
  async environment() {
    if (!isTauri())
      return {
        supported: false,
        pythonFound: false,
        runtimeReady: false,
        obsInstalled: false,
        bundled: false,
      };
    return invoke("webcam_environment");
  },
  status: () => invoke("webcam_status"),
  setup: () => invoke("webcam_setup"),
  start: (options) => invoke("webcam_start", { options }),
  stop: () => invoke("webcam_stop"),
};
let client = defaultClient;

export function getWebcamClient() {
  return client;
}
export function setWebcamClient(next: WebcamClient) {
  client = next;
}
export function resetWebcamClient() {
  client = defaultClient;
}

export async function openStudioHelp(topic: "obs" | "python") {
  if (isTauri()) return invoke<void>("webcam_open_help", { topic });
  const url =
    topic === "obs"
      ? "https://obsproject.com/download"
      : "https://www.python.org/downloads/windows/";
  window.open(url, "_blank", "noopener,noreferrer");
}

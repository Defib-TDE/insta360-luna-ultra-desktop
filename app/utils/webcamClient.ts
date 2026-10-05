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

export async function openStudioHelp(topic: "obs" | "python" | "whatnot") {
  if (isTauri()) return invoke<void>("webcam_open_help", { topic });
  const url = {
    obs: "https://obsproject.com/download",
    python: "https://www.python.org/downloads/windows/",
    whatnot:
      "https://help.whatnot.com/hc/en-us/articles/5497980244749-Using-OBS-with-your-Livestream",
  }[topic];
  window.open(url, "_blank", "noopener,noreferrer");
}

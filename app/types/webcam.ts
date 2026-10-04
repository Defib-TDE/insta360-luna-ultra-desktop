export interface WebcamEnvironment {
  supported: boolean;
  pythonFound: boolean;
  runtimeReady: boolean;
  obsInstalled: boolean;
  bundled: boolean;
}

export interface WebcamStatus {
  phase: "stopped" | "installing" | "starting" | "publishing" | "reconnecting" | "error";
  url: string | null;
  device: string | null;
  sourceWidth: number | null;
  sourceHeight: number | null;
  sourceFps: number | null;
  outputFps: number | null;
  reconnects: number;
  error: string | null;
  logs: string[];
}

export interface WebcamOptions {
  url: string;
  codec: "hevc" | "h264";
  width: number;
  height: number;
  fps: number;
  mirror: boolean;
}

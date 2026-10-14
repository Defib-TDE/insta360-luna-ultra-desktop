import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const { version: appVersion } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

function resolveBuildCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 12);
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ["@nuxt/ui"],
  // Desktop use must work on camera Wi-Fi without internet. Fonts are bundled
  // with the app instead of resolving providers during startup or tests.
  ui: { fonts: false },
  // Keep installs and builds non-interactive in terminals and CI.
  telemetry: false,
  devtools: {
    enabled: true,
  },
  // Bundle every statically-referenced icon so the app works fully offline
  // (the Tauri build must never fetch icons from the Iconify CDN at runtime)
  icon: {
    clientBundle: {
      scan: true,
      // These names are selected from TypeScript profile/readiness objects,
      // so the template scanner cannot discover every possible value.
      icons: [
        "lucide:monitor",
        "lucide:smartphone",
        "lucide:expand",
        "lucide:loader-circle",
        "lucide:wifi-off",
        "lucide:video",
        "lucide:refresh-cw",
        "lucide:circle-alert",
        "lucide:download",
        "lucide:wifi",
        "lucide:circle-check",
      ],
      sizeLimitKb: 512,
    },
  },
  css: ["~/assets/css/main.css"],
  compatibilityDate: "2026-06-30",
  ssr: false,
  runtimeConfig: {
    public: {
      appVersion,
      buildChannel: "webcam-dev",
      buildCommit: resolveBuildCommit(),
    },
  },
  vite: {
    // Better support for Tauri CLI output
    clearScreen: false,
    // Enable environment variables
    // Additional environment variables can be found at
    // https://v2.tauri.app/reference/environment-variables/
    envPrefix: ["VITE_", "TAURI_"],
    server: {
      // Tauri requires a consistent port
      strictPort: true,
    },
  },
  // Avoids error [unhandledRejection] EMFILE: too many open files, watch
  ignore: ["**/src-tauri/**"],
});

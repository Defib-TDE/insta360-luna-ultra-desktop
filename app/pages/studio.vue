<script setup lang="ts">
import { WEBCAM_PROFILES } from "~/utils/webcamProfiles";
import { openStudioHelp } from "~/utils/webcamClient";
import { collectCameraReport, collectConnectionReport } from "~/utils/cameraReport";
import { saveBlob } from "~/utils/saveFile";
import { PREVIEW_PROFILES, previewVerdict } from "~/utils/previewProfiles";

useHead({ title: "Studio" });
const camera = useCamera();
const live = useLiveView();
const {
  environment,
  status,
  profileId,
  profile,
  mirror,
  codec,
  matchCamera,
  preparing,
  cameraMode,
  checking,
  error,
  wanted,
  publishing,
  running,
  check,
  setup,
  start,
  stop,
} = useWebcam();
const { colorway } = useCameraAppearance();
const destination = ref("calls");
const copied = ref(false);
const collecting = ref(false);
const collectingConnection = ref(false);
const reportLocation = ref<string | null>(null);
const outputStyle = computed(() => ({
  aspectRatio: `${profile.value.width} / ${profile.value.height}`,
}));
const busy = computed(() => status.value.phase === "installing");
const ready = computed(() => environment.value?.runtimeReady && environment.value?.obsInstalled);
const statusLabel = computed(() => {
  if (preparing.value) return "Preparing camera mode";
  if (wanted.value && !camera.isConnected.value) return "Reconnecting camera";
  return {
    stopped: "Ready when you are",
    installing: "Preparing webcam",
    starting: "Starting output",
    publishing: "Webcam on",
    reconnecting: "Recovering video",
    error: "Output needs attention",
  }[status.value.phase];
});
const framingHint = computed(() => {
  if (!status.value.sourceWidth || !status.value.sourceHeight) return null;
  const vertical = status.value.sourceHeight > status.value.sourceWidth;
  if (vertical === (profileId.value === "portrait")) return null;
  return profileId.value === "portrait"
    ? "Your source is landscape. Set portrait orientation on the camera for a taller picture; output keeps its proportions."
    : "Your source is portrait. Set landscape orientation on the camera for a wider picture; output keeps its proportions.";
});
const sourceLabel = computed(() =>
  wanted.value && status.value.sourceWidth
    ? `${status.value.sourceWidth} × ${status.value.sourceHeight}`
    : "Awaiting video",
);

async function copyDevice() {
  try {
    await navigator.clipboard.writeText("OBS Virtual Camera");
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    error.value = "Choose OBS Virtual Camera in your destination app.";
  }
}

async function openHelp(topic: "obs" | "python" | "whatnot") {
  try {
    await openStudioHelp(topic);
  } catch (cause) {
    error.value = `Could not open setup help: ${String(cause)}`;
  }
}

async function exportCameraReport() {
  collecting.value = true;
  reportLocation.value = null;
  try {
    const report = await collectCameraReport(camera.info.value ?? {}, {
      codec: codec.value,
      sourceWidth: wanted.value ? status.value.sourceWidth : null,
      sourceHeight: wanted.value ? status.value.sourceHeight : null,
      observedDecodeFps: wanted.value ? status.value.sourceFps : null,
      outputWidth: profile.value.width,
      outputHeight: profile.value.height,
      outputFps: wanted.value
        ? (status.value.outputFps ?? live.sourceRequest.value.fps)
        : live.sourceRequest.value.fps,
      requestedProfile: live.sourceProfile.value,
    });
    reportLocation.value = await saveBlob(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
      "luna-camera-capabilities.json",
    );
  } catch (cause) {
    error.value = `Camera report could not finish: ${String(cause)}`;
  } finally {
    collecting.value = false;
  }
}

async function exportConnectionReport() {
  collectingConnection.value = true;
  try {
    const report = await collectConnectionReport(
      status.value,
      live.diagnostics.value,
      camera.info.value?.firmware,
    );
    reportLocation.value = await saveBlob(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
      "luna-connection-report.json",
    );
  } catch (cause) {
    error.value = `Connection report could not finish: ${String(cause)}`;
  } finally {
    collectingConnection.value = false;
  }
}
</script>

<template>
  <UDashboardPanel id="studio" :ui="{ body: 'p-4 sm:p-6' }">
    <template #header>
      <UDashboardNavbar title="Studio">
        <template #leading><UDashboardSidebarCollapse /></template>
        <template #right>
          <span class="flex items-center gap-2 text-xs text-muted" role="status" aria-live="polite">
            <span
              class="size-2 rounded-full"
              :class="publishing ? 'bg-emerald-400' : running ? 'bg-amber-400' : 'bg-neutral-400'"
            />
            {{ statusLabel }}
          </span>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="studio-surface mx-auto w-full max-w-[1440px] space-y-6 pb-6">
        <header class="flex flex-wrap items-end justify-between gap-4">
          <div class="space-y-2">
            <p
              class="text-[10px] font-semibold tracking-[0.24em] text-violet-500 dark:text-violet-300"
            >
              LUNA / STUDIO
            </p>
            <h1 class="text-3xl font-semibold tracking-tight text-highlighted">
              Your camera. A bigger stage.
            </h1>
            <p class="text-sm text-muted">
              A beautiful feed, ready for your next call or live show.
            </p>
          </div>
          <UButton
            to="/camera"
            label="Camera controls"
            icon="i-lucide-sliders-horizontal"
            color="neutral"
            variant="ghost"
          />
        </header>

        <div class="studio-grid grid items-start gap-5">
          <section class="min-w-0 space-y-4" aria-label="Studio preview">
            <div
              class="studio-viewfinder relative flex h-[clamp(260px,48vh,540px)] items-center justify-center overflow-hidden rounded-[24px] border border-white/10 bg-[#101017]"
            >
              <div
                v-if="camera.isConnected.value && live.active.value"
                class="max-h-full max-w-full overflow-hidden bg-black"
                :class="profileId === 'portrait' ? 'h-full' : 'w-full'"
                :style="outputStyle"
              >
                <LiveView :class="mirror ? '-scale-x-100' : ''" />
              </div>
              <div
                v-else
                class="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center"
              >
                <div class="studio-hero-model h-40 w-48">
                  <LunaModel :colorway :interactive="false" />
                </div>
                <div class="space-y-2">
                  <h2 class="text-lg font-medium text-white">
                    {{
                      camera.isConnected.value
                        ? live.failed.value
                          ? "Your picture needs a restart"
                          : preparing
                            ? "Preparing your camera"
                            : "Bringing your picture in"
                        : "Meet your next webcam"
                    }}
                  </h2>
                  <p class="max-w-sm text-sm text-white/50">
                    {{
                      camera.isConnected.value
                        ? live.failed.value
                          ? "The camera did not send video. Retry the preview, or reconnect Luna if it stays stuck."
                          : "The preview starts as soon as the camera sends video."
                        : "Join your Luna’s Wi-Fi, then connect. Your live picture will appear here."
                    }}
                  </p>
                </div>
                <UButton
                  v-if="camera.isConnected.value && live.failed.value"
                  label="Retry preview"
                  icon="i-lucide-refresh-cw"
                  @click="live.retry({ elementary: wanted })"
                />
                <UButton
                  v-if="!camera.isConnected.value"
                  label="Connect Luna"
                  icon="i-lucide-plug"
                  :loading="camera.isBusy.value"
                  :disabled="!camera.available.value"
                  @click="camera.connect"
                />
              </div>
              <div
                v-if="wanted && (!camera.isConnected.value || status.phase === 'reconnecting')"
                class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#101017]/95 text-white"
              >
                <UIcon
                  name="i-lucide-radio"
                  class="size-8 text-violet-300 motion-safe:animate-pulse"
                />
                <span class="font-medium">Reconnecting your picture</span>
                <span class="text-xs text-white/50"
                  >Keep your destination open. We’ll recover automatically.</span
                >
              </div>
              <div
                class="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-5 pb-10 pt-5 text-[10px] tracking-[0.15em] text-white/65"
              >
                <span class="flex items-center gap-2"
                  ><span
                    class="size-1.5 rounded-full"
                    :class="publishing ? 'bg-emerald-400' : 'bg-white/40'"
                  />{{ publishing ? "WEBCAM OUTPUT" : "CAMERA PREVIEW" }}</span
                >
                <span>{{ profile.width }} × {{ profile.height }}</span>
              </div>
              <div
                class="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent px-5 pb-4 pt-10 text-[10px] tracking-[0.15em] text-white/65"
              >
                <span>{{ camera.info.value?.deviceName ?? "LUNA ULTRA" }}</span>
                <span
                  >{{ mirror ? "MIRRORED · " : ""
                  }}{{ profileId === "portrait" ? "9:16" : "16:9" }}</span
                >
              </div>
            </div>

            <div class="grid grid-cols-3 gap-2" role="group" aria-label="Webcam output profile">
              <button
                v-for="choice in WEBCAM_PROFILES"
                :key="choice.id"
                type="button"
                :disabled="wanted || busy"
                class="studio-profile flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-60 sm:p-4"
                :class="
                  profileId === choice.id
                    ? 'border-violet-400/70 bg-violet-500/5'
                    : 'border-default hover:bg-elevated'
                "
                :aria-pressed="profileId === choice.id"
                @click="profileId = choice.id"
              >
                <UIcon
                  :name="choice.icon"
                  class="hidden size-5 shrink-0 text-violet-400 sm:block"
                />
                <span class="min-w-0"
                  ><span class="block text-sm font-medium text-highlighted">{{ choice.label }}</span
                  ><span class="block text-[11px] text-muted">{{ choice.detail }}</span></span
                >
              </button>
            </div>
            <p class="px-1 text-xs leading-relaxed text-muted">
              {{
                profileId === "portrait"
                  ? "Fits a vertical source without stretching. Source orientation depends on the camera’s mode."
                  : "Keeps your source proportions, with black bars when needed. Camera mode determines the native picture."
              }}
              {{
                profileId === "fullhd"
                  ? "1080p output scales to fit the delivered source; source measurements show the actual camera detail."
                  : ""
              }}
            </p>
            <section
              class="space-y-3 rounded-2xl border border-default bg-default/70 p-4"
              aria-label="Camera source settings"
            >
              <div
                class="flex flex-wrap items-center justify-between gap-3 text-xs font-medium text-highlighted"
              >
                <label for="native-source-profile">Native camera source</label>
                <select
                  id="native-source-profile"
                  v-model="live.sourceProfile.value"
                  :disabled="wanted || busy || preparing || live.starting.value"
                  class="max-w-full rounded-xl border border-default bg-default p-2 text-xs"
                >
                  <option v-for="choice in PREVIEW_PROFILES" :key="choice.id" :value="choice.id">
                    {{ choice.label }}
                  </option>
                </select>
              </div>
              <p class="text-xs leading-relaxed text-muted">
                These request a different feed from Luna. Experimental profiles may be ignored or
                unavailable; use the source measurements below to check what arrives. Stop webcam
                before changing. Keep camera mode and orientation fixed while comparing.
              </p>
              <p v-if="status.sourceWidth && wanted" class="text-xs text-muted" role="status">
                {{
                  previewVerdict(
                    live.sourceProfile.value,
                    status.sourceWidth,
                    status.sourceHeight,
                    status.sourceFps,
                  )
                }}
              </p>
              <UButton
                v-if="live.sourceProfile.value !== 'baseline'"
                label="Use tested baseline"
                size="xs"
                color="neutral"
                variant="outline"
                :disabled="wanted || live.starting.value"
                @click="live.sourceProfile.value = 'baseline'"
              />
            </section>
            <p
              v-if="framingHint"
              class="px-1 text-xs leading-relaxed text-amber-600 dark:text-amber-300"
              role="status"
            >
              {{ framingHint }}
            </p>

            <div
              class="grid grid-cols-3 divide-x divide-default rounded-2xl border border-default bg-default/70 py-4 text-center"
            >
              <div>
                <p class="text-[10px] uppercase tracking-widest text-muted">Source</p>
                <p class="mt-1 font-mono text-xs text-highlighted">{{ sourceLabel }}</p>
              </div>
              <div>
                <p class="text-[10px] uppercase tracking-widest text-muted">Decoded</p>
                <p class="mt-1 font-mono text-xs text-highlighted">
                  {{
                    wanted && status.sourceFps ? `${status.sourceFps.toFixed(1)} fps` : "Measuring…"
                  }}
                </p>
              </div>
              <div>
                <p class="text-[10px] uppercase tracking-widest text-muted">Output</p>
                <p class="mt-1 font-mono text-xs text-highlighted">
                  {{
                    wanted
                      ? (status.outputFps ?? live.sourceRequest.value.fps)
                      : live.sourceRequest.value.fps
                  }}
                  fps
                </p>
              </div>
            </div>
          </section>

          <aside class="space-y-4" aria-label="Output controls">
            <section class="rounded-[24px] border border-default bg-default/80 p-5 shadow-sm">
              <div class="mb-5 flex items-center justify-between">
                <h2 class="text-sm font-semibold text-highlighted">Webcam output</h2>
                <UIcon name="i-lucide-video" class="size-5 text-violet-400" />
              </div>
              <div v-if="!ready" class="mb-5 space-y-3">
                <p class="text-xs leading-relaxed text-muted">
                  {{
                    !environment?.supported
                      ? "Use the Windows desktop app for webcam output."
                      : "Finish these steps once, then start your webcam with one click."
                  }}
                </p>
                <div class="flex items-center gap-2 text-xs">
                  <UIcon
                    :name="environment?.runtimeReady ? 'i-lucide-circle-check' : 'i-lucide-circle'"
                    class="size-4 text-violet-400"
                  />{{ environment?.runtimeReady ? "Video engine ready" : "Video engine" }}
                </div>
                <UButton
                  v-if="environment?.supported && !environment.runtimeReady"
                  class="w-full"
                  color="neutral"
                  variant="outline"
                  :label="
                    environment.pythonFound ? 'Prepare webcam' : 'Python needed for this dev build'
                  "
                  :loading="busy"
                  :disabled="!environment.pythonFound"
                  @click="setup"
                />
                <p
                  v-if="environment?.supported && !environment.runtimeReady"
                  class="text-[11px] text-muted"
                >
                  Setup needs internet access. Installed Windows releases include the video engine.
                </p>
                <div class="flex items-center gap-2 text-xs">
                  <UIcon
                    :name="environment?.obsInstalled ? 'i-lucide-circle-check' : 'i-lucide-circle'"
                    class="size-4 text-violet-400"
                  />{{
                    environment?.obsInstalled ? "OBS camera driver ready" : "OBS camera driver"
                  }}
                </div>
                <button
                  v-if="
                    environment?.supported && !environment.runtimeReady && !environment.pythonFound
                  "
                  type="button"
                  class="text-xs text-violet-500 underline underline-offset-4 dark:text-violet-300"
                  @click="openHelp('python')"
                >
                  Install Python for this development build
                </button>
                <button
                  v-if="environment?.supported && !environment.obsInstalled"
                  type="button"
                  class="inline-flex items-center gap-1 text-xs text-violet-500 underline underline-offset-4 dark:text-violet-300"
                  @click="openHelp('obs')"
                >
                  Install OBS Studio <UIcon name="i-lucide-arrow-up-right" class="size-3" />
                </button>
                <UButton
                  label="Check setup again"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-refresh-cw"
                  :loading="checking"
                  @click="check"
                />
              </div>
              <template v-else>
                <p class="mb-4 text-xs leading-relaxed text-muted">
                  Choose this camera in your call or streaming app:
                </p>
                <button
                  type="button"
                  class="mb-5 flex w-full items-center justify-between rounded-xl bg-elevated p-3 text-left text-xs focus-visible:outline-2"
                  @click="copyDevice"
                >
                  <span class="font-medium">{{
                    copied ? "Copied camera name" : "OBS Virtual Camera"
                  }}</span
                  ><UIcon
                    :name="copied ? 'i-lucide-check' : 'i-lucide-copy'"
                    class="size-3.5 text-muted"
                  />
                </button>
              </template>
              <div class="mb-4 border-t border-default pt-4">
                <div class="flex items-center justify-between gap-3">
                  <label for="match-camera" class="text-xs text-highlighted"
                    >Match camera mode</label
                  >
                  <USwitch id="match-camera" v-model="matchCamera" :disabled="wanted || busy" />
                </div>
                <p class="mt-2 text-[11px] leading-relaxed text-muted">
                  {{
                    matchCamera
                      ? `Start selects ${profile.cameraModeLabel}, then verifies it. Switching to Slow-mo resets its color and filter to Standard.`
                      : "Keep my camera settings. Start uses the current mode, color and orientation."
                  }}
                </p>
                <p v-if="matchCamera" class="mt-2 text-[11px] leading-relaxed text-muted">
                  Based on the tested Luna preview. Orientation is set on the camera; recording
                  resolution does not set preview quality.
                </p>
              </div>
              <div
                class="mb-5 flex items-center justify-between gap-3 border-t border-default pt-4"
              >
                <label for="mirror-output" class="text-xs text-muted">Mirror image</label
                ><USwitch id="mirror-output" v-model="mirror" :disabled="wanted || busy" />
              </div>
              <UButton
                class="w-full justify-center rounded-xl py-3"
                size="lg"
                :color="wanted ? 'neutral' : 'primary'"
                :variant="wanted ? 'outline' : 'solid'"
                :icon="wanted ? 'i-lucide-square' : 'i-lucide-video'"
                :label="wanted ? 'Stop webcam' : 'Start webcam'"
                :disabled="!wanted && (!ready || !camera.isConnected.value || busy)"
                @click="wanted ? stop() : start()"
              />
              <p class="mt-3 text-center text-[11px] text-muted">
                {{
                  wanted
                    ? preparing
                      ? "Checking the camera. Stop cancels startup."
                      : cameraMode
                        ? `${cameraMode} verified · output stays on while you navigate.`
                        : "Output stays on while you navigate."
                    : matchCamera
                      ? `Camera preparation: ${profile.cameraModeLabel}`
                      : "Your camera settings stay as you set them."
                }}
              </p>
            </section>

            <section class="rounded-[24px] border border-violet-400/20 bg-violet-500/[0.035] p-5">
              <div class="mb-2 flex items-center gap-2">
                <UIcon name="i-lucide-radio" class="size-4 text-violet-400" />
                <h2 class="text-sm font-semibold text-highlighted">Take it live</h2>
              </div>
              <p class="mb-4 text-xs leading-relaxed text-muted">
                Your Luna feeds OBS. OBS handles your microphone, scene and broadcast destination.
              </p>
              <div
                class="mb-4 flex gap-1 rounded-lg bg-elevated p-1"
                role="group"
                aria-label="Destination guide"
              >
                <button
                  v-for="target in [
                    { id: 'calls', label: 'Calls' },
                    { id: 'obs', label: 'OBS' },
                    { id: 'whatnot', label: 'Whatnot' },
                  ]"
                  :key="target.id"
                  type="button"
                  class="flex-1 rounded-md px-2 py-1.5 text-xs focus-visible:outline-2"
                  :class="
                    destination === target.id
                      ? 'bg-default text-highlighted shadow-sm'
                      : 'text-muted'
                  "
                  :aria-pressed="destination === target.id"
                  @click="destination = target.id"
                >
                  {{ target.label }}
                </button>
              </div>
              <ol class="space-y-3 text-xs leading-relaxed text-muted">
                <template v-if="destination === 'calls'">
                  <li>
                    <span class="text-highlighted">1. Start webcam above.</span> Leave the Luna
                    connected.
                  </li>
                  <li>
                    <span class="text-highlighted">2. Select OBS Virtual Camera</span> in Discord,
                    Teams or Zoom.
                  </li>
                  <li>
                    <span class="text-highlighted">3. Choose your microphone</span> separately in
                    the call app.
                  </li>
                </template>
                <template v-else>
                  <li>
                    <span class="text-highlighted">1. Start webcam above.</span> Keep OBS’s own
                    virtual-camera publisher stopped.
                  </li>
                  <li>
                    <span class="text-highlighted">2. In OBS, add Video Capture Device</span> and
                    choose OBS Virtual Camera. Add your microphone.
                  </li>
                  <li>
                    <span class="text-highlighted"
                      >3.
                      {{
                        destination === "whatnot" ? "Use Whatnot Show Tools" : "Set your OBS canvas"
                      }}</span
                    >
                    {{
                      destination === "whatnot"
                        ? "Connect OBS WebSocket and apply the show’s settings: WHIP, a per-show bearer token and a 1080 × 1920 canvas. Keep the token private."
                        : "Configure your platform’s broadcast settings in OBS."
                    }}
                  </li>
                  <li>
                    <span class="text-highlighted"
                      >4.
                      {{
                        destination === "whatnot"
                          ? "Follow the Show Tools launch steps"
                          : "Start Streaming in OBS"
                      }}</span
                    >
                    {{
                      destination === "whatnot"
                        ? "Restart OBS after applying the initial profile, then return to Show Tools to start your show. Settings and tokens are specific to each show."
                        : "when your destination is configured."
                    }}
                  </li>
                </template>
              </ol>
              <UButton
                v-if="destination === 'whatnot'"
                class="mt-3"
                label="Whatnot’s official OBS guide"
                trailing-icon="i-lucide-arrow-up-right"
                size="xs"
                color="neutral"
                variant="link"
                @click="openHelp('whatnot')"
              />
              <p class="mt-4 border-t border-violet-400/15 pt-3 text-[11px] text-muted">
                Webcam output is local. Broadcast status is managed in your destination app.
              </p>
            </section>
          </aside>
        </div>

        <UAlert
          v-if="error || status.error || live.error.value || camera.error.value"
          icon="i-lucide-triangle-alert"
          color="warning"
          variant="subtle"
          :title="error ?? status.error ?? live.error.value ?? camera.error.value ?? ''"
        />
        <UButton
          v-if="live.active.value && live.error.value && camera.isConnected.value"
          label="Retry preview"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          :disabled="preparing"
          @click="live.retry({ elementary: wanted })"
        />

        <details class="rounded-2xl border border-default p-4 text-xs text-muted">
          <summary class="cursor-pointer font-medium text-highlighted">
            Connection & diagnostics
          </summary>
          <div class="mt-4 grid gap-4 md:grid-cols-2">
            <div class="space-y-3">
              <p>
                {{
                  camera.info.value?.firmware
                    ? `Camera firmware ${camera.info.value.firmware}`
                    : "Firmware is available after connecting."
                }}
              </p>
              <p class="break-all font-mono">
                {{ live.streamUrl.value ?? "No active camera stream" }}
              </p>
              <p>
                {{ status.reconnects }} decoder retries ·
                {{ environment?.bundled ? "Bundled video engine" : "Development video runtime" }}
              </p>
              <label class="flex items-center gap-2"
                >Source codec
                <select
                  v-model="codec"
                  :disabled="wanted"
                  class="rounded border border-default bg-default p-1.5"
                >
                  <option value="hevc">HEVC · tested Luna</option>
                  <option value="h264">H.264 · other firmware</option>
                </select></label
              >
              <UButton
                label="Export camera report"
                icon="i-lucide-file-down"
                size="xs"
                color="neutral"
                variant="outline"
                :loading="collecting"
                :disabled="!camera.isConnected.value || preparing"
                @click="exportCameraReport"
              />
              <p class="text-[11px]">
                Reads known camera options through this connection. No settings change; Wi-Fi
                credentials and device identifiers are omitted.
              </p>
              <UButton
                label="Export connection report"
                icon="i-lucide-activity"
                size="xs"
                color="neutral"
                variant="outline"
                :loading="collectingConnection"
                @click="exportConnectionReport"
              />
              <p class="text-[11px]">
                Save this just after a dropout, before closing the app. It includes recovery reasons
                and works while disconnected.
              </p>
              <p v-if="reportLocation" role="status">Saved to {{ reportLocation }}</p>
            </div>
            <pre
              class="max-h-36 overflow-auto whitespace-pre-wrap rounded-xl bg-elevated p-3 font-mono text-[11px]"
              >{{
                status.logs.length
                  ? status.logs.join("\n")
                  : "Video diagnostics will appear when output starts."
              }}</pre>
          </div>
        </details>
      </div>
    </template>
  </UDashboardPanel>
</template>

<style scoped>
.studio-surface {
  background: radial-gradient(ellipse at 25% 0%, rgb(139 92 246 / 0.055), transparent 55%);
}
.studio-viewfinder {
  box-shadow: 0 24px 60px -30px rgb(0 0 0 / 0.55);
}
@media (min-width: 900px) {
  .studio-grid {
    grid-template-columns: minmax(0, 1fr) 280px;
  }
}
@media (min-width: 1280px) {
  .studio-grid {
    grid-template-columns: minmax(0, 1fr) 320px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .studio-profile {
    transition: none;
  }
}
@media (max-height: 740px) {
  .studio-hero-model {
    height: 6rem;
  }
}
</style>

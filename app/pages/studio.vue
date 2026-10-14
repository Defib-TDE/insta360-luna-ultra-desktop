<script setup lang="ts">
import { WEBCAM_PROFILES } from "~/utils/webcamProfiles";
import { openStudioHelp } from "~/utils/webcamClient";
import { collectCameraReport, collectConnectionReport } from "~/utils/cameraReport";
import { saveBlob } from "~/utils/saveFile";
import { PREVIEW_PROFILES, previewVerdict } from "~/utils/previewProfiles";
import { studioReadiness } from "~/utils/studioReadiness";

useHead({ title: "Studio" });
const camera = useCamera();
const { appVersion, buildCommit, buildChannel } = useRuntimeConfig().public;
const appBuild = { version: appVersion, commit: buildCommit, channel: buildChannel };
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
const primaryError = computed(
  () => error.value ?? status.value.error ?? live.error.value ?? camera.error.value,
);
const readiness = computed(() =>
  studioReadiness({
    environment: environment.value,
    checking: checking.value,
    phase: status.value.phase,
    connected: camera.isConnected.value,
    connecting: camera.isBusy.value,
    wanted: wanted.value,
    preparing: preparing.value,
    error: primaryError.value,
  }),
);
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
    : wanted.value
      ? "Awaiting video"
      : "Not measured",
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
    const report = await collectCameraReport(
      camera.info.value ?? {},
      {
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
      },
      appBuild,
    );
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
      appBuild,
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
          <UButton
            to="/camera"
            label="Camera controls"
            icon="i-lucide-sliders-horizontal"
            color="neutral"
            variant="ghost"
            size="sm"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="studio-surface mx-auto w-full max-w-[1440px] space-y-5 pb-6">
        <header class="space-y-1">
          <p
            class="text-[10px] font-semibold tracking-[0.2em] text-violet-500 dark:text-violet-300"
          >
            LUNA / STUDIO
          </p>
          <h1 class="text-2xl font-semibold tracking-tight text-highlighted">
            Your camera, everywhere.
          </h1>
          <p class="text-sm text-muted">
            Set your frame. Start your webcam. Open your favorite app.
          </p>
        </header>

        <section
          class="rounded-2xl border border-violet-400/25 bg-default/90 p-4 shadow-sm"
          aria-label="Webcam setup and output"
        >
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="flex min-w-0 items-start gap-3" role="status" aria-live="polite">
              <span
                class="flex size-10 shrink-0 items-center justify-center rounded-xl"
                :class="
                  readiness.tone === 'success'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : readiness.tone === 'error' || readiness.tone === 'warning'
                      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      : 'bg-violet-500/10 text-violet-500 dark:text-violet-300'
                "
                ><UIcon :name="readiness.icon" class="size-5"
              /></span>
              <div class="min-w-0 space-y-1">
                <h2 class="text-sm font-semibold text-highlighted">{{ readiness.label }}</h2>
                <p class="max-w-xl text-xs leading-relaxed text-muted">
                  {{ readiness.description }}
                </p>
              </div>
            </div>
            <UButton
              class="shrink-0 justify-center rounded-xl px-5 py-3"
              size="lg"
              :color="wanted ? 'neutral' : 'primary'"
              :variant="wanted ? 'outline' : 'solid'"
              :icon="wanted ? 'i-lucide-square' : 'i-lucide-video'"
              :label="wanted ? 'Stop webcam' : 'Start webcam'"
              :disabled="!wanted && !readiness.ready"
              @click="wanted ? stop() : start()"
            />
          </div>

          <div
            v-if="
              environment?.supported &&
              (!environment.runtimeReady || !environment.obsInstalled || !camera.isConnected.value)
            "
            class="mt-4 flex flex-wrap items-center gap-3 border-t border-default pt-3"
          >
            <template v-if="!environment.runtimeReady">
              <template v-if="!environment.bundled">
                <UButton
                  v-if="environment.pythonFound"
                  label="Prepare webcam"
                  icon="i-lucide-download"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  :loading="busy"
                  @click="setup"
                />
                <UButton
                  v-else
                  label="Install Python"
                  trailing-icon="i-lucide-arrow-up-right"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  @click="openHelp('python')"
                />
                <span class="text-xs text-muted"
                  >One-time setup for this development build; internet required.</span
                >
              </template>
            </template>
            <UButton
              v-if="!environment.obsInstalled"
              label="Install OBS Studio"
              trailing-icon="i-lucide-arrow-up-right"
              color="neutral"
              variant="outline"
              size="sm"
              @click="openHelp('obs')"
            />
            <UButton
              v-if="!camera.isConnected.value"
              label="Connect Luna"
              icon="i-lucide-plug"
              color="neutral"
              variant="outline"
              size="sm"
              :loading="camera.isBusy.value"
              :disabled="!camera.available.value"
              @click="camera.connect"
            />
            <UButton
              v-if="!environment.runtimeReady || !environment.obsInstalled"
              label="Check setup again"
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              size="sm"
              :loading="checking"
              :disabled="busy"
              @click="check"
            />
          </div>
          <UButton
            v-if="!environment && error && !checking"
            class="mt-3"
            label="Check setup again"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            size="sm"
            @click="check"
          />
          <details class="mt-3 border-t border-default pt-3 text-xs text-muted">
            <summary
              class="cursor-pointer rounded-sm font-medium text-highlighted focus-visible:outline-2 focus-visible:outline-offset-4"
            >
              Before a long session · camera power &amp; internet
            </summary>
            <div class="mt-3 grid gap-3 leading-relaxed md:grid-cols-2">
              <p>
                Check
                <span class="font-medium text-highlighted"
                  >Screen Auto Sleep and Auto Power Off</span
                >
                in Luna’s Settings → General. If video pauses when the screen goes dark, wake the
                camera and adjust those timers on Luna. Automatic camera keep-awake is not available
                yet.
              </p>
              <p>
                Calls and streams need internet alongside Luna’s Wi-Fi. Use Ethernet for internet,
                or a second Wi-Fi adapter. Choose a separate microphone in your call app or OBS.
              </p>
            </div>
          </details>
        </section>

        <UAlert
          v-if="primaryError"
          icon="i-lucide-triangle-alert"
          color="warning"
          variant="subtle"
          :title="primaryError"
        >
          <template v-if="camera.isConnected.value && live.error.value" #actions>
            <UButton
              label="Retry preview"
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="outline"
              size="sm"
              :disabled="preparing"
              @click="live.retry({ elementary: true })"
            />
          </template>
        </UAlert>

        <div class="studio-grid grid items-start gap-5">
          <section class="min-w-0 space-y-4" aria-label="Studio preview">
            <div
              class="studio-viewfinder relative flex h-[clamp(240px,40vh,480px)] items-center justify-center overflow-hidden rounded-[24px] border border-white/10 bg-[#101017]"
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
                class="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 py-10 text-center"
              >
                <div class="studio-hero-model h-28 w-40">
                  <LunaModel :colorway :interactive="false" />
                </div>
                <div class="space-y-1.5">
                  <h2 class="text-base font-medium text-white">
                    {{
                      camera.isConnected.value
                        ? live.failed.value
                          ? "Your picture needs a restart"
                          : preparing
                            ? "Preparing your camera"
                            : "Bringing your picture in"
                        : "Your frame starts here"
                    }}
                  </h2>
                  <p class="max-w-sm text-xs leading-relaxed text-white/60">
                    {{
                      camera.isConnected.value
                        ? live.failed.value
                          ? "Retry the preview, or reconnect Luna if video does not return."
                          : "Waiting for the camera’s first picture."
                        : "Join your Luna’s Wi-Fi, then connect to see your picture."
                    }}
                  </p>
                </div>
                <UButton
                  v-if="camera.isConnected.value && live.failed.value"
                  label="Retry preview"
                  icon="i-lucide-refresh-cw"
                  size="sm"
                  @click="live.retry({ elementary: true })"
                />
                <UButton
                  v-if="!camera.isConnected.value"
                  label="Connect Luna"
                  icon="i-lucide-plug"
                  size="sm"
                  :loading="camera.isBusy.value"
                  :disabled="!camera.available.value"
                  @click="camera.connect"
                />
              </div>
              <div
                v-if="wanted && (!camera.isConnected.value || status.phase === 'reconnecting')"
                class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#101017]/95 px-6 text-center text-white"
              >
                <UIcon
                  name="i-lucide-radio"
                  class="size-8 text-violet-300 motion-safe:animate-pulse"
                />
                <span class="font-medium">Reconnecting your picture</span>
                <span class="text-xs text-white/60"
                  >Keep your destination open. We’ll recover automatically.</span
                >
              </div>
              <div
                class="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-5 pb-8 pt-4 text-[10px] tracking-[0.12em] text-white/70"
              >
                <span class="flex items-center gap-2">
                  <span
                    class="size-1.5 rounded-full"
                    :class="publishing ? 'bg-emerald-400' : 'bg-white/40'"
                  />
                  {{ publishing ? "WEBCAM ON" : "CAMERA PREVIEW" }}
                </span>
                <span>{{ profileId === "portrait" ? "9:16" : "16:9" }} FRAME</span>
              </div>
              <div
                class="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent px-5 pb-4 pt-8 text-[10px] tracking-[0.12em] text-white/70"
              >
                <span>{{ camera.info.value?.deviceName ?? "LUNA ULTRA" }}</span>
                <span>{{ mirror ? "MIRROR ON" : "" }}</span>
              </div>
            </div>

            <div class="grid grid-cols-3 gap-2" role="group" aria-label="Webcam output profile">
              <button
                v-for="choice in WEBCAM_PROFILES"
                :key="choice.id"
                type="button"
                :disabled="wanted || busy"
                class="studio-profile flex min-w-0 items-center gap-2 rounded-2xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-60 sm:p-4"
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
                  class="hidden size-4 shrink-0 text-violet-400 sm:block"
                />
                <span class="min-w-0">
                  <span class="block text-sm font-medium text-highlighted">{{ choice.label }}</span>
                  <span class="mt-1 block text-[11px] leading-relaxed text-muted">{{
                    choice.detail
                  }}</span>
                </span>
              </button>
            </div>
            <p class="px-1 text-xs leading-relaxed text-muted">
              {{
                profileId === "fullhd"
                  ? "1080p is upscaled from Luna’s source. It fits a Full HD canvas without adding camera detail."
                  : profileId === "portrait"
                    ? "For vertical video, set portrait orientation on Luna. Your picture keeps its proportions."
                    : "A 720p frame for calls and OBS. Your picture keeps its proportions, with black bars when needed."
              }}
              <span v-if="wanted"> Stop webcam to change your frame or settings.</span>
            </p>
            <p
              v-if="framingHint && wanted"
              class="px-1 text-xs leading-relaxed text-amber-600 dark:text-amber-300"
              role="status"
            >
              {{ framingHint }}
            </p>

            <div
              class="grid grid-cols-3 divide-x divide-default rounded-2xl border border-default bg-default/70 py-3 text-center"
            >
              <div class="px-2">
                <p class="text-[10px] uppercase tracking-widest text-muted">Camera source</p>
                <p class="mt-1 font-mono text-xs text-highlighted">{{ sourceLabel }}</p>
              </div>
              <div class="px-2">
                <p class="text-[10px] uppercase tracking-widest text-muted">Source rate</p>
                <p class="mt-1 font-mono text-xs text-highlighted">
                  {{
                    wanted
                      ? status.sourceFps
                        ? `${status.sourceFps.toFixed(1)} fps`
                        : "Measuring…"
                      : "Not measured"
                  }}
                </p>
              </div>
              <div class="px-2">
                <p class="text-[10px] uppercase tracking-widest text-muted">Output frame</p>
                <p class="mt-1 font-mono text-xs text-highlighted">
                  {{ profile.width }} × {{ profile.height }}
                </p>
                <p class="mt-1 text-[10px] text-muted">
                  {{
                    wanted
                      ? (status.outputFps ?? live.sourceRequest.value.fps)
                      : live.sourceRequest.value.fps
                  }}
                  fps{{ profileId === "fullhd" ? " · upscaled" : "" }}
                </p>
              </div>
            </div>
            <p v-if="!wanted" class="px-1 text-[11px] text-muted">
              Source size and frame rate are measured when webcam output starts.
            </p>

            <details class="rounded-2xl border border-default bg-default/70 p-4 text-xs">
              <summary
                class="cursor-pointer rounded-sm font-medium text-highlighted focus-visible:outline-2 focus-visible:outline-offset-4"
              >
                Advanced source settings{{
                  live.sourceProfile.value !== "baseline" ? " · experimental profile selected" : ""
                }}
              </summary>
              <div class="mt-4 space-y-3">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <label for="native-source-profile" class="font-medium text-highlighted"
                    >Native camera source</label
                  >
                  <select
                    id="native-source-profile"
                    v-model="live.sourceProfile.value"
                    :disabled="wanted || busy || preparing || live.starting.value"
                    class="max-w-full rounded-lg border border-default bg-default p-2"
                  >
                    <option v-for="choice in PREVIEW_PROFILES" :key="choice.id" :value="choice.id">
                      {{ choice.label }}
                    </option>
                  </select>
                </div>
                <p class="leading-relaxed text-muted">
                  Keep the tested baseline for everyday use. Higher resolutions and frame rates are
                  experimental requests; Luna may ignore them. Compare measured source video with
                  camera mode and orientation fixed. Connection recovery restores the baseline.
                </p>
                <p
                  v-if="status.sourceWidth && wanted"
                  class="leading-relaxed text-muted"
                  role="status"
                >
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
              </div>
            </details>
          </section>

          <aside class="space-y-4" aria-label="Output settings and destination">
            <section class="rounded-[24px] border border-default bg-default/80 p-5">
              <div class="mb-4 flex items-center justify-between">
                <h2 class="text-sm font-semibold text-highlighted">Your webcam</h2>
                <UIcon name="i-lucide-video" class="size-5 text-violet-400" />
              </div>
              <p class="mb-3 text-xs leading-relaxed text-muted">
                Once started, select this camera in your app:
              </p>
              <button
                type="button"
                class="mb-4 flex w-full items-center justify-between gap-2 rounded-xl bg-elevated p-3 text-left text-xs focus-visible:outline-2"
                @click="copyDevice"
              >
                <span class="font-medium">{{
                  copied ? "Copied camera name" : "OBS Virtual Camera"
                }}</span>
                <UIcon
                  :name="copied ? 'i-lucide-check' : 'i-lucide-copy'"
                  class="size-3.5 shrink-0 text-muted"
                />
              </button>
              <div class="flex items-center justify-between gap-3 border-t border-default py-4">
                <label for="mirror-output" class="text-xs text-highlighted">Mirror image</label>
                <USwitch id="mirror-output" v-model="mirror" :disabled="wanted || busy" />
              </div>
              <div class="border-t border-default pt-4">
                <div class="flex items-center justify-between gap-3">
                  <label for="match-camera" class="text-xs text-highlighted"
                    >Match camera mode</label
                  >
                  <USwitch id="match-camera" v-model="matchCamera" :disabled="wanted || busy" />
                </div>
                <p class="mt-2 text-[11px] leading-relaxed text-muted">
                  {{
                    matchCamera
                      ? `Start selects the tested ${profile.cameraModeLabel} mode. Orientation stays as set on Luna.`
                      : "Use your current camera mode, color and orientation."
                  }}
                </p>
                <details v-if="matchCamera" class="mt-3 text-[11px] text-muted">
                  <summary
                    class="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4"
                  >
                    What changes on the camera?
                  </summary>
                  <p class="mt-2 leading-relaxed">
                    Switching into Slow-mo resets its color and filter to Standard. An already
                    matching mode keeps its settings. Recording never starts automatically.
                  </p>
                </details>
                <p
                  v-if="wanted && cameraMode"
                  class="mt-3 text-[11px] text-violet-500 dark:text-violet-300"
                >
                  {{ cameraMode }} verified · webcam stays on as you navigate.
                </p>
              </div>
            </section>

            <section class="rounded-[24px] border border-violet-400/20 bg-violet-500/[0.035] p-5">
              <div class="mb-2 flex items-center gap-2">
                <UIcon name="i-lucide-radio" class="size-4 text-violet-400" />
                <h2 class="text-sm font-semibold text-highlighted">Choose your destination</h2>
              </div>
              <p class="mb-4 text-xs leading-relaxed text-muted">
                Use Luna for calls, or bring its picture into OBS for a live show.
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
                    <span class="text-highlighted">1. Start webcam.</span> Keep Luna connected.
                  </li>
                  <li>
                    <span class="text-highlighted">2. Select OBS Virtual Camera</span> in your call
                    app, such as Discord, Teams or Zoom.
                  </li>
                  <li>
                    <span class="text-highlighted">3. Choose your microphone</span> separately in
                    the call app.
                  </li>
                </template>
                <template v-else>
                  <li>
                    <span class="text-highlighted">1. Start webcam in Luna.</span> Keep OBS’s own
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
                        destination === "whatnot"
                          ? "Use Whatnot Show Tools."
                          : "Set your OBS canvas."
                      }}</span
                    >
                    {{
                      destination === "whatnot"
                        ? "Connect OBS WebSocket and apply the show’s WHIP settings and 1080 × 1920 canvas. Keep the per-show token private."
                        : "Match your frame and configure the destination’s broadcast settings in OBS."
                    }}
                  </li>
                  <li>
                    <span class="text-highlighted"
                      >4.
                      {{
                        destination === "whatnot"
                          ? "Launch from Show Tools."
                          : "Start Streaming in OBS."
                      }}</span
                    >
                    {{
                      destination === "whatnot"
                        ? "After initial profile setup, restart OBS and reconnect Show Tools before starting the show."
                        : "Your destination app manages the live broadcast."
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
              <p
                class="mt-4 border-t border-violet-400/15 pt-3 text-[11px] leading-relaxed text-muted"
              >
                Webcam output stays on this computer. Going live and microphone audio are handled by
                your destination app.
              </p>
            </section>
          </aside>
        </div>

        <details class="rounded-2xl border border-default p-4 text-xs text-muted">
          <summary
            class="cursor-pointer rounded-sm font-medium text-highlighted focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            Connection &amp; diagnostics
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
                </select>
              </label>
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
                Reads known camera options without changing settings. Wi-Fi credentials and device
                identifiers are omitted.
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
                Save just after a dropout, before closing the app. Includes recovery reasons and
                works while disconnected.
              </p>
              <p class="text-[11px]">Development build {{ appVersion }} · {{ buildCommit }}</p>
              <p v-if="reportLocation" class="break-all" role="status">
                Saved to {{ reportLocation }}
              </p>
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
@media (min-width: 1180px) {
  .studio-grid {
    grid-template-columns: minmax(0, 1fr) 280px;
  }
}
@media (min-width: 1440px) {
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
    height: 4rem;
  }
}
</style>

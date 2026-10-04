<script setup lang="ts">
import { WEBCAM_PROFILES } from "~/utils/webcamProfiles";
import { openStudioHelp } from "~/utils/webcamClient";

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
const outputStyle = computed(() => ({
  aspectRatio: `${profile.value.width} / ${profile.value.height}`,
}));
const busy = computed(() => status.value.phase === "installing");
const ready = computed(() => environment.value?.runtimeReady && environment.value?.obsInstalled);
const statusLabel = computed(() => {
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
const sourceLabel = computed(() =>
  status.value.sourceWidth
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

async function openHelp(topic: "obs" | "python") {
  try {
    await openStudioHelp(topic);
  } catch (cause) {
    error.value = `Could not open setup help: ${String(cause)}`;
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
                        ? "Bringing your picture in"
                        : "Meet your next webcam"
                    }}
                  </h2>
                  <p class="max-w-sm text-sm text-white/50">
                    {{
                      camera.isConnected.value
                        ? "The preview starts as soon as the camera sends video."
                        : "Join your Luna’s Wi-Fi, then connect. Your live picture will appear here."
                    }}
                  </p>
                </div>
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
                  ? "Portrait preserves a vertical source. Photo, Pure and Video were measured vertically on your camera."
                  : "Landscape fits your source with black bars if needed. Slow-mo and Pano were measured at 720p landscape."
              }}
              {{
                profileId === "fullhd"
                  ? "1080p scales the source; camera detail stays the same."
                  : ""
              }}
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
                  {{ status.sourceFps ? `${status.sourceFps.toFixed(1)} fps` : "Measuring…" }}
                </p>
              </div>
              <div>
                <p class="text-[10px] uppercase tracking-widest text-muted">Output</p>
                <p class="mt-1 font-mono text-xs text-highlighted">{{ profile.fps }} fps</p>
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
                    ? "Output stays on while you navigate."
                    : "Your camera mode stays as you set it."
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
                        destination === "whatnot"
                          ? "Use a portrait OBS canvas"
                          : "Set your OBS canvas"
                      }}</span
                    >
                    and configure the platform’s broadcast settings in OBS.
                  </li>
                  <li>
                    <span class="text-highlighted">4. Start Streaming in OBS</span> when your
                    destination is configured.
                  </li>
                </template>
              </ol>
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

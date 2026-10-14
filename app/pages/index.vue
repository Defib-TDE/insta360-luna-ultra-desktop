<script setup lang="ts">
const { info, error, isConnected, isBusy, available, connect, disconnect } = useCamera();
const { colorway } = useCameraAppearance();

useHead({ title: "Connect" });

const celebrate = ref(0);
watch(isConnected, (connected) => {
  if (connected) celebrate.value += 1;
});
</script>

<template>
  <UDashboardPanel id="connect">
    <template #header>
      <UDashboardNavbar title="Connect">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="grid min-h-full grid-cols-1 items-center gap-6 lg:grid-cols-2">
        <div class="flex flex-col justify-center gap-6 lg:pl-6">
          <template v-if="isConnected && info">
            <div class="space-y-1.5">
              <h1 class="text-3xl font-semibold tracking-tight text-highlighted">
                {{ info.deviceName ?? "Luna Ultra" }}
              </h1>
              <p class="font-mono text-sm text-muted">{{ info.ssid ?? info.host }}</p>
              <p class="pt-2 text-sm text-muted">
                Ready for Studio. Choose your frame, then start your webcam.
              </p>
            </div>

            <div class="flex max-w-md flex-wrap items-center gap-3">
              <UButton size="xl" icon="i-lucide-radio" label="Open Studio" to="/studio" />
              <UButton
                size="xl"
                icon="i-lucide-images"
                label="Gallery"
                to="/gallery"
                color="neutral"
                variant="ghost"
              />
              <UButton
                size="xl"
                label="Disconnect"
                icon="i-lucide-unplug"
                color="neutral"
                variant="ghost"
                @click="disconnect"
              />
            </div>
            <CameraAppearance class="max-w-md" />
          </template>

          <template v-else>
            <div class="space-y-3">
              <h1 class="text-3xl font-semibold tracking-tight text-highlighted lg:text-4xl">
                Bring Luna to your desktop.
              </h1>
              <p class="max-w-md text-muted">
                Your camera for calls, live shows and everything you shot. Start with a Wi-Fi
                connection.
              </p>
            </div>

            <ol class="max-w-md space-y-3 text-sm text-muted">
              <li class="flex items-start gap-3">
                <span
                  class="flex size-6 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-xs font-medium text-violet-500 dark:text-violet-300"
                  >1</span
                >
                <span class="pt-0.5">Turn on Wi-Fi on your Luna.</span>
              </li>
              <li class="flex items-start gap-3">
                <span
                  class="flex size-6 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-xs font-medium text-violet-500 dark:text-violet-300"
                  >2</span
                >
                <span class="pt-0.5">Join Luna’s network in your computer’s Wi-Fi settings.</span>
              </li>
              <li class="flex items-start gap-3">
                <span
                  class="flex size-6 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-xs font-medium text-violet-500 dark:text-violet-300"
                  >3</span
                >
                <span class="pt-0.5">Connect below, then open Studio to set up your webcam.</span>
              </li>
            </ol>

            <UAlert
              v-if="!available"
              class="max-w-md"
              icon="i-lucide-monitor-down"
              color="warning"
              variant="subtle"
              title="Desktop app required"
              description="Connecting to the camera needs the packaged Luna Ultra desktop app."
            />

            <UAlert
              v-if="error"
              class="max-w-md"
              icon="i-lucide-triangle-alert"
              color="error"
              variant="subtle"
              :title="error"
            >
              <template #actions>
                <UButton
                  label="Open settings"
                  size="xs"
                  color="neutral"
                  variant="outline"
                  to="/settings"
                />
              </template>
            </UAlert>

            <div class="flex max-w-md flex-wrap items-center gap-3">
              <UButton
                size="xl"
                icon="i-lucide-cable"
                :label="isBusy ? 'Connecting' : 'Connect Luna'"
                :loading="isBusy"
                :disabled="!available"
                @click="connect"
              />
              <UButton
                size="xl"
                label="View downloads"
                color="neutral"
                variant="ghost"
                to="/downloads"
              />
            </div>
          </template>
        </div>

        <div class="h-48 min-h-0 lg:h-full lg:min-h-80">
          <LunaModel class="size-full" :celebrate :colorway />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>

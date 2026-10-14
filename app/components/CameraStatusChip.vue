<script setup lang="ts">
defineProps<{ collapsed?: boolean }>();

const { status, info, wantConnection } = useCamera();

const meta = computed(() => {
  if (status.value !== "connected" && wantConnection.value) {
    return {
      label: "Reconnecting",
      icon: "i-lucide-refresh-cw",
      color: "warning" as const,
      spin: true,
    };
  }
  switch (status.value) {
    case "connected":
      return { label: "Connected", icon: "i-lucide-wifi", color: "success" as const };
    case "connecting":
      return {
        label: "Connecting",
        icon: "i-lucide-loader-circle",
        color: "neutral" as const,
        spin: true,
      };
    default:
      return { label: "Offline", icon: "i-lucide-wifi-off", color: "neutral" as const };
  }
});

const tooltip = computed(() =>
  status.value !== "connected" && wantConnection.value
    ? "Reconnecting to Luna. Keep your computer on the camera’s Wi-Fi."
    : info.value
      ? (info.value.ssid ?? info.value.host)
      : "Camera not connected",
);
</script>

<template>
  <UTooltip :text="tooltip">
    <NuxtLink
      to="/settings"
      class="block rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      :class="collapsed ? '' : 'w-full'"
      :aria-label="`Camera ${meta.label.toLowerCase()}. Open settings`"
    >
      <UBadge
        :color="meta.color"
        variant="subtle"
        size="md"
        :class="collapsed ? 'px-1.5' : 'w-full justify-start'"
      >
        <UIcon
          :name="meta.icon"
          class="size-3.5 shrink-0"
          :class="meta.spin ? 'motion-safe:animate-spin' : ''"
        />
        <span v-if="!collapsed">{{ meta.label }}</span>
      </UBadge>
    </NuxtLink>
  </UTooltip>
</template>

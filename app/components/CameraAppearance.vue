<script setup lang="ts">
const { colorway } = useCameraAppearance();
const choices = [
  { value: "white", label: "Arctic White" },
  { value: "black", label: "Midnight Black" },
  { value: "auto", label: "Match app" },
] as const;
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-wrap gap-2" role="group" aria-label="Camera body color">
      <button
        v-for="choice in choices"
        :key="choice.value"
        type="button"
        class="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-4"
        :class="
          colorway === choice.value
            ? 'border-violet-400 bg-violet-400/10 text-highlighted'
            : 'border-default text-muted hover:bg-elevated'
        "
        :aria-pressed="colorway === choice.value"
        @click="colorway = choice.value"
      >
        <span
          v-if="choice.value !== 'auto'"
          class="size-3 rounded-full border border-neutral-400/40"
          :class="choice.value === 'white' ? 'bg-stone-100' : 'bg-neutral-900'"
        />
        {{ choice.label }}
      </button>
    </div>
    <p class="text-xs text-muted">
      Remembered for this camera. Body color is not reported by the current protocol.
    </p>
  </div>
</template>

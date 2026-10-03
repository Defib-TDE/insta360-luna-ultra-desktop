<script setup lang="ts">
useHead({
  title: "Luna Ultra Webcam Dev",
  titleTemplate: (chunk) =>
    chunk && chunk !== "Luna Ultra Webcam Dev"
      ? `${chunk} · Luna Ultra Webcam Dev`
      : "Luna Ultra Webcam Dev",
});
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>

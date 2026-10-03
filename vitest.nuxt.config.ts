import { defineVitestConfig } from "@nuxt/test-utils/config";

export default defineVitestConfig({
  test: {
    include: ["tests/nuxt/**/*.test.ts"],
    environment: "nuxt",
    // Cold Windows hosts can take longer than Vitest's 10s default to prepare
    // each Nuxt environment, especially while filesystem caches are empty.
    hookTimeout: 30_000,
  },
});

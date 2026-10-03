<script setup lang="ts">
useSeoMeta({
  // No `title` here: `site.name` already carries the product name and the
  // `%s | %siteName` title template appends it, so setting an identical
  // page title would otherwise be doubled in
  // both <title> and og:title. Omitting it lets the template's default
  // (siteName alone, no separator) stand for the homepage.
  description:
    "An unofficial development fork for real-feed Insta360 Luna Ultra webcam and livestream workflows.",
  // A plain static asset, not `defineOgImageComponent()` — see the long
  // comment on `ogImage` in `nuxt.config.ts` for why the satori/component
  // route (`nuxt-og-image`'s intended, dynamic path) doesn't work in this
  // install and had to be abandoned in favour of this.
  //
  // Written out fully-qualified rather than "/og.png": `nuxt-og-image`
  // normally absolutizes any relative `og:image` itself (its
  // `og-image-canonical-urls` server plugin), but that plugin is also
  // affected by the same `@unhead/vue` v2/v3 duplicate-install conflict
  // documented in `components/JsonLd.vue` and left "/og.png" unresolved in
  // the generated HTML — confirmed by inspecting the output before this
  // change. Hardcoding the full URL sidesteps that broken step entirely.
  ogImage: "https://defib-tde.github.io/insta360-luna-ultra-desktop/og.png",
});

// See `components/JsonLd.vue` for why this is hand-rolled rather than
// `useSchemaOrg()`/`defineSoftwareApp()`.
const softwareApp = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Luna Ultra Webcam Dev",
  applicationCategory: "MultimediaApplication",
  operatingSystem: "macOS, Windows, Linux",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  url: "https://defib-tde.github.io/insta360-luna-ultra-desktop",
};

/**
 * The demo section sits below the fold on a normal viewport, but the
 * iframe's own `loading="lazy"` alone isn't tight enough to prove that:
 * measured on this exact page, Chromium's lazy-load lookahead distance
 * still starts fetching /demo's entire second Nuxt app (a real, separate
 * app bundle) before first paint, purely because the section is only ~200px
 * below an 863px viewport — nowhere near scrolled to, but within the
 * browser's prefetch margin regardless. An IntersectionObserver gate is what
 * actually ties the mount to the user having scrolled, so the demo cannot
 * compete with the hero's prose for bandwidth or main-thread time during
 * the page's real first paint.
 */
const demoSectionRef = useTemplateRef("demo-section");
const showDemo = ref(false);

onMounted(() => {
  if (!demoSectionRef.value || typeof IntersectionObserver === "undefined") {
    showDemo.value = true; // no-op environments (no IO support) degrade to eager
    return;
  }
  // No `rootMargin`: the default (0px, "the element is actually visible")
  // is deliberate. A positive margin would just recreate the native
  // `loading="lazy"` lookahead this observer exists to replace.
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    showDemo.value = true;
    observer.disconnect();
  });
  observer.observe(demoSectionRef.value);
});
</script>

<template>
  <UPageHero
    title="Build a real-feed Luna Ultra webcam"
    description="An unofficial development fork targeting OBS, Teams, Zoom, and Whatnot without screen or window capture. Local testing only while licensing is unresolved."
    :links="[
      {
        label: 'Build locally',
        to: '/docs/install',
        icon: 'i-lucide-hammer',
      },
      {
        label: 'View source',
        to: 'https://github.com/Defib-TDE/insta360-luna-ultra-desktop',
        variant: 'subtle',
      },
    ]"
  />
  <UPageSection
    title="Try it right here"
    description="A live, simulated Luna Ultra loaded with sample media — no camera or download required."
  >
    <!--
      `min-h` reserves the demo's footprint (36px title bar + 520px iframe +
      my-8 margins) up front, so the section's height doesn't jump once the
      real thing mounts — the observer above only flips `showDemo` once this
      div is actually scrolled into view, and `LazyDemo` (Nuxt's
      auto-generated async wrapper) keeps the component's whole chunk, and
      therefore the iframe and the second Nuxt app it points at, out of the
      page entirely until then.
    -->
    <div ref="demo-section" class="min-h-[620px]">
      <LazyDemo v-if="showDemo" screen="gallery" preset="selection" />
    </div>
  </UPageSection>
  <JsonLd :data="softwareApp" />
</template>

/** Named requests from the protocol schema. Only baseline is hardware-tested. */
export const PREVIEW_PROFILES = [
  {
    id: "baseline",
    label: "720p · 30 fps · tested",
    width: 1280,
    height: 720,
    fps: 30,
    resolution: 9,
    experimental: false,
  },
  {
    id: "1080p30",
    label: "1080p · 30 fps · experimental",
    width: 1920,
    height: 1080,
    fps: 30,
    resolution: 29,
    experimental: true,
  },
  {
    id: "1080p60",
    label: "1080p · 60 fps · experimental",
    width: 1920,
    height: 1080,
    fps: 60,
    resolution: 40,
    experimental: true,
  },
  {
    id: "4k30",
    label: "4K · 30 fps · experimental",
    width: 3840,
    height: 2160,
    fps: 30,
    resolution: 24,
    experimental: true,
  },
  {
    id: "4k60",
    label: "4K · 60 fps · experimental",
    width: 3840,
    height: 2160,
    fps: 60,
    resolution: 23,
    experimental: true,
  },
] as const;

export type PreviewProfileId = (typeof PREVIEW_PROFILES)[number]["id"];
export function previewProfile(id: string) {
  return PREVIEW_PROFILES.find((profile) => profile.id === id) ?? PREVIEW_PROFILES[0];
}

export function previewVerdict(
  id: PreviewProfileId,
  width: number | null,
  height: number | null,
  fps: number | null,
) {
  if (!width || !height || !fps) return "Measuring delivered source…";
  const requested = previewProfile(id);
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  if (longEdge !== requested.width || shortEdge !== requested.height)
    return "Camera delivered a different resolution. This request is not verified.";
  if (Math.abs(fps - requested.fps) > requested.fps * 0.1)
    return "Decoded cadence differs from the request. This profile is not verified on this PC.";
  return "Delivered dimensions and measured cadence match. Sustained reliability still needs testing.";
}

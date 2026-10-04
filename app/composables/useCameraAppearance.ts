type BodyColor = "white" | "black" | "auto";
const KEY = "luna-camera-appearances";

export function useCameraAppearance() {
  const { info, host } = useCamera();
  const choices = useState<Record<string, BodyColor>>("camera-appearances", () => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
      return Object.fromEntries(
        Object.entries(saved).filter(([, color]) => ["white", "black", "auto"].includes(color)),
      );
    } catch {
      return {};
    }
  });
  const cameraKey = computed(() => info.value?.serial ?? info.value?.host ?? host.value);
  const colorway = computed<BodyColor>({
    get: () => choices.value[cameraKey.value] ?? "auto",
    set: (value) => {
      choices.value = { ...choices.value, [cameraKey.value]: value };
      try {
        localStorage.setItem(KEY, JSON.stringify(choices.value));
      } catch {
        /* Storage may be disabled. */
      }
    },
  });
  return { colorway };
}

<script setup lang="ts">
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/**
 * Official Insta360 Luna Ultra scan dropped into public/.
 * Root-relative in the desktop app; base-prefixed wherever the app is served
 * under a subpath. Resolved at call time rather than module-eval time so it
 * always reflects the current runtime config.
 */
function stlUrl(): string {
  return `${useRuntimeConfig().app.baseURL}Insta360+LunaUltra.stl`;
}

/** Optional textured glTF at public/models/luna-ultra.glb, same base-path rules. */
function gltfFallbackUrl(): string {
  return `${useRuntimeConfig().app.baseURL}models/luna-ultra.glb`;
}

const {
  colorway = "auto",
  autoRotate = true,
  interactive = true,
  celebrate = 0,
} = defineProps<{
  /** Model colorway; "auto" follows the app color mode */
  colorway?: "black" | "white" | "auto";
  autoRotate?: boolean;
  interactive?: boolean;
  /** Increment to play a one-shot spin celebration (e.g. on camera connect) */
  celebrate?: number;
}>();

const emit = defineEmits<{ ready: [source: "gltf" | "stl" | "fallback"] }>();

const container = useTemplateRef<HTMLDivElement>("container");
const loading = ref(true);
const colorMode = useColorMode();

const resolvedColorway = computed<"black" | "white">(() => {
  if (colorway !== "auto") return colorway;
  return colorMode.value === "dark" ? "black" : "white";
});

let renderer: THREE.WebGLRenderer | null = null;
let controls: OrbitControls | null = null;
let frame = 0;
let disposeScene: (() => void) | null = null;
let disposed = false;
let bodyMaterial: THREE.MeshStandardMaterial | null = null;
let observer: ResizeObserver | null = null;
let spinStart: number | null = null;
/** Draw only while visible and moving; stationary scenes redraw on changes. */
let onScreen = true;
let looping = false;
let visibility: IntersectionObserver | null = null;
let startLoop: (() => void) | null = null;
let stopLoop: (() => void) | null = null;
const onVisibilityChange = () => (document.hidden ? stopLoop?.() : startLoop?.());

const BODY_COLORS = {
  black: { color: 0x161616, roughness: 0.38, metalness: 0.45 },
  white: { color: 0xf1f0ee, roughness: 0.55, metalness: 0.08 },
} as const;

function buildFallbackModel(): THREE.Group {
  const group = new THREE.Group();
  const spec = BODY_COLORS[resolvedColorway.value];
  bodyMaterial = new THREE.MeshStandardMaterial(spec);
  const glass = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.04, metalness: 1 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.3, metalness: 0.8 });

  // Candy-bar 360 body with twin bulging lenses, screen and shutter button
  const body = new THREE.Mesh(new RoundedBoxGeometry(1, 2.3, 0.62, 6, 0.18), bodyMaterial);
  group.add(body);

  for (const side of [1, -1]) {
    const bulge = new THREE.Mesh(new THREE.SphereGeometry(0.34, 48, 48), glass);
    bulge.position.set(0, 0.72, side * 0.24);
    bulge.scale.set(1, 1, 0.9);
    group.add(bulge);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 24, 64), trim);
    ring.position.set(0, 0.72, side * 0.34);
    group.add(ring);
  }

  const screen = new THREE.Mesh(
    new RoundedBoxGeometry(0.74, 1.05, 0.03, 4, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.2, metalness: 0.1 }),
  );
  screen.position.set(0, -0.45, 0.33);
  group.add(screen);

  const shutter = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 32), trim);
  shutter.rotation.x = Math.PI / 2;
  shutter.position.set(0, -1.18, 0.18);
  group.add(shutter);

  return group;
}

function applyColorway() {
  if (bodyMaterial) {
    const spec = BODY_COLORS[resolvedColorway.value];
    bodyMaterial.color.setHex(spec.color);
    bodyMaterial.roughness = spec.roughness;
    bodyMaterial.metalness = spec.metalness;
    startLoop?.();
  }
}

function disposeModel(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}

onMounted(async () => {
  const el = container.value;
  if (!el) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
  camera.position.set(2.1, 0.6, 3.2);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  el.appendChild(renderer.domElement);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  room.dispose();
  pmrem.dispose();

  // Navigation can unmount while the large scan is still downloading. Own the
  // environment immediately, then release any late loader result separately.
  disposeScene = () => {
    disposeModel(scene);
    scene.clear();
    scene.environment = null;
    environment.dispose();
  };

  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(3, 4, 2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.7);
  rim.position.set(-3, 1, -3);
  scene.add(rim);

  function fitToView(model: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const fit = 2.4 / Math.max(size.x, size.y, size.z);
    model.scale.setScalar(fit);
    model.position.sub(center.multiplyScalar(fit));
    model.userData.fitScale = fit;
  }

  let model: THREE.Object3D;
  try {
    // The official hi-fi scan (binary STL, geometry only) with the colorway material
    const geometry = await new STLLoader().loadAsync(stlUrl());
    if (disposed) {
      geometry.dispose();
      return;
    }
    geometry.rotateX(-Math.PI / 2);
    bodyMaterial = new THREE.MeshStandardMaterial(BODY_COLORS[resolvedColorway.value]);
    model = new THREE.Mesh(geometry, bodyMaterial);
    fitToView(model);
    emit("ready", "stl");
  } catch {
    if (disposed) return;
    try {
      // Optional textured glTF at public/models/luna-ultra.glb takes this path
      const gltf = await new GLTFLoader().loadAsync(gltfFallbackUrl());
      if (disposed) {
        disposeModel(gltf.scene);
        return;
      }
      model = gltf.scene;
      fitToView(model);
      emit("ready", "gltf");
    } catch {
      if (disposed) return;
      model = buildFallbackModel();
      emit("ready", "fallback");
    }
  }
  loading.value = false;
  scene.add(model);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.enabled = interactive;
  controls.minDistance = 2;
  controls.maxDistance = 6;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  controls.autoRotate = autoRotate && !reducedMotion;
  controls.autoRotateSpeed = 1.6;

  const host: HTMLDivElement = el;
  function resize() {
    if (!renderer) return;
    const { clientWidth, clientHeight } = host;
    if (clientWidth === 0 || clientHeight === 0) return;
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(clientWidth, clientHeight);
    startLoop?.();
  }
  observer = new ResizeObserver(resize);
  observer.observe(el);
  resize();

  const baseAutoRotateSpeed = controls.autoRotateSpeed;
  function animate() {
    if (!looping) return;
    if (controls && spinStart !== null) {
      // Celebration: briefly boost the orbit auto-rotation and let it decay,
      // so the spin blends into the idle motion with no snapping
      const t = (performance.now() - spinStart) / 1800;
      if (t >= 1) {
        spinStart = null;
        controls.autoRotate = autoRotate && !reducedMotion;
        controls.autoRotateSpeed = baseAutoRotateSpeed;
      } else {
        controls.autoRotate = true;
        controls.autoRotateSpeed = baseAutoRotateSpeed + 110 * Math.pow(1 - t, 2.4);
      }
    }
    const moving = controls?.update();
    renderer?.render(scene, camera);
    if (controls?.autoRotate || moving) frame = requestAnimationFrame(animate);
    else looping = false;
  }
  // The model auto-rotates forever, so without gating this draws every frame
  // for as long as the page is mounted — including while it sits scrolled out
  // of view in the stacked layout, or behind another window.
  function start() {
    if (disposed || looping || !onScreen || document.hidden) return;
    looping = true;
    animate();
  }
  function stop() {
    looping = false;
    cancelAnimationFrame(frame);
  }
  startLoop = start;
  stopLoop = stop;
  controls.addEventListener("change", start);

  visibility = new IntersectionObserver((entries) => {
    onScreen = entries.some((entry) => entry.isIntersecting);
    if (onScreen) start();
    else stop();
  });
  visibility.observe(el);
  document.addEventListener("visibilitychange", onVisibilityChange);
  start();
});

watch(resolvedColorway, applyColorway);

watch(
  () => celebrate,
  (next, prev) => {
    if (next > (prev ?? 0) && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      spinStart = performance.now();
      startLoop?.();
    }
  },
);

onBeforeUnmount(() => {
  disposed = true;
  looping = false;
  cancelAnimationFrame(frame);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  visibility?.disconnect();
  observer?.disconnect();
  controls?.dispose();
  controls = null;
  disposeScene?.();
  disposeScene = null;
  bodyMaterial = null;
  startLoop = null;
  stopLoop = null;
  renderer?.dispose();
  renderer?.domElement.remove();
  renderer = null;
});
</script>

<template>
  <div class="relative size-full">
    <div ref="container" class="size-full" />
    <div v-if="loading" class="absolute inset-0 flex items-center justify-center">
      <div class="flex items-center gap-2 text-sm text-muted">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
        Loading model
      </div>
    </div>
  </div>
</template>

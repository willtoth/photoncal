<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Session } from '../core/types';
import { currentResult } from '../core/types';
import { boardPoint, scenePoint, frustumPoints, type Point3 } from '../core/sceneGeometry';
const props = defineProps<{ session: Session }>();
const emit = defineEmits<{ inspect: [string] }>();
const host = ref<HTMLDivElement>(),
  canvas = ref<HTMLCanvasElement>();
const error = ref(''),
  selected = ref(''),
  showFrustum = ref(true),
  ready = ref(false);
const result = computed(() => currentResult(props.session));
const views = computed(() => result.value?.views ?? []);
const chosen = computed(() => views.value.find((v) => v.id === selected.value));
const frameName = (id: string) => props.session.frames.find((f) => f.id === id)?.name ?? id;
let renderer: T.WebGLRenderer | undefined, controls: OrbitControls | undefined;
let observer: ResizeObserver | undefined;
const scene = new T.Scene();
scene.background = new T.Color('#102027');
const camera = new T.PerspectiveCamera(50, 1, 0.001, 1000);
const content = new T.Group();
scene.add(content);
const center = new T.Vector3();
let radius = 1;
function render() {
  if (renderer && !error.value) renderer.render(scene, camera);
}
function clear() {
  content.traverse((obj) => {
    const drawable = obj as T.Mesh;
    drawable.geometry?.dispose();
    const materials = drawable.material
      ? Array.isArray(drawable.material)
        ? drawable.material
        : [drawable.material]
      : [];
    materials.forEach((m) => m.dispose());
  });
  content.clear();
}
function lines(points: Point3[], color: number, opacity = 1) {
  const geometry = new T.BufferGeometry().setFromPoints(points.map((p) => new T.Vector3(...p)));
  const line = new T.LineSegments(
    geometry,
    new T.LineBasicMaterial({ color, transparent: opacity < 1, opacity }),
  );
  content.add(line);
}
function points(positions: Point3[], color: number, size: number) {
  if (!positions.length) return;
  content.add(
    new T.Points(
      new T.BufferGeometry().setFromPoints(positions.map((p) => new T.Vector3(...p))),
      new T.PointsMaterial({ color, size, sizeAttenuation: false }),
    ),
  );
}
function overview() {
  if (!controls) return;
  camera.fov = 50;
  const halfAngle = Math.atan(Math.tan(T.MathUtils.degToRad(25)) * Math.min(camera.aspect, 1));
  const distance = (radius / Math.sin(halfAngle)) * 1.15;
  camera.position
    .copy(center)
    .add(new T.Vector3(-0.7, 0.45, 1).normalize().multiplyScalar(distance));
  controls.target.copy(center);
  camera.near = Math.max(radius / 10000, 0.00001);
  camera.far = Math.max(distance * 20, 10);
  camera.updateProjectionMatrix();
  controls.update();
  render();
}
function cameraView() {
  if (!controls || !result.value) return;
  camera.position.set(0, 0, 0);
  const rays = result.value.modelGeometry?.boundaryRays;
  const top = rays?.[8],
    bottom = rays?.[40];
  const vertical =
    top && bottom
      ? Math.acos(
          Math.max(
            -1,
            Math.min(
              1,
              top.reduce((sum, v, i) => sum + v * bottom[i]!, 0),
            ),
          ),
        )
      : 2 * Math.atan(props.session.height / (2 * result.value.intrinsics[1]!));
  // The orbit renderer is perspective; cap its overview FOV while drawing the actual lens rays.
  camera.fov = Math.max(10, Math.min(160, T.MathUtils.radToDeg(vertical)));
  controls.target.set(0, 0, -Math.max(radius, 0.1));
  camera.updateProjectionMatrix();
  controls.update();
  render();
}
function zoom(factor: number) {
  if (!controls) return;
  camera.position.sub(controls.target).multiplyScalar(factor).add(controls.target);
  controls.update();
  render();
}
function rebuild(reset = false) {
  clear();
  const r = result.value;
  if (!r || !renderer) {
    render();
    return;
  }
  const bounds = new T.Box3().expandByPoint(new T.Vector3());
  const accepted: Point3[] = [],
    rejected: Point3[] = [];
  r.views.forEach((view, i) => {
    const pose = r.poses[i];
    if (!pose || pose.length !== 6 || !pose.every(Number.isFinite)) return;
    const world = (id: number) => scenePoint(boardPoint(props.session.board, id, r.warp), pose);
    view.residuals.forEach((corner) => {
      const p = world(corner.id);
      bounds.expandByPoint(new T.Vector3(...p));
      if (!selected.value || selected.value === view.id)
        (corner.used ? accepted : rejected).push(p);
    });
    const cols = props.session.board.columns - 1,
      rows = props.session.board.rows - 1;
    const ids = [0, cols - 1, cols * rows - 1, cols * (rows - 1)];
    lines(
      ids.flatMap((id, j) => [world(id), world(ids[(j + 1) % 4]!)]),
      selected.value === view.id ? 0xffce72 : 0x86acb0,
      selected.value && selected.value !== view.id ? 0.12 : 0.5,
    );
  });
  bounds.getCenter(center);
  radius = Math.max(bounds.getSize(new T.Vector3()).length() / 2, 0.05);
  points(accepted, 0x66e6af, selected.value ? 6 : 3);
  points(rejected, 0xff6767, selected.value ? 8 : 5);
  const depth = Math.max(-center.z, radius / 2);
  if (showFrustum.value) {
    const rays = r.modelGeometry?.boundaryRays;
    const corners: (Point3 | null)[] = rays
      ? rays.map((p) => (p ? ([p[0] * depth, -p[1] * depth, -p[2] * depth] as Point3) : null))
      : frustumPoints(r.intrinsics, props.session.width, props.session.height, depth);
    lines(
      corners.flatMap((p, i) => {
        const next = corners[(i + 1) % corners.length];
        if (!p || !next) return [];
        return i % (rays ? 16 : 1) === 0 ? [[0, 0, 0] as Point3, p, p, next] : [p, next];
      }),
      0xe4b969,
      0.7,
    );
  }
  const axis = Math.max(radius * 0.2, 0.02);
  lines(
    [
      [0, 0, 0],
      [axis, 0, 0],
    ],
    0xf47878,
  );
  lines(
    [
      [0, 0, 0],
      [0, -axis, 0],
    ],
    0x66e6af,
  );
  lines(
    [
      [0, 0, 0],
      [0, 0, -axis],
    ],
    0x70b6ff,
  );
  const body = new T.Mesh(
    new T.BoxGeometry(axis * 0.35, axis * 0.25, axis * 0.2),
    new T.MeshBasicMaterial({ color: 0xc5d5dd, wireframe: true }),
  );
  body.position.z = axis * 0.1;
  content.add(body);
  if (reset) overview();
  else render();
}
function resize() {
  if (!host.value || !renderer) return;
  const { width, height } = host.value.getBoundingClientRect();
  if (width <= 0 || height <= 0) return;
  renderer.setSize(Math.max(width, 1), Math.max(height, 1), false);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
  render();
}
function contextLost(event: Event) {
  event.preventDefault();
  error.value = 'The 3D graphics context was lost. Reload the page to restore this view.';
}
onMounted(() => {
  try {
    renderer = new T.WebGLRenderer({ canvas: canvas.value, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    controls = new OrbitControls(camera, canvas.value!);
    controls.addEventListener('change', render);
    controls.listenToKeyEvents(canvas.value!);
    observer = new ResizeObserver(resize);
    observer.observe(host.value!);
    canvas.value!.addEventListener('webglcontextlost', contextLost);
    resize();
    rebuild(true);
    ready.value = true;
  } catch {
    error.value =
      '3D rendering is unavailable in this browser. Calibration results and exports are still available.';
  }
});
watch(result, () => {
  selected.value = '';
  rebuild(true);
});
watch([selected, showFrustum], () => rebuild());
onBeforeUnmount(() => {
  observer?.disconnect();
  controls?.dispose();
  clear();
  renderer?.dispose();
  canvas.value?.removeEventListener('webglcontextlost', contextLost);
});
</script>
<template>
  <section class="panel calibration-scene">
    <div class="panel-heading">
      <h3>3D calibration views</h3>
      <span class="small muted">{{ views.length }} solved poses</span>
    </div>
    <p v-if="!result" class="small muted">
      Recalibrate to show poses for the current images and target settings.
    </p>
    <div v-show="result">
      <div class="scene-toolbar">
        <label
          >Capture<select v-model="selected" aria-label="3D capture">
            <option value="">All captures</option>
            <option v-for="(view, i) in views" :key="view.id" :value="view.id">
              {{ i + 1 }} · {{ frameName(view.id) }}
            </option>
          </select></label
        >
        <button class="button small-button" :disabled="!ready || !!error" @click="overview">
          Reset 3D view
        </button>
        <button class="button small-button" :disabled="!ready || !!error" @click="cameraView">
          Camera view
        </button>
        <button
          class="button small-button"
          :disabled="!ready || !!error"
          aria-label="Zoom in 3D"
          @click="zoom(0.8)"
        >
          +
        </button>
        <button
          class="button small-button"
          :disabled="!ready || !!error"
          aria-label="Zoom out 3D"
          @click="zoom(1.25)"
        >
          −
        </button>
        <button
          class="button small-button"
          :disabled="!selected"
          @click="emit('inspect', selected)"
        >
          Inspect selected image
        </button>
        <label class="check-label"
          ><input v-model="showFrustum" type="checkbox" />Camera frustum</label
        >
      </div>
      <div ref="host" class="scene-viewport">
        <canvas
          ref="canvas"
          tabindex="0"
          aria-label="Interactive 3D calibration scene"
          aria-describedby="scene-instructions"
        />
        <p v-if="error" class="scene-error" role="status">{{ error }}</p>
      </div>
      <p v-if="chosen" class="small">
        {{ frameName(chosen.id) }} · RMS {{ chosen.rms.toFixed(3) }} px ·
        {{ chosen.inliers }} accepted / {{ chosen.outliers }} rejected corners
      </p>
      <p id="scene-instructions" class="small muted">
        Drag to orbit · scroll or pinch to zoom · right-drag or arrow keys to pan. Green: accepted
        corners. Red: rejected corners.
      </p>
      <p class="small muted">
        Camera at the origin. Axes: red X right, green Y down, blue Z forward. Coordinates in
        meters. Outlines connect the outer calibration corners; frustum uses calibrated boundary
        rays (legacy sessions use a pinhole approximation) without lens distortion.
      </p>
    </div>
  </section>
</template>
<style scoped>
.scene-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: end;
  margin-bottom: 12px;
}
.scene-toolbar > label:first-child {
  flex: 1 1 220px;
  min-width: 0;
}
.scene-toolbar .check-label {
  margin: 0;
  padding: 8px;
}
.scene-viewport {
  height: clamp(280px, 48vh, 500px);
  position: relative;
  background: #102027;
  border-radius: 8px;
  overflow: hidden;
}
.scene-viewport canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}
.scene-error {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  padding: 24px;
  color: #e2ece7;
}
</style>

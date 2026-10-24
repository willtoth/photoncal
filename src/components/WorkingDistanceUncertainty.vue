<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import type { Session, Grid } from '../core/types';
import { currentResult, solveRequest } from '../core/types';
import { EngineClient } from '../core/engine';
import { percentile } from '../core/residualStats';
import DiagnosticPlot from './DiagnosticPlot.vue';
const props = defineProps<{ session: Session; working: boolean }>();
const engine = new EngineClient();
const mode = ref('infinity'),
  distance = ref(3),
  colorMax = ref(0.5),
  busy = ref(false),
  error = ref(''),
  progress = ref('');
const result = computed(() => currentResult(props.session));
const finite = ref<{ distance: number; grid: Grid }>(),
  curve = ref<{ distance: number; grid: Grid }[]>([]),
  asymptote = ref<Grid>();
const ray = ref(4);
const rays = [
  'Top left',
  'Top center',
  'Top right',
  'Left center',
  'Center',
  'Right center',
  'Bottom left',
  'Bottom center',
  'Bottom right',
];
const grid = computed(() =>
  mode.value === 'infinity' ? result.value?.uncertainty : finite.value?.grid,
);
const values = computed(
  () => grid.value?.values.filter((v): v is number => v !== null && Number.isFinite(v)) ?? [],
);
const stats = computed(() => ({
  median: percentile(values.value, 0.5),
  p95: percentile(values.value, 0.95),
  max: values.value.length ? Math.max(...values.value) : undefined,
}));
let generation = 0;
function cancel() {
  generation++;
  engine.cancel();
  busy.value = false;
  progress.value = '';
}
watch(result, () => {
  cancel();
  finite.value = undefined;
  curve.value = [];
  asymptote.value = undefined;
  error.value = '';
});
onBeforeUnmount(cancel);
async function calculate(curveOnly = false) {
  if (!result.value || busy.value || props.working) return;
  if (
    !curveOnly &&
    (!Number.isFinite(distance.value) || distance.value < 0.05 || distance.value > 1000)
  ) {
    error.value = 'Enter a distance from 0.05 to 1000 meters.';
    return;
  }
  const job = ++generation,
    snapshot = JSON.parse(JSON.stringify({ ...solveRequest(props.session), result: result.value }));
  busy.value = true;
  error.value = '';
  try {
    if (curveOnly) {
      const next: { distance: number; grid: Grid }[] = [];
      for (const d of [0.25, 0.5, 1, 2, 5, 10, 20, 50]) {
        progress.value = `Computing curve at ${d} m…`;
        const g = await engine.call<Grid>('uncertainty', {
          ...snapshot,
          distance: d,
          gridWidth: 3,
          gridHeight: 3,
        });
        if (job !== generation) return;
        next.push({ distance: d, grid: g });
      }
      const infinity = await engine.call<Grid>('uncertainty', {
        ...snapshot,
        gridWidth: 3,
        gridHeight: 3,
      });
      if (job !== generation) return;
      curve.value = next;
      asymptote.value = infinity;
    } else {
      const d = distance.value;
      progress.value = `Computing uncertainty at ${d} m…`;
      const next = await engine.call<Grid>('uncertainty', {
        ...snapshot,
        distance: d,
        gridWidth: 60,
        gridHeight: 40,
      });
      if (job !== generation) return;
      finite.value = { distance: d, grid: next };
    }
  } catch (e) {
    if (job === generation) error.value = (e as Error).message;
  } finally {
    if (job === generation) {
      busy.value = false;
      progress.value = '';
      engine.cancel();
    }
  }
}
const curveValues = computed(() =>
  curve.value.map((v) => ({ distance: v.distance, value: v.grid.values[ray.value] })),
);
const infinityValue = computed(() => asymptote.value?.values[ray.value]);
const yMax = computed(
  () =>
    Math.max(0.001, ...curveValues.value.map((v) => v.value ?? 0), infinityValue.value ?? 0) * 1.1,
);
const x = (d: number) => 50 + (Math.log(d / 0.25) / Math.log(50 / 0.25)) * 500;
const y = (v: number) => 210 - (v / yMax.value) * 180;
const segments = computed(() => {
  const paths: string[] = [];
  let p = '';
  for (const v of curveValues.value) {
    if (v.value == null) {
      if (p) paths.push(p);
      p = '';
    } else p += `${p ? ' L' : 'M'} ${x(v.distance)} ${y(v.value)}`;
  }
  if (p) paths.push(p);
  return paths;
});
</script>
<template>
  <section class="panel working-distance">
    <h3>Uncertainty at working distance</h3>
    <div class="diagnostic-controls">
      <label
        >Evaluation distance<select v-model="mode">
          <option value="infinity">Infinity</option>
          <option value="finite">Working distance</option>
        </select></label
      >
      <label v-if="mode === 'finite'"
        >Range along viewing ray · m<input
          v-model.number="distance"
          type="number"
          min="0.05"
          max="1000"
          step="0.25"
      /></label>
      <button
        v-if="mode === 'finite'"
        class="button"
        :disabled="busy || working"
        @click="calculate()"
      >
        Compute distance map
      </button>
      <label
        >Uncertainty color scale · px<input
          v-model.number="colorMax"
          type="number"
          min="0.001"
          step="0.1"
      /></label>
    </div>
    <p v-if="busy" role="status" class="small">
      {{ progress }}
      <button class="text-button" @click="cancel">Cancel uncertainty calculation</button>
    </p>
    <p v-if="error" role="alert" class="error-text">{{ error }}</p>
    <template v-if="grid">
      <p class="small">
        Showing {{ mode === 'infinity' ? 'infinity' : `${finite!.distance} m` }} · spatial median
        {{ stats.median?.toFixed(3) ?? '—' }} px · p95 {{ stats.p95?.toFixed(3) ?? '—' }} px ·
        maximum {{ stats.max?.toFixed(3) ?? '—' }} px.
      </p>
      <DiagnosticPlot
        :grid="grid"
        :width="session.width"
        :height="session.height"
        :scale-max="Math.max(0.001, colorMax || 0.5)"
      />
    </template>
    <p v-else class="small muted">Choose a working distance and compute its uncertainty map.</p>
    <p class="small muted">
      Values are worst-direction predicted sampling standard deviations in pixels. The p95 is across
      image locations, not a 95% confidence bound. Distance is range from the camera along each
      viewing ray, not optical-axis depth. The fixed color scale lets you compare distances.
    </p>
    <div class="diagnostic-controls">
      <label
        >Curve location<select v-model.number="ray">
          <option v-for="(name, i) in rays" :value="i" :key="i">{{ name }}</option>
        </select></label
      ><button class="button" :disabled="busy || working" @click="calculate(true)">
        Compute uncertainty curve
      </button>
    </div>
    <template v-if="curve.length">
      <svg
        class="distance-curve"
        viewBox="0 0 600 260"
        role="img"
        aria-label="Projection uncertainty versus viewing distance"
      >
        <path d="M50 25 V210 H560" fill="none" stroke="#889a90" />
        <text x="50" y="16" fill="currentColor">{{ yMax.toFixed(3) }} px</text>
        <text x="12" y="214" fill="currentColor">0</text>
        <g v-for="d in [0.25, 1, 5, 20, 50]" :key="d">
          <line :x1="x(d)" y1="210" :x2="x(d)" y2="217" stroke="#889a90" />
          <text :x="x(d)" y="234" text-anchor="middle" fill="currentColor">{{ d }}</text>
        </g>
        <text x="300" y="255" text-anchor="middle" fill="currentColor">
          Range · meters (log scale)
        </text>
        <line
          v-if="infinityValue != null"
          x1="50"
          x2="550"
          :y1="y(infinityValue)"
          :y2="y(infinityValue)"
          stroke="#b58334"
          stroke-dasharray="6 4"
        />
        <path
          v-for="(segment, i) in segments"
          :key="i"
          :d="segment"
          fill="none"
          stroke="#167257"
          stroke-width="3"
        />
        <template v-for="v in curveValues" :key="v.distance">
          <circle v-if="v.value != null" :cx="x(v.distance)" :cy="y(v.value)" r="4" fill="#167257">
            <title>{{ v.distance }} m: {{ v.value.toFixed(4) }} px</title>
          </circle>
        </template>
      </svg>
      <p class="small">
        {{ rays[ray] }} · dashed line: infinity {{ infinityValue?.toFixed(4) ?? 'unavailable' }} px.
      </p>
      <details>
        <summary>Curve values</summary>
        <table>
          <thead>
            <tr>
              <th>Range · m</th>
              <th>Standard deviation · px</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in curveValues" :key="v.distance">
              <td>{{ v.distance }}</td>
              <td>{{ v.value?.toFixed(4) ?? 'Unavailable' }}</td>
            </tr>
          </tbody>
        </table>
      </details>
    </template>
    <p class="small muted">
      Computed with finite-distance mean-pcam propagation, including uncertainty in board rotations
      and translations. This models corner-detection noise; it does not bound systematic lens/target
      errors or predict robot positioning accuracy.
    </p>
  </section>
</template>
<style scoped>
.distance-curve {
  display: block;
  width: 100%;
  margin-top: 16px;
  font-size: 13px;
}
table {
  border-collapse: collapse;
}
th,
td {
  padding: 6px 20px 6px 0;
  text-align: left;
}
</style>

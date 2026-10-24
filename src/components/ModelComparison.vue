<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import type { Session, Grid } from '../core/types';
import { solveRequest } from '../core/types';
import { savedFits, modelName, OPENCV8, DEFAULT_SPLINE } from '../core/lensModel';
import { EngineClient } from '../core/engine';
import { percentile, regionalResiduals } from '../core/residualStats';
import { getImage } from '../core/storage';
import DiagnosticPlot from './DiagnosticPlot.vue';
import ResidualOverlay from './ResidualOverlay.vue';
const props = defineProps<{ session: Session; working: boolean }>();
const fits = computed(() => savedFits(props.session));
const spline = computed(() =>
  fits.value.find((r) => r.lensModel === (props.session.splineModel ?? DEFAULT_SPLINE)),
);
const pair = computed(() =>
  [fits.value.find((r) => (r.lensModel ?? OPENCV8) === OPENCV8), spline.value].filter((r) => !!r),
);
const ready = computed(() => pair.value.length === 2);
const uncertaintyScale = ref(1),
  differenceScale = ref(1);
const scale = ref(1),
  arrowScale = ref(25),
  selected = ref(''),
  rejected = ref(true),
  url = ref(''),
  error = ref('');
const regional = ref<'mean' | 'spread' | 'count' | 'rejection'>('mean');
const distance = ref(3),
  atInfinity = ref(true),
  busy = ref(false),
  progress = ref('');
const maps = ref<Grid[]>([]),
  mapDistance = ref<number>();
const difference = ref<Grid & { mean: number; p95: number }>();
const engine = new EngineClient();
let job = 0,
  imageJob = 0;
const views = computed(() => pair.value[0]?.views ?? []);
const selectedViews = computed(() =>
  pair.value.map((r) => r.views.find((v) => v.id === selected.value)),
);
const displayedMaps = computed(() =>
  atInfinity.value ? pair.value.map((r) => r.uncertainty) : maps.value,
);
const regionGrids = computed(() =>
  pair.value.map((r) => ({
    width: 8,
    height: 6,
    values: regionalResiduals(r.views, props.session.width, props.session.height).map(
      (c) => c[regional.value],
    ),
  })),
);
const regionScale = computed(() =>
  regional.value === 'rejection'
    ? 100
    : regional.value === 'count'
      ? Math.max(
          1,
          ...regionGrids.value.flatMap((g) => g.values.filter((v): v is number => v !== null)),
        )
      : Math.max(0.001, scale.value || 1),
);
const p95 = (g?: Grid) =>
  percentile(g?.values.filter((v): v is number => v !== null) ?? [], 0.95)?.toFixed(3) ?? '—';
function cancel() {
  job++;
  engine.cancel();
  busy.value = false;
  progress.value = '';
}
watch(
  pair,
  () => {
    cancel();
    difference.value = undefined;
    maps.value = [];
    uncertaintyScale.value = Math.max(
      0.01,
      ...pair.value.map((r) => Number(p95(r.uncertainty)) || 1),
    );
  },
  { immediate: true },
);
watch(
  views,
  (v) => {
    if (!v.some((v) => v.id === selected.value)) selected.value = v[0]?.id ?? '';
  },
  { immediate: true },
);
watch(
  [() => props.session.id, selected],
  async () => {
    const n = ++imageJob;
    if (url.value) URL.revokeObjectURL(url.value);
    url.value = '';
    if (!selected.value) return;
    try {
      const b = await getImage(props.session.id, selected.value);
      if (n === imageJob && b) url.value = URL.createObjectURL(b);
    } catch (e) {
      if (n === imageJob) error.value = (e as Error).message;
    }
  },
  { immediate: true },
);
async function compute(kind: 'difference' | 'distance') {
  if (!ready.value || busy.value || props.working) return;
  if (
    kind === 'distance' &&
    (!Number.isFinite(distance.value) || distance.value < 0.05 || distance.value > 1000)
  ) {
    error.value = 'Range must be 0.05–1000 meters.';
    return;
  }
  const n = ++job;
  busy.value = true;
  error.value = '';
  const snapshot = JSON.parse(
    JSON.stringify({ request: solveRequest(props.session), pair: pair.value }),
  );
  try {
    if (kind === 'difference') {
      progress.value = 'Comparing aligned projections…';
      const d = await engine.call<Grid & { mean: number; p95: number }>('compare', {
        width: props.session.width,
        height: props.session.height,
        a: snapshot.pair[0],
        b: snapshot.pair[1],
      });
      if (n === job) {
        difference.value = d;
        differenceScale.value = Math.max(0.01, d.p95);
      }
    } else {
      const d = distance.value,
        next: Grid[] = [];
      for (const r of snapshot.pair) {
        progress.value = `Computing ${modelName(r.lensModel)} at ${d} m…`;
        next.push(
          await engine.call<Grid>('uncertainty', { ...snapshot.request, result: r, distance: d }),
        );
        if (n !== job) return;
      }
      maps.value = next;
      mapDistance.value = d;
    }
  } catch (e) {
    if (n === job) error.value = (e as Error).message;
  } finally {
    if (n === job) {
      busy.value = false;
      progress.value = '';
      engine.cancel();
    }
  }
}
onBeforeUnmount(() => {
  cancel();
  imageJob++;
  if (url.value) URL.revokeObjectURL(url.value);
});
</script>
<template>
  <section class="model-comparison panel">
    <h3>Compare lens models</h3>
    <p v-if="!ready" class="small">
      Fit both models on the current image selection to compare them.
    </p>
    <template v-else>
      <p class="small muted">
        Both fits use the same captured dataset. Each fit can reject different corners. Compare
        residual structure and independent-subset agreement; lower training RMS alone does not
        establish accuracy.
      </p>
      <div class="comparison-table">
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th v-for="r in pair" :key="r.lensModel">{{ modelName(r.lensModel) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Parameters</th>
              <td v-for="r in pair" :key="r.lensModel">{{ r.intrinsics.length }}</td>
            </tr>
            <tr>
              <th>Accepted-corner RMS · px</th>
              <td v-for="r in pair" :key="r.lensModel">{{ r.rms.toFixed(3) }}</td>
            </tr>
            <tr>
              <th>Rejected corners</th>
              <td v-for="r in pair" :key="r.lensModel">{{ r.outliers }}</td>
            </tr>
            <tr>
              <th>Infinity uncertainty · spatial p95 · px</th>
              <td v-for="r in pair" :key="r.lensModel">{{ p95(r.uncertainty) }}</td>
            </tr>
            <tr>
              <th>Subset difference · spatial p95 · px</th>
              <td v-for="r in pair" :key="r.lensModel">
                {{ r.consistency?.p95.toFixed(3) ?? 'Run check in model view' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="diagnostic-controls">
        <label
          >Shared residual color scale · px<input
            v-model.number="scale"
            type="number"
            min=".001"
            step=".1"
        /></label>
      </div>
      <h4>Per-image residuals</h4>
      <div class="diagnostic-controls">
        <label
          >Comparison capture<select v-model="selected">
            <option v-for="v in views" :key="v.id" :value="v.id">
              {{ session.frames.find((f) => f.id === v.id)?.name ?? v.id }}
            </option>
          </select></label
        >
        <label
          >Shared arrow magnification<select v-model.number="arrowScale">
            <option v-for="n in [1, 10, 25, 50, 100]" :key="n" :value="n">{{ n }}×</option>
          </select></label
        >
        <label class="check-label"
          ><input type="checkbox" v-model="rejected" />Show rejected corners</label
        >
      </div>
      <div class="comparison-pair">
        <div v-for="(r, i) in pair" :key="r.lensModel">
          <h4>{{ modelName(r.lensModel) }}</h4>
          <div v-if="url && selectedViews[i]" class="comparison-image">
            <img :src="url" alt="Same calibration capture for model comparison" /><ResidualOverlay
              :residuals="selectedViews[i]!.residuals"
              :width="session.width"
              :height="session.height"
              :scale="arrowScale"
              :rejected="rejected"
            />
          </div>
        </div>
      </div>
      <h4>Regional residuals</h4>
      <label
        >Shared regional metric<select v-model="regional">
          <option value="mean">Mean residual magnitude</option>
          <option value="spread">Residual spread</option>
          <option value="count">Accepted observations</option>
          <option value="rejection">Rejected corners · %</option>
        </select></label
      >
      <div class="comparison-pair">
        <div v-for="(r, i) in pair" :key="r.lensModel">
          <h4>{{ modelName(r.lensModel) }}</h4>
          <DiagnosticPlot
            :grid="regionGrids[i]"
            :width="session.width"
            :height="session.height"
            :scale-max="regionScale"
            :unit="regional === 'count' ? 'observations' : regional === 'rejection' ? '%' : 'px'"
          />
        </div>
      </div>
      <h4>Projection uncertainty</h4>
      <label
        >Shared uncertainty color scale · px<input
          v-model.number="uncertaintyScale"
          type="number"
          min=".001"
          step=".1"
      /></label>
      <div class="diagnostic-controls">
        <label
          >Shared evaluation distance<select v-model="atInfinity">
            <option :value="true">Infinity</option>
            <option :value="false">Working distance</option>
          </select></label
        >
        <label v-if="!atInfinity"
          >Shared range along viewing ray · m<input
            v-model.number="distance"
            type="number"
            min=".05"
            max="1000"
            step=".25"
        /></label>
        <button
          v-if="!atInfinity"
          class="button"
          :disabled="busy || working"
          @click="compute('distance')"
        >
          Compute both distance maps
        </button>
      </div>
      <p class="small">
        {{
          atInfinity
            ? 'At infinity'
            : mapDistance
              ? `Showing ${mapDistance} m`
              : 'Compute maps at the selected range'
        }}. Values are worst-direction sampling standard deviations in pixels; spatial p95 is not a
        confidence bound.
      </p>
      <div class="comparison-pair">
        <div v-for="(r, i) in pair" :key="r.lensModel">
          <h4>{{ modelName(r.lensModel) }} · p95 {{ p95(displayedMaps[i]) }} px</h4>
          <DiagnosticPlot
            v-if="displayedMaps[i]"
            :grid="displayedMaps[i]"
            :width="session.width"
            :height="session.height"
            :scale-max="Math.max(0.001, uncertaintyScale || 1)"
          />
        </div>
      </div>
      <h4>Projection difference</h4>
      <label
        >Projection difference color scale · px<input
          v-model.number="differenceScale"
          type="number"
          min=".001"
          step=".1"
      /></label>
      <button class="button" :disabled="busy || working" @click="compute('difference')">
        Compare model projections
      </button>
      <template v-if="difference"
        ><p class="small">
          Mean {{ difference.mean.toFixed(3) }} px · spatial p95 {{ difference.p95.toFixed(3) }} px
        </p>
        <DiagnosticPlot
          :grid="difference"
          :width="session.width"
          :height="session.height"
          :scale-max="Math.max(0.001, differenceScale || 1)"
      /></template>
      <p class="small muted">
        Rays are rotationally aligned using the central image region before comparing projections at
        infinity. This measures model disagreement, not ground-truth error.
      </p>
    </template>
    <p v-if="busy" role="status">
      {{ progress }} <button class="text-button" @click="cancel">Cancel comparison</button>
    </p>
    <p v-if="error" role="alert" class="error-text">{{ error }}</p>
  </section>
</template>
<style scoped>
.comparison-pair {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin: 16px 0;
}
.comparison-image {
  position: relative;
}
.comparison-image img {
  display: block;
  width: 100%;
}
.comparison-table {
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: 10px;
  border-bottom: 1px solid var(--border);
}
h4 {
  margin: 16px 0 10px;
}
@media (max-width: 700px) {
  .comparison-pair {
    grid-template-columns: 1fr;
  }
}
</style>

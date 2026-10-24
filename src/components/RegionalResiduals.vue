<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Session } from '../core/types';
import { currentResult } from '../core/types';
import { regionalResiduals } from '../core/residualStats';
const props = defineProps<{ session: Session }>();
const metric = ref<'mean' | 'spread' | 'count' | 'rejection'>('mean'),
  columns = ref(8),
  selected = ref(0),
  limit = ref(1);
const rows = computed(() => (columns.value === 8 ? 6 : 12));
watch(columns, () => (selected.value = 0));
const cells = computed(() =>
  regionalResiduals(
    currentResult(props.session)?.views ?? [],
    props.session.width,
    props.session.height,
    columns.value,
    rows.value,
  ),
);
const cell = computed(() => cells.value[Math.min(selected.value, cells.value.length - 1)]!);
const unit = computed(() =>
  metric.value === 'count' ? 'observations' : metric.value === 'rejection' ? '%' : 'px',
);
const maximum = computed(() =>
  metric.value === 'count'
    ? Math.max(1, ...cells.value.map((c) => c.count))
    : metric.value === 'rejection'
      ? 100
      : Math.max(0.001, limit.value || 1),
);
function color(i: number) {
  const c = cells.value[i]!,
    v = c[metric.value];
  if (v === null || !(c.count + c.rejected)) return '#555f64';
  const t = Math.min(1, v / maximum.value);
  return `hsl(${170 - t * 145} 65% ${25 + t * 30}%)`;
}
const details = (i: number) => {
  const c = cells.value[i]!;
  return `Region ${i + 1}: mean X ${c.dx.toFixed(3)}, mean Y ${c.dy.toFixed(3)} pixels; spread ${c.spread?.toFixed(3) ?? 'unavailable'} pixels; ${c.count} accepted, ${c.rejected} rejected, ${c.frames} captures`;
};
</script>
<template>
  <section class="panel regional-residuals">
    <h3>Regional residual statistics</h3>
    <div class="diagnostic-controls">
      <label
        >Regional metric<select v-model="metric">
          <option value="mean">Mean residual magnitude</option>
          <option value="spread">Residual spread</option>
          <option value="count">Accepted observations</option>
          <option value="rejection">Rejected corners</option>
        </select></label
      >
      <label
        >Region grid<select v-model.number="columns">
          <option :value="8">8 × 6</option>
          <option :value="16">16 × 12</option>
        </select></label
      >
      <label v-if="unit === 'px'"
        >Color scale maximum · px<input v-model.number="limit" type="number" min="0.001" step="0.1"
      /></label>
    </div>
    <svg
      :viewBox="`0 0 ${session.width} ${session.height}`"
      role="group"
      aria-label="Regional residual map"
      class="regional-map"
    >
      <rect
        v-for="(c, i) in cells"
        :key="i"
        :x="((i % columns) * session.width) / columns"
        :y="(Math.floor(i / columns) * session.height) / rows"
        :width="session.width / columns"
        :height="session.height / rows"
        :fill="color(i)"
        :stroke="i === selected ? 'white' : '#102027'"
        :stroke-width="i === selected ? 4 : 1"
        tabindex="0"
        role="button"
        :aria-label="details(i)"
        @pointerenter="selected = i"
        @click="selected = i"
        @focus="selected = i"
        @keydown.enter="selected = i"
      >
        <title>{{ details(i) }}</title>
      </rect>
    </svg>
    <div class="plot-scale">
      <span>0 {{ unit }}</span
      ><span class="gradient-scale" /><span
        >{{ maximum.toFixed(unit === 'px' ? 3 : 0) }}+ {{ unit }}</span
      >
    </div>
    <p class="small" role="status">
      {{ details(selected) }} · {{ cell.rejection?.toFixed(1) ?? '—' }}% rejected<span
        v-if="cell.count < 10"
      >
        · Low sample count</span
      >.
    </p>
    <p class="small muted">
      Mean residual is the magnitude of the average X/Y error vector. Spread is 2D RMS about that
      mean, using accepted corners only; at least two are required. Gray means no data for this
      metric. Hover or focus a region for details. Counts are corner observations, not independent
      captures.
    </p>
  </section>
</template>
<style scoped>
.regional-map {
  display: block;
  width: 100%;
  background: #102027;
  border-radius: 6px;
  margin: 12px 0;
}
.regional-map rect:focus {
  outline: none;
  stroke: white;
  stroke-width: 4;
}
</style>

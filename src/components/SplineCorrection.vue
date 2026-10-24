<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Session } from '../core/types';
import { currentResult } from '../core/types';
import { modelConfig } from '../core/lensModel';
import { regionalResiduals } from '../core/residualStats';
import DiagnosticPlot from './DiagnosticPlot.vue';
const props = defineProps<{ session: Session }>();
const result = computed(() => currentResult(props.session));
const geometry = computed(() => result.value?.modelGeometry);
const config = computed(() => modelConfig(result.value?.lensModel));
const scale = ref(10),
  knots = ref(true),
  sparse = ref(true);
const cells = computed(() =>
  regionalResiduals(result.value?.views ?? [], props.session.width, props.session.height),
);
const lines = computed(() => {
  const c = config.value,
    g = geometry.value;
  if (c.family !== 'spline' || !g?.knots) return [];
  const lines: number[][] = [];
  for (let y = 0; y < c.ny; y++)
    for (let x = 0; x < c.nx; x++) {
      const a = g.knots[y * c.nx + x];
      if (!a) continue;
      for (const i of [
        x + 1 < c.nx ? y * c.nx + x + 1 : -1,
        y + 1 < c.ny ? (y + 1) * c.nx + x : -1,
      ]) {
        const b = g.knots[i];
        if (b) lines.push([...a, ...b]);
      }
    }
  return lines;
});
</script>
<template>
  <section v-if="geometry?.correction" class="panel spline-correction">
    <h3>Spline correction field</h3>
    <div class="diagnostic-controls">
      <label
        >Correction color scale · px<input v-model.number="scale" type="number" min="0.01" step="1"
      /></label>
      <label class="check-label"><input v-model="knots" type="checkbox" />Control-point grid</label>
      <label class="check-label"
        ><input v-model="sparse" type="checkbox" />Mark sparse coverage</label
      >
    </div>
    <div class="correction-map">
      <DiagnosticPlot
        :grid="geometry.correction"
        :width="session.width"
        :height="session.height"
        :scale-max="Math.max(0.01, scale || 10)"
      />
      <svg
        :viewBox="`0 0 ${session.width} ${session.height}`"
        :style="{ aspectRatio: `${session.width}/${session.height}` }"
        aria-label="Spline control grid and coverage overlay"
      >
        <template v-if="knots">
          <line
            v-for="(p, i) in lines"
            :key="i"
            :x1="p[0]"
            :y1="p[1]"
            :x2="p[2]"
            :y2="p[3]"
            stroke="white"
            :stroke-width="session.width / 900"
            opacity=".6"
          />
        </template>
        <template v-if="sparse">
          <template v-for="(c, i) in cells" :key="i">
            <rect
              v-if="c.frames < 3 || c.count < 10"
              :x="((i % 8) * session.width) / 8"
              :y="(Math.floor(i / 8) * session.height) / 6"
              :width="session.width / 8"
              :height="session.height / 6"
              fill="#16282b"
              fill-opacity=".55"
              stroke="#ffffff88"
            />
          </template>
        </template>
        <template v-for="(inside, i) in geometry.splineInBounds" :key="i">
          <rect
            v-if="!inside"
            :x="((i % 40) * session.width) / 40"
            :y="(Math.floor(i / 40) * session.height) / 30"
            :width="session.width / 40"
            :height="session.height / 30"
            fill="#ed64bb"
            fill-opacity=".5"
          />
        </template>
      </svg>
    </div>
    <p class="small muted">
      Correction magnitude relative to the fitted stereographic core, in pixels—not residual error.
      White lines show the projected control-point grid. Dark regions have fewer than three
      contributing captures or ten accepted corners; this is a coverage indicator, not a validated
      accuracy boundary. Pink marks rays outside the spline's configured interior.
    </p>
  </section>
</template>
<style scoped>
.correction-map {
  position: relative;
  overflow: hidden;
}
.correction-map svg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  pointer-events: none;
}
</style>

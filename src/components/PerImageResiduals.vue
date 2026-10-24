<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import type { Session } from '../core/types';
import { currentResult } from '../core/types';
import { getImage } from '../core/storage';
import { percentile } from '../core/residualStats';
import ResidualOverlay from './ResidualOverlay.vue';
const props = defineProps<{ session: Session }>();
const emit = defineEmits<{ inspect: [string] }>();
const views = computed(() =>
  [...(currentResult(props.session)?.views ?? [])].sort((a, b) => b.rms - a.rms),
);
const selected = ref(''),
  scale = ref(25),
  rejected = ref(true),
  url = ref(''),
  error = ref('');
const view = computed(() => views.value.find((v) => v.id === selected.value) ?? views.value[0]);
watch(
  views,
  (next) => {
    if (!next.some((v) => v.id === selected.value)) selected.value = next[0]?.id ?? '';
  },
  { immediate: true },
);
const stats = computed(() => {
  const values =
    view.value?.residuals.filter((p) => p.used).map((p) => Math.hypot(p.dx, p.dy)) ?? [];
  return { median: percentile(values, 0.5), p95: percentile(values, 0.95) };
});
const name = (id: string) => props.session.frames.find((f) => f.id === id)?.name ?? id;
let generation = 0;
watch(
  [() => props.session.id, () => view.value?.id],
  async () => {
    const job = ++generation;
    if (url.value) URL.revokeObjectURL(url.value);
    url.value = '';
    error.value = '';
    if (!view.value) return;
    try {
      const blob = await getImage(props.session.id, view.value.id);
      if (job !== generation) return;
      if (!blob) throw new Error('Source image unavailable.');
      url.value = URL.createObjectURL(blob);
    } catch (e) {
      if (job === generation) error.value = (e as Error).message;
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  generation++;
  if (url.value) URL.revokeObjectURL(url.value);
});
</script>
<template>
  <section class="panel per-image-residuals">
    <h3>Per-image residuals</h3>
    <div class="diagnostic-controls">
      <label
        >Capture · worst RMS first<select v-model="selected" aria-label="Residual capture">
          <option v-for="v in views" :key="v.id" :value="v.id">
            {{ name(v.id) }} · {{ v.rms.toFixed(3) }} px
          </option>
        </select></label
      >
      <label
        >Arrow magnification<select v-model.number="scale">
          <option v-for="n in [1, 10, 25, 50, 100]" :key="n" :value="n">{{ n }}×</option>
        </select></label
      >
      <label class="check-label"
        ><input v-model="rejected" type="checkbox" />Show rejected corners</label
      >
      <button
        class="button small-button"
        :disabled="!view"
        @click="view && emit('inspect', view.id)"
      >
        Inspect residual image
      </button>
    </div>
    <p v-if="view" class="small">
      RMS {{ view.rms.toFixed(3) }} px · median {{ stats.median?.toFixed(3) ?? '—' }} px · p95
      {{ stats.p95?.toFixed(3) ?? '—' }} px · {{ view.inliers }} accepted /
      {{ view.outliers }} rejected. Error summaries use accepted corners.
    </p>
    <div
      v-if="url && view"
      class="residual-image"
      :style="{ aspectRatio: `${session.width}/${session.height}` }"
    >
      <img :src="url" :alt="name(view.id)" /><ResidualOverlay
        :residuals="view.residuals"
        :width="session.width"
        :height="session.height"
        :scale="scale"
        :rejected="rejected"
      />
    </div>
    <p v-else class="small muted">{{ error || 'Loading source image…' }}</p>
    <p class="small muted">
      Arrows run from observed corners toward predicted positions, enlarged {{ scale }}×. Green:
      accepted; red: rejected. Look for coherent patterns; removing difficult images just to reduce
      RMS can weaken calibration.
    </p>
  </section>
</template>
<style scoped>
.residual-image {
  position: relative;
  max-width: 100%;
  margin: 12px auto;
  background: #102027;
}
.residual-image img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>

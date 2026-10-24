<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { OPENCV8, DEFAULT_SPLINE, modelConfig } from '../core/lensModel';
const props = defineProps<{ model?: string; spline?: string; disabled: boolean }>();
const emit = defineEmits<{ change: [string] }>();
const order = ref(3),
  nx = ref(16),
  ny = ref(12),
  fov = ref(120),
  error = ref('');
const spline = computed(() => (props.model ?? OPENCV8) !== OPENCV8);
watch(
  () => props.model,
  () => {
    const c = modelConfig(spline.value ? props.model : (props.spline ?? DEFAULT_SPLINE));
    if (c.family === 'spline') {
      order.value = c.order;
      nx.value = c.nx;
      ny.value = c.ny;
      fov.value = c.fov;
    }
  },
  { immediate: true },
);
function apply() {
  const name = `LENSMODEL_SPLINED_STEREOGRAPHIC_order=${order.value}_Nx=${nx.value}_Ny=${ny.value}_fov_x_deg=${fov.value}`;
  try {
    modelConfig(name);
    error.value = '';
    emit('change', name);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>
<template>
  <div class="lens-model-settings">
    <label
      >Calibration model<select
        :value="spline ? 'spline' : 'opencv8'"
        :disabled="disabled"
        @change="
          emit(
            'change',
            ($event.target as HTMLSelectElement).value === 'opencv8'
              ? OPENCV8
              : (props.spline ?? DEFAULT_SPLINE),
          )
        "
      >
        <option value="opencv8">OpenCV8 · PhotonVision compatible</option>
        <option value="spline">Splined stereographic · advanced</option>
      </select></label
    >
    <details v-if="spline">
      <summary>Spline configuration</summary>
      <div class="spline-settings">
        <label
          >Spline order<select v-model.number="order" :disabled="disabled">
            <option :value="3">Cubic (3)</option>
            <option :value="2">Quadratic (2)</option>
          </select></label
        >
        <label
          >Horizontal knots<input
            v-model.number="nx"
            type="number"
            min="6"
            max="40"
            :disabled="disabled"
        /></label>
        <label
          >Vertical knots<input
            v-model.number="ny"
            type="number"
            min="6"
            max="40"
            :disabled="disabled"
        /></label>
        <label
          >Spline horizontal extent · degrees<input
            v-model.number="fov"
            type="number"
            min="20"
            max="220"
            :disabled="disabled"
        /></label>
      </div>
      <button class="button small-button" :disabled="disabled" @click="apply">
        Apply spline configuration
      </button>
      <p v-if="error" role="alert" class="error-text">{{ error }}</p>
      <p class="small muted">
        Choose an extent covering the lens field of view. Denser grids need more varied observations
        across the image. Changes require a new fit.
      </p>
    </details>
    <p v-if="spline" class="small muted">
      Export as an mrcal camera model. Fit OpenCV8 separately for PhotonVision.
    </p>
  </div>
</template>
<style scoped>
.spline-settings {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 12px 0;
}
.spline-settings label {
  margin: 0;
}
.lens-model-settings {
  margin: 12px 0;
}
</style>

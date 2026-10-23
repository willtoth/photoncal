<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Control } from '../core/camera';
import { exposureScale, exposureLabel, exposureMilliseconds } from '../core/exposure';
const props = defineProps<{ control: Control; value?: number; disabled: boolean }>();
const emit = defineEmits<{ change: [number] }>();
const scale = computed(() =>
  exposureScale(
    { min: props.control.min!, max: props.control.max!, step: props.control.step },
    /Windows/.test(navigator.userAgent),
  ),
);
const current = computed(() => props.value ?? props.control.min!);
const dragging = ref(false);
const editing = ref(false);
const milliseconds = ref(exposureMilliseconds(current.value));
watch(current, (value) => {
  if (!editing.value) milliseconds.value = exposureMilliseconds(value);
});
function finishEntry() {
  editing.value = false;
  milliseconds.value = exposureMilliseconds(current.value);
}
const position = ref(0);
watch(
  [current, scale],
  () => {
    if (!dragging.value) position.value = scale.value.toPosition(current.value);
  },
  { immediate: true },
);
function slide(event: Event) {
  position.value = Number((event.target as HTMLInputElement).value);
  emit('change', scale.value.fromPosition(position.value));
}
function finish() {
  dragging.value = false;
  position.value = scale.value.toPosition(current.value);
}
</script>
<template>
  <div class="exposure-control">
    <label>
      <span class="range-label"
        >Shutter / exposure<output>{{ exposureLabel(value) }}</output></span
      >
      <input
        type="range"
        aria-label="Shutter / exposure"
        min="0"
        :max="scale.maximum"
        step="1"
        :value="position"
        :disabled="disabled"
        :aria-valuetext="exposureLabel(value)"
        @pointerdown="dragging = true"
        @input="slide"
        @change="finish"
        @pointercancel="finish"
        @blur="finish"
      />
    </label>
    <div class="exposure-entry">
      <button
        class="button small-button"
        aria-label="Shorter exposure"
        :disabled="disabled || current <= control.min!"
        @click="emit('change', scale.adjacent(current, -1))"
      >
        −
      </button>
      <label
        >Exposure · ms<select
          v-if="scale.stops.length"
          aria-label="Exposure time"
          :value="current"
          :disabled="disabled"
          @change="emit('change', Number(($event.target as HTMLSelectElement).value))"
        >
          <option v-for="stop in scale.stops" :key="stop" :value="stop">
            {{ exposureLabel(stop) }}
          </option></select
        ><input
          v-else
          type="number"
          aria-label="Exposure in milliseconds"
          v-model.number="milliseconds"
          @focus="editing = true"
          @blur="finishEntry"
          :min="exposureMilliseconds(control.min!)"
          :max="exposureMilliseconds(control.max!)"
          step="any"
          :disabled="disabled"
          @change="
            emit('change', scale.snap(Number(($event.target as HTMLInputElement).value) * 10))
          "
      /></label>
      <button
        class="button small-button"
        aria-label="Longer exposure"
        :disabled="disabled || current >= control.max!"
        @click="emit('change', scale.adjacent(current, 1))"
      >
        +
      </button>
    </div>
    <p class="small muted">
      {{
        scale.stops.length
          ? `${scale.stops.length} camera exposure stops.`
          : 'Logarithmic scale; adjustments use the camera’s supported steps.'
      }}
      Shown value is reported by the camera.
    </p>
  </div>
</template>

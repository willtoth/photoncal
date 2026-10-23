<script setup lang="ts">
import { computed } from 'vue';
import type { BoardConfig } from '../core/types';
const props = defineProps<{ modelValue: BoardConfig; disabled: boolean; unit: 'mm' | 'in' }>();
const emit = defineEmits<{
  'update:modelValue': [BoardConfig];
  'update:unit': ['mm' | 'in'];
  print: [];
}>();
const scale = computed(() => (props.unit === 'mm' ? 1000 : 1 / 0.0254));
function update(key: keyof BoardConfig, value: any) {
  emit('update:modelValue', { ...props.modelValue, [key]: value });
}
</script>
<template>
  <section class="panel board-settings">
    <div class="panel-heading">
      <h3>Calibration target</h3>
      <button class="text-button" @click="emit('print')">Print target</button>
    </div>
    <fieldset :disabled="disabled">
      <label
        >Target type<select
          :value="modelValue.kind"
          @change="update('kind', ($event.target as HTMLSelectElement).value)"
        >
          <option value="charuco">ChArUco (recommended)</option>
          <option value="chessboard">Chessboard</option>
        </select></label
      >
      <div class="field-pair">
        <label
          >Rows · squares<input
            type="number"
            min="3"
            max="40"
            :value="modelValue.rows"
            @change="update('rows', Number(($event.target as HTMLInputElement).value))" /></label
        ><label
          >Columns · squares<input
            type="number"
            min="3"
            max="40"
            :value="modelValue.columns"
            @change="update('columns', Number(($event.target as HTMLInputElement).value))"
        /></label>
      </div>
      <div class="field-pair">
        <label
          >Measured square size<input
            type="number"
            min="0.01"
            step="0.01"
            :value="Number((modelValue.squareSize * scale).toFixed(4))"
            @change="
              update('squareSize', Number(($event.target as HTMLInputElement).value) / scale)
            " /></label
        ><label
          >Units<select
            :value="unit"
            @change="emit('update:unit', ($event.target as HTMLSelectElement).value as 'mm' | 'in')"
          >
            <option value="mm">Millimeters</option>
            <option value="in">Inches</option>
          </select></label
        >
      </div>
      <template v-if="modelValue.kind === 'charuco'">
        <label
          >Measured marker size · {{ unit
          }}<input
            type="number"
            min="0.01"
            step="0.01"
            :value="Number((modelValue.markerSize * scale).toFixed(4))"
            @change="
              update('markerSize', Number(($event.target as HTMLInputElement).value) / scale)
            "
        /></label>
        <label
          >Marker dictionary<select
            :value="modelValue.dictionary"
            @change="update('dictionary', Number(($event.target as HTMLSelectElement).value))"
          >
            <option :value="3">4×4 · 1000 markers</option>
            <option :value="7">5×5 · 1000 markers</option>
            <option :value="11">6×6 · 1000 markers</option>
            <option :value="15">7×7 · 1000 markers</option>
            <option :value="0">4×4 · 50 markers</option>
            <option :value="1">4×4 · 100 markers</option>
            <option :value="2">4×4 · 250 markers</option>
            <option :value="4">5×5 · 50 markers</option>
            <option :value="5">5×5 · 100 markers</option>
            <option :value="6">5×5 · 250 markers</option>
            <option :value="8">6×6 · 50 markers</option>
            <option :value="9">6×6 · 100 markers</option>
            <option :value="10">6×6 · 250 markers</option>
            <option :value="12">7×7 · 50 markers</option>
            <option :value="13">7×7 · 100 markers</option>
            <option :value="14">7×7 · 250 markers</option>
            <option :value="16">Original ArUco</option>
          </select></label
        >
        <label class="check-label"
          ><input
            type="checkbox"
            :checked="modelValue.legacy"
            @change="update('legacy', ($event.target as HTMLInputElement).checked)"
          />Legacy pattern (OpenCV before 4.6)</label
        >
      </template>
    </fieldset>
    <p class="small muted">
      {{ (modelValue.rows - 1) * (modelValue.columns - 1) }} internal corners. Measure the printed
      target to check its dimensions.
    </p>
    <p v-if="disabled" class="small muted">
      Target settings are locked after capture. Start a new calibration to change them.
    </p>
  </section>
</template>

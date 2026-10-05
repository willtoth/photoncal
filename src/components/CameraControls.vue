<script setup lang="ts">
import type { Control } from '../core/camera';
defineProps<{ controls: Control[]; settings: Record<string, any>; locked?: boolean }>();
const emit = defineEmits<{ change: [string, string | number] }>();
</script>
<template>
  <section class="panel">
    <h3>Camera controls</h3>
    <p v-if="!controls.length" class="small muted">
      No adjustable controls are available in this browser. Use the camera’s software or physical
      controls.
    </p>
    <div v-for="control in controls" :key="control.key" class="camera-control">
      <label v-if="control.choices"
        >{{ control.label
        }}<select
          :value="settings[control.key]"
          :disabled="locked && ['focusMode', 'zoom', 'focusDistance'].includes(control.key)"
          @change="emit('change', control.key, ($event.target as HTMLSelectElement).value)"
        >
          <option v-if="settings[control.key] === undefined" disabled value="">Not reported</option>
          <option v-for="choice in control.choices" :key="choice" :value="choice">
            {{ choice.replaceAll('-', ' ') }}
          </option>
        </select></label
      >
      <label v-else
        ><span class="range-label"
          >{{ control.label
          }}<output
            >{{ settings[control.key] ?? '—' }}
            <span class="muted">{{ control.unit }}</span></output
          ></span
        ><input
          type="range"
          :min="control.min"
          :max="control.max"
          :step="control.step"
          :value="settings[control.key] ?? control.min"
          :disabled="
            (locked && ['zoom', 'focusDistance'].includes(control.key)) ||
            (control.key === 'exposureTime' && settings.exposureMode !== 'manual') ||
            (control.key === 'focusDistance' && settings.focusMode !== 'manual')
          "
          @change="emit('change', control.key, Number(($event.target as HTMLInputElement).value))"
      /></label>
    </div>
    <p v-if="controls.length" class="small muted">
      Available controls depend on the camera and browser. Shutter and focus sliders require manual
      mode.
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { cameraControlDefinitions, type Control } from '../core/camera';
const props = withDefaults(
  defineProps<{
    controls: Control[];
    settings: Record<string, any>;
    locked?: boolean;
    checked?: boolean;
    inactive?: boolean;
    disabled?: boolean;
    expected?: string[];
  }>(),
  { checked: true },
);
const unavailable = computed(() =>
  cameraControlDefinitions
    .filter(
      (control) =>
        (!props.expected || props.expected.includes(control.key)) &&
        !props.controls.some((available) => available.key === control.key),
    )
    .map((control) => control.label.toLowerCase()),
);
const emit = defineEmits<{ change: [string, string | number] }>();
</script>
<template>
  <section class="panel">
    <h3>Camera controls</h3>
    <p v-if="!checked" class="small muted">
      Check available settings to see brightness, exposure, and other controls reported by this
      camera.
    </p>
    <p v-else-if="!controls.length" class="small muted">
      This camera has no adjustable controls in this browser. Use the camera’s software or physical
      controls.
    </p>
    <p v-else-if="inactive" class="small muted">Start preview to adjust these controls.</p>
    <fieldset :disabled="disabled || inactive">
      <div v-for="control in controls" :key="control.key" class="camera-control">
        <label v-if="control.choices"
          >{{ control.label
          }}<select
            :aria-label="control.label"
            :value="settings[control.key]"
            :disabled="locked && ['focusMode', 'zoom', 'focusDistance'].includes(control.key)"
            @change="emit('change', control.key, ($event.target as HTMLSelectElement).value)"
          >
            <option v-if="settings[control.key] === undefined" disabled value="">
              Not reported
            </option>
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
            :aria-label="control.label"
            :min="control.min"
            :max="control.max"
            :step="control.step"
            :value="settings[control.key] ?? control.min"
            :disabled="
              (locked && ['zoom', 'focusDistance'].includes(control.key)) ||
              (control.key === 'exposureTime' && settings.exposureMode !== 'manual') ||
              (control.key === 'focusDistance' && settings.focusMode !== 'manual')
            "
            @change="
              emit('change', control.key, Number(($event.target as HTMLInputElement).value))
            "
        /></label>
      </div>
    </fieldset>
    <p v-if="checked && unavailable.length" class="small muted">
      Not adjustable in this browser: {{ unavailable.join(', ') }}.
    </p>
    <p
      v-if="controls.some((c) => ['exposureTime', 'focusDistance'].includes(c.key))"
      class="small muted"
    >
      Shutter and focus sliders require manual mode.
    </p>
  </section>
</template>

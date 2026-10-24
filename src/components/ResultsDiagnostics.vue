<script setup lang="ts">
import type { Session } from '../core/types';
import PerImageResiduals from './PerImageResiduals.vue';
import RegionalResiduals from './RegionalResiduals.vue';
import WorkingDistanceUncertainty from './WorkingDistanceUncertainty.vue';
defineProps<{ session: Session; working: boolean }>();
const emit = defineEmits<{ inspect: [string] }>();
</script>
<template>
  <div class="results-diagnostics">
    <PerImageResiduals :session="session" @inspect="emit('inspect', $event)" /><RegionalResiduals
      :session="session"
    /><WorkingDistanceUncertainty :session="session" :working="working" />
  </div>
</template>
<style>
.results-diagnostics {
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin-top: 24px;
}
.diagnostic-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: end;
  margin: 14px 0;
}
.diagnostic-controls > label {
  flex: 1 1 180px;
  min-width: 0;
}
.diagnostic-controls > label + label {
  margin-top: 0;
}
.diagnostic-controls .check-label {
  flex: 0 1 auto;
  align-self: center;
}
.diagnostic-controls .button {
  flex: none;
}
.results > .panel {
  margin: 24px 0;
}
.results > .result-actions {
  margin: 16px 0;
}
</style>

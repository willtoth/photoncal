<script setup lang="ts">
import { useId } from 'vue';
import type { Residual } from '../core/types';
const props = defineProps<{
  residuals: Residual[];
  width: number;
  height: number;
  scale: number;
  rejected: boolean;
}>();
const id = useId().replaceAll(':', '');
</script>
<template>
  <svg
    :viewBox="`0 0 ${width} ${height}`"
    class="residual-overlay"
    aria-label="Observed-to-predicted residual arrows"
  >
    <defs>
      <marker
        :id="id"
        viewBox="0 0 6 6"
        refX="5"
        refY="3"
        markerWidth="5"
        markerHeight="5"
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 6 3 L 0 6 z" fill="context-stroke" />
      </marker>
    </defs>
    <g
      v-for="p in props.residuals.filter((p) => p.used || rejected)"
      :key="p.id"
      :stroke="p.used ? '#62f6b7' : '#ff7d72'"
      :fill="p.used ? '#62f6b7' : '#ff7d72'"
    >
      <circle :cx="p.x" :cy="p.y" :r="width / 500" stroke="none" />
      <line
        :x1="p.x"
        :y1="p.y"
        :x2="p.x + p.dx * scale"
        :y2="p.y + p.dy * scale"
        :stroke-width="width / 900"
        :marker-end="`url(#${id})`"
      />
    </g>
  </svg>
</template>
<style scoped>
.residual-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>

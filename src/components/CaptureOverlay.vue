<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import type { Frame, Corner, Region } from '../core/types';
import { coverage } from '../core/capture';
const props = defineProps<{
  width: number;
  height: number;
  frames: Frame[];
  corners: Corner[];
  dots: boolean;
  grid: boolean;
  roi?: Region;
}>();
const canvas = ref<HTMLCanvasElement>();
function draw() {
  const el = canvas.value;
  if (!el) return;
  el.width = props.width;
  el.height = props.height;
  const ctx = el.getContext('2d')!;
  ctx.clearRect(0, 0, el.width, el.height);
  const scale = props.width / 640;
  if (props.grid) {
    const grid = coverage(props.frames, props.width, props.height);
    const w = props.width / grid.columns,
      h = props.height / grid.rows;
    for (let y = 0; y < grid.rows; y++)
      for (let x = 0; x < grid.columns; x++) {
        const count = grid.cells[y * grid.columns + x]!;
        ctx.fillStyle =
          count >= 3
            ? 'rgba(47,208,167,.12)'
            : count
              ? 'rgba(47,208,167,.055)'
              : 'rgba(255,177,87,.025)';
        ctx.fillRect(x * w, y * h, w, h);
        ctx.strokeStyle = count ? 'rgba(47,208,167,.26)' : 'rgba(255,255,255,.1)';
        ctx.lineWidth = 0.6 * scale;
        ctx.strokeRect(x * w, y * h, w, h);
      }
  }
  if (props.dots) {
    const colors = ['#64dbbf', '#6ca9e9', '#edb96b', '#cf9ded', '#f28e89'];
    let i = 0;
    ctx.globalAlpha = 0.55;
    for (const frame of props.frames.filter((f) => f.included)) {
      ctx.strokeStyle = colors[i++ % colors.length]!;
      ctx.lineWidth = scale;
      ctx.beginPath();
      for (const p of frame.corners) {
        ctx.moveTo(p.x + 2.5 * scale, p.y);
        ctx.arc(p.x, p.y, 2.5 * scale, 0, Math.PI * 2);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = '#9afadd';
  ctx.strokeStyle = '#102b23';
  ctx.lineWidth = scale;
  for (const p of props.corners) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  if (props.roi) {
    const r = props.roi;
    ctx.strokeStyle = '#64dbbf';
    ctx.lineWidth = 2 * scale;
    ctx.strokeRect(r.x * props.width, r.y * props.height, r.w * props.width, r.h * props.height);
    ctx.fillStyle = '#64dbbf';
    ctx.font = `${11 * scale}px sans-serif`;
    ctx.fillText('FOCUS AREA', r.x * props.width, r.y * props.height - 8 * scale);
  }
}
watch(
  () => [props.width, props.height, props.frames, props.corners, props.dots, props.grid, props.roi],
  draw,
  { deep: true, flush: 'post' },
);
onMounted(draw);
</script>
<template><canvas ref="canvas" class="capture-overlay" aria-hidden="true" /></template>

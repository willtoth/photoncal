<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import type { Grid, Residual } from '../core/types';
const props = defineProps<{
  grid?: Grid;
  residuals?: Residual[];
  width: number;
  height: number;
  mode?: 'magnitude' | 'direction';
  scaleMax?: number;
}>();
const canvas = ref<HTMLCanvasElement>(),
  maximum = ref(0);
function draw() {
  const el = canvas.value;
  if (!el) return;
  el.width = 720;
  el.height = Math.round((720 * props.height) / props.width);
  const ctx = el.getContext('2d')!;
  ctx.fillStyle = '#111f25';
  ctx.fillRect(0, 0, el.width, el.height);
  if (props.grid) {
    const vals = props.grid.values.filter((v): v is number => v !== null && Number.isFinite(v));
    const sorted = [...vals].sort((a, b) => a - b);
    maximum.value = props.scaleMax ?? sorted[Math.floor(sorted.length * 0.95)] ?? 1;
    const w = el.width / props.grid.width,
      h = el.height / props.grid.height;
    props.grid.values.forEach((v, i) => {
      const t = v === null ? 0 : Math.min(1, v / Math.max(maximum.value, 1e-9));
      ctx.fillStyle =
        v === null ? '#434b52' : `hsl(${170 - t * 145} ${60 + t * 10}% ${22 + t * 35}%)`;
      ctx.fillRect(
        (i % props.grid!.width) * w,
        Math.floor(i / props.grid!.width) * h,
        w + 1,
        h + 1,
      );
    });
  } else if (props.residuals) {
    const sx = el.width / props.width,
      sy = el.height / props.height;
    maximum.value = 1;
    for (const p of props.residuals) {
      if (!p.used) continue;
      const magnitude = Math.hypot(p.dx, p.dy),
        t = Math.min(1, magnitude);
      ctx.fillStyle = `hsl(${170 - t * 145} 75% 60%)`;
      if (props.mode === 'direction') {
        ctx.strokeStyle = `hsl(${((Math.atan2(p.dy, p.dx) + Math.PI) * 180) / Math.PI} 80% 65%)`;
        ctx.beginPath();
        ctx.moveTo(p.x * sx, p.y * sy);
        ctx.lineTo(p.x * sx + p.dx * 15, p.y * sy + p.dy * 15);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(p.x * sx, p.y * sy, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.strokeStyle = 'rgba(255,255,255,.15)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo((el.width * i) / 4, 0);
    ctx.lineTo((el.width * i) / 4, el.height);
    ctx.moveTo(0, (el.height * i) / 4);
    ctx.lineTo(el.width, (el.height * i) / 4);
    ctx.stroke();
  }
}
onMounted(draw);
watch(() => [props.grid, props.residuals, props.mode, props.scaleMax], draw, { deep: true });
</script>
<template>
  <div class="diagnostic-plot">
    <canvas
      ref="canvas"
      :aria-label="grid ? 'Projection error heatmap' : 'Reprojection residual plot'"
      role="img"
    />
    <div v-if="mode !== 'direction'" class="plot-scale">
      <span>0 px</span><span class="gradient-scale" /><span>{{ maximum.toFixed(3) }}+ px</span>
    </div>
    <p v-else class="small muted">Vectors enlarged 15×; color indicates direction.</p>
  </div>
</template>

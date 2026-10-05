<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Session } from '../core/types';
import { currentResult } from '../core/types';
import { coverage } from '../core/capture';
import { Download, Archive, ScanLine, AlertTriangle } from 'lucide-vue-next';
import DiagnosticPlot from './DiagnosticPlot.vue';
const props = defineProps<{ session: Session; working: boolean }>();
const emit = defineEmits<{
  download: [];
  archive: [];
  capture: [];
  consistency: [];
  recalibrate: [];
}>();
const result = computed(() => props.session.result),
  fresh = computed(() => !!currentResult(props.session));
const mode = ref<'magnitude' | 'direction'>('magnitude');
const c = computed(() => coverage(props.session.frames, props.session.width, props.session.height));
const residuals = computed(() => result.value?.views.flatMap((v) => v.residuals) ?? []);
const outlierRate = computed(() =>
  result.value ? (100 * result.value.outliers) / (result.value.inliers + result.value.outliers) : 0,
);
const issues = computed(() => {
  const messages: string[] = [];
  if (!result.value) return messages;
  if (!fresh.value) messages.push('Images or settings changed. Recalibrate before exporting.');
  if (result.value.rms > 1)
    messages.push(
      'Reprojection RMS exceeds 1 pixel. Review images with the largest errors and check the board settings.',
    );
  if (outlierRate.value > 3)
    messages.push(
      'More than 3% of detected corners were rejected. Inspect outliers for motion, glare, or an incorrect board pattern.',
    );
  if (c.value.percent < 80)
    messages.push(
      'Parts of the image have little calibration coverage. Add tilted views near the edges and corners.',
    );
  if (!result.value.uncertainty)
    messages.push(
      'Uncertainty is unavailable. Reprojection error alone does not establish accuracy.',
    );
  return messages;
});
const uncertainty95 = computed(() => {
  const vals = result.value?.uncertainty?.values
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  return vals?.[Math.floor(vals.length * 0.95)];
});
</script>
<template>
  <div v-if="result" class="results">
    <div class="result-banner" :class="{ warning: issues.length }">
      <AlertTriangle v-if="issues.length" :size="22" />
      <div>
        <h2>
          {{ !fresh ? 'Results need updating' : 'Calibration complete' }}
        </h2>
      </div>
      <span class="model-label">mrcal / OpenCV8</span>
    </div>
    <div class="metric-grid">
      <div class="metric">
        <span>Reprojection RMS</span><strong>{{ result.rms.toFixed(3) }} <small>px</small></strong>
        <p>Mean {{ result.mean.toFixed(3) }} px</p>
      </div>
      <div class="metric">
        <span>Observed coverage</span><strong>{{ c.percent.toFixed(0) }}<small>%</small></strong>
        <p>{{ c.strongPercent.toFixed(0) }}% has 3+ views</p>
      </div>
      <div class="metric">
        <span>Rejected corners</span><strong>{{ outlierRate.toFixed(1) }}<small>%</small></strong>
        <p>{{ result.outliers }} of {{ result.inliers + result.outliers }}</p>
      </div>
      <div class="metric">
        <span>95th percentile uncertainty</span
        ><strong>{{ uncertainty95?.toFixed(3) ?? '—' }} <small>px</small></strong>
        <p>At infinity · sampling noise</p>
      </div>
    </div>
    <div v-if="issues.length" class="findings">
      <p v-for="issue in issues" :key="issue"><AlertTriangle :size="16" />{{ issue }}</p>
    </div>
    <div class="diagnostic-grid">
      <section class="panel">
        <div class="panel-heading">
          <h3>Projection uncertainty</h3>
          <span class="small muted">At infinity</span>
        </div>
        <DiagnosticPlot
          v-if="result.uncertainty"
          :grid="result.uncertainty"
          :width="session.width"
          :height="session.height"
        />
        <div v-else class="plot-placeholder">
          {{ result.uncertaintyError || 'Computing uncertainty…' }}
        </div>
        <p class="small muted">
          Estimated projection variation from corner-detection noise. This excludes systematic
          errors such as board deformation or a poor lens model.
        </p>
      </section>
      <section class="panel">
        <div class="panel-heading">
          <h3>Reprojection residuals</h3>
          <select v-model="mode" class="compact-select" aria-label="Residual visualization">
            <option value="magnitude">Magnitude</option>
            <option value="direction">Direction</option>
          </select>
        </div>
        <DiagnosticPlot
          :residuals="residuals"
          :width="session.width"
          :height="session.height"
          :mode="mode"
        />
        <p class="small muted">
          Errors should be small and scattered. Patterns can indicate a poor lens model, a warped
          board, motion blur, or inaccurate corner detection.
        </p>
      </section>
    </div>
    <div class="diagnostic-grid">
      <section class="panel">
        <div class="panel-heading">
          <h3>Subset comparison</h3>
          <button
            class="button small-button"
            :disabled="working || !fresh || session.frames.filter((f) => f.included).length < 24"
            @click="emit('consistency')"
          >
            <ScanLine :size="15" />{{ result.consistency ? 'Run again' : 'Run check' }}
          </button>
        </div>
        <template v-if="result.consistency"
          ><DiagnosticPlot
            :grid="result.consistency"
            :width="session.width"
            :height="session.height"
          />
          <p class="small">
            Mean difference {{ result.consistency.mean.toFixed(3) }} px · 95th percentile
            {{ result.consistency.p95.toFixed(3) }} px
          </p></template
        >
        <p v-else class="muted">
          Calibrate two sets of alternating images and compare their projections. Requires at least
          24 images, varied angles and coverage in each set, and two extra solves.
        </p>
        <p v-if="result.consistencyError" class="error-text">{{ result.consistencyError }}</p>
        <p class="small muted">
          Both sets can share the same systematic error, even when their results agree.
        </p>
      </section>
      <section class="panel">
        <h3>Camera model</h3>
        <dl class="model-details">
          <div>
            <dt>Resolution</dt>
            <dd>{{ session.width }} × {{ session.height }}</dd>
          </div>
          <div>
            <dt>Focal lengths · fx, fy</dt>
            <dd>
              {{
                result.intrinsics
                  .slice(0, 2)
                  .map((v) => v.toFixed(3))
                  .join(', ')
              }}
              px
            </dd>
          </div>
          <div>
            <dt>Optical center · cx, cy</dt>
            <dd>
              {{
                result.intrinsics
                  .slice(2, 4)
                  .map((v) => v.toFixed(3))
                  .join(', ')
              }}
              px
            </dd>
          </div>
          <div>
            <dt>Pinhole-equivalent horizontal FOV</dt>
            <dd>
              {{
                (
                  (2 * Math.atan(session.width / (2 * result.intrinsics[0]!)) * 180) /
                  Math.PI
                ).toFixed(1)
              }}°
            </dd>
          </div>
          <div>
            <dt>Board warp · x, y</dt>
            <dd>{{ result.warp.map((v) => (v * 1000).toFixed(3)).join(', ') }} mm</dd>
          </div>
        </dl>
        <details>
          <summary>Distortion coefficients</summary>
          <code class="coefficients">{{
            result.intrinsics
              .slice(4)
              .map((v) => v.toPrecision(7))
              .join(', ')
          }}</code>
          <p class="small muted">k₁, k₂, p₁, p₂, k₃, k₄, k₅, k₆</p>
        </details>
      </section>
    </div>
    <section class="export-panel">
      <div>
        <h3>Export calibration</h3>
        <p>
          Use this JSON in PhotonVision with the same camera at {{ session.width }} ×
          {{ session.height }}, with focus and zoom unchanged.
        </p>
        <p class="small muted">
          JSON contains calibration parameters. The session archive also includes images and
          diagnostics.
        </p>
      </div>
      <div class="export-buttons">
        <button class="button primary" :disabled="!fresh || working" @click="emit('download')">
          <Download :size="18" />Download PhotonVision JSON</button
        ><button class="button" :disabled="working" @click="emit('archive')">
          <Archive :size="18" />Save session archive
        </button>
      </div>
    </section>
    <div class="result-actions">
      <button class="button" :disabled="working" @click="emit('capture')">
        Add or review images</button
      ><button
        v-if="!fresh"
        class="button primary"
        :disabled="working"
        @click="emit('recalibrate')"
      >
        Recalibrate selected images</button
      ><a href="https://mrcal.secretsauce.net/how-to-calibrate.html" target="_blank" rel="noopener"
        >Understanding calibration quality</a
      >
    </div>
  </div>
</template>

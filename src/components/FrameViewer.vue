<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { getImage } from '../core/storage';
import { EngineClient } from '../core/engine';
import { currentResult, type Session } from '../core/types';
import { X, SplitSquareHorizontal } from 'lucide-vue-next';
const props = defineProps<{ session: Session; frameId: string }>();
const emit = defineEmits<{ close: [] }>();
const url = ref(''),
  corrected = ref(''),
  showCorrected = ref(false),
  working = ref(false),
  error = ref('');
const dialog = ref<HTMLDialogElement>();
const frame = computed(() => props.session.frames.find((f) => f.id === props.frameId)!);
const calibrated = computed(() => currentResult(props.session));
const view = computed(() => calibrated.value?.views.find((v) => v.id === props.frameId));
const engine = new EngineClient();
let disposed = false;
async function compare() {
  if (corrected.value) {
    showCorrected.value = !showCorrected.value;
    return;
  }
  if (!props.session.result) return;
  working.value = true;
  try {
    const blob = await getImage(props.session.id, props.frameId);
    const output = await engine.call<Blob>('undistort', {
      blob,
      intrinsics: [...props.session.result.intrinsics],
    });
    if (!disposed) {
      corrected.value = URL.createObjectURL(output);
      showCorrected.value = true;
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    working.value = false;
  }
}
onMounted(async () => {
  dialog.value?.showModal();
  const blob = await getImage(props.session.id, props.frameId);
  if (blob && !disposed) url.value = URL.createObjectURL(blob);
});
onUnmounted(() => {
  disposed = true;
  engine.cancel();
  URL.revokeObjectURL(url.value);
  URL.revokeObjectURL(corrected.value);
});
</script>
<template>
  <dialog
    ref="dialog"
    class="image-dialog"
    @cancel.prevent="emit('close')"
    @click="$event.target === dialog && emit('close')"
  >
    <div class="dialog-body">
      <div class="panel-heading">
        <div>
          <h3>{{ frame?.name }}</h3>
          <p class="small muted">
            {{ showCorrected ? 'Undistorted preview' : 'Original capture' }} · {{ session.width }} ×
            {{ session.height
            }}<template v-if="view"> · {{ view.mean.toFixed(3) }} px mean error</template>
          </p>
        </div>
        <button class="icon-button" aria-label="Close image" @click="emit('close')">
          <X :size="22" />
        </button>
      </div>
      <div class="inspection-image">
        <img
          v-if="url"
          :src="showCorrected ? corrected : url"
          alt="Selected calibration capture"
        /><svg v-if="!showCorrected && frame" :viewBox="`0 0 ${session.width} ${session.height}`">
          <circle
            v-for="c in frame.corners"
            :key="c.id"
            :cx="c.x"
            :cy="c.y"
            :r="session.width / 300"
            :fill="
              view?.residuals.find((r) => r.id === c.id)?.used === false ? '#ff7d72' : '#62f6b7'
            "
            fill-opacity=".75"
          />
        </svg>
      </div>
      <p v-if="error" class="error-text">{{ error }}</p>
      <div class="panel-heading">
        <p class="small muted">
          {{
            view
              ? 'Green corners were used. Red corners are outliers.'
              : 'Green dots are detected board corners.'
          }}
        </p>
        <button v-if="calibrated" class="button" :disabled="working" @click="compare">
          <SplitSquareHorizontal :size="17" />{{
            working ? 'Preparing…' : showCorrected ? 'Show original' : 'Show undistorted'
          }}
        </button>
      </div>
    </div>
  </dialog>
</template>

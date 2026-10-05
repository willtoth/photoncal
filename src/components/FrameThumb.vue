<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { getImage } from '../core/storage';
import type { Frame } from '../core/types';
const props = defineProps<{
  sessionId: string;
  frame: Frame;
  index: number;
  error?: number;
  disabled?: boolean;
}>();
const emit = defineEmits<{ inspect: []; toggle: []; remove: [] }>();
const url = ref('');
let disposed = false;
onMounted(async () => {
  try {
    const blob = await getImage(props.sessionId, props.frame.id);
    if (!blob) return;
    const bitmap = await createImageBitmap(blob, { resizeWidth: 240, resizeQuality: 'low' });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const thumb = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
    if (!disposed) url.value = URL.createObjectURL(thumb);
  } catch {}
});
onUnmounted(() => {
  disposed = true;
  if (url.value) URL.revokeObjectURL(url.value);
});
</script>
<template>
  <article class="frame-thumb" :class="{ excluded: !frame.included }">
    <button class="thumbnail-image" :aria-label="`Inspect ${frame.name}`" @click="emit('inspect')">
      <img v-if="url" :src="url" :alt="frame.name" loading="lazy" /><span
        v-else
        class="thumb-loading"
        >{{ index + 1 }}</span
      ><span class="frame-number">{{ String(index + 1).padStart(2, '0') }}</span
      ><span v-if="error !== undefined" class="frame-error">{{ error.toFixed(2) }} px</span>
    </button>
    <div class="thumb-actions">
      <label class="check-label"
        ><input
          type="checkbox"
          :checked="frame.included"
          :disabled="disabled"
          @change="emit('toggle')"
        />Use</label
      ><button
        class="text-button danger"
        :disabled="disabled"
        :aria-label="`Delete ${frame.name}`"
        @click="emit('remove')"
      >
        Delete
      </button>
    </div>
  </article>
</template>

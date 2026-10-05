<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { currentResult, type Session } from '../core/types';
import FrameThumb from './FrameThumb.vue';
const props = defineProps<{ session: Session; disabled: boolean }>();
const emit = defineEmits<{ inspect: [string]; toggle: [string]; remove: [string] }>();
const page = ref(0),
  size = 12,
  pages = computed(() => Math.max(1, Math.ceil(props.session.frames.length / size)));
const sort = ref('capture');
const ordered = computed(() =>
  sort.value === 'error'
    ? [...props.session.frames].sort(
        (a, b) => (errors.value.get(b.id) ?? -1) - (errors.value.get(a.id) ?? -1),
      )
    : props.session.frames,
);
const visible = computed(() => ordered.value.slice(page.value * size, (page.value + 1) * size));
watch(sort, () => (page.value = 0));
watch(
  () => props.session.id,
  () => (page.value = 0),
);
watch(pages, (p) => (page.value = Math.min(page.value, p - 1)));
const errors = computed(
  () => new Map(currentResult(props.session)?.views.map((v) => [v.id, v.mean]) ?? []),
);
</script>
<template>
  <section class="panel gallery">
    <div class="panel-heading">
      <h3>
        Images <span class="count">{{ session.frames.length }}</span>
      </h3>
      <span class="small muted"
        >{{ session.frames.filter((f) => f.included).length }} included</span
      >
      <select v-if="session.result" v-model="sort" class="compact-select" aria-label="Image order">
        <option value="capture">Capture order</option>
        <option value="error">Largest error first</option>
      </select>
    </div>
    <p v-if="!session.frames.length" class="empty-gallery">No images captured yet.</p>
    <div v-else class="gallery-grid">
      <FrameThumb
        v-for="(frame, i) in visible"
        :key="session.id + frame.id"
        :session-id="session.id"
        :frame="frame"
        :index="session.frames.indexOf(frame)"
        :error="errors.get(frame.id)"
        :disabled="disabled"
        @inspect="emit('inspect', frame.id)"
        @toggle="emit('toggle', frame.id)"
        @remove="emit('remove', frame.id)"
      />
    </div>
    <div v-if="pages > 1" class="pagination">
      <button class="button small-button" :disabled="page === 0" @click="page--">Previous</button
      ><span class="small muted">Page {{ page + 1 }} of {{ pages }}</span
      ><button class="button small-button" :disabled="page >= pages - 1" @click="page++">
        Next
      </button>
    </div>
  </section>
</template>

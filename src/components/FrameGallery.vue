<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { currentResult, type Session } from '../core/types';
import FrameThumb from './FrameThumb.vue';
const props = defineProps<{ session: Session; disabled: boolean; live?: boolean }>();
const emit = defineEmits<{ inspect: [string]; toggle: [string]; remove: [string] }>();
const page = ref(0),
  size = 12,
  pages = computed(() => Math.max(1, Math.ceil(props.session.frames.length / size)));
const sort = ref('capture');
const followLatest = ref(!!props.live);
const grid = ref<HTMLDivElement>();
function browse(delta: number) {
  followLatest.value = false;
  page.value = Math.max(0, Math.min(pages.value - 1, page.value + delta));
  if (grid.value) grid.value.scrollTop = 0;
}
function scrolled() {
  const el = grid.value;
  if (props.live && el && el.scrollHeight - el.clientHeight - el.scrollTop > 8)
    followLatest.value = false;
}
watch(
  [() => props.session.frames.length, followLatest],
  async () => {
    if (!props.live || !followLatest.value || sort.value !== 'capture') return;
    page.value = pages.value - 1;
    await nextTick();
    if (grid.value) grid.value.scrollTop = grid.value.scrollHeight;
  },
  { immediate: true },
);
const ordered = computed(() =>
  sort.value === 'error'
    ? [...props.session.frames].sort(
        (a, b) => (errors.value.get(b.id) ?? -1) - (errors.value.get(a.id) ?? -1),
      )
    : props.session.frames,
);
const visible = computed(() => ordered.value.slice(page.value * size, (page.value + 1) * size));
watch(sort, () => {
  page.value = 0;
  if (sort.value !== 'capture') followLatest.value = false;
});
watch(
  () => props.session.id,
  () => {
    followLatest.value = !!props.live;
    page.value = props.live ? pages.value - 1 : 0;
  },
);
watch(pages, (p) => (page.value = Math.min(page.value, p - 1)));
const errors = computed(
  () => new Map(currentResult(props.session)?.views.map((v) => [v.id, v.mean]) ?? []),
);
</script>
<template>
  <section class="panel gallery" :class="{ 'live-gallery': live }">
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
    <label v-if="live" class="check-label follow-captures"
      ><input v-model="followLatest" type="checkbox" :disabled="sort !== 'capture'" />Follow new
      captures</label
    >
    <p v-if="!session.frames.length" class="empty-gallery">No images captured yet.</p>
    <div
      v-else
      ref="grid"
      class="gallery-grid"
      tabindex="0"
      aria-label="Captured images"
      @scroll="scrolled"
    >
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
      <button class="button small-button" :disabled="page === 0" @click="browse(-1)">
        Previous</button
      ><span class="small muted">Page {{ page + 1 }} of {{ pages }}</span
      ><button class="button small-button" :disabled="page >= pages - 1" @click="browse(1)">
        Next
      </button>
    </div>
  </section>
</template>

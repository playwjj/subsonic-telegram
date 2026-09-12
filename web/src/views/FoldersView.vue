<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { getFolder, type Song } from "../api/subsonic";
import { playQueue } from "../stores/player";
import TrackRow from "../components/TrackRow.vue";

// Route is `/folders/:path*`. vue-router normally gives repeatable params as
// string[], but hands back "" for the bare (no-segment) case — normalize
// both here rather than depend on that edge case.
const props = defineProps<{ path?: string[] | string }>();

const segments = computed(() => {
  const p = props.path;
  if (!p) return [];
  return Array.isArray(p) ? p : p.split("/").filter(Boolean);
});
const currentPath = computed(() => segments.value.join("/"));

const dirs = ref<string[]>([]);
const songs = ref<Song[]>([]);
const loading = ref(true);

async function load(path: string) {
  loading.value = true;
  const result = await getFolder(path);
  dirs.value = result.dirs;
  songs.value = result.songs;
  loading.value = false;
}
watch(currentPath, load, { immediate: true });

function breadcrumbTo(index: number) {
  return { name: "folders", params: { path: segments.value.slice(0, index + 1) } };
}
</script>

<template>
  <div>
    <div class="mb-4 flex flex-wrap items-center gap-1 text-sm text-[var(--text-dim)]">
      <RouterLink :to="{ name: 'folders', params: {} }" class="hover:text-[var(--text)]">Folders</RouterLink>
      <template v-for="(seg, i) in segments" :key="i">
        <span>/</span>
        <RouterLink :to="breadcrumbTo(i)" class="hover:text-[var(--text)]">{{ seg }}</RouterLink>
      </template>
    </div>

    <p v-if="loading" class="text-[var(--text-dim)]">Loading…</p>
    <p v-else-if="!dirs.length && !songs.length" class="text-[var(--text-dim)]">Empty folder.</p>

    <div v-if="dirs.length" class="glass mb-4 p-2">
      <RouterLink
        v-for="dir in dirs"
        :key="dir"
        :to="{ name: 'folders', params: { path: [...segments, dir] } }"
        class="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-white/5"
      >
        <span>📁</span>
        <span>{{ dir }}</span>
      </RouterLink>
    </div>

    <div v-if="songs.length" class="glass p-2">
      <TrackRow v-for="(song, i) in songs" :key="song.id" :song="song" @play="playQueue(songs, i)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { getSongs, deleteTrack, type Song, type SongSort } from "../api/subsonic";
import { playQueue } from "../stores/player";
import TrackRow from "../components/TrackRow.vue";

const PAGE_SIZE = 50;

const songs = ref<Song[]>([]);
const total = ref(0);
const page = ref(0);
const sort = ref<SongSort>("title");
const loading = ref(true);

async function load() {
  loading.value = true;
  const result = await getSongs({ size: PAGE_SIZE, offset: page.value * PAGE_SIZE, sort: sort.value });
  songs.value = result.songs;
  total.value = result.total;
  loading.value = false;
}

watch([page, sort], load, { immediate: true });

function changeSort(next: SongSort) {
  sort.value = next;
  page.value = 0;
}

async function handleDelete(song: Song) {
  if (!confirm(`Permanently delete "${song.title}"? This also removes the file from Telegram.`)) return;
  await deleteTrack(song.id);
  songs.value = songs.value.filter((s) => s.id !== song.id);
  total.value--;
}
</script>

<template>
  <div>
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-semibold">Songs</h1>
      <select :value="sort" class="text-sm" @change="changeSort(($event.target as HTMLSelectElement).value as SongSort)">
        <option value="title">Title</option>
        <option value="artist">Artist</option>
        <option value="recent">Recently added</option>
        <option value="mostPlayed">Most played</option>
      </select>
    </div>

    <p v-if="loading" class="text-[var(--text-dim)]">Loading…</p>
    <p v-else-if="!songs.length" class="text-[var(--text-dim)]">No songs yet.</p>

    <div v-else class="glass p-2">
      <TrackRow
        v-for="(song, i) in songs"
        :key="song.id"
        :song="song"
        deletable
        @play="playQueue(songs, i)"
        @delete="handleDelete(song)"
      />
    </div>

    <div v-if="total > PAGE_SIZE" class="mt-4 flex items-center justify-center gap-3 text-sm">
      <button :disabled="page === 0" @click="page--">← Prev</button>
      <span class="text-[var(--text-dim)]">{{ page + 1 }} / {{ Math.ceil(total / PAGE_SIZE) }}</span>
      <button :disabled="(page + 1) * PAGE_SIZE >= total" @click="page++">Next →</button>
    </div>
  </div>
</template>

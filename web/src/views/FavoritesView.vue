<script setup lang="ts">
import { onMounted, ref } from "vue";
import { coverArtUrl, getStarred2, type Starred } from "../api/subsonic";
import { playQueue, shufflePlay } from "../stores/player";
import TrackRow from "../components/TrackRow.vue";

const starred = ref<Starred | null>(null);
const loading = ref(true);
const error = ref("");

// Unfavoriting a song here only flips its heart (TrackRow mutates the shared
// Song) rather than dropping the row, so an accidental click is one click
// to undo; the list is re-fetched on the next visit.
onMounted(async () => {
  try {
    starred.value = await getStarred2();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load";
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="space-y-8">
    <h1>Favorites</h1>
    <p v-if="loading" class="flex items-center gap-2 text-[var(--text-dim)]"><span class="spinner"></span> Loading…</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p
      v-if="starred && !starred.song.length && !starred.album.length && !starred.artist.length"
      class="text-[var(--text-dim)]"
    >
      Nothing favorited yet — tap ♡ on any song.
    </p>

    <section v-if="starred?.song.length">
      <div class="mb-3 flex items-center justify-between gap-2">
        <h2 class="text-sm font-medium text-[var(--text-dim)]">Songs · {{ starred.song.length }}</h2>
        <div class="flex gap-2">
          <button class="text-xs" @click="playQueue(starred.song, 0)">▶ Play all</button>
          <button class="text-xs" @click="shufflePlay(starred.song)">🔀 Shuffle</button>
        </div>
      </div>
      <div class="glass p-2">
        <TrackRow
          v-for="(song, i) in starred.song"
          :key="song.id"
          :song="song"
          @play="playQueue(starred.song, i)"
        />
      </div>
    </section>

    <section v-if="starred?.album.length">
      <h2 class="mb-3 text-sm font-medium text-[var(--text-dim)]">Albums · {{ starred.album.length }}</h2>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4">
        <RouterLink
          v-for="al in starred.album"
          :key="al.id"
          :to="{ name: 'album', params: { id: al.id } }"
          class="glass p-2 transition-transform hover:scale-[1.03]"
        >
          <img v-if="al.coverArt" :src="coverArtUrl(al.coverArt)" :alt="al.name" class="aspect-square w-full rounded-lg object-cover" />
          <div v-else class="aspect-square w-full rounded-lg bg-white/5"></div>
          <div class="mt-2 truncate text-sm">{{ al.name }}</div>
          <div class="truncate text-xs text-[var(--text-dim)]">{{ al.artist }}</div>
        </RouterLink>
      </div>
    </section>

    <section v-if="starred?.artist.length">
      <h2 class="mb-3 text-sm font-medium text-[var(--text-dim)]">Artists · {{ starred.artist.length }}</h2>
      <div class="glass divide-y divide-[var(--border)] p-2">
        <RouterLink
          v-for="a in starred.artist"
          :key="a.id"
          :to="{ name: 'artist', params: { id: a.id } }"
          class="flex items-center gap-3 py-2"
        >
          <img v-if="a.coverArt" :src="coverArtUrl(a.coverArt)" :alt="a.name" class="h-10 w-10 rounded-full object-cover" />
          <div v-else class="h-10 w-10 rounded-full bg-white/5"></div>
          <span class="truncate">{{ a.name }}</span>
        </RouterLink>
      </div>
    </section>
  </div>
</template>

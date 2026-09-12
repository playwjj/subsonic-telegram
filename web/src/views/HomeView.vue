<script setup lang="ts">
import { ref, onMounted } from "vue";
import {
  getLibraryStats,
  getAlbumList2,
  getRandomSongs,
  getRecentlyPlayed,
  getMostPlayed,
  coverArtUrl,
  type LibraryStats,
  type Album,
  type Song,
} from "../api/subsonic";
import { playQueue } from "../stores/player";
import TrackRow from "../components/TrackRow.vue";

const stats = ref<LibraryStats | null>(null);
const recentAlbums = ref<Album[]>([]);
const randomSongs = ref<Song[]>([]);
const recentlyPlayed = ref<Song[]>([]);
const mostPlayed = ref<Song[]>([]);
const loading = ref(true);
const shuffling = ref(false);

async function shuffle() {
  shuffling.value = true;
  randomSongs.value = await getRandomSongs(8);
  shuffling.value = false;
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  return hours > 0 ? `${hours} 小时 ${minutes} 分` : `${minutes} 分钟`;
}

onMounted(async () => {
  const [s, albums, random, played, most] = await Promise.all([
    getLibraryStats(),
    getAlbumList2({ type: "newest", size: 10 }),
    getRandomSongs(8),
    getRecentlyPlayed(8),
    getMostPlayed(8),
  ]);
  stats.value = s;
  recentAlbums.value = albums;
  randomSongs.value = random;
  recentlyPlayed.value = played;
  mostPlayed.value = most;
  loading.value = false;
});
</script>

<template>
  <div class="space-y-8">
    <p v-if="loading" class="text-[var(--text-dim)]">Loading…</p>

    <section v-if="stats" class="glass grid grid-cols-2 gap-4 p-6 sm:grid-cols-4">
      <div>
        <div class="text-2xl font-semibold">{{ stats.artistCount }}</div>
        <div class="text-sm text-[var(--text-dim)]">Artists</div>
      </div>
      <div>
        <div class="text-2xl font-semibold">{{ stats.albumCount }}</div>
        <div class="text-sm text-[var(--text-dim)]">Albums</div>
      </div>
      <div>
        <div class="text-2xl font-semibold">{{ stats.songCount }}</div>
        <div class="text-sm text-[var(--text-dim)]">Songs</div>
      </div>
      <div>
        <div class="text-2xl font-semibold">{{ formatDuration(stats.totalDuration) }}</div>
        <div class="text-sm text-[var(--text-dim)]">Total length</div>
      </div>
    </section>

    <section v-if="recentAlbums.length">
      <h2 class="mb-3 text-sm font-medium text-[var(--text-dim)]">Recently Added</h2>
      <div class="flex gap-4 overflow-x-auto pb-2">
        <RouterLink
          v-for="al in recentAlbums"
          :key="al.id"
          :to="{ name: 'album', params: { id: al.id } }"
          class="glass w-32 shrink-0 p-2 transition-transform hover:scale-[1.03]"
        >
          <img v-if="al.coverArt" :src="coverArtUrl(al.coverArt)" :alt="al.name" class="aspect-square w-full rounded-lg object-cover" />
          <div v-else class="aspect-square w-full rounded-lg bg-white/5"></div>
          <div class="mt-2 truncate text-sm">{{ al.name }}</div>
          <div class="truncate text-xs text-[var(--text-dim)]">{{ al.artist }}</div>
        </RouterLink>
      </div>
    </section>

    <section v-if="randomSongs.length">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-sm font-medium text-[var(--text-dim)]">Random Songs</h2>
        <button class="text-xs" :disabled="shuffling" @click="shuffle">🔀 {{ shuffling ? "Shuffling…" : "Shuffle" }}</button>
      </div>
      <div class="glass p-2">
        <TrackRow v-for="(song, i) in randomSongs" :key="song.id" :song="song" @play="playQueue(randomSongs, i)" />
      </div>
    </section>

    <section v-if="recentlyPlayed.length">
      <h2 class="mb-3 text-sm font-medium text-[var(--text-dim)]">Continue Listening</h2>
      <div class="glass p-2">
        <TrackRow
          v-for="(song, i) in recentlyPlayed"
          :key="song.id"
          :song="song"
          @play="playQueue(recentlyPlayed, i)"
        />
      </div>
    </section>

    <section v-if="mostPlayed.length">
      <h2 class="mb-3 text-sm font-medium text-[var(--text-dim)]">Most Played</h2>
      <div class="glass p-2">
        <TrackRow v-for="(song, i) in mostPlayed" :key="song.id" :song="song" @play="playQueue(mostPlayed, i)" />
      </div>
    </section>

    <p v-if="!loading && !stats?.songCount" class="text-[var(--text-dim)]">
      No music yet — import some with <code>npm run import</code>.
    </p>
  </div>
</template>

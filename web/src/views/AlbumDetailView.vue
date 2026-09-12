<script setup lang="ts">
import { ref, watch } from "vue";
import { useRouter } from "vue-router";
import { getAlbum, deleteTrack, coverArtUrl, type AlbumDetail, type Song } from "../api/subsonic";
import { playQueue } from "../stores/player";
import TrackRow from "../components/TrackRow.vue";

const props = defineProps<{ id: string }>();
const album = ref<AlbumDetail | null>(null);
const error = ref("");
const router = useRouter();

async function load(id: string) {
  error.value = "";
  album.value = null;
  try {
    album.value = await getAlbum(id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load";
  }
}
watch(() => props.id, load, { immediate: true });

function playFrom(index: number) {
  if (album.value) playQueue(album.value.song, index);
}

async function handleDelete(song: Song) {
  if (!confirm(`Permanently delete "${song.title}"? This also removes the file from Telegram.`)) return;
  await deleteTrack(song.id);
  if (!album.value) return;
  // Deleting an album's last track deletes the now-empty album server-side
  // too, so this page's id would no longer resolve — bail out to the artist.
  if (album.value.song.length === 1) {
    await router.push({ name: "artist", params: { id: album.value.artistId } });
    return;
  }
  album.value.song = album.value.song.filter((s) => s.id !== song.id);
  album.value.songCount--;
}
</script>

<template>
  <div v-if="album" class="album-detail">
    <div class="header glass mb-6 p-4">
      <img v-if="album.coverArt" class="cover" :src="coverArtUrl(album.coverArt)" :alt="album.name" />
      <div class="info">
        <h1>{{ album.name }}</h1>
        <RouterLink :to="{ name: 'artist', params: { id: album.artistId } }">{{ album.artist }}</RouterLink>
        <p class="meta">{{ album.songCount }} 首{{ album.year ? ` · ${album.year}` : "" }}</p>
        <button @click="playFrom(0)">▶ Play album</button>
      </div>
    </div>
    <div class="tracks glass p-2">
      <TrackRow
        v-for="(song, i) in album.song"
        :key="song.id"
        :song="song"
        deletable
        @play="playFrom(i)"
        @delete="handleDelete(song)"
      />
    </div>
  </div>
  <p v-else-if="error" class="error">{{ error }}</p>
</template>

<style scoped>
.header {
  display: flex;
  gap: 1.25rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}
.cover {
  width: 10rem;
  height: 10rem;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
}
.meta {
  opacity: 0.7;
  font-size: 0.9rem;
  margin: 0.3rem 0 0.8rem;
}
</style>

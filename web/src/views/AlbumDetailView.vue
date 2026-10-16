<script setup lang="ts">
import { ref, watch } from "vue";
import { useRouter } from "vue-router";
import { getAlbum, deleteTrack, coverArtUrl, type AlbumDetail, type Song } from "../api/subsonic";
import { playQueue, shufflePlay } from "../stores/player";
import TrackRow from "../components/TrackRow.vue";
import AlbumEditDialog from "../components/AlbumEditDialog.vue";
import TagEditorDialog from "../components/TagEditorDialog.vue";

const props = defineProps<{ id: string }>();
const album = ref<AlbumDetail | null>(null);
const error = ref("");
const router = useRouter();
const editingAlbum = ref(false);
const editingSong = ref<Song | null>(null);

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

// A new name/artist gives the album a new id (and may merge it into
// another album) — follow it there.
async function onAlbumSaved(albumId: string) {
  editingAlbum.value = false;
  if (albumId !== props.id) await router.replace({ name: "album", params: { id: albumId } });
  else await load(albumId);
}

// The song may have moved to another album; if it was the last one here,
// this album is gone — go where it went.
async function onSongSaved(albumIds: string[]) {
  editingSong.value = null;
  if (album.value?.song.length === 1 && albumIds[0] && albumIds[0] !== props.id) {
    await router.replace({ name: "album", params: { id: albumIds[0] } });
  } else await load(props.id);
}

function playFrom(index: number) {
  if (album.value) playQueue(album.value.song, index);
}

async function handleDelete(song: Song) {
  if (!confirm(`Move "${song.title}" to the trash? You can restore it from Folders → Trash.`)) return;
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
        <div class="flex gap-2">
          <button @click="playFrom(0)">▶ Play album</button>
          <button @click="shufflePlay(album.song)">🔀 Shuffle</button>
          <button @click="editingAlbum = true">✎ Edit</button>
        </div>
      </div>
    </div>
    <div class="tracks glass p-2">
      <TrackRow
        v-for="(song, i) in album.song"
        :key="song.id"
        :song="song"
        deletable
        editable
        @play="playFrom(i)"
        @delete="handleDelete(song)"
        @edit="editingSong = song"
      />
    </div>
    <AlbumEditDialog v-if="editingAlbum" :album="album" @close="editingAlbum = false" @saved="onAlbumSaved" />
    <TagEditorDialog
      v-if="editingSong"
      :songs="[editingSong]"
      :song-ids="[editingSong.id]"
      :count="1"
      @close="editingSong = null"
      @saved="onSongSaved($event.albumIds)"
    />
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

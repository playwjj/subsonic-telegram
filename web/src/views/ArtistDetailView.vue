<script setup lang="ts">
import { ref, watch } from "vue";
import { getArtist, getShuffleSongs, coverArtUrl, setCoverArt, type ArtistDetail } from "../api/subsonic";
import { prepareCover } from "../utils/image";
import ShuffleButton from "../components/ShuffleButton.vue";

const props = defineProps<{ id: string }>();
const artist = ref<ArtistDetail | null>(null);
const error = ref("");

async function load(id: string) {
  error.value = "";
  artist.value = null;
  try {
    artist.value = await getArtist(id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load";
  }
}
watch(() => props.id, load, { immediate: true });

// The artist's own photo (shown instead of one of their album covers).
const photoInput = ref<HTMLInputElement | null>(null);
const uploadingPhoto = ref(false);
async function onPhotoPicked(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !artist.value) return;
  uploadingPhoto.value = true;
  error.value = "";
  try {
    await setCoverArt(artist.value.id, await prepareCover(file));
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    uploadingPhoto.value = false;
  }
}
</script>

<template>
  <div v-if="artist" class="artist-detail">
    <div class="artist-header">
      <img v-if="artist.coverArt" :src="coverArtUrl(artist.coverArt)" :alt="`${artist.name} cover`" />
      <h1>{{ artist.name }}</h1>
      <ShuffleButton class="ml-auto text-sm" :load="() => getShuffleSongs({ artistId: artist!.id })" />
      <button class="inline-flex items-center gap-2 text-sm" :disabled="uploadingPhoto" @click="photoInput?.click()">
        <span v-if="uploadingPhoto" class="spinner"></span> Change photo…
      </button>
      <input ref="photoInput" type="file" accept="image/*" hidden @change="onPhotoPicked" />
    </div>
    <p v-if="error" class="error mt-2 text-sm">{{ error }}</p>
    <div class="albums">
      <RouterLink
        v-for="al in artist.album"
        :key="al.id"
        :to="{ name: 'album', params: { id: al.id } }"
        class="album-card glass p-2 transition-transform hover:scale-[1.03]"
      >
        <img v-if="al.coverArt" :src="coverArtUrl(al.coverArt)" :alt="al.name" />
        <div v-else class="cover-placeholder" />
        <div class="title">{{ al.name }}</div>
        <div class="meta">{{ al.year ?? "" }}</div>
      </RouterLink>
    </div>
  </div>
  <p v-else-if="error" class="error">{{ error }}</p>
</template>

<style scoped>
.albums {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}
.artist-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1rem;
}
/* The 8rem basis makes the buttons wrap to their own row on phones rather
   than squeezing the name down to a character per line. */
.artist-header h1 {
  flex: 1 1 8rem;
  min-width: 0;
  overflow-wrap: anywhere;
}
.artist-header button {
  white-space: nowrap;
}
.artist-header img {
  flex-shrink: 0;
  width: 4rem;
  height: 4rem;
  border-radius: 50%;
  object-fit: cover;
  background: var(--surface-hover);
}
.album-card {
  color: inherit;
  text-decoration: none;
  display: block;
}
.album-card img,
.cover-placeholder {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 6px;
  object-fit: cover;
  background: var(--surface-hover);
}
.title {
  margin-top: 0.4rem;
  font-size: 0.9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  font-size: 0.8rem;
  opacity: 0.6;
}
</style>

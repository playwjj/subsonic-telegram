<script setup lang="ts">
import { ref, watch } from "vue";
import { getArtist, coverArtUrl, type ArtistDetail } from "../api/subsonic";

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
</script>

<template>
  <div v-if="artist" class="artist-detail">
    <h1>{{ artist.name }}</h1>
    <div class="albums">
      <RouterLink
        v-for="al in artist.album"
        :key="al.id"
        :to="{ name: 'album', params: { id: al.id } }"
        class="album-card"
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

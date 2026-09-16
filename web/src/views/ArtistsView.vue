<script setup lang="ts">
import { ref, onMounted } from "vue";
import { coverArtUrl, getArtists, type ArtistIndex } from "../api/subsonic";

const indexes = ref<ArtistIndex[]>([]);
const loading = ref(true);
const error = ref("");

onMounted(async () => {
  try {
    indexes.value = await getArtists();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load";
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="artists">
    <h1>Artists</h1>
    <p v-if="loading" class="flex items-center gap-2 text-[var(--text-dim)]"><span class="spinner"></span> Loading…</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="!loading && !error && indexes.length === 0">No artists yet — import some music first.</p>
    <div v-for="group in indexes" :key="group.name" class="group">
      <h2>{{ group.name }}</h2>
      <ul>
        <li v-for="a in group.artist" :key="a.id">
          <RouterLink :to="{ name: 'artist', params: { id: a.id } }" class="artist-link">
            <img v-if="a.coverArt" :src="coverArtUrl(a.coverArt)" :alt="`${a.name} cover`" />
            <span>{{ a.name }}</span>
          </RouterLink>
          <span class="count">{{ a.albumCount }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.group {
  margin-bottom: 1rem;
}
h2 {
  font-size: 0.9rem;
  opacity: 0.6;
  margin-bottom: 0.3rem;
}
ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.4rem 0;
}
li + li {
  border-top: 1px solid var(--border);
}
.count {
  opacity: 0.6;
  font-size: 0.85rem;
}
.artist-link {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
}
.artist-link img {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 50%;
  object-fit: cover;
  background: var(--surface-hover);
  flex-shrink: 0;
}
</style>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { getPlaylists, createPlaylist, type Playlist } from "../api/subsonic";

const playlists = ref<Playlist[]>([]);
const newName = ref("");
const loading = ref(true);

async function load() {
  loading.value = true;
  playlists.value = await getPlaylists();
  loading.value = false;
}
onMounted(load);

async function create() {
  const name = newName.value.trim();
  if (!name) return;
  await createPlaylist({ name });
  newName.value = "";
  await load();
}
</script>

<template>
  <div class="playlists">
    <h1>Playlists</h1>
    <form @submit.prevent="create">
      <input v-model="newName" placeholder="New playlist name" />
      <button type="submit">Create</button>
    </form>
    <p v-if="loading">Loading…</p>
    <p v-else-if="!playlists.length">No playlists yet.</p>
    <ul v-else class="glass p-2">
      <li v-for="p in playlists" :key="p.id">
        <RouterLink :to="{ name: 'playlist', params: { id: p.id } }">{{ p.name }}</RouterLink>
        <span class="count">{{ p.songCount }} 首</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
form {
  display: flex;
  gap: 0.5rem;
  margin: 1rem 0 1.5rem;
}
form input {
  flex: 1;
}
ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
li {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border);
}
.count {
  opacity: 0.6;
  font-size: 0.85rem;
}
</style>

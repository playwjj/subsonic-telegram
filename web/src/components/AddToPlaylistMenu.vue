<script setup lang="ts">
import { ref } from "vue";
import { getPlaylists, updatePlaylist, createPlaylist, type Playlist } from "../api/subsonic";

const props = defineProps<{ songId: string }>();

const open = ref(false);
const playlists = ref<Playlist[]>([]);
const loading = ref(false);
const newName = ref("");

async function toggle() {
  open.value = !open.value;
  if (open.value) {
    loading.value = true;
    try {
      playlists.value = await getPlaylists();
    } finally {
      loading.value = false;
    }
  }
}

async function addTo(playlistId: string) {
  await updatePlaylist({ playlistId, songIdToAdd: [props.songId] });
  open.value = false;
}

async function createAndAdd() {
  const name = newName.value.trim();
  if (!name) return;
  await createPlaylist({ name, songIds: [props.songId] });
  newName.value = "";
  open.value = false;
}
</script>

<template>
  <div class="add-menu">
    <button class="icon-btn" title="Add to playlist" @click="toggle">+</button>
    <div v-if="open" class="dropdown">
      <p v-if="loading" class="hint">Loading…</p>
      <button v-for="p in playlists" :key="p.id" class="option" @click="addTo(p.id)">{{ p.name }}</button>
      <div class="new-row">
        <input v-model="newName" placeholder="New playlist" @keyup.enter="createAndAdd" />
        <button @click="createAndAdd">Add</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.add-menu {
  position: relative;
}
.icon-btn {
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.dropdown {
  position: absolute;
  right: 0;
  top: 2rem;
  z-index: 10;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  min-width: 12rem;
  padding: 0.4rem;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}
.option {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.4rem 0.5rem;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  border-radius: 4px;
}
.option:hover {
  background: var(--surface-hover);
}
.new-row {
  display: flex;
  gap: 0.3rem;
  margin-top: 0.4rem;
  border-top: 1px solid var(--border);
  padding-top: 0.4rem;
}
.new-row input {
  flex: 1;
  min-width: 0;
}
.hint {
  opacity: 0.7;
  font-size: 0.85rem;
}
</style>

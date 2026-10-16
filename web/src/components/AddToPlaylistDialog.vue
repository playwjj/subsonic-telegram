<script setup lang="ts">
import { onMounted, ref } from "vue";
import { createPlaylist, getPlaylists, updatePlaylist, SubsonicError, type Playlist } from "../api/subsonic";
import Modal from "./Modal.vue";

// Multi-song counterpart of AddToPlaylistMenu (which sits on a single track
// row) — used by the Folders view's selection actions.
const props = defineProps<{ songIds: string[] }>();
const emit = defineEmits<{ close: []; added: [playlistName: string] }>();

const playlists = ref<Playlist[]>([]);
const loading = ref(true);
const busy = ref(false);
const newName = ref("");
const error = ref("");

onMounted(async () => {
  try {
    playlists.value = await getPlaylists();
  } finally {
    loading.value = false;
  }
});

async function run(name: string, action: () => Promise<unknown>) {
  busy.value = true;
  error.value = "";
  try {
    await action();
    emit("added", name);
  } catch (e) {
    error.value = e instanceof SubsonicError ? e.message : "Failed to add to playlist";
  } finally {
    busy.value = false;
  }
}

function addTo(p: Playlist) {
  run(p.name, () => updatePlaylist({ playlistId: p.id, songIdToAdd: props.songIds }));
}

function createAndAdd() {
  const name = newName.value.trim();
  if (name) run(name, () => createPlaylist({ name, songIds: props.songIds }));
}
</script>

<template>
  <Modal :title="`Add ${songIds.length} song${songIds.length === 1 ? '' : 's'} to playlist`" @close="emit('close')">
    <p v-if="loading" class="flex items-center gap-2 text-[var(--text-dim)]"><span class="spinner"></span> Loading…</p>
    <div v-else class="space-y-1">
      <button v-for="p in playlists" :key="p.id" class="option" :disabled="busy" @click="addTo(p)">
        {{ p.name }} <span class="text-[var(--text-dim)]">· {{ p.songCount }}</span>
      </button>
    </div>
    <div class="mt-3 flex gap-2 border-t border-[var(--border)] pt-3">
      <input v-model="newName" class="min-w-0 flex-1" placeholder="New playlist" @keyup.enter="createAndAdd" />
      <button :disabled="busy || !newName.trim()" @click="createAndAdd">Create</button>
    </div>
    <p v-if="error" class="error mt-2 text-sm">{{ error }}</p>
  </Modal>
</template>

<style scoped>
.option {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: none;
  padding: 0.45rem 0.6rem;
}
.option:hover:not(:disabled) {
  background: var(--surface-hover);
}
</style>

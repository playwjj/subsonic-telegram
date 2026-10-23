<script setup lang="ts">
import { ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  getPlaylist,
  updatePlaylist,
  createPlaylist,
  deletePlaylist,
  type PlaylistDetail,
} from "../api/subsonic";
import { playQueue, shufflePlay } from "../stores/player";
import TrackRow from "../components/TrackRow.vue";

const props = defineProps<{ id: string }>();
const playlist = ref<PlaylistDetail | null>(null);
const router = useRouter();

async function load(id: string) {
  playlist.value = await getPlaylist(id);
}
watch(() => props.id, load, { immediate: true });

function playFrom(index: number) {
  if (playlist.value) playQueue(playlist.value.entry, index);
}

async function removeAt(index: number) {
  if (!playlist.value) return;
  await updatePlaylist({ playlistId: playlist.value.id, songIndexToRemove: [index] });
  await load(playlist.value.id);
}

// Reordering isn't a native Subsonic operation — createPlaylist with an
// existing playlistId replaces its whole track list, so we reorder
// client-side and resend the full song id list in the new order.
async function move(index: number, dir: -1 | 1) {
  if (!playlist.value) return;
  const entries = [...playlist.value.entry];
  const target = index + dir;
  if (target < 0 || target >= entries.length) return;
  const [item] = entries.splice(index, 1);
  entries.splice(target, 0, item);
  await createPlaylist({ playlistId: playlist.value.id, songIds: entries.map((e) => e.id) });
  await load(playlist.value.id);
}

async function removePlaylist() {
  if (!playlist.value) return;
  if (!confirm(`Delete playlist "${playlist.value.name}"?`)) return;
  await deletePlaylist(playlist.value.id);
  await router.push({ name: "playlists" });
}
</script>

<template>
  <div v-if="playlist" class="playlist-detail">
    <div class="header">
      <h1>{{ playlist.name }}</h1>
      <div class="actions">
        <button @click="playFrom(0)">▶ Play all</button>
        <button :disabled="!playlist.entry.length" @click="shufflePlay(playlist.entry)">🔀 Shuffle</button>
        <button class="danger" @click="removePlaylist">Delete</button>
      </div>
    </div>
    <p v-if="!playlist.entry.length">No songs yet — add some from the album/search views.</p>
    <div v-else class="glass p-2">
      <div v-for="(song, i) in playlist.entry" :key="`${song.id}-${i}`" class="row">
        <TrackRow :song="song" @play="playFrom(i)">
          <template #menu="{ close }">
            <button class="menu-remove" @click="close(); removeAt(i)">Remove from playlist</button>
          </template>
        </TrackRow>
        <div class="reorder">
          <button :disabled="i === 0" title="Move up" @click="move(i, -1)">↑</button>
          <button :disabled="i === playlist.entry.length - 1" title="Move down" @click="move(i, 1)">↓</button>
          <button class="remove" title="Remove from playlist" @click="removeAt(i)">✕</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.header h1 {
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  gap: 0.5rem;
  white-space: nowrap;
}
.danger {
  color: var(--danger);
}
.row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.row + .row {
  border-top: 1px solid var(--border);
}
.row > :first-child {
  flex: 1;
  min-width: 0;
}
.reorder {
  display: flex;
  gap: 0.2rem;
  flex-shrink: 0;
}
.reorder button {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px solid var(--border);
  color: inherit;
  border-radius: 4px;
  width: 1.6rem;
  height: 1.6rem;
  padding: 0;
  line-height: 1;
  cursor: pointer;
}
.reorder button:disabled {
  opacity: 0.3;
  cursor: default;
}
.menu-remove {
  display: none;
  width: 100%;
  text-align: left;
  padding: 0.4rem 0.5rem;
  background: none;
  border: none;
  border-radius: 4px;
  color: var(--danger);
}
.menu-remove:hover {
  background: var(--surface-hover);
}
/* Phones: ↑/↓ stack into one narrow column and remove moves into the
   row's ⋯ menu, so the song title keeps its room. */
@media (max-width: 600px) {
  .reorder {
    flex-direction: column;
    gap: 0.15rem;
  }
  .reorder button {
    width: 1.5rem;
    height: 1.3rem;
    font-size: 0.75rem;
  }
  .reorder .remove {
    display: none;
  }
  .menu-remove {
    display: block;
  }
}
</style>

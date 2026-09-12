<script setup lang="ts">
import type { Song } from "../api/subsonic";
import AddToPlaylistMenu from "./AddToPlaylistMenu.vue";

// `deletable` is opt-in per view: library views (Songs/Album/Folders) show a
// permanent-delete button, but derived views like a playlist or search
// results don't — a playlist already has its own "remove from playlist"
// action (updatePlaylist), which is a different, much less destructive thing.
defineProps<{ song: Song; deletable?: boolean }>();
const emit = defineEmits<{ play: []; delete: [] }>();

function formatDuration(sec?: number): string {
  if (sec === undefined) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
</script>

<template>
  <div class="track-row">
    <button class="play-btn" title="Play" @click="emit('play')">▶</button>
    <div class="info">
      <div class="title">{{ song.title }}</div>
      <div class="artist">{{ song.artist }}</div>
    </div>
    <div class="duration">{{ formatDuration(song.duration) }}</div>
    <AddToPlaylistMenu :song-id="song.id" />
    <button v-if="deletable" class="delete-btn" title="Delete permanently" @click="emit('delete')">🗑</button>
  </div>
</template>

<style scoped>
.track-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border);
}
.play-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  line-height: 1;
  border-radius: 50%;
  border: none;
  background: var(--surface-hover);
  color: inherit;
  cursor: pointer;
  flex-shrink: 0;
}
.info {
  flex: 1;
  min-width: 0;
}
.title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.artist {
  font-size: 0.85rem;
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.duration {
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
  flex-shrink: 0;
}
.delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  line-height: 1;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: transparent;
  color: inherit;
  cursor: pointer;
  flex-shrink: 0;
}
</style>

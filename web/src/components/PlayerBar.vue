<script setup lang="ts">
import { computed } from "vue";
import { playerState, currentTrack, toggle, next, prev, seek } from "../stores/player";
import { coverArtUrl, star, unstar } from "../api/subsonic";

function onSeek(e: Event) {
  seek(Number((e.target as HTMLInputElement).value));
}

const starred = computed(() => !!currentTrack.value?.starred);

// Mutates the shared Song object (not a local copy) — currentTrack is the
// same reactive object the track's list row renders, so this keeps both in
// sync without a round-trip re-fetch.
async function toggleStar() {
  const track = currentTrack.value;
  if (!track) return;
  const nextStarred = !starred.value;
  const prevStarred = track.starred;
  track.starred = nextStarred ? new Date().toISOString() : undefined; // optimistic
  try {
    await (nextStarred ? star(track.id) : unstar(track.id));
  } catch {
    track.starred = prevStarred;
  }
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
</script>

<template>
  <div v-if="currentTrack" class="player-bar glass">
    <img v-if="currentTrack.coverArt" class="cover" :src="coverArtUrl(currentTrack.coverArt)" alt="" />
    <div class="meta">
      <div class="title">{{ currentTrack.title }}</div>
      <div class="artist">{{ currentTrack.artist }}</div>
    </div>
    <button
      class="heart-btn"
      :class="{ starred }"
      :title="starred ? 'Unfavorite' : 'Favorite'"
      @click="toggleStar"
    >
      {{ starred ? "♥" : "♡" }}
    </button>
    <div class="controls">
      <button @click="prev">⏮</button>
      <button class="play-pause" @click="toggle">{{ playerState.isPlaying ? "⏸" : "▶" }}</button>
      <button @click="next">⏭</button>
    </div>
    <span class="time">{{ formatTime(playerState.currentTime) }}</span>
    <input
      class="seek"
      type="range"
      min="0"
      :max="playerState.duration || 0"
      :value="playerState.currentTime"
      @input="onSeek"
    />
    <span class="time">{{ formatTime(playerState.duration) }}</span>
  </div>
</template>

<style scoped>
.player-bar {
  position: fixed;
  left: 0.75rem;
  right: 0.75rem;
  bottom: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 1rem;
  z-index: 20;
  /* Floats over actively scrolling content, so it needs to read as solid —
     the shared .glass tint (5% white) is too subtle here and looked
     see-through against whatever track list is scrolled underneath it. */
  background: rgba(23, 26, 33, 0.92);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.cover {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 4px;
  object-fit: cover;
  flex-shrink: 0;
}
.meta {
  min-width: 8rem;
  max-width: 12rem;
  overflow: hidden;
}
.title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.artist {
  font-size: 0.8rem;
  opacity: 0.7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.heart-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  line-height: 1;
  font-size: 1.1rem;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
  flex-shrink: 0;
}
.heart-btn:hover {
  opacity: 1;
}
.heart-btn.starred {
  color: #e0245e;
  opacity: 1;
}
.controls {
  display: flex;
  gap: 0.4rem;
  flex-shrink: 0;
}
.controls button {
  background: none;
  border: none;
  color: inherit;
  font-size: 1.1rem;
  cursor: pointer;
}
.play-pause {
  font-size: 1.3rem;
}
.seek {
  flex: 1;
  min-width: 3rem;
}
.time {
  font-variant-numeric: tabular-nums;
  font-size: 0.8rem;
  opacity: 0.7;
  flex-shrink: 0;
}

@media (max-width: 600px) {
  .meta {
    min-width: 0;
    max-width: 6rem;
  }
}
</style>

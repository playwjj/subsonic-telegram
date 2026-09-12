<script setup lang="ts">
import { playerState, currentTrack, toggle, next, prev, seek } from "../stores/player";
import { coverArtUrl } from "../api/subsonic";

function onSeek(e: Event) {
  seek(Number((e.target as HTMLInputElement).value));
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

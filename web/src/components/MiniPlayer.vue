<script setup lang="ts">
import { computed } from "vue";
import { playerState, currentTrack, toggle, setView, closePlayer } from "../stores/player";
import { coverArtUrl } from "../api/subsonic";

// Progress ring around the disc: r=46 in a 100×100 viewBox.
const CIRCUMFERENCE = 2 * Math.PI * 46;
const dashOffset = computed(() => {
  const ratio = playerState.duration ? playerState.currentTime / playerState.duration : 0;
  return CIRCUMFERENCE * (1 - Math.min(Math.max(ratio, 0), 1));
});

const cover = computed(() =>
  currentTrack.value?.coverArt ? coverArtUrl(currentTrack.value.coverArt) : "/music-cover.jpg",
);
</script>

<template>
  <!-- Collapsed to just the disc; hovering (or any touch screen) slides out
       the controls. -->
  <div v-if="currentTrack" class="mini" :title="`${currentTrack.title} — ${currentTrack.artist}`">
    <div class="actions">
      <button class="act" title="Close" @click="closePlayer">✕</button>
      <button class="act" title="Restore" @click="setView('bar')">▭</button>
      <button class="act" title="Maximize" @click="setView('full')">⤢</button>
      <button class="act play" :title="playerState.isPlaying ? 'Pause' : 'Play'" @click="toggle">
        {{ playerState.isPlaying ? "⏸" : "▶" }}
      </button>
    </div>
    <button class="disc-btn" title="Open player" @click="setView('full')">
      <svg class="ring" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="46" class="ring-track" />
        <circle
          cx="50"
          cy="50"
          r="46"
          class="ring-fill"
          :stroke-dasharray="CIRCUMFERENCE"
          :stroke-dashoffset="dashOffset"
        />
      </svg>
      <span class="disc" :class="{ spinning: playerState.isPlaying }">
        <img :src="cover" alt="" />
      </span>
    </button>
  </div>
</template>

<style scoped>
.mini {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: 20;
  display: flex;
  align-items: center;
  padding: 0.3rem;
  border-radius: 999px;
  background: rgba(23, 26, 33, 0.92);
  border: 1px solid var(--border);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  animation: pop-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes pop-in {
  from {
    transform: scale(0.4) translateY(1rem);
    opacity: 0;
  }
}
.actions {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  max-width: 0;
  overflow: hidden;
  opacity: 0;
  transition:
    max-width 0.3s ease,
    opacity 0.2s ease,
    padding 0.3s ease;
}
.mini:hover .actions,
.mini:focus-within .actions {
  max-width: 12rem;
  opacity: 1;
  padding: 0 0.4rem 0 0.3rem;
}
@media (hover: none) {
  .actions {
    max-width: 12rem;
    opacity: 1;
    padding: 0 0.4rem 0 0.3rem;
  }
}
.act {
  width: 2rem;
  height: 2rem;
  padding: 0;
  flex-shrink: 0;
  line-height: 1;
  font-size: 0.9rem;
  border: none;
  border-radius: 50%;
  background: transparent;
  opacity: 0.7;
}
.act:hover {
  opacity: 1;
  background: var(--surface-hover);
}
.act.play {
  opacity: 1;
  font-size: 1.05rem;
}
.disc-btn {
  position: relative;
  width: 3.5rem;
  height: 3.5rem;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: none;
  flex-shrink: 0;
}
.disc-btn:hover {
  background: none;
}
.ring {
  position: absolute;
  inset: 0;
  transform: rotate(-90deg);
}
.ring-track,
.ring-fill {
  fill: none;
  stroke-width: 5;
}
.ring-track {
  stroke: rgba(255, 255, 255, 0.1);
}
.ring-fill {
  stroke: var(--accent);
  stroke-linecap: round;
  transition: stroke-dashoffset 0.3s linear;
}
.disc {
  position: absolute;
  inset: 5px;
  border-radius: 50%;
  overflow: hidden;
  background: #111;
  animation: spin 12s linear infinite;
  animation-play-state: paused;
}
.disc.spinning {
  animation-play-state: running;
}
.disc img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
@media (prefers-reduced-motion: reduce) {
  .disc {
    animation: none;
  }
}
</style>

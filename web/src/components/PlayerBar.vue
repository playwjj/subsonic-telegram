<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  playerState,
  currentTrack,
  toggle,
  next,
  prev,
  seek,
  toggleShuffle,
  cycleRepeat,
  setVolume,
  restoreQueue,
  toggleCurrentStar,
  setView,
  closePlayer,
} from "../stores/player";
import { coverArtUrl } from "../api/subsonic";
import { formatTime } from "../utils/format";
import StarRating from "./StarRating.vue";
import QueueModal from "./QueueModal.vue";
import FullPlayer from "./FullPlayer.vue";
import MiniPlayer from "./MiniPlayer.vue";

function onSeek(e: Event) {
  seek(Number((e.target as HTMLInputElement).value));
}

function onVolume(e: Event) {
  setVolume(Number((e.target as HTMLInputElement).value));
}

// Remembers the pre-mute level so unmuting goes back to it, not to 100%.
let volumeBeforeMute = 1;
function toggleMute() {
  if (playerState.volume > 0) {
    volumeBeforeMute = playerState.volume;
    setVolume(0);
  } else {
    setVolume(volumeBeforeMute || 1);
  }
}

const showQueue = ref(false);

const repeatTitle = computed(
  () => ({ off: "Repeat: off", all: "Repeat: all", one: "Repeat: one" })[playerState.repeat],
);

// Only mounted once logged in, so this is the first point the saved queue
// can be fetched.
onMounted(() => {
  void restoreQueue();
});

const starred = computed(() => !!currentTrack.value?.starred);
</script>

<template>
  <template v-if="currentTrack">
    <div v-if="playerState.view === 'bar'" class="player-bar glass">
      <button class="cover-btn" title="Open player" @click="setView('full')">
        <img class="cover" :src="currentTrack.coverArt ? coverArtUrl(currentTrack.coverArt) : '/music-cover.jpg'" alt="" />
        <span class="cover-hint">⤢</span>
      </button>
      <div class="meta" @click="setView('full')">
        <div class="title">{{ currentTrack.title }}</div>
        <div class="artist">{{ currentTrack.artist }}</div>
      </div>
      <button
        class="heart-btn"
        :class="{ starred }"
        :title="starred ? 'Unfavorite' : 'Favorite'"
        @click="toggleCurrentStar"
      >
        {{ starred ? "♥" : "♡" }}
      </button>
      <StarRating class="rating-slot" :song="currentTrack" />
      <button class="heart-btn extra" title="Lyrics" @click="setView('full')">🎤</button>
      <button class="heart-btn extra" title="Queue" @click="showQueue = true">☰</button>
      <div class="controls">
        <button
          class="mode-btn"
          :class="{ active: playerState.shuffle }"
          :title="playerState.shuffle ? 'Shuffle: on' : 'Shuffle: off'"
          @click="toggleShuffle"
        >
          🔀
        </button>
        <button @click="prev">⏮</button>
        <button class="play-pause" @click="toggle">{{ playerState.isPlaying ? "⏸" : "▶" }}</button>
        <button @click="next">⏭</button>
        <button
          class="mode-btn"
          :class="{ active: playerState.repeat !== 'off' }"
          :title="repeatTitle"
          @click="cycleRepeat"
        >
          {{ playerState.repeat === "one" ? "🔂" : "🔁" }}
        </button>
      </div>
      <div class="progress">
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
      <div class="volume">
        <button class="heart-btn" :title="playerState.volume > 0 ? 'Mute' : 'Unmute'" @click="toggleMute">
          {{ playerState.volume === 0 ? "🔇" : playerState.volume < 0.5 ? "🔉" : "🔊" }}
        </button>
        <input type="range" min="0" max="1" step="0.01" :value="playerState.volume" @input="onVolume" />
      </div>
      <div class="window-btns">
        <button class="win-btn" title="Maximize" @click="setView('full')">⤢</button>
        <button class="win-btn" title="Minimize" @click="setView('mini')">–</button>
        <button class="win-btn" title="Close" @click="closePlayer">✕</button>
      </div>
    </div>

    <MiniPlayer v-if="playerState.view === 'mini'" />
    <FullPlayer :open="playerState.view === 'full'" @queue="showQueue = true" />
    <QueueModal v-if="showQueue" @close="showQueue = false" />
  </template>
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
.cover-btn {
  position: relative;
  flex-shrink: 0;
  padding: 0;
  border: none;
  background: none;
  border-radius: 4px;
  overflow: hidden;
  line-height: 0;
}
.cover-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  line-height: 1;
  color: #fff;
  background: rgba(0, 0, 0, 0.45);
  opacity: 0;
  transition: opacity 0.15s ease;
}
.cover-btn:hover .cover-hint {
  opacity: 1;
}
.cover {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 4px;
  object-fit: cover;
  flex-shrink: 0;
}
.meta {
  cursor: pointer;
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
.controls .mode-btn {
  font-size: 0.95rem;
  opacity: 0.4;
}
.controls .mode-btn.active {
  opacity: 1;
}
.volume {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
}
.volume input {
  width: 5rem;
}
.progress {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 1;
  min-width: 0;
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

.window-btns {
  display: flex;
  gap: 0.1rem;
  flex-shrink: 0;
  margin-left: 0.25rem;
  padding-left: 0.5rem;
  border-left: 1px solid var(--border);
}
.win-btn {
  width: 1.6rem;
  height: 1.6rem;
  padding: 0;
  line-height: 1;
  font-size: 0.9rem;
  border: none;
  border-radius: 6px;
  background: transparent;
  opacity: 0.55;
}
.win-btn:hover {
  opacity: 1;
  background: var(--surface-hover);
}

/* Phones: one row can't fit everything (it used to push the playback
   controls off the right edge), so wrap into two — cover/title/♥/controls
   on top, progress bar + lyrics/queue below. The progress row's 60% basis
   is what forces the wrap; it then grows to fill the second line. */
@media (max-width: 600px) {
  .player-bar {
    flex-wrap: wrap;
    gap: 0.4rem 0.5rem;
    padding: 0.5rem 0.75rem;
  }
  .meta {
    flex: 1 1 0;
    min-width: 0;
    max-width: none;
  }
  .controls {
    gap: 0;
  }
  .controls button {
    width: 1.9rem;
    padding: 0.25rem 0;
  }
  .cover {
    width: 2.25rem;
    height: 2.25rem;
  }
  .progress {
    order: 1;
    flex: 1 1 60%;
    gap: 0.5rem;
  }
  .extra,
  .window-btns {
    order: 2;
  }
  .window-btns {
    margin-left: 0;
    padding-left: 0.25rem;
  }
  /* Rating stays available on every track row; phones use hardware volume. */
  .rating-slot,
  .volume {
    display: none;
  }
}

</style>

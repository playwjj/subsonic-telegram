<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
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
  jumpTo,
  removeFromQueue,
  clearQueue,
} from "../stores/player";
import { coverArtUrl, star, unstar, getLyrics } from "../api/subsonic";
import StarRating from "./StarRating.vue";
import Modal from "./Modal.vue";

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
const queueList = ref<HTMLElement | null>(null);

async function openQueue() {
  showQueue.value = true;
  await nextTick();
  queueList.value?.querySelector(".queue-item.current")?.scrollIntoView({ block: "center" });
}

function handleClearQueue() {
  showQueue.value = false;
  clearQueue();
}

const repeatTitle = computed(
  () => ({ off: "Repeat: off", all: "Repeat: all", one: "Repeat: one" })[playerState.repeat],
);

// Only mounted once logged in, so this is the first point the saved queue
// can be fetched.
onMounted(() => {
  void restoreQueue();
});

const starred = computed(() => !!currentTrack.value?.starred);

const showLyrics = ref(false);
const lyricsState = ref<"loading" | "found" | "empty" | "error">("loading");
const lyricsText = ref("");

async function loadLyrics() {
  const track = currentTrack.value;
  if (!track) return;
  lyricsState.value = "loading";
  try {
    const lyrics = await getLyrics(track.artist, track.title);
    lyricsText.value = lyrics.value ?? "";
    lyricsState.value = lyrics.value ? "found" : "empty";
  } catch {
    lyricsState.value = "error";
  }
}

function openLyrics() {
  showLyrics.value = true;
  loadLyrics();
}

// Keep showing lyrics through track changes (e.g. a queue playing through)
// rather than silently going stale — but only while the panel is open, so
// switching tracks never fires an LRCLIB request the user hasn't asked for.
watch(currentTrack, () => {
  if (showLyrics.value) loadLyrics();
});

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
    <StarRating :song="currentTrack" />
    <button class="heart-btn" title="Lyrics" @click="openLyrics">🎤</button>
    <button class="heart-btn" title="Queue" @click="openQueue">☰</button>
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
    <div class="volume">
      <button class="heart-btn" :title="playerState.volume > 0 ? 'Mute' : 'Unmute'" @click="toggleMute">
        {{ playerState.volume === 0 ? "🔇" : playerState.volume < 0.5 ? "🔉" : "🔊" }}
      </button>
      <input type="range" min="0" max="1" step="0.01" :value="playerState.volume" @input="onVolume" />
    </div>

    <Modal
      v-if="showLyrics"
      :title="`${currentTrack.title} — ${currentTrack.artist}`"
      @close="showLyrics = false"
    >
      <p v-if="lyricsState === 'loading'" class="lyrics-status">Loading lyrics…</p>
      <p v-else-if="lyricsState === 'empty'" class="lyrics-status">No lyrics found.</p>
      <p v-else-if="lyricsState === 'error'" class="lyrics-status">Couldn't load lyrics.</p>
      <pre v-else class="lyrics-text">{{ lyricsText }}</pre>
    </Modal>

    <Modal v-if="showQueue" :title="`Queue · ${playerState.queue.length}`" @close="showQueue = false">
      <div class="queue-actions">
        <button @click="handleClearQueue">Clear queue</button>
      </div>
      <ol ref="queueList" class="queue-list">
        <li
          v-for="(song, i) in playerState.queue"
          :key="`${song.id}-${i}`"
          class="queue-item"
          :class="{ current: i === playerState.currentIndex, played: i < playerState.currentIndex }"
        >
          <button class="queue-jump" @click="jumpTo(i)">
            <span class="queue-index">{{ i === playerState.currentIndex ? "▶" : i + 1 }}</span>
            <span class="queue-meta">
              <span class="queue-title">{{ song.title }}</span>
              <span class="queue-artist">{{ song.artist }}</span>
            </span>
          </button>
          <button class="heart-btn" title="Remove from queue" @click="removeFromQueue(i)">✕</button>
        </li>
      </ol>
    </Modal>
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
  /* Phones use hardware volume buttons; the slider just eats seek-bar room. */
  .volume {
    display: none;
  }
  .meta {
    min-width: 0;
    max-width: 6rem;
  }
}

.queue-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 0.5rem;
}
.queue-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.queue-item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 6px;
}
.queue-item.current {
  background: var(--surface-hover);
}
.queue-item.played {
  opacity: 0.5;
}
.queue-jump {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex: 1;
  min-width: 0;
  padding: 0.4rem 0.5rem;
  background: none;
  border: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.queue-index {
  width: 1.75rem;
  flex-shrink: 0;
  text-align: right;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  opacity: 0.6;
}
.queue-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.queue-title,
.queue-artist {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.queue-artist {
  font-size: 0.8rem;
  opacity: 0.7;
}

.lyrics-status {
  opacity: 0.7;
  text-align: center;
  padding: 1rem 0;
}
.lyrics-text {
  white-space: pre-wrap;
  font-family: inherit;
  line-height: 1.6;
  text-align: center;
}
</style>

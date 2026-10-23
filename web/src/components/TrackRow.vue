<script setup lang="ts">
import { computed } from "vue";
import { coverArtUrl, star, unstar, type Song } from "../api/subsonic";
import AddToPlaylistMenu from "./AddToPlaylistMenu.vue";
import QueueMenu from "./QueueMenu.vue";
import StarRating from "./StarRating.vue";

// `deletable` is opt-in per view: library views (Songs/Album) show a
// delete (to trash) button, but derived views like a playlist or search
// results don't — a playlist already has its own "remove from playlist"
// action (updatePlaylist), which is a different, much less destructive thing.
const props = defineProps<{ song: Song; deletable?: boolean; editable?: boolean }>();
const emit = defineEmits<{ play: []; delete: []; edit: [] }>();

const starred = computed(() => !!props.song.starred);

// Mutates the shared Song object (not a local copy) so the player bar and
// any other row rendering this same track — it's the same reactive object
// wherever a queue/list holds it — flip their heart in lockstep.
async function toggleStar() {
  const next = !starred.value;
  const prev = props.song.starred;
  props.song.starred = next ? new Date().toISOString() : undefined; // optimistic
  try {
    await (next ? star(props.song.id) : unstar(props.song.id));
  } catch {
    props.song.starred = prev;
  }
}

// Phones hide the ▶ button (no room), so tapping the title plays instead.
function playFromInfo() {
  if (window.matchMedia("(max-width: 600px)").matches) emit("play");
}

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
    <button class="cover-btn" title="Play" @click="emit('play')">
      <img
        v-if="song.coverArt"
        class="cover"
        :src="coverArtUrl(song.coverArt)"
        :alt="`${song.album} cover`"
        @error="($event.target as HTMLImageElement).style.display = 'none'"
      />
      <span class="cover-play">▶</span>
    </button>
    <div class="info" @click="playFromInfo">
      <div class="title">{{ song.title }}</div>
      <div class="artist">{{ song.artist }}</div>
    </div>
    <div class="duration">{{ formatDuration(song.duration) }}</div>
    <StarRating class="wide-only" :song="song" />
    <button
      class="heart-btn"
      :class="{ starred }"
      :title="starred ? 'Unfavorite' : 'Favorite'"
      @click="toggleStar"
    >
      {{ starred ? "♥" : "♡" }}
    </button>
    <QueueMenu :song="song">
      <!-- Phones: the rating and edit/delete buttons don't fit on the row,
           so they live in this menu instead. -->
      <template #default="{ close }">
        <div class="narrow-only menu-rating">
          <span>Rate</span>
          <StarRating :song="song" />
        </div>
        <button v-if="editable" class="option narrow-only" @click="close(); emit('edit')">Edit tags…</button>
        <button v-if="deletable" class="option narrow-only" @click="close(); emit('delete')">Move to trash</button>
        <slot name="menu" :close="close" />
      </template>
    </QueueMenu>
    <AddToPlaylistMenu :song-id="song.id" />
    <button v-if="editable" class="delete-btn wide-only" title="Edit tags" @click="emit('edit')">✎</button>
    <button v-if="deletable" class="delete-btn wide-only" title="Move to trash" @click="emit('delete')">🗑</button>
  </div>
</template>

<style scoped>
.track-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
}
.track-row + .track-row {
  border-top: 1px solid var(--border);
}
.cover-btn {
  position: relative;
  flex-shrink: 0;
  width: 3rem;
  height: 3rem;
  padding: 0;
  border: none;
  border-radius: 6px;
  overflow: hidden;
  background: var(--surface-hover);
  line-height: 0;
}
.cover-play {
  position: absolute;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  line-height: 1;
  color: #fff;
  background: rgba(0, 0, 0, 0.35);
}
.cover-btn:hover .cover-play {
  display: flex;
}
.cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 6px;
  background: var(--surface-hover);
  flex-shrink: 0;
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
.option {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.4rem 0.5rem;
  background: none;
  border: none;
  border-radius: 4px;
}
.option:hover {
  background: var(--surface-hover);
}
.menu-rating {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0.5rem;
}
.narrow-only {
  display: none;
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

/* Phones: drop the ▶ button (the cover plays, with a ▶ overlay), tighten
   gaps and move rating/edit/delete into the ⋯ menu so the title keeps room. */
@media (max-width: 600px) {
  .track-row {
    gap: 0.5rem;
  }
  .play-btn,
  .wide-only {
    display: none;
  }
  .cover-btn {
    width: 2.75rem;
    height: 2.75rem;
  }
  .cover-play {
    display: flex;
  }
  .info {
    cursor: pointer;
  }
  .duration {
    font-size: 0.8rem;
  }
  .narrow-only {
    display: flex;
  }
  .option.narrow-only {
    display: block;
  }
}
</style>

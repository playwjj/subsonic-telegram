<script setup lang="ts">
import { ref } from "vue";
import type { Song } from "../api/subsonic";
import { shufflePlay } from "../stores/player";

// For lists the view doesn't already hold in full (a whole folder tree, an
// artist, the library, a playlist from the list page) — fetches them on
// click, then starts a shuffled queue.
const props = defineProps<{ load: () => Promise<Song[]>; label?: string }>();

const busy = ref(false);
const empty = ref(false);

async function onClick() {
  busy.value = true;
  empty.value = false;
  try {
    const songs = await props.load();
    if (songs.length) shufflePlay(songs);
    else empty.value = true;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <button :disabled="busy" :title="empty ? 'No songs to play' : undefined" @click="onClick">
    🔀 {{ busy ? "Loading…" : empty ? "No songs" : (label ?? "Shuffle") }}
  </button>
</template>

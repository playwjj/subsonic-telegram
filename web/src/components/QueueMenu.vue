<script setup lang="ts">
import { ref } from "vue";
import type { Song } from "../api/subsonic";
import { addToQueue, playNext } from "../stores/player";

const props = defineProps<{ song: Song }>();

const open = ref(false);

function choose(action: (song: Song) => void) {
  action(props.song);
  open.value = false;
}
</script>

<template>
  <div class="queue-menu">
    <button class="icon-btn" title="Queue" @click="open = !open">⋯</button>
    <div v-if="open" class="dropdown">
      <button class="option" @click="choose(playNext)">Play next</button>
      <button class="option" @click="choose(addToQueue)">Add to queue</button>
    </div>
  </div>
</template>

<style scoped>
.queue-menu {
  position: relative;
}
.icon-btn {
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
}
.dropdown {
  position: absolute;
  right: 0;
  top: 2rem;
  z-index: 30;
  background: rgba(23, 26, 33, 0.92);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  min-width: 10rem;
  padding: 0.4rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.option {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.4rem 0.5rem;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  border-radius: 4px;
}
.option:hover {
  background: var(--surface-hover);
}
</style>

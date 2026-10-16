<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { playerState, jumpTo, removeFromQueue, clearQueue } from "../stores/player";
import Modal from "./Modal.vue";

const emit = defineEmits<{ close: [] }>();

const queueList = ref<HTMLElement | null>(null);

onMounted(async () => {
  await nextTick();
  queueList.value?.querySelector(".queue-item.current")?.scrollIntoView({ block: "center" });
});

function handleClearQueue() {
  emit("close");
  clearQueue();
}
</script>

<template>
  <Modal :title="`Queue · ${playerState.queue.length}`" @close="emit('close')">
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
        <button class="remove-btn" title="Remove from queue" @click="removeFromQueue(i)">✕</button>
      </li>
    </ol>
  </Modal>
</template>

<style scoped>
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
.remove-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  font-size: 1.1rem;
  border-radius: 50%;
  border: none;
  background: transparent;
  opacity: 0.6;
  flex-shrink: 0;
}
.remove-btn:hover {
  opacity: 1;
}
</style>

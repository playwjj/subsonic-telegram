<script setup lang="ts">
import { ref } from "vue";
import Modal from "../Modal.vue";
import FolderTree from "./FolderTree.vue";
import { canDropInto, type DragPayload } from "../../stores/folders";

// `from` is the folder the items all sit in, if they share one (not for
// search results) — moving there would be a no-op.
const props = defineProps<{ items: DragPayload; from?: string; count: number }>();
const emit = defineEmits<{ close: []; move: [dest: string] }>();

const dest = ref(props.from ?? "");
</script>

<template>
  <Modal :title="`Move ${count} item${count === 1 ? '' : 's'} to…`" @close="emit('close')">
    <div class="glass max-h-[55vh] overflow-y-auto p-1">
      <FolderTree :selected="dest" :disabled="(path) => !canDropInto(path, items)" @select="dest = $event" />
    </div>
    <div class="mt-4 flex items-center justify-end gap-2">
      <span class="mr-auto truncate text-sm text-[var(--text-dim)]">→ {{ dest || "All folders (root)" }}</span>
      <button @click="emit('close')">Cancel</button>
      <button class="primary" :disabled="dest === from" @click="emit('move', dest)">Move here</button>
    </div>
  </Modal>
</template>

<style scoped>
.primary {
  border-color: var(--accent);
  color: var(--accent);
}
</style>

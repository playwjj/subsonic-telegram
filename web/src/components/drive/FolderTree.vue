<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { canDropInto, childFolders, drag, folderTree } from "../../stores/folders";
import { baseName } from "../../utils/format";

// Used both as the Folders view's sidebar (navigates, and accepts dragged
// items) and inside the "Move to…" dialog (just picks a destination).
const props = defineProps<{
  selected: string;
  // Greys out folders that can't be chosen (e.g. moving a folder into itself).
  disabled?: (path: string) => boolean;
  acceptDrops?: boolean;
}>();
const emit = defineEmits<{ select: [path: string]; drop: [path: string] }>();

const expanded = reactive(new Set<string>([""]));

// Keep the selected folder visible by expanding everything above it.
watch(
  () => props.selected,
  (path) => {
    const segments = path ? path.split("/") : [];
    for (let i = 0; i < segments.length; i++) expanded.add(segments.slice(0, i).join("/"));
  },
  { immediate: true },
);

interface Row {
  path: string;
  name: string;
  depth: number;
  hasChildren: boolean;
}

const rows = computed<Row[]>(() => {
  const out: Row[] = [{ path: "", name: "All folders", depth: 0, hasChildren: childFolders.value.has("") }];
  const walk = (parent: string, depth: number) => {
    if (!expanded.has(parent)) return;
    for (const folder of childFolders.value.get(parent) ?? []) {
      out.push({ path: folder.path, name: baseName(folder.path), depth, hasChildren: childFolders.value.has(folder.path) });
      walk(folder.path, depth + 1);
    }
  };
  walk("", 1);
  return out;
});

function toggle(path: string) {
  if (expanded.has(path)) expanded.delete(path);
  else expanded.add(path);
}

const dropTarget = ref<string | null>(null);

function onDragOver(e: DragEvent, path: string) {
  if (!props.acceptDrops || !canDropInto(path)) return;
  e.preventDefault();
  dropTarget.value = path;
}

function onDrop(path: string) {
  dropTarget.value = null;
  emit("drop", path);
}
</script>

<template>
  <div class="tree text-sm">
    <p v-if="!folderTree.loaded" class="flex items-center gap-2 p-2 text-[var(--text-dim)]"><span class="spinner"></span></p>
    <div
      v-for="row in rows"
      :key="row.path"
      class="tree-row"
      :class="{
        selected: row.path === selected,
        disabled: disabled?.(row.path),
        'drop-target': dropTarget === row.path && drag.payload,
      }"
      :style="{ paddingLeft: `${row.depth * 0.9 + 0.25}rem` }"
      :title="row.path || 'All folders'"
      @click="!disabled?.(row.path) && emit('select', row.path)"
      @dragover="onDragOver($event, row.path)"
      @dragleave="dropTarget = null"
      @drop.prevent="onDrop(row.path)"
    >
      <button
        class="caret"
        :class="{ invisible: !row.hasChildren }"
        :title="expanded.has(row.path) ? 'Collapse' : 'Expand'"
        @click.stop="toggle(row.path)"
      >
        {{ expanded.has(row.path) ? "▾" : "▸" }}
      </button>
      <span>{{ row.path ? "📁" : "🗂" }}</span>
      <span class="truncate">{{ row.name }}</span>
    </div>
  </div>
</template>

<style scoped>
.tree-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding-top: 0.3rem;
  padding-bottom: 0.3rem;
  padding-right: 0.4rem;
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
}
.tree-row:hover {
  background: rgba(255, 255, 255, 0.05);
}
.tree-row.selected {
  background: rgba(125, 211, 192, 0.14);
  color: var(--accent);
}
.tree-row.disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.tree-row.drop-target {
  outline: 1px dashed var(--accent);
  background: rgba(125, 211, 192, 0.1);
}
.caret {
  width: 1rem;
  padding: 0;
  border: none;
  background: transparent;
  font-size: 0.7rem;
  opacity: 0.7;
  flex-shrink: 0;
}
.caret:hover {
  background: transparent;
  opacity: 1;
}
</style>

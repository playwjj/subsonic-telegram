<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { getFolder } from "../../api/subsonic";
import { defaultUploadFolder, enqueue, readTags, stage, stem } from "../../stores/uploads";
import { formatBytes, joinPath } from "../../utils/format";
import type { PickedFile } from "../../utils/pickFiles";
import Modal from "../Modal.vue";

// Review step between picking/dropping files and queueing them: where they
// go, what tags were found, what can't be uploaded, what already exists.
const props = defineProps<{ picked: PickedFile[]; folder: string }>();
const emit = defineEmits<{ close: [] }>();

const { items, ignored } = stage(props.picked);
const folder = ref(props.folder);
const overrides = reactive({ artist: "", album: "", genre: "", year: undefined as number | undefined });
const onConflict = ref<"skip" | "rename">("skip");

const valid = computed(() => items.filter((i) => !i.invalid));
const invalidCount = computed(() => items.length - valid.value.length);
const totalSize = computed(() => valid.value.reduce((n, i) => n + i.file.size, 0));

function destinationOf(relDir: string): string {
  return joinPath(folder.value.trim(), relDir) || defaultUploadFolder();
}

// Read tags one file at a time in the background (anything still unread
// when the batch starts is read by the queue right before uploading).
let stopped = false;
onMounted(async () => {
  for (const item of items) {
    if (stopped) return;
    await readTags(item);
  }
});
onUnmounted(() => (stopped = true));

// Which destination folders already hold a file of the same name.
const existing = ref(new Map<string, Set<string>>());
let checkTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  folder,
  () => {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(async () => {
      const dirs = [...new Set(valid.value.map((i) => destinationOf(i.relDir)))];
      const found = new Map<string, Set<string>>();
      await Promise.all(
        dirs.map(async (dir) => {
          try {
            const listing = await getFolder(dir);
            found.set(dir, new Set(listing.songs.map((s) => s.path?.slice(s.path.lastIndexOf("/") + 1) ?? "")));
          } catch {
            // can't tell — treat as no clashes; the server still checks
          }
        }),
      );
      existing.value = found;
    }, 300);
  },
  { immediate: true },
);
const exists = (item: (typeof items)[number]) => !!existing.value.get(destinationOf(item.relDir))?.has(item.file.name);
const existingCount = computed(() => valid.value.filter(exists).length);

function start() {
  enqueue(items, {
    folder: folder.value.trim(),
    overrides: {
      artist: overrides.artist.trim() || undefined,
      album: overrides.album.trim() || undefined,
      genre: overrides.genre.trim() || undefined,
      year: overrides.year || undefined,
    },
    onConflict: onConflict.value,
  });
  emit("close");
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
</script>

<template>
  <Modal :title="`Upload ${plural(items.length, 'file')}`" wide @close="emit('close')">
    <div class="space-y-4 text-sm">
      <label class="block">
        Upload to
        <input v-model="folder" class="mt-1 w-full" :placeholder="defaultUploadFolder()" />
        <span class="mt-1 block text-xs text-[var(--text-dim)]">
          Folders you dropped keep their structure inside it.
          <template v-if="!folder.trim()">Loose files go to “{{ defaultUploadFolder() }}”.</template>
        </span>
      </label>

      <details class="rounded-lg border border-[var(--border)] px-3 py-2">
        <summary class="cursor-pointer">Set tags for all files <span class="text-[var(--text-dim)]">(optional — overrides what the files say)</span></summary>
        <div class="mt-3 grid grid-cols-2 gap-3">
          <label>Artist <input v-model="overrides.artist" class="mt-1 w-full" placeholder="From tags" /></label>
          <label>Album <input v-model="overrides.album" class="mt-1 w-full" placeholder="From tags" /></label>
          <label>Genre <input v-model="overrides.genre" class="mt-1 w-full" placeholder="From tags" /></label>
          <label>Year <input v-model.number="overrides.year" type="number" class="mt-1 w-full" placeholder="From tags" /></label>
        </div>
      </details>

      <div v-if="existingCount" class="rounded-lg border border-[var(--border)] px-3 py-2">
        <p>{{ plural(existingCount, "file") }} already {{ existingCount === 1 ? "exists" : "exist" }} in the destination.</p>
        <label class="mr-4"><input v-model="onConflict" type="radio" value="skip" /> Skip {{ existingCount === 1 ? "it" : "them" }}</label>
        <label><input v-model="onConflict" type="radio" value="rename" /> Upload anyway, as “name (1)”</label>
      </div>

      <div class="file-list">
        <div v-for="item in items" :key="item.id" class="file-row" :class="{ dim: item.invalid }">
          <span>🎵</span>
          <div class="min-w-0">
            <div class="truncate">{{ item.file.name }}</div>
            <div class="sub truncate">
              <template v-if="item.relDir">📁 {{ item.relDir }} · </template>
              <template v-if="!item.tags">Reading tags…</template>
              <template v-else>
                {{ item.tags.title || stem(item.file.name) }} · {{ overrides.artist || item.tags.artist || "Unknown artist" }}
                <template v-if="overrides.album || item.tags.album"> · {{ overrides.album || item.tags.album }}</template>
              </template>
            </div>
          </div>
          <span class="size">{{ formatBytes(item.file.size) }}</span>
          <span v-if="item.invalid" class="badge bad" :title="item.invalid">Too large</span>
          <span v-else-if="exists(item)" class="badge">{{ onConflict === "skip" ? "Exists — skip" : "Exists — copy" }}</span>
          <span v-else></span>
        </div>
      </div>

      <p class="text-xs text-[var(--text-dim)]">
        {{ plural(valid.length - (onConflict === "skip" ? existingCount : 0), "file") }} to upload · {{ formatBytes(totalSize) }}
        <template v-if="invalidCount"> · {{ invalidCount }} too large, left out</template>
        <template v-if="ignored"> · {{ plural(ignored, "non-audio file") }} ignored</template>
        <template v-if="valid.length > 20"> · Telegram accepts about 20 files a minute, so this takes a while — you can keep browsing meanwhile.</template>
      </p>
    </div>

    <div class="mt-5 flex justify-end gap-2">
      <button @click="emit('close')">Cancel</button>
      <button class="primary" :disabled="!valid.length" @click="start">Upload</button>
    </div>
  </Modal>
</template>

<style scoped>
.file-list {
  max-height: 40vh;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.25rem;
}
.file-row {
  display: grid;
  grid-template-columns: 1.25rem minmax(0, 1fr) 4.5rem 6.5rem;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.4rem;
}
.file-row + .file-row {
  border-top: 1px solid var(--border);
}
.file-row.dim {
  opacity: 0.5;
}
.sub {
  font-size: 0.75rem;
  color: var(--text-dim);
}
.size {
  text-align: right;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.badge {
  justify-self: end;
  font-size: 0.7rem;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-dim);
  white-space: nowrap;
}
.badge.bad {
  color: var(--danger);
  border-color: var(--danger);
}
.primary {
  border-color: var(--accent);
  color: var(--accent);
}
@media (max-width: 600px) {
  .file-row {
    grid-template-columns: 1.25rem minmax(0, 1fr) 5.5rem;
  }
  .size {
    display: none;
  }
}
</style>

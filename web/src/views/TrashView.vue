<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { getTrash, restoreTrash, purgeTrash, SubsonicError, type TrashEntry } from "../api/subsonic";
import { loadFolderTree } from "../stores/folders";
import { formatBytes, formatDate, parentOf } from "../utils/format";
import ConfirmDialog from "../components/ConfirmDialog.vue";

const entries = ref<TrashEntry[]>([]);
const retentionDays = ref(30);
const pendingDeletes = ref(0);
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const notice = ref("");

async function load() {
  try {
    const trash = await getTrash();
    entries.value = trash.entries;
    retentionDays.value = trash.retentionDays;
    pendingDeletes.value = trash.pendingDeletes;
  } catch (e) {
    error.value = e instanceof SubsonicError ? e.message : "Failed to load the trash";
  } finally {
    loading.value = false;
  }
}
load();

const selected = reactive(new Set<string>());
const selectedEntries = computed(() => entries.value.filter((e) => selected.has(e.id)));
const totalSize = computed(() => entries.value.reduce((sum, e) => sum + e.size, 0));

function toggleAll() {
  if (selected.size === entries.value.length) selected.clear();
  else for (const e of entries.value) selected.add(e.id);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function daysLeft(entry: TrashEntry): string {
  const days = Math.ceil((new Date(entry.expires).getTime() - Date.now()) / 86400000);
  return days <= 0 ? "deleted at the next cleanup" : days === 1 ? "1 day left" : `${days} days left`;
}

// Where it was: the folder it sat in (a deleted folder's parent).
function locationOf(entry: TrashEntry): string | null {
  if (!entry.path) return null;
  return parentOf(entry.path);
}

function folderRoute(path: string) {
  return { name: "folders", params: { path: path ? path.split("/") : [] } };
}

async function run(action: () => Promise<string>) {
  busy.value = true;
  error.value = "";
  try {
    notice.value = await action();
    selected.clear();
    await Promise.all([load(), loadFolderTree()]);
  } catch (e) {
    error.value = e instanceof SubsonicError ? e.message : "Something went wrong";
  } finally {
    busy.value = false;
  }
}

function restore(list: TrashEntry[]) {
  run(async () => {
    const { restored, renamed, skipped } = await restoreTrash(list.map((e) => e.id));
    return [
      `Restored ${plural(restored, "song")}.`,
      renamed ? `${renamed} came back renamed — the name was taken meanwhile.` : "",
      skipped ? `${skipped} skipped — the same song exists again.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  });
}

// What "Delete forever" applies to: the selection, or everything.
const purgeDialog = ref<{ list: TrashEntry[] | "all" } | null>(null);
const purgeSummary = computed(() => {
  const list = purgeDialog.value?.list === "all" ? entries.value : (purgeDialog.value?.list ?? []);
  return {
    count: list.length,
    songs: list.reduce((n, e) => n + e.songCount, 0),
    size: list.reduce((n, e) => n + e.size, 0),
  };
});

function confirmPurge() {
  const target = purgeDialog.value!.list;
  purgeDialog.value = null;
  run(async () => {
    const purged = await purgeTrash(target === "all" ? "all" : target.map((e) => e.id));
    return `Deleted ${plural(purged, "item")} forever.`;
  });
}
</script>

<template>
  <div>
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <h1 class="text-xl font-semibold">Trash</h1>
      <span v-if="entries.length" class="text-sm text-[var(--text-dim)]">
        {{ plural(entries.length, "item") }} · {{ formatBytes(totalSize) }}
      </span>
      <RouterLink :to="{ name: 'folders', params: {} }" class="ml-auto text-sm text-[var(--text-dim)] hover:text-[var(--text)]">
        ← Folders
      </RouterLink>
      <button class="danger text-sm" :disabled="busy || !entries.length" @click="purgeDialog = { list: 'all' }">
        Empty trash
      </button>
    </div>

    <p class="mb-4 text-sm text-[var(--text-dim)]">
      Deleted songs and folders stay here for {{ retentionDays }} days, then they're deleted for good — files on Telegram
      included. Until then nothing is removed from Telegram, and restoring brings back their playlist entries and
      favorites too.
    </p>
    <p v-if="pendingDeletes" class="mb-4 rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
      ⚠ {{ plural(pendingDeletes, "Telegram file") }} couldn't be deleted yet and will be retried daily. If this number
      doesn't go down, check that the bot has the “Delete messages” permission in the channel.
    </p>

    <div v-if="selected.size" class="selection-bar glass">
      <span class="font-medium">{{ selected.size }} selected</span>
      <div class="ml-auto flex gap-1.5">
        <button :disabled="busy" @click="restore(selectedEntries)">Restore</button>
        <button class="danger" :disabled="busy" @click="purgeDialog = { list: selectedEntries }">Delete forever</button>
        <button title="Clear selection" @click="selected.clear()">✕</button>
      </div>
    </div>

    <p v-if="error" class="error mb-3 text-sm">{{ error }}</p>
    <p v-if="notice" class="mb-3 text-sm text-[var(--accent)]">{{ notice }}</p>

    <p v-if="loading" class="flex items-center gap-2 text-[var(--text-dim)]"><span class="spinner"></span> Loading…</p>
    <p v-else-if="!entries.length" class="py-10 text-center text-[var(--text-dim)]">The trash is empty.</p>

    <div v-else class="glass list">
      <div class="row header">
        <input
          type="checkbox"
          :checked="selected.size === entries.length"
          :indeterminate="selected.size > 0 && selected.size < entries.length"
          title="Select all"
          @change="toggleAll"
        />
        <span></span>
        <span>Name</span>
        <span class="col-size">Size</span>
        <span class="col-deleted">Deleted</span>
        <span></span>
      </div>
      <div
        v-for="entry in entries"
        :key="entry.id"
        class="row"
        :class="{ selected: selected.has(entry.id) }"
        @click="selected.has(entry.id) ? selected.delete(entry.id) : selected.add(entry.id)"
      >
        <input type="checkbox" :checked="selected.has(entry.id)" @click.stop="selected.has(entry.id) ? selected.delete(entry.id) : selected.add(entry.id)" />
        <span class="text-xl">{{ entry.kind === "folder" ? "📁" : "🎵" }}</span>
        <div class="min-w-0">
          <div class="truncate">{{ entry.name }}</div>
          <div class="sub truncate">
            <template v-if="entry.kind === 'folder'">{{ plural(entry.songCount, "song") }} · </template>
            <template v-if="locationOf(entry) !== null">
              from
              <RouterLink :to="folderRoute(locationOf(entry)!)" class="hover:text-[var(--text)]" @click.stop>
                {{ locationOf(entry) || "the root folder" }}
              </RouterLink>
            </template>
            <template v-else>not in a folder</template>
          </div>
        </div>
        <span class="col-size">{{ formatBytes(entry.size) }}</span>
        <span class="col-deleted">
          {{ formatDate(entry.deleted) }}
          <span class="sub block">{{ daysLeft(entry) }}</span>
        </span>
        <button class="restore" :disabled="busy" title="Restore" @click.stop="restore([entry])">↩︎</button>
      </div>
    </div>

    <ConfirmDialog
      v-if="purgeDialog"
      title="Delete forever?"
      confirm-label="Delete forever"
      danger
      @close="purgeDialog = null"
      @confirm="confirmPurge"
    >
      <p>
        {{ purgeDialog.list === "all" ? "Empty the trash" : `Delete ${plural(purgeSummary.count, "item")} forever` }} —
        {{ plural(purgeSummary.songs, "song") }}, {{ formatBytes(purgeSummary.size) }}?
      </p>
      <p class="text-[var(--text-dim)]">The files are deleted from Telegram too. This can't be undone.</p>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.danger {
  color: var(--danger);
}
.selection-bar {
  position: sticky;
  top: 5rem;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.75rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  background: rgba(23, 26, 33, 0.9);
}
.selection-bar button {
  padding: 0.3rem 0.6rem;
}
.list {
  padding: 0.25rem;
}
.row {
  display: grid;
  grid-template-columns: 1.25rem 1.75rem minmax(0, 1fr) 4.5rem 7rem 2rem;
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 0.5rem;
  border-radius: 10px;
  font-size: 0.875rem;
  cursor: default;
  user-select: none;
}
.row:not(.header):hover {
  background: rgba(255, 255, 255, 0.04);
}
.row.selected {
  background: rgba(125, 211, 192, 0.12);
}
.row.header {
  color: var(--text-dim);
  font-size: 0.75rem;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
}
.sub {
  font-size: 0.75rem;
  color: var(--text-dim);
}
.col-size {
  text-align: right;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.col-deleted {
  color: var(--text-dim);
  font-size: 0.8rem;
}
.restore {
  width: 2rem;
  height: 2rem;
  padding: 0;
  border-radius: 50%;
}
@media (max-width: 600px) {
  .row {
    grid-template-columns: 1.25rem 1.75rem minmax(0, 1fr) 2rem;
  }
  .col-size,
  .col-deleted {
    display: none;
  }
}
</style>

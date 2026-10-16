<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  deleteItems,
  getDuplicates,
  restoreTrash,
  SubsonicError,
  type DuplicateMode,
  type Song,
} from "../api/subsonic";
import { currentTrack, playQueue } from "../stores/player";
import { formatBytes, formatDuration, parentOf } from "../utils/format";
import ConfirmDialog from "../components/ConfirmDialog.vue";

// Groups of likely duplicate songs, to pick which copies go to the trash.
const mode = ref<DuplicateMode>("tags");
const groups = ref<Song[][]>([]);
const loading = ref(true);
const error = ref("");
const selected = reactive(new Set<string>());

async function load() {
  loading.value = true;
  error.value = "";
  selected.clear();
  try {
    groups.value = (await getDuplicates(mode.value)).map(sortBest);
  } catch (e) {
    error.value = e instanceof SubsonicError ? e.message : "Failed to load";
  } finally {
    loading.value = false;
  }
}
watch(mode, load, { immediate: true });

// The copy most worth keeping first: a favorite, rated higher, better
// quality, bigger (likely less compressed), played more, or added first.
function sortBest(songs: Song[]): Song[] {
  const time = (s: Song) => (s.created ? Date.parse(s.created) : 0);
  return [...songs].sort(
    (a, b) =>
      Number(!!b.starred) - Number(!!a.starred) ||
      (b.userRating ?? 0) - (a.userRating ?? 0) ||
      (b.bitRate ?? 0) - (a.bitRate ?? 0) ||
      b.size - a.size ||
      (b.playCount ?? 0) - (a.playCount ?? 0) ||
      time(a) - time(b),
  );
}

const extraCopies = computed(() => groups.value.reduce((n, g) => n + g.length - 1, 0));
const reclaimable = computed(() =>
  groups.value.reduce((n, g) => n + g.slice(1).reduce((m, s) => m + s.size, 0), 0),
);
const selectedSongs = computed(() => groups.value.flat().filter((s) => selected.has(s.id)));
const selectedSize = computed(() => selectedSongs.value.reduce((n, s) => n + s.size, 0));
// Groups where every copy is selected: deleting would lose the song entirely.
const wipedGroups = computed(() => groups.value.filter((g) => g.every((s) => selected.has(s.id))).length);

function selectSuggested() {
  selected.clear();
  for (const g of groups.value) for (const s of g.slice(1)) selected.add(s.id);
}

function toggle(id: string) {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
}

// --- trash, with undo ---

const confirming = ref(false);
const busy = ref(false);
const notice = ref<{ message: string; undo?: () => void } | null>(null);
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function notify(message: string, undo?: () => void) {
  notice.value = { message, undo };
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.value = null), undo ? 8000 : 3500);
}

async function trashSelected() {
  busy.value = true;
  try {
    const { deleted, entryIds } = await deleteItems({ songIds: [...selected], folderPaths: [] });
    confirming.value = false;
    await load();
    notify(`Moved ${deleted} song${deleted === 1 ? "" : "s"} to the trash`, async () => {
      notice.value = null;
      await restoreTrash(entryIds);
      await load();
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    confirming.value = false;
  } finally {
    busy.value = false;
  }
}

function folderLink(path?: string) {
  const dir = path ? parentOf(path) : "";
  return { name: "folders", params: { path: dir ? dir.split("/") : [] } };
}

function groupTitle(g: Song[]): string {
  const s = g[0];
  return mode.value === "size" ? `${formatBytes(s.size)} · ${s.suffix.toUpperCase()}` : `${s.title} — ${s.artist}`;
}
</script>

<template>
  <div>
    <div class="mb-1 flex flex-wrap items-center gap-3">
      <h1 class="text-xl font-semibold">Duplicates</h1>
      <div class="segmented ml-auto text-sm" role="group" aria-label="Match by">
        <button :class="{ active: mode === 'tags' }" @click="mode = 'tags'">Same title &amp; artist</button>
        <button :class="{ active: mode === 'size' }" @click="mode = 'size'">Same file size</button>
      </div>
    </div>
    <p class="mb-4 text-sm text-[var(--text-dim)]">
      <template v-if="mode === 'tags'">Songs with the same title by the same artist, and about the same length.</template>
      <template v-else>Files of exactly the same size and format — almost certainly the same file stored twice.</template>
      The first song in each group is the one suggested to keep: a favorite, the higher rating or quality, or the
      bigger file.
    </p>

    <p v-if="loading" class="flex items-center gap-2 text-[var(--text-dim)]"><span class="spinner"></span> Looking for duplicates…</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <p v-else-if="!groups.length" class="text-[var(--text-dim)]">No duplicates found. 🎉</p>

    <template v-else>
      <div class="toolbar glass">
        <span>
          <strong>{{ groups.length }}</strong> groups · {{ extraCopies }} extra copies ·
          {{ formatBytes(reclaimable) }} could be freed
        </span>
        <div class="ml-auto flex flex-wrap gap-2">
          <button @click="selectSuggested">Select all but the suggested</button>
          <button v-if="selected.size" @click="selected.clear()">Clear</button>
          <button v-if="selected.size" class="danger" @click="confirming = true">
            Move {{ selected.size }} to trash ({{ formatBytes(selectedSize) }})
          </button>
        </div>
      </div>

      <section v-for="g in groups" :key="g[0].id" class="group glass">
        <h2 class="group-title">
          <span class="truncate">{{ groupTitle(g) }}</span>
          <span class="text-xs font-normal text-[var(--text-dim)]">{{ g.length }} copies</span>
        </h2>
        <label
          v-for="(s, i) in g"
          :key="s.id"
          class="row"
          :class="{ selected: selected.has(s.id), playing: currentTrack?.id === s.id }"
        >
          <input type="checkbox" :checked="selected.has(s.id)" @change="toggle(s.id)" />
          <button class="play" title="Play" @click.prevent="playQueue(g, i)">▶</button>
          <div class="min-w-0">
            <div class="truncate">
              {{ s.title }} <span class="text-[var(--text-dim)]">· {{ s.artist }} · {{ s.album }}</span>
              <span v-if="i === 0" class="badge keep">Suggested keep</span>
              <span v-if="s.starred" class="badge" title="Favorite">♥</span>
            </div>
            <RouterLink :to="folderLink(s.path)" class="path truncate" :title="s.path" @click.stop>
              {{ s.path ?? "(not in a folder)" }}
            </RouterLink>
          </div>
          <span class="meta">
            {{ s.suffix.toUpperCase() }}<template v-if="s.bitRate"> · {{ s.bitRate }} kbps</template>
          </span>
          <span class="meta num">{{ formatDuration(s.duration) }}</span>
          <span class="meta num">{{ formatBytes(s.size) }}</span>
          <span class="meta num" title="Plays">{{ s.playCount ? `${s.playCount}▶` : "" }}</span>
        </label>
      </section>
    </template>

    <ConfirmDialog
      v-if="confirming"
      :title="`Move ${selected.size} songs to the trash?`"
      confirm-label="Move to trash"
      danger
      :busy="busy"
      @confirm="trashSelected"
      @close="confirming = false"
    >
      <p>{{ formatBytes(selectedSize) }} · they can be restored from the trash.</p>
      <p v-if="wipedGroups" class="error">
        In {{ wipedGroups }} group{{ wipedGroups === 1 ? "" : "s" }} every copy is selected — that song would be gone
        from the library entirely.
      </p>
    </ConfirmDialog>

    <div v-if="notice" class="toast glass">
      <span>{{ notice.message }}</span>
      <button v-if="notice.undo" @click="notice.undo">Undo</button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  position: sticky;
  top: 4.5rem;
  z-index: 10;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  padding: 0.6rem 0.9rem;
  font-size: 0.875rem;
  background: rgba(23, 26, 33, 0.94);
}
.group {
  margin-bottom: 0.75rem;
  padding: 0.5rem 0.75rem;
}
.group-title {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0.2rem 0 0.4rem;
  font-weight: 600;
  font-size: 0.9rem;
}
.row {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) 7.5rem 3.5rem 4.5rem 2.5rem;
  align-items: center;
  gap: 0.6rem;
  padding: 0.4rem 0.3rem;
  border-top: 1px solid var(--border);
  font-size: 0.85rem;
  cursor: pointer;
  border-radius: 6px;
}
.row:hover {
  background: rgba(255, 255, 255, 0.04);
}
.row.selected {
  background: rgba(239, 68, 68, 0.1);
}
.row.playing .truncate:first-child {
  color: var(--accent);
}
.play {
  width: 1.7rem;
  height: 1.7rem;
  padding: 0;
  border-radius: 50%;
  font-size: 0.7rem;
}
.path {
  display: block;
  font-size: 0.75rem;
  color: var(--text-dim);
}
.path:hover {
  color: var(--text);
}
.meta {
  color: var(--text-dim);
  white-space: nowrap;
  font-size: 0.8rem;
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.badge {
  margin-left: 0.4rem;
  padding: 0 0.4rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 0.7rem;
  color: var(--text-dim);
}
.badge.keep {
  border-color: var(--accent);
  color: var(--accent);
}
.danger {
  border-color: var(--danger);
  color: var(--danger);
}
.segmented {
  display: inline-flex;
}
.segmented button {
  border-radius: 0;
}
.segmented button:first-child {
  border-radius: 8px 0 0 8px;
}
.segmented button:last-child {
  border-radius: 0 8px 8px 0;
  margin-left: -1px;
}
.segmented button.active {
  border-color: var(--accent);
  color: var(--accent);
}
.toast {
  position: fixed;
  left: 50%;
  bottom: 6.5rem;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.9rem;
  transform: translateX(-50%);
  font-size: 0.875rem;
  background: rgba(23, 26, 33, 0.96);
}
@media (max-width: 700px) {
  /* The nav bar wraps to two lines here; don't slide under it. */
  .toolbar {
    position: static;
  }
  .row {
    grid-template-columns: auto auto minmax(0, 1fr) 4rem;
  }
  .row .meta:not(:nth-last-child(2)) {
    display: none;
  }
}
</style>

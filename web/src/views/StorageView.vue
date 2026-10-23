<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  checkFiles,
  deleteItems,
  getStorageStats,
  SubsonicError,
  UploadError,
  type FileProblem,
  type StorageStats,
} from "../api/subsonic";
import { formatBytes, parentOf } from "../utils/format";
import ConfirmDialog from "../components/ConfirmDialog.vue";

// Where the space goes, the R2 cache, and a check that every file can
// still be fetched.
const stats = ref<StorageStats | null>(null);
const error = ref("");

async function load() {
  try {
    stats.value = await getStorageStats();
    error.value = "";
  } catch (e) {
    error.value = e instanceof SubsonicError ? e.message : "Failed to load";
  }
}
load();

function hours(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  return h >= 48 ? `${Math.round(h / 24)} days` : `${h} h ${Math.round((seconds % 3600) / 60)} min`;
}

const share = (part: number, whole: number) => `${whole ? Math.max(0.5, (part / whole) * 100) : 0}%`;
const maxMonth = computed(() => Math.max(1, ...(stats.value?.months.map((m) => m.size) ?? [])));

function folderLink(path: string) {
  return { name: "folders", params: { path: path ? path.split("/") : [] } };
}

const TOO_BIG = 20 * 1024 * 1024;

// --- integrity check ---

const LAST_CHECK_KEY = "storage.lastCheck";
const check = reactive({
  running: false,
  phase: "songs" as "songs" | "covers",
  checked: 0,
  total: 0,
  waitUntil: 0,
  problems: [] as FileProblem[],
  finished: false,
});
const lastCheck = ref<{ at: string; problems: number } | null>(null);
try {
  lastCheck.value = JSON.parse(localStorage.getItem(LAST_CHECK_KEY) ?? "null");
} catch {
  // storage unavailable
}
let stopRequested = false;

async function runCheck() {
  Object.assign(check, { running: true, checked: 0, total: 0, problems: [], finished: false, waitUntil: 0 });
  stopRequested = false;
  // Each phase reports its own total; until covers start, estimate theirs.
  const c = stats.value?.covers;
  const totals = { songs: stats.value?.songCount ?? 0, covers: c ? c.albumsWithCover + c.artistsWithPhoto + c.songCovers : 0 };
  for (const phase of ["songs", "covers"] as const) {
    check.phase = phase;
    let after = "";
    for (;;) {
      if (stopRequested) return void (check.running = false);
      try {
        const batch = await checkFiles(phase, after);
        totals[phase] = batch.total;
        check.total = totals.songs + totals.covers;
        check.checked += batch.checked;
        check.problems.push(...batch.problems);
        if (!batch.next) break;
        after = batch.next;
      } catch (e) {
        if (e instanceof UploadError && e.retryAfter) {
          // Telegram wants a pause; try the same batch again after it.
          check.waitUntil = Date.now() + e.retryAfter * 1000;
          await new Promise((r) => setTimeout(r, e.retryAfter! * 1000 + 500));
          check.waitUntil = 0;
          continue;
        }
        error.value = e instanceof Error ? e.message : String(e);
        check.running = false;
        return;
      }
    }
  }
  check.running = false;
  check.finished = true;
  check.total = check.checked;
  lastCheck.value = { at: new Date().toISOString(), problems: check.problems.length };
  try {
    localStorage.setItem(LAST_CHECK_KEY, JSON.stringify(lastCheck.value));
  } catch {
    // ignore
  }
}
function stopCheck() {
  stopRequested = true;
}

const KIND_LABEL: Record<FileProblem["kind"], string> = {
  song: "Song",
  album: "Album cover",
  artist: "Artist photo",
  songCover: "Song cover",
};

const brokenSongs = computed(() => check.problems.filter((p) => p.kind === "song"));
const confirmTrash = ref(false);
const trashing = ref(false);
async function trashBroken() {
  trashing.value = true;
  try {
    const ids = brokenSongs.value.map((p) => p.id);
    await deleteItems({ songIds: ids, folderPaths: [] });
    check.problems = check.problems.filter((p) => p.kind !== "song");
    confirmTrash.value = false;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    trashing.value = false;
  }
}

function problemLink(p: FileProblem) {
  if (p.kind === "album") return { name: "album", params: { id: p.id } };
  if (p.kind === "artist") return { name: "artist", params: { id: p.id } };
  return folderLink(p.path ? parentOf(p.path) : "");
}
</script>

<template>
  <div class="space-y-5">
    <h1 class="text-xl font-semibold">Storage</h1>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="!stats && !error" class="flex items-center gap-2 text-[var(--text-dim)]">
      <span class="spinner"></span> Loading…
    </p>

    <template v-if="stats">
      <div class="cards">
        <div class="card glass">
          <div class="label">Library</div>
          <div class="value">{{ formatBytes(stats.size) }}</div>
          <div class="sub">{{ stats.songCount.toLocaleString() }} songs · {{ hours(stats.duration) }}</div>
        </div>
        <RouterLink :to="{ name: 'trash' }" class="card glass">
          <div class="label">Trash</div>
          <div class="value">{{ formatBytes(stats.trash.size) }}</div>
          <div class="sub">
            {{ stats.trash.songCount.toLocaleString() }} songs in {{ stats.trash.entries }} entries
            <template v-if="stats.pendingDeletes"> · {{ stats.pendingDeletes }} Telegram deletes to retry</template>
          </div>
        </RouterLink>
        <div class="card glass">
          <div class="label">R2 cache</div>
          <template v-if="stats.cache.enabled">
            <div class="value">{{ formatBytes(stats.cache.size) }} <span class="dim">/ {{ formatBytes(stats.cache.maxBytes) }}</span></div>
            <div class="bar"><div :style="{ width: share(stats.cache.size, stats.cache.maxBytes) }"></div></div>
            <div class="sub">{{ stats.cache.entries.toLocaleString() }} files cached</div>
          </template>
          <template v-else>
            <div class="value dim">Off</div>
            <div class="sub">Every play fetches from Telegram (see README to enable).</div>
          </template>
        </div>
        <div class="card glass">
          <div class="label">Covers</div>
          <div class="value">
            {{ stats.covers.albumsWithCover.toLocaleString() }} <span class="dim">/ {{ stats.covers.albums.toLocaleString() }} albums</span>
          </div>
          <div class="sub">{{ stats.covers.artistsWithPhoto }} artist photos · {{ stats.covers.songCovers }} song covers</div>
        </div>
        <RouterLink :to="{ name: 'setup' }" class="card glass">
          <div class="label">Telegram</div>
          <div class="value">Bot &amp; channel</div>
          <div class="sub">Where the files are stored</div>
        </RouterLink>
      </div>

      <div class="grid gap-5 lg:grid-cols-2">
        <section class="glass panel">
          <h2>By folder</h2>
          <RouterLink v-for="f in stats.folders" :key="f.name" :to="folderLink(f.name === '(no folder)' ? '' : f.name)" class="bucket">
            <span class="truncate">{{ f.name || "(files at the root)" }}</span>
            <span class="num">{{ f.songCount.toLocaleString() }}</span>
            <span class="num">{{ formatBytes(f.size) }}</span>
            <div class="bar"><div :style="{ width: share(f.size, stats.size) }"></div></div>
          </RouterLink>
        </section>

        <div class="space-y-5">
          <section class="glass panel">
            <h2>By format</h2>
            <div v-for="f in stats.formats" :key="f.name" class="bucket">
              <span>{{ f.name.toUpperCase() }}</span>
              <span class="num">{{ f.songCount.toLocaleString() }}</span>
              <span class="num">{{ formatBytes(f.size) }}</span>
              <div class="bar"><div :style="{ width: share(f.size, stats.size) }"></div></div>
            </div>
          </section>
          <section class="glass panel">
            <h2>Added per month</h2>
            <div class="months">
              <div v-for="m in stats.months" :key="m.name" class="month" :title="`${m.songCount} songs · ${formatBytes(m.size)}`">
                <div class="column"><div :style="{ height: share(m.size, maxMonth) }"></div></div>
                <span>{{ m.name.slice(2) }}</span>
              </div>
            </div>
          </section>
        </div>
      </div>

      <section class="glass panel">
        <h2>Largest files</h2>
        <div v-for="s in stats.largest" :key="s.id" class="bucket">
          <RouterLink :to="folderLink(s.path ? parentOf(s.path) : '')" class="truncate" :title="s.path">
            {{ s.path ?? s.title }}
          </RouterLink>
          <span class="num" :class="{ warn: s.size > TOO_BIG }" :title="s.size > TOO_BIG ? 'Over Telegram\'s 20 MB download limit — can\'t be played' : ''">
            {{ s.size > TOO_BIG ? "⚠ " : "" }}{{ formatBytes(s.size) }}
          </span>
        </div>
      </section>

      <section class="glass panel">
        <h2>Integrity check</h2>
        <p class="text-sm text-[var(--text-dim)]">
          Asks Telegram for every song and cover file (without downloading them) and lists the ones that can't be
          fetched anymore.
          <template v-if="lastCheck && !check.running && !check.finished">
            Last run {{ new Date(lastCheck.at).toLocaleString() }}: {{ lastCheck.problems ? `${lastCheck.problems} problems` : "everything fine" }}.
          </template>
        </p>
        <div class="mt-3 flex flex-wrap items-center gap-3">
          <button v-if="!check.running" @click="runCheck">{{ check.finished ? "Check again" : "Check all files" }}</button>
          <button v-else @click="stopCheck">Stop</button>
          <span v-if="check.running || check.finished" class="text-sm">
            {{ check.checked.toLocaleString() }}<template v-if="check.total"> / {{ check.total.toLocaleString() }}</template>
            checked<template v-if="check.running"> ({{ check.phase }})</template>
            · {{ check.problems.length }} problems
            <template v-if="check.waitUntil"> · Telegram asked to wait, resuming shortly…</template>
          </span>
        </div>
        <div v-if="check.running && check.total" class="bar mt-2"><div :style="{ width: share(check.checked, check.total) }"></div></div>
        <p v-if="check.finished && !check.problems.length" class="mt-3 text-sm">✓ Every file is reachable.</p>

        <div v-if="check.problems.length" class="mt-3">
          <div v-for="p in check.problems" :key="p.kind + p.id" class="problem">
            <span class="kind">{{ KIND_LABEL[p.kind] }}</span>
            <RouterLink :to="problemLink(p)" class="truncate" :title="p.path ?? p.name">{{ p.path ?? p.name }}</RouterLink>
            <span class="error text-xs">{{ p.error }}</span>
          </div>
          <button v-if="brokenSongs.length" class="danger mt-3" @click="confirmTrash = true">
            Move {{ brokenSongs.length }} broken songs to the trash…
          </button>
        </div>
      </section>
    </template>

    <ConfirmDialog
      v-if="confirmTrash"
      :title="`Move ${brokenSongs.length} songs to the trash?`"
      confirm-label="Move to trash"
      danger
      :busy="trashing"
      @confirm="trashBroken"
      @close="confirmTrash = false"
    >
      <p>Their files can't be fetched from Telegram, so they can't be played anyway.</p>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
  gap: 1rem;
}
.card {
  display: block;
  padding: 0.9rem 1rem;
  color: inherit;
}
.label {
  font-size: 0.8rem;
  color: var(--text-dim);
}
.value {
  margin: 0.2rem 0;
  font-size: 1.4rem;
  font-weight: 600;
}
.sub {
  font-size: 0.8rem;
  color: var(--text-dim);
}
.dim {
  color: var(--text-dim);
  font-weight: 400;
  font-size: 0.9rem;
}
.panel {
  padding: 0.9rem 1rem;
}
.panel h2 {
  margin-bottom: 0.6rem;
  font-weight: 600;
}
.bucket {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 4rem 5rem;
  gap: 0.3rem 0.75rem;
  align-items: center;
  padding: 0.35rem 0;
  font-size: 0.875rem;
  color: inherit;
}
.bucket + .bucket {
  border-top: 1px solid var(--border);
}
.bucket .bar {
  grid-column: 1 / -1;
}
a.bucket:hover {
  color: var(--accent);
}
.num {
  text-align: right;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.warn {
  color: #f59e0b;
}
.bar {
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}
.bar > div {
  height: 100%;
  background: var(--accent);
}
.months {
  display: flex;
  gap: 0.4rem;
  align-items: flex-end;
  height: 8rem;
}
.month {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  height: 100%;
  font-size: 0.7rem;
  color: var(--text-dim);
}
.column {
  display: flex;
  flex: 1;
  align-items: flex-end;
  width: 100%;
  max-width: 2.5rem;
}
.column > div {
  width: 100%;
  border-radius: 3px 3px 0 0;
  background: var(--accent);
  opacity: 0.8;
}
.problem {
  display: grid;
  grid-template-columns: 6.5rem minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.35rem 0;
  border-top: 1px solid var(--border);
  font-size: 0.85rem;
}
.kind {
  color: var(--text-dim);
  font-size: 0.75rem;
}
.danger {
  border-color: var(--danger);
  color: var(--danger);
}
@media (max-width: 600px) {
  .problem {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.1rem;
  }
}
</style>

<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from "vue";
import {
  parseFileName,
  searchOnline,
  setCoverArt,
  updateTracks,
  SubsonicError,
  type OnlineMatch,
  type Song,
  type TagEdits,
} from "../api/subsonic";
import { confidentMatch } from "../stores/uploadEnrich";
import { formatDuration } from "../utils/format";
import Modal from "./Modal.vue";

// "Find online…" for several songs at once (Folders → selection): looks up
// each song on iTunes/MusicBrainz, one at a time, then lists the best match
// per song for review. Close matches (same bar as uploads' "fill in
// missing info") come pre-checked; the rest can be checked or switched to
// another candidate by hand. Nothing changes until "Apply".
const props = defineProps<{ songs: Song[] }>();
const emit = defineEmits<{ close: []; done: [] }>();

const MAX_SONGS = 300;
const CANDIDATES = 6;
// Between searches: each one is up to three iTunes requests, and Apple
// allows roughly 20 a minute.
const SEARCH_GAP_MS = 1500;
const RATE_LIMIT_PAUSE_S = 30;

interface Row {
  song: Song;
  state: "waiting" | "searching" | "found" | "none" | "error";
  // Artist/title searched for, when Workers AI read them from the file
  // name (an "Unknown Artist" song).
  query?: { artist: string; title: string };
  matches: OnlineMatch[];
  pick: number; // index into matches, -1: none
  checked: boolean;
  confident: boolean;
  result?: string; // after applying: "ok" or the error
}

const rows = reactive<Row[]>(
  props.songs.slice(0, MAX_SONGS).map((song) => ({ song, state: "waiting", matches: [], pick: -1, checked: false, confident: false })),
);
const leftOut = props.songs.length - rows.length;

// names: use the match's spelling of title/artist (always, for an
// "Unknown Artist" song: that's filling a gap). album: move the song to the
// match's album, with its year, genre and track number — off by default,
// since it takes songs out of a folder's album. cover: the song's own
// cover, or with album on, the matched album's cover if it has none.
// yearGenre (album off): the release's year and genre as the songs' own.
const opts = reactive({ cover: true, names: false, album: false, yearGenre: true });

const phase = ref<"searching" | "review" | "applying" | "finished">("searching");
let stopped = false;
const pausedUntil = ref(0);
const now = ref(Date.now());
const ticker = setInterval(() => (now.value = Date.now()), 1000);
onUnmounted(() => {
  stopped = true;
  clearInterval(ticker);
});
const pauseLeft = computed(() => Math.max(0, Math.ceil((pausedUntil.value - now.value) / 1000)));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function pause(seconds: number) {
  pausedUntil.value = Date.now() + seconds * 1000;
  await sleep(seconds * 1000);
  pausedUntil.value = 0;
}

const message = (e: unknown) => (e instanceof SubsonicError || e instanceof Error ? e.message : String(e));
const isUnknown = (song: Song) => !song.artist || song.artist === "Unknown Artist";

async function lookUp(row: Row) {
  let artist = row.song.artist;
  let title = row.song.title;
  if (isUnknown(row.song) && row.song.path) {
    const slash = row.song.path.lastIndexOf("/");
    const parsed = await parseFileName(row.song.path.slice(slash + 1), slash > 0 ? row.song.path.slice(0, slash) : "").catch(
      () => null,
    );
    if (!parsed?.artist) return; // nothing worth searching for
    artist = parsed.artist;
    title = parsed.title || title;
    row.query = { artist, title };
  }
  for (let attempt = 0; ; attempt++) {
    const { matches, errors } = await searchOnline("song", artist, title);
    const sure = confidentMatch(matches, row.song.duration);
    // iTunes rate-limited: MusicBrainz alone may still have answered, but
    // iTunes usually has the better match — wait and ask again.
    if (!sure && errors.some((e) => /rate-limit/i.test(e)) && attempt < 2 && !stopped) {
      await pause(RATE_LIMIT_PAUSE_S);
      continue;
    }
    const list = matches.slice(0, CANDIDATES);
    if (sure && !list.includes(sure)) list.unshift(sure);
    row.matches = list;
    row.pick = sure ? list.indexOf(sure) : list.length ? 0 : -1;
    row.confident = row.checked = !!sure;
    return;
  }
}

async function searchAll() {
  for (const row of rows) {
    if (stopped) break;
    row.state = "searching";
    try {
      await lookUp(row);
      row.state = row.matches.length ? "found" : "none";
    } catch (e) {
      row.state = "error";
      row.result = message(e);
    }
    if (!stopped) await sleep(SEARCH_GAP_MS);
  }
  if (phase.value === "searching") phase.value = "review";
}
void searchAll();

function stopSearching() {
  stopped = true;
  for (const row of rows) if (row.state === "waiting" || row.state === "searching") row.state = "none";
  phase.value = "review";
}

const searchedCount = computed(() => rows.filter((r) => r.state !== "waiting" && r.state !== "searching").length);
const pick = (row: Row) => (row.pick >= 0 ? row.matches[row.pick] : undefined);

// What applying a row would change, under the current options.
function changesOf(row: Row): { key: keyof TagEdits; label: string; from: string; to: string | number }[] {
  const m = pick(row);
  if (!m) return [];
  const s = row.song;
  const out: ReturnType<typeof changesOf> = [];
  const add = (key: keyof TagEdits, label: string, from: string | number | undefined, to: string | number | undefined) => {
    if (to === undefined || to === "" || String(to) === String(from ?? "")) return;
    out.push({ key, label, from: from === undefined || from === "" ? "—" : String(from), to });
  };
  if (opts.names || isUnknown(s)) {
    add("title", "title", s.title, m.title);
    add("artist", "artist", s.artist, m.artist);
  }
  if (opts.album) {
    add("album", "album", s.album, m.album);
    add("year", "year", s.year, m.year);
    add("genre", "genre", s.genre, m.genre);
    add("track", "track", s.track, m.track);
    if (m.disc && (m.disc > 1 || s.discNumber)) add("disc", "disc", s.discNumber, m.disc);
  } else if (opts.yearGenre) {
    add("year", "year", s.year, m.year);
    add("genre", "genre", s.genre, m.genre);
  }
  return out;
}

// A song's own cover is only added where it has none (its coverArt is its
// own id once it has one); an album cover only where the album has none.
function coverOf(row: Row): string | undefined {
  const m = pick(row);
  if (!opts.cover || !m?.coverUrl) return undefined;
  return opts.album || row.song.coverArt !== row.song.id ? m.coverUrl : undefined;
}

const lengthDiffers = (row: Row) => {
  const m = pick(row);
  return row.song.duration !== undefined && m?.duration !== undefined && Math.abs(row.song.duration - m.duration) > 5;
};

const toApply = computed(() => rows.filter((r) => r.checked && pick(r) && (changesOf(r).length || coverOf(r))));
const foundCount = computed(() => rows.filter((r) => r.matches.length).length);
const confidentCount = computed(() => rows.filter((r) => r.confident).length);

function checkAll(on: boolean, onlyConfident = false) {
  for (const r of rows) if (r.matches.length) r.checked = on && (!onlyConfident || r.confident);
}

// Telegram's rate limit (covers are Telegram uploads): wait it out.
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof SubsonicError) || !e.retryAfter || attempt >= 3) throw e;
      await pause(e.retryAfter + 1);
    }
  }
}

async function apply() {
  phase.value = "applying";
  stopped = false;
  const coveredAlbums = new Set<string>();
  for (const row of toApply.value) {
    if (stopped) break;
    const cover = coverOf(row);
    const edits: TagEdits = {};
    for (const c of changesOf(row)) (edits as Record<string, string | number>)[c.key] = c.to;
    try {
      let albumId = row.song.albumId;
      if (Object.keys(edits).length) {
        // Staying in its album, the song's year/genre are its own.
        const result = await withRetry(() => updateTracks({ songIds: [row.song.id] }, edits, { songLevel: !opts.album }));
        albumId = result.albumIds[0] ?? albumId;
      }
      if (cover && opts.album) {
        if (!coveredAlbums.has(albumId)) {
          coveredAlbums.add(albumId);
          await withRetry(() => setCoverArt(albumId, cover, { onlyIfMissing: true }));
        }
      } else if (cover) {
        await withRetry(() => setCoverArt(row.song.id, cover));
      }
      row.result = "ok";
      row.checked = false;
    } catch (e) {
      row.result = message(e);
    }
  }
  phase.value = "finished";
  emit("done");
}

// Finishes the song in progress, then stops.
function stopApplying() {
  stopped = true;
}

const appliedCount = computed(() => rows.filter((r) => r.result === "ok").length);
const failedCount = computed(() => rows.filter((r) => r.result && r.result !== "ok" && r.state !== "error").length);

function matchLabel(m: OnlineMatch): string {
  return [m.title, m.artist, m.album, m.year].filter(Boolean).join(" · ");
}
</script>

<template>
  <Modal :title="`Find online — ${rows.length} song${rows.length === 1 ? '' : 's'}`" wide @close="emit('close')">
    <div class="space-y-3 text-sm">
      <div class="flex flex-wrap gap-x-5 gap-y-1">
        <label class="flex items-center gap-2">
          <input v-model="opts.cover" type="checkbox" :disabled="phase === 'applying'" /> Add covers
        </label>
        <label v-if="!opts.album" class="flex items-center gap-2">
          <input v-model="opts.yearGenre" type="checkbox" :disabled="phase === 'applying'" /> Set year &amp; genre
        </label>
        <label class="flex items-center gap-2">
          <input v-model="opts.names" type="checkbox" :disabled="phase === 'applying'" /> Use the match's title &amp; artist
          spelling
        </label>
        <label class="flex items-center gap-2">
          <input v-model="opts.album" type="checkbox" :disabled="phase === 'applying'" /> Move to the matched album
        </label>
      </div>
      <p class="text-xs text-[var(--text-dim)]">
        <template v-if="opts.album">
          Songs move out of their current album (a folder's songs stop being grouped as one album) and get the
          release's year, genre and track number; a cover goes on the matched album if it has none.
        </template>
        <template v-else>
          Songs stay in their current album; a cover becomes the song's own (songs that already have one are left
          alone), and year and genre are set on each song, not its album. "Unknown Artist" songs get the matched title
          and artist either way.
        </template>
      </p>

      <p v-if="phase === 'searching'" class="flex items-center gap-2">
        <span class="spinner"></span>
        Searching {{ searchedCount }} / {{ rows.length }}…
        <span v-if="pauseLeft" class="text-[var(--text-dim)]">(rate-limited, resuming in {{ pauseLeft }}s)</span>
        <button type="button" class="ml-auto text-xs" @click="stopSearching">Stop</button>
      </p>
      <p v-else-if="phase === 'applying'" class="flex items-center gap-2">
        <span class="spinner"></span> Applying…
        <span v-if="pauseLeft" class="text-[var(--text-dim)]">(Telegram rate limit, resuming in {{ pauseLeft }}s)</span>
        <button type="button" class="ml-auto text-xs" @click="stopApplying">Stop</button>
      </p>
      <p v-else-if="phase === 'finished'">
        Updated {{ appliedCount }} song{{ appliedCount === 1 ? "" : "s" }}<template v-if="failedCount">,
          {{ failedCount }} failed</template>.
      </p>
      <p v-else class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--text-dim)]">
        Matches for {{ foundCount }} of {{ rows.length }} · {{ confidentCount }} close
        <button type="button" class="text-xs" @click="checkAll(true, true)">Check close ones</button>
        <button type="button" class="text-xs" @click="checkAll(true)">Check all</button>
        <button type="button" class="text-xs" @click="checkAll(false)">Uncheck all</button>
      </p>
      <p v-if="leftOut" class="text-xs text-[var(--text-dim)]">
        Only the first {{ MAX_SONGS }} songs — {{ leftOut }} more left out; run it again on those afterwards.
      </p>

      <ul class="rows">
        <li v-for="row in rows" :key="row.song.id" class="row">
          <input
            v-model="row.checked"
            type="checkbox"
            :disabled="!pick(row) || phase === 'applying' || phase === 'searching' || row.result === 'ok'"
          />
          <div class="thumb">
            <img v-if="pick(row)?.thumbUrl" :src="pick(row)!.thumbUrl" alt="" loading="lazy" />
            <span v-else>♪</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="truncate">
              <span class="font-medium">{{ row.song.title }}</span>
              <span class="text-[var(--text-dim)]"> — {{ row.song.artist }}</span>
            </div>
            <div v-if="row.query" class="truncate text-xs text-[var(--text-dim)]">
              ✨ from the file name: {{ row.query.artist }} — {{ row.query.title }}
            </div>
            <template v-if="pick(row)">
              <select
                v-if="row.matches.length > 1 && phase === 'review'"
                v-model.number="row.pick"
                class="candidate"
                @change="row.checked = true"
              >
                <option v-for="(m, i) in row.matches" :key="i" :value="i">
                  {{ Math.round(m.score * 100) }}% · {{ matchLabel(m) }}
                </option>
              </select>
              <div v-else class="truncate text-xs">→ {{ matchLabel(pick(row)!) }}</div>
              <div class="truncate text-xs text-[var(--text-dim)]">
                <template v-for="(c, i) in changesOf(row)" :key="c.key">
                  {{ i ? " · " : "" }}{{ c.label }}: {{ c.from }} → {{ c.to }}
                </template>
                <template v-if="coverOf(row)">{{ changesOf(row).length ? " · " : "" }}+ cover</template>
                <template v-if="!changesOf(row).length && !coverOf(row)">nothing to change</template>
                <span v-if="lengthDiffers(row)" class="warn">
                  · length differs ({{ formatDuration(row.song.duration) }} vs {{ formatDuration(pick(row)!.duration) }})
                </span>
              </div>
            </template>
            <div v-else class="text-xs text-[var(--text-dim)]">
              {{
                row.state === "waiting"
                  ? "Waiting"
                  : row.state === "searching"
                    ? "Searching…"
                    : row.state === "error"
                      ? row.result
                      : "No match"
              }}
            </div>
          </div>
          <div class="shrink-0 text-right text-xs">
            <span v-if="row.result === 'ok'" class="good">✓</span>
            <span v-else-if="row.result && row.state !== 'error'" class="warn" :title="row.result">failed</span>
            <span v-else-if="pick(row)" :class="{ good: row.confident }">{{ Math.round(pick(row)!.score * 100) }}%</span>
          </div>
        </li>
      </ul>

      <div class="flex justify-end gap-2 pt-1">
        <button type="button" :disabled="phase === 'applying'" @click="emit('close')">
          {{ phase === "finished" ? "Close" : "Cancel" }}
        </button>
        <button
          v-if="phase !== 'finished'"
          type="button"
          class="primary"
          :disabled="phase !== 'review' || !toApply.length"
          @click="apply"
        >
          Apply to {{ toApply.length }} song{{ toApply.length === 1 ? "" : "s" }}
        </button>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.rows {
  max-height: 50vh;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.25rem;
}
.row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.4rem;
}
.row + .row {
  border-top: 1px solid var(--border);
}
.thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 6px;
  background: var(--surface-hover);
  color: var(--text-dim);
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.candidate {
  width: 100%;
  max-width: 100%;
  margin: 0.15rem 0;
  font-size: 0.75rem;
}
.good {
  color: var(--accent);
}
.warn {
  color: #e8b06a;
}
.primary {
  border-color: var(--accent);
  color: var(--accent);
}
</style>

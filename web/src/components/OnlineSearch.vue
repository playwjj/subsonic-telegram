<script setup lang="ts">
import { reactive, ref } from "vue";
import { parseFileName, searchOnline, SubsonicError, type OnlineMatch } from "../api/subsonic";
import { formatDuration } from "../utils/format";

// "Find online…" inside the album/song edit dialogs: searches iTunes and
// MusicBrainz and lets the user pick a match, which the dialog then puts in
// its form for review — nothing is saved from here.
// `path`: the song's file path, which Workers AI can read artist/title out
// of when the tags are no help.
const props = defineProps<{ kind: "album" | "song"; artist: string; name: string; duration?: number; path?: string }>();
const emit = defineEmits<{ pick: [match: OnlineMatch]; back: [] }>();

const query = reactive({ artist: props.artist, name: props.name });
const matches = ref<OnlineMatch[]>([]);
const sourceErrors = ref<string[]>([]);
const error = ref("");
const loading = ref(false);
const searched = ref(false);
// Thumbnails that didn't load: Cover Art Archive has no art for many
// releases, and then the full-size cover won't exist either.
const noCover = reactive(new Set<number>()); // indexes into matches

async function search() {
  error.value = "";
  loading.value = true;
  try {
    const result = await searchOnline(props.kind, query.artist, query.name);
    noCover.clear();
    matches.value = result.matches;
    sourceErrors.value = result.errors;
    searched.value = true;
  } catch (e) {
    error.value = e instanceof SubsonicError || e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}
void search();

const parsing = ref(false);
async function readFileName() {
  if (!props.path) return;
  error.value = "";
  parsing.value = true;
  try {
    const slash = props.path.lastIndexOf("/");
    const parsed = await parseFileName(props.path.slice(slash + 1), slash > 0 ? props.path.slice(0, slash) : "");
    if (!parsed.artist && !parsed.title) {
      error.value = "Couldn't make out an artist or title in the file name.";
      return;
    }
    if (parsed.artist) query.artist = parsed.artist;
    if (parsed.title) query.name = parsed.title;
  } catch (e) {
    error.value = e instanceof SubsonicError || e instanceof Error ? e.message : String(e);
    return;
  } finally {
    parsing.value = false;
  }
  await search();
}

function pick(m: OnlineMatch, i: number) {
  emit("pick", noCover.has(i) ? { ...m, coverUrl: undefined, thumbUrl: undefined } : m);
}

// A song more than a few seconds off is likely another version (live,
// remix, edit) of the same title.
const lengthDiffers = (m: OnlineMatch) =>
  props.duration !== undefined && m.duration !== undefined && Math.abs(props.duration - m.duration) > 5;

function details(m: OnlineMatch): string {
  const parts: string[] = [];
  if (m.year) parts.push(String(m.year));
  if (m.genre) parts.push(m.genre);
  if (props.kind === "album" && m.trackCount) parts.push(`${m.trackCount} tracks`);
  if (props.kind === "song" && m.track) parts.push(`#${m.track}${m.disc && m.disc > 1 ? ` (disc ${m.disc})` : ""}`);
  if (props.kind === "song" && m.duration) parts.push(formatDuration(m.duration));
  return parts.join(" · ");
}
</script>

<template>
  <div class="space-y-3 text-sm">
    <form class="flex flex-wrap items-end gap-2" @submit.prevent="search">
      <label class="min-w-[8rem] flex-1">Artist <input v-model="query.artist" class="mt-1 w-full" /></label>
      <label class="min-w-[8rem] flex-[2]">
        {{ kind === "album" ? "Album" : "Title" }} <input v-model="query.name" class="mt-1 w-full" />
      </label>
      <button type="submit" class="inline-flex items-center gap-2" :disabled="loading">
        <span v-if="loading" class="spinner"></span> Search
      </button>
    </form>
    <button
      v-if="kind === 'song' && path"
      type="button"
      class="inline-flex items-center gap-2 text-xs"
      :disabled="parsing || loading"
      :title="path"
      @click="readFileName"
    >
      <span v-if="parsing" class="spinner"></span> ✨ Read artist/title from the file name
    </button>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-for="e in sourceErrors" :key="e" class="text-xs text-[var(--text-dim)]">⚠ {{ e }}</p>
    <p v-if="searched && !loading && !matches.length && !error" class="text-[var(--text-dim)]">
      No matches. Try fewer or different words.
    </p>

    <ul v-if="matches.length" class="matches">
      <li v-for="(m, i) in matches" :key="i">
        <button type="button" class="match" @click="pick(m, i)">
          <div class="thumb">
            <img v-if="m.thumbUrl && !noCover.has(i)" :src="m.thumbUrl" alt="" loading="lazy" @error="noCover.add(i)" />
            <span v-else>♪</span>
          </div>
          <div class="min-w-0 flex-1 text-left">
            <div class="truncate font-medium">{{ kind === "album" ? m.album : m.title }}</div>
            <div class="truncate text-[var(--text-dim)]">
              {{ m.artist }}<template v-if="kind === 'song' && m.album"> — {{ m.album }}</template>
            </div>
            <div class="truncate text-xs text-[var(--text-dim)]">
              {{ details(m) }}
              <span v-if="lengthDiffers(m)" class="warn" :title="`Your file is ${formatDuration(duration)}`">
                · length differs
              </span>
            </div>
          </div>
          <div class="shrink-0 text-right text-xs text-[var(--text-dim)]">
            <div>{{ m.source === "itunes" ? "iTunes" : "MusicBrainz" }}</div>
            <div :class="{ good: m.score >= 0.8 }">{{ Math.round(m.score * 100) }}%</div>
          </div>
        </button>
      </li>
    </ul>

    <div class="flex justify-end pt-1">
      <button type="button" @click="emit('back')">Back</button>
    </div>
  </div>
</template>

<style scoped>
.matches {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-height: 55vh;
  overflow-y: auto;
}
.match {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.4rem;
  border: 1px solid transparent;
  border-radius: 8px;
  background: none;
}
.match:hover {
  border-color: var(--border);
  background: var(--surface-hover);
}
.thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3.5rem;
  height: 3.5rem;
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
.good {
  color: var(--accent);
}
.warn {
  color: #e8b06a;
}
</style>

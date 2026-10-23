<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { getArtists, setCoverArt, updateTracks, SubsonicError, type OnlineMatch, type Song, type TagEdits } from "../api/subsonic";
import Modal from "./Modal.vue";
import OnlineSearch from "./OnlineSearch.vue";

// Edits the library tags of songs (`songIds`) and/or everything in some
// folders (`folderPaths`). `songs` is what's known of all of them, only for
// showing current values; `count` the total. Only changed fields are sent.
// For a single song, "Find online…" fills the form (and offers the match's
// cover as the song's own cover) from an iTunes/MusicBrainz match.
const props = defineProps<{ songs: Song[]; songIds: string[]; folderPaths?: string[]; count: number }>();
const emit = defineEmits<{ close: []; saved: [result: { updated: number; albumIds: string[] }] }>();

type Key = "title" | "artist" | "album" | "year" | "genre" | "track" | "disc";

const single = computed(() => props.count === 1);

const FIELDS: { key: Key; label: string; numeric?: boolean; singleOnly?: boolean; required?: boolean }[] = [
  { key: "title", label: "Title", singleOnly: true, required: true },
  { key: "artist", label: "Artist", required: true },
  { key: "album", label: "Album", required: true },
  { key: "year", label: "Year", numeric: true },
  { key: "genre", label: "Genre" },
  { key: "track", label: "Track #", numeric: true, singleOnly: true },
  { key: "disc", label: "Disc #", numeric: true },
];
const fields = computed(() => FIELDS.filter((f) => !f.singleOnly || single.value));

function valueOf(song: Song, key: Key): string {
  const v = { title: song.title, artist: song.artist, album: song.album, year: song.year, genre: song.genre, track: song.track, disc: song.discNumber }[key];
  return v === undefined || v === null ? "" : String(v);
}

// Per field: the value all songs share, or "" and mixed when they differ.
const initial = {} as Record<Key, { value: string; mixed: boolean }>;
for (const f of FIELDS) {
  const values = new Set(props.songs.map((s) => valueOf(s, f.key)));
  const mixed = values.size > 1 || (!!props.folderPaths?.length && props.songs.length === 0);
  initial[f.key] = { value: mixed ? "" : [...values][0] ?? "", mixed };
}
const form = reactive(Object.fromEntries(FIELDS.map((f) => [f.key, initial[f.key].value])) as Record<Key, string>);
// Number inputs' v-model hands back numbers (or "").
const text = (key: Key) => String(form[key] ?? "").trim();
const isChanged = (key: Key) => text(key) !== initial[key].value.trim();

const changed = computed(() => fields.value.filter((f) => isChanged(f.key)));

// Only for one song picked by id (not "everything in a folder").
const canSearch = computed(() => single.value && props.songIds.length === 1 && !props.folderPaths?.length);
const searching = ref(false);
const matchedFrom = ref<OnlineMatch | null>(null);
const useCover = ref(true);
const coverUrl = computed(() => (useCover.value ? matchedFrom.value?.coverUrl : undefined));

function onMatch(m: OnlineMatch) {
  searching.value = false;
  matchedFrom.value = m;
  useCover.value = true;
  const values: Partial<Record<Key, string | number | undefined>> = {
    title: m.title,
    artist: m.artist,
    album: m.album,
    year: m.year,
    genre: m.genre,
    track: m.track,
    disc: m.disc && (m.disc > 1 || props.songs[0]?.discNumber) ? m.disc : undefined,
  };
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== "") form[key as Key] = String(value);
}

function resetForm() {
  for (const f of FIELDS) form[f.key] = initial[f.key].value;
  matchedFrom.value = null;
}

const artistNames = ref<string[]>([]);
onMounted(async () => {
  try {
    artistNames.value = (await getArtists()).flatMap((i) => i.artist.map((a) => a.name));
  } catch {
    // just no suggestions
  }
});

const saving = ref(false);
const error = ref("");

async function save() {
  error.value = "";
  const edits: TagEdits = {};
  for (const f of changed.value) {
    const raw = text(f.key);
    if (f.required) {
      if (!raw) return void (error.value = `${f.label} can't be empty`);
      edits[f.key as "title" | "artist" | "album"] = raw;
    } else if (f.numeric) {
      const n = Number(raw);
      if (raw && (!Number.isInteger(n) || n < 0)) return void (error.value = `${f.label} must be a whole number`);
      edits[f.key as "year" | "track" | "disc"] = raw ? n : null;
    } else {
      edits.genre = raw || null;
    }
  }
  if (!Object.keys(edits).length && !coverUrl.value) return emit("close");
  saving.value = true;
  try {
    const result = Object.keys(edits).length
      ? await updateTracks({ songIds: props.songIds, folderPaths: props.folderPaths }, edits)
      : { updated: 1, albumIds: [] };
    // The song's own cover, not the album's: the album may well be a folder
    // of unrelated songs (an album match is the way to set an album cover).
    if (coverUrl.value) await setCoverArt(props.songIds[0], coverUrl.value);
    emit("saved", result);
  } catch (e) {
    error.value = e instanceof SubsonicError || e instanceof Error ? e.message : String(e);
  } finally {
    saving.value = false;
  }
}

const albumAffected = computed(() => changed.value.some((f) => f.key === "year" || f.key === "genre"));
</script>

<template>
  <Modal
    :title="searching ? 'Find song online' : single ? 'Edit tags' : `Edit tags of ${count.toLocaleString()} songs`"
    :wide="searching"
    @close="emit('close')"
  >
    <OnlineSearch
      v-if="searching"
      kind="song"
      :artist="text('artist')"
      :name="text('title')"
      :duration="songs[0]?.duration"
      @pick="onMatch"
      @back="searching = false"
    />
    <form v-else class="space-y-3 text-sm" @submit.prevent="save">
      <div v-if="single" class="flex items-center gap-2">
        <p v-if="songs[0]?.path" class="min-w-0 flex-1 truncate text-xs text-[var(--text-dim)]" :title="songs[0].path">
          {{ songs[0].path }}
        </p>
        <button v-if="canSearch" type="button" class="ml-auto shrink-0" @click="searching = true">🔍 Find online…</button>
      </div>
      <div v-if="matchedFrom" class="flex items-center gap-3 text-xs">
        <img v-if="matchedFrom.thumbUrl" :src="matchedFrom.thumbUrl" alt="" class="match-cover" />
        <div class="space-y-1">
          <p class="text-[var(--text-dim)]">
            Filled in from {{ matchedFrom.source === "itunes" ? "iTunes" : "MusicBrainz" }} — check before saving.
            <button type="button" class="link" @click="resetForm">Reset</button>
          </p>
          <label v-if="matchedFrom.coverUrl" class="flex items-center gap-2">
            <input v-model="useCover" type="checkbox" /> Use this cover for the song
          </label>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <label v-for="f in fields" :key="f.key" :class="{ 'col-span-2': !f.numeric && f.key !== 'genre' }">
          <span class="flex items-center gap-1">
            {{ f.label }}
            <span v-if="isChanged(f.key)" class="dot" title="Changed"></span>
          </span>
          <input
            v-model="form[f.key]"
            class="mt-1 w-full"
            :type="f.numeric ? 'number' : 'text'"
            :min="f.numeric ? 0 : undefined"
            :list="f.key === 'artist' ? 'tag-editor-artists' : undefined"
            :placeholder="initial[f.key].mixed ? 'Multiple values — leave empty to keep' : ''"
          />
        </label>
      </div>
      <datalist id="tag-editor-artists">
        <option v-for="name in artistNames" :key="name" :value="name" />
      </datalist>

      <p class="text-xs text-[var(--text-dim)]">
        Changes the library's tags only — the files in Telegram stay as they are. Songs keep their place in playlists
        and favorites.
        <template v-if="albumAffected"> Year and genre are stored per album, so they change for the whole album.</template>
      </p>
      <p v-if="error" class="error text-sm">{{ error }}</p>

      <div class="flex justify-end gap-2 pt-2">
        <button type="button" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="primary inline-flex items-center gap-2" :disabled="saving || (!changed.length && !coverUrl)">
          <span v-if="saving" class="spinner"></span> Save
        </button>
      </div>
    </form>
  </Modal>
</template>

<style scoped>
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}
.primary {
  border-color: var(--accent);
  color: var(--accent);
}
.match-cover {
  width: 3rem;
  height: 3rem;
  flex-shrink: 0;
  border-radius: 6px;
  object-fit: cover;
}
.link {
  padding: 0;
  border: none;
  background: none;
  color: var(--accent);
  text-decoration: underline;
}
</style>

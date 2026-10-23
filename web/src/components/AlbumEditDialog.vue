<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from "vue";
import {
  coverArtUrl,
  getArtists,
  getOnlineAlbumTracks,
  setCoverArt,
  updateTracks,
  SubsonicError,
  type AlbumDetail,
  type OnlineMatch,
  type TagEdits,
} from "../api/subsonic";
import { prepareCover } from "../utils/image";
import Modal from "./Modal.vue";
import OnlineSearch from "./OnlineSearch.vue";

// Album name/artist/year/genre (applied to all its songs — renaming onto an
// existing album merges into it) and its cover. "Find online…" fills these
// (and optionally the songs' track numbers) from an iTunes/MusicBrainz
// match, for review before saving. Emits the album's id afterwards, which
// changes when the name or artist does.
const props = defineProps<{ album: AlbumDetail }>();
const emit = defineEmits<{ close: []; saved: [albumId: string] }>();

const initial = {
  name: props.album.name,
  artist: props.album.artist,
  year: props.album.year ? String(props.album.year) : "",
  genre: props.album.genre ?? "",
};
const form = reactive({ ...initial });

// undefined: unchanged; null: remove; Blob: replace; string: replace with
// the online match's cover at that URL.
const cover = ref<Blob | string | null | undefined>(undefined);
const previewUrl = ref<string | null>(null); // object URL of a picked Blob
const remotePreview = ref<string | null>(null); // thumbnail of a match's cover
const hasCover = computed(() => (cover.value === undefined ? !!props.album.coverArt : cover.value !== null));
const shownCover = computed(() => {
  if (cover.value instanceof Blob) return previewUrl.value;
  if (typeof cover.value === "string") return remotePreview.value ?? cover.value;
  return cover.value === null || !props.album.coverArt ? null : coverArtUrl(props.album.coverArt);
});
const fileInput = ref<HTMLInputElement | null>(null);

async function onPicked(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  error.value = "";
  try {
    const blob = await prepareCover(file);
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = URL.createObjectURL(blob);
    cover.value = blob;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}
onUnmounted(() => previewUrl.value && URL.revokeObjectURL(previewUrl.value));

function removeCover() {
  cover.value = null;
}

const artistNames = ref<string[]>([]);
getArtists()
  .then((index) => (artistNames.value = index.flatMap((i) => i.artist.map((a) => a.name))))
  .catch(() => {});

// --- online match ---

const searching = ref(false);
const matchedFrom = ref<OnlineMatch | null>(null);
// Track/disc numbers from the match's track list, for songs whose numbers
// differ from it.
const trackChanges = ref<{ id: string; title: string; track?: number; disc?: number }[]>([]);
const matchedSongs = ref(0);
const applyTrackNumbers = ref(true);
const loadingTracks = ref(false);

async function onMatch(m: OnlineMatch) {
  searching.value = false;
  matchedFrom.value = m;
  if (m.album) form.name = m.album;
  if (m.artist) form.artist = m.artist;
  if (m.year) form.year = String(m.year);
  if (m.genre) form.genre = m.genre;
  if (m.coverUrl) {
    cover.value = m.coverUrl;
    remotePreview.value = m.thumbUrl ?? null;
  }
  trackChanges.value = [];
  matchedSongs.value = 0;
  if (!m.albumRef) return;
  loadingTracks.value = true;
  try {
    const songs = props.album.song;
    const tracks = await getOnlineAlbumTracks(m.albumRef, songs.map((s) => s.title));
    if (matchedFrom.value !== m) return; // another match picked meanwhile
    const changes: typeof trackChanges.value = [];
    for (const t of tracks) {
      if (t.match === undefined) continue;
      matchedSongs.value++;
      const song = songs[t.match];
      // A single-disc release's disc 1 isn't worth writing over "no disc".
      const disc = t.disc && (t.disc > 1 || song.discNumber) ? t.disc : song.discNumber;
      if (t.track !== song.track || disc !== song.discNumber) {
        changes.push({ id: song.id, title: song.title, track: t.track, disc });
      }
    }
    trackChanges.value = changes;
  } catch {
    // Just no track numbers; the album fields are already filled in.
  } finally {
    loadingTracks.value = false;
  }
}

function resetForm() {
  Object.assign(form, initial);
  cover.value = undefined;
  matchedFrom.value = null;
  trackChanges.value = [];
}

// The year input's v-model hands back a number (or "").
const text = (key: keyof typeof initial) => String(form[key] ?? "").trim();
const changedKeys = computed(() => (Object.keys(initial) as (keyof typeof initial)[]).filter((k) => text(k) !== initial[k]));
const willSetTracks = computed(() => applyTrackNumbers.value && trackChanges.value.length > 0);
const dirty = computed(() => changedKeys.value.length > 0 || cover.value !== undefined || willSetTracks.value);

const saving = ref(false);
const error = ref("");

async function save() {
  error.value = "";
  const edits: TagEdits = {};
  for (const key of changedKeys.value) {
    const raw = text(key);
    if (key === "name" || key === "artist") {
      if (!raw) return void (error.value = `${key === "name" ? "Album name" : "Artist"} can't be empty`);
      edits[key === "name" ? "album" : "artist"] = raw;
    } else if (key === "year") {
      const n = Number(raw);
      if (raw && (!Number.isInteger(n) || n < 0 || n > 9999)) return void (error.value = "Year must be a whole number");
      edits.year = raw ? n : null;
    } else {
      edits.genre = raw || null;
    }
  }
  saving.value = true;
  try {
    let albumId = props.album.id;
    if (Object.keys(edits).length) {
      const result = await updateTracks({ songIds: props.album.song.map((s) => s.id) }, edits);
      albumId = result.albumIds[0] ?? albumId;
    }
    // Song ids don't change with the album's name, so these still apply.
    if (willSetTracks.value) {
      for (const c of trackChanges.value) {
        await updateTracks({ songIds: [c.id] }, { track: c.track ?? null, disc: c.disc ?? null });
      }
    }
    if (cover.value !== undefined) await setCoverArt(albumId, cover.value);
    emit("saved", albumId);
  } catch (e) {
    error.value = e instanceof SubsonicError || e instanceof Error ? e.message : String(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal :title="searching ? 'Find album online' : 'Edit album'" :wide="searching" @close="emit('close')">
    <OnlineSearch
      v-if="searching"
      kind="album"
      :artist="text('artist')"
      :name="text('name')"
      @pick="onMatch"
      @back="searching = false"
    />
    <form v-else class="space-y-3 text-sm" @submit.prevent="save">
      <div class="flex items-start gap-4">
        <div class="cover-box">
          <img v-if="shownCover" :src="shownCover" alt="Cover" />
          <span v-else class="text-xs text-[var(--text-dim)]">No cover</span>
        </div>
        <div class="flex flex-col gap-2">
          <button type="button" @click="searching = true">🔍 Find online…</button>
          <button type="button" @click="fileInput?.click()">{{ hasCover ? "Change cover…" : "Add cover…" }}</button>
          <button v-if="hasCover" type="button" @click="removeCover">Remove cover</button>
          <button v-if="cover !== undefined" type="button" class="link" @click="cover = undefined">Undo cover change</button>
          <input ref="fileInput" type="file" accept="image/*" hidden @change="onPicked" />
        </div>
      </div>

      <p v-if="matchedFrom" class="flex items-center gap-2 text-xs text-[var(--text-dim)]">
        Filled in from {{ matchedFrom.source === "itunes" ? "iTunes" : "MusicBrainz" }} — check before saving.
        <button type="button" class="link" @click="resetForm">Reset</button>
      </p>

      <label class="block">
        Album <span v-if="text('name') !== initial.name" class="was">was: {{ initial.name }}</span>
        <input v-model="form.name" class="mt-1 w-full" />
      </label>
      <label class="block">
        Album artist <span v-if="text('artist') !== initial.artist" class="was">was: {{ initial.artist }}</span>
        <input v-model="form.artist" class="mt-1 w-full" list="album-edit-artists" />
      </label>
      <datalist id="album-edit-artists">
        <option v-for="name in artistNames" :key="name" :value="name" />
      </datalist>
      <div class="grid grid-cols-2 gap-3">
        <label>
          Year <span v-if="text('year') !== initial.year" class="was">was: {{ initial.year || "—" }}</span>
          <input v-model="form.year" type="number" min="0" class="mt-1 w-full" />
        </label>
        <label>
          Genre <span v-if="text('genre') !== initial.genre" class="was">was: {{ initial.genre || "—" }}</span>
          <input v-model="form.genre" class="mt-1 w-full" />
        </label>
      </div>

      <p v-if="loadingTracks" class="flex items-center gap-2 text-xs text-[var(--text-dim)]">
        <span class="spinner"></span> Matching track list…
      </p>
      <div v-else-if="matchedFrom?.albumRef" class="text-xs">
        <p class="text-[var(--text-dim)]">
          {{ matchedSongs }} of {{ album.song.length }} songs found in this release's track list.
        </p>
        <label v-if="trackChanges.length" class="mt-1 flex items-start gap-2">
          <input v-model="applyTrackNumbers" type="checkbox" class="mt-0.5" />
          <span>
            Set track numbers of {{ trackChanges.length }} song{{ trackChanges.length === 1 ? "" : "s" }}
            <span class="text-[var(--text-dim)]">
              ({{
                trackChanges
                  .slice(0, 3)
                  .map((c) => `${c.title} → #${c.track ?? "—"}`)
                  .join(", ")
              }}{{ trackChanges.length > 3 ? ", …" : "" }})
            </span>
          </span>
        </label>
      </div>

      <p class="text-xs text-[var(--text-dim)]">
        Applies to all {{ album.songCount }} songs. If another album by that artist already has this name, the songs join
        it. The files in Telegram aren't changed.
      </p>
      <p v-if="error" class="error text-sm">{{ error }}</p>

      <div class="flex justify-end gap-2 pt-2">
        <button type="button" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="primary inline-flex items-center gap-2" :disabled="saving || !dirty">
          <span v-if="saving" class="spinner"></span> Save
        </button>
      </div>
    </form>
  </Modal>
</template>

<style scoped>
.cover-box {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 8rem;
  height: 8rem;
  flex-shrink: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-hover);
}
.cover-box img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.primary {
  border-color: var(--accent);
  color: var(--accent);
}
.link {
  padding: 0;
  border: none;
  background: none;
  color: var(--accent);
  text-decoration: underline;
  font-size: 0.8rem;
}
.was {
  margin-left: 0.25rem;
  font-size: 0.75rem;
  color: var(--text-dim);
}
</style>

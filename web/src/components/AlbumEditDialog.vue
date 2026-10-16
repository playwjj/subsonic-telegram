<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from "vue";
import {
  coverArtUrl,
  getArtists,
  setCoverArt,
  updateTracks,
  SubsonicError,
  type AlbumDetail,
  type TagEdits,
} from "../api/subsonic";
import { prepareCover } from "../utils/image";
import Modal from "./Modal.vue";

// Album name/artist/year/genre (applied to all its songs — renaming onto an
// existing album merges into it) and its cover. Emits the album's id
// afterwards, which changes when the name or artist does.
const props = defineProps<{ album: AlbumDetail }>();
const emit = defineEmits<{ close: []; saved: [albumId: string] }>();

const initial = {
  name: props.album.name,
  artist: props.album.artist,
  year: props.album.year ? String(props.album.year) : "",
  genre: props.album.genre ?? "",
};
const form = reactive({ ...initial });

// undefined: unchanged; null: remove; Blob: replace.
const cover = ref<Blob | null | undefined>(undefined);
const previewUrl = ref<string | null>(null);
const hasCover = computed(() => (cover.value === undefined ? !!props.album.coverArt : cover.value !== null));
const shownCover = computed(() =>
  cover.value ? previewUrl.value : cover.value === null || !props.album.coverArt ? null : coverArtUrl(props.album.coverArt),
);
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

// The year input's v-model hands back a number (or "").
const text = (key: keyof typeof initial) => String(form[key] ?? "").trim();
const changedKeys = computed(() => (Object.keys(initial) as (keyof typeof initial)[]).filter((k) => text(k) !== initial[k]));
const dirty = computed(() => changedKeys.value.length > 0 || cover.value !== undefined);

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
  <Modal title="Edit album" @close="emit('close')">
    <form class="space-y-3 text-sm" @submit.prevent="save">
      <div class="flex items-start gap-4">
        <div class="cover-box">
          <img v-if="shownCover" :src="shownCover" alt="Cover" />
          <span v-else class="text-xs text-[var(--text-dim)]">No cover</span>
        </div>
        <div class="flex flex-col gap-2">
          <button type="button" @click="fileInput?.click()">{{ hasCover ? "Change cover…" : "Add cover…" }}</button>
          <button v-if="hasCover" type="button" @click="removeCover">Remove cover</button>
          <button v-if="cover !== undefined" type="button" class="link" @click="cover = undefined">Undo cover change</button>
          <input ref="fileInput" type="file" accept="image/*" hidden @change="onPicked" />
        </div>
      </div>

      <label class="block">Album <input v-model="form.name" class="mt-1 w-full" /></label>
      <label class="block">
        Album artist <input v-model="form.artist" class="mt-1 w-full" list="album-edit-artists" />
      </label>
      <datalist id="album-edit-artists">
        <option v-for="name in artistNames" :key="name" :value="name" />
      </datalist>
      <div class="grid grid-cols-2 gap-3">
        <label>Year <input v-model="form.year" type="number" min="0" class="mt-1 w-full" /></label>
        <label>Genre <input v-model="form.genre" class="mt-1 w-full" /></label>
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
</style>

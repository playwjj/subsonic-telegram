<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { getFolder, renameFolder, createFolder, deleteFolder, deleteTrack, SubsonicError, type Song } from "../api/subsonic";
import { playQueue } from "../stores/player";
import TrackRow from "../components/TrackRow.vue";

const router = useRouter();

// Route is `/folders/:path*`. vue-router normally gives repeatable params as
// string[], but hands back "" for the bare (no-segment) case — normalize
// both here rather than depend on that edge case.
const props = defineProps<{ path?: string[] | string }>();

const segments = computed(() => {
  const p = props.path;
  if (!p) return [];
  return Array.isArray(p) ? p : p.split("/").filter(Boolean);
});
const currentPath = computed(() => segments.value.join("/"));

const dirs = ref<string[]>([]);
const songs = ref<Song[]>([]);
const loading = ref(true);
const error = ref("");

async function load(path: string) {
  loading.value = true;
  error.value = "";
  const result = await getFolder(path);
  dirs.value = result.dirs;
  songs.value = result.songs;
  loading.value = false;
}
watch(currentPath, load, { immediate: true });

function breadcrumbTo(index: number) {
  return { name: "folders", params: { path: segments.value.slice(0, index + 1) } };
}

// Renaming a subdirectory shown in this listing (`renamingDir` holds its
// current name) and renaming the current folder itself (via its own
// breadcrumb segment, `renamingSelf`) both just swap the leaf segment of a
// source_path prefix — see renameFolder in src/index.ts.
const renamingDir = ref<string | null>(null);
const renamingSelf = ref(false);
const renameValue = ref("");

function startRenameDir(dir: string) {
  renamingDir.value = dir;
  renameValue.value = dir;
}

async function confirmRenameDir(dir: string) {
  // Enter and the resulting blur (once the input unmounts) can both fire
  // this — bail out on the second call rather than renaming twice.
  if (renamingDir.value !== dir) return;
  const name = renameValue.value.trim();
  renamingDir.value = null;
  if (!name || name === dir) return;
  const fullPath = [...segments.value, dir].join("/");
  await renameFolder(fullPath, name);
  await load(currentPath.value);
}

function startRenameSelf() {
  renamingSelf.value = true;
  renameValue.value = segments.value[segments.value.length - 1] ?? "";
}

async function confirmRenameSelf() {
  if (!renamingSelf.value) return;
  const name = renameValue.value.trim();
  renamingSelf.value = false;
  const oldName = segments.value[segments.value.length - 1];
  if (!name || name === oldName) return;
  await renameFolder(currentPath.value, name);
  await router.push({ name: "folders", params: { path: [...segments.value.slice(0, -1), name] } });
}

const creatingFolder = ref(false);
const newFolderName = ref("");

function startCreateFolder() {
  creatingFolder.value = true;
  newFolderName.value = "";
}

async function confirmCreateFolder() {
  if (!creatingFolder.value) return;
  const name = newFolderName.value.trim();
  creatingFolder.value = false;
  if (!name) return;
  await createFolder(currentPath.value, name);
  await load(currentPath.value);
}

async function handleDeleteDir(dir: string) {
  if (!confirm(`Delete empty folder "${dir}"?`)) return;
  error.value = "";
  const fullPath = [...segments.value, dir].join("/");
  try {
    await deleteFolder(fullPath);
    await load(currentPath.value);
  } catch (e) {
    error.value = e instanceof SubsonicError ? e.message : "Delete failed";
  }
}

async function handleDeleteSelf() {
  const name = segments.value[segments.value.length - 1];
  if (!confirm(`Delete empty folder "${name}"?`)) return;
  error.value = "";
  try {
    await deleteFolder(currentPath.value);
    await router.push({ name: "folders", params: { path: segments.value.slice(0, -1) } });
  } catch (e) {
    error.value = e instanceof SubsonicError ? e.message : "Delete failed";
  }
}

async function handleDelete(song: Song) {
  if (!confirm(`Permanently delete "${song.title}"? This also removes the file from Telegram.`)) return;
  await deleteTrack(song.id);
  songs.value = songs.value.filter((s) => s.id !== song.id);
}
</script>

<template>
  <div>
    <div class="mb-4 flex flex-wrap items-center gap-1 text-sm text-[var(--text-dim)]">
      <RouterLink :to="{ name: 'folders', params: {} }" class="hover:text-[var(--text)]">Folders</RouterLink>
      <template v-for="(seg, i) in segments" :key="i">
        <span>/</span>
        <template v-if="i === segments.length - 1 && renamingSelf">
          <input
            v-model="renameValue"
            class="!py-0.5 text-sm"
            autofocus
            @keyup.enter="confirmRenameSelf"
            @keyup.esc="renamingSelf = false"
            @blur="confirmRenameSelf"
          />
        </template>
        <template v-else-if="i === segments.length - 1">
          <RouterLink :to="breadcrumbTo(i)" class="hover:text-[var(--text)]">{{ seg }}</RouterLink>
          <button class="edit-btn" title="Rename this folder" @click="startRenameSelf">✎</button>
          <button
            v-if="!loading && !dirs.length && !songs.length"
            class="edit-btn"
            title="Delete this empty folder"
            @click="handleDeleteSelf"
          >
            🗑
          </button>
        </template>
        <RouterLink v-else :to="breadcrumbTo(i)" class="hover:text-[var(--text)]">{{ seg }}</RouterLink>
      </template>
    </div>

    <div class="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <RouterLink
        :to="{ name: 'upload', query: { folder: currentPath } }"
        class="rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--surface-hover)]"
      >
        ⬆ Upload here
      </RouterLink>
      <button v-if="!creatingFolder" @click="startCreateFolder">+ New folder</button>
      <input
        v-else
        v-model="newFolderName"
        placeholder="Folder name"
        autofocus
        @keyup.enter="confirmCreateFolder"
        @keyup.esc="creatingFolder = false"
        @blur="confirmCreateFolder"
      />
    </div>

    <p v-if="loading" class="flex items-center gap-2 text-[var(--text-dim)]"><span class="spinner"></span> Loading…</p>
    <p v-else-if="!dirs.length && !songs.length" class="text-[var(--text-dim)]">Empty folder.</p>

    <div v-if="dirs.length" class="glass mb-4 p-2">
      <div v-for="dir in dirs" :key="dir" class="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-white/5">
        <span>📁</span>
        <input
          v-if="renamingDir === dir"
          v-model="renameValue"
          class="!py-0.5 flex-1 text-sm"
          autofocus
          @keyup.enter="confirmRenameDir(dir)"
          @keyup.esc="renamingDir = null"
          @blur="confirmRenameDir(dir)"
        />
        <RouterLink v-else :to="{ name: 'folders', params: { path: [...segments, dir] } }" class="flex-1">{{ dir }}</RouterLink>
        <template v-if="renamingDir !== dir">
          <button class="edit-btn" title="Rename folder" @click="startRenameDir(dir)">✎</button>
          <button class="edit-btn" title="Delete (must be empty)" @click="handleDeleteDir(dir)">🗑</button>
        </template>
      </div>
    </div>

    <p v-if="error" class="error mb-4">{{ error }}</p>

    <div v-if="songs.length" class="glass p-2">
      <TrackRow
        v-for="(song, i) in songs"
        :key="song.id"
        :song="song"
        deletable
        @play="playQueue(songs, i)"
        @delete="handleDelete(song)"
      />
    </div>
  </div>
</template>

<style scoped>
.edit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  line-height: 1;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: transparent;
  color: inherit;
  cursor: pointer;
  flex-shrink: 0;
  font-size: 0.75rem;
}
</style>

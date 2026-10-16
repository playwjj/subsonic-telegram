<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch, type Directive } from "vue";
import { useRouter } from "vue-router";
import {
  getFolder,
  getFolderSongs,
  getShuffleSongs,
  createFolder,
  renameFolder,
  renameTrackFile,
  moveItems,
  deleteItems,
  restoreTrash,
  coverArtUrl,
  downloadUrl,
  SubsonicError,
  type ConflictPolicy,
  type FolderDir,
  type Song,
} from "../api/subsonic";
import { addToQueue, currentTrack, playNext, playQueue } from "../stores/player";
import { canDropInto, drag, folderTree, loadFolderTree, type DragPayload } from "../stores/folders";
import { uploads } from "../stores/uploads";
import { AUDIO_EXTENSIONS, fromDataTransfer, fromFileList, isFileDrag, type PickedFile } from "../utils/pickFiles";
import { baseName, formatBytes, formatDate, formatDuration, joinPath, parentOf } from "../utils/format";
import ShuffleButton from "../components/ShuffleButton.vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import UploadDialog from "../components/upload/UploadDialog.vue";
import AddToPlaylistDialog from "../components/AddToPlaylistDialog.vue";
import FolderTree from "../components/drive/FolderTree.vue";
import MoveDialog from "../components/drive/MoveDialog.vue";
import ContextMenu, { type MenuItem } from "../components/drive/ContextMenu.vue";
import PropertiesDialog from "../components/drive/PropertiesDialog.vue";
import TagEditorDialog from "../components/TagEditorDialog.vue";

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

function folderRoute(path: string) {
  return { name: "folders", params: { path: path ? path.split("/") : [] } };
}
function navigate(path: string) {
  router.push(folderRoute(path));
}

// --- listing ---

const dirs = ref<FolderDir[]>([]);
const songs = ref<Song[]>([]);
const loading = ref(true);
const error = ref("");

async function load(path: string) {
  try {
    const result = await getFolder(path);
    if (path !== currentPath.value) return; // navigated away meanwhile
    dirs.value = result.dirs;
    songs.value = result.songs;
    error.value = "";
  } catch (e) {
    error.value = e instanceof SubsonicError ? e.message : "Failed to load folder";
  } finally {
    loading.value = false;
  }
}


// After anything that changes the library: re-read this folder and the tree.
async function refresh() {
  selected.clear();
  await Promise.all([load(currentPath.value), loadFolderTree()]);
  if (query.value.trim()) runSearch(query.value.trim());
}

// --- search within this folder (and its subfolders) ---

const query = ref("");
const searchResults = ref<Song[] | null>(null);
const searching = computed(() => query.value.trim() !== "");
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let searchToken = 0;

async function runSearch(q: string) {
  const token = ++searchToken;
  const results = await getFolderSongs(currentPath.value, q);
  if (token === searchToken) searchResults.value = results;
}

watch(query, (value) => {
  clearTimeout(searchTimer);
  selected.clear();
  const q = value.trim();
  if (!q) {
    searchToken++;
    searchResults.value = null;
    return;
  }
  searchTimer = setTimeout(() => runSearch(q), 300);
});

// --- entries, sorting, view mode ---

type Entry =
  | { kind: "dir"; key: string; name: string; path: string; dir: FolderDir }
  | { kind: "song"; key: string; name: string; song: Song };

type SortKey = "name" | "title" | "artist" | "duration" | "size" | "added";

const PREFS_KEY = "folders.view";
const prefs = reactive({ mode: "list" as "list" | "grid", sortKey: "name" as SortKey, desc: false });
try {
  Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}"));
} catch {
  // storage unavailable or garbage — keep the defaults
}
watch(prefs, () => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
});

function setSort(key: SortKey) {
  if (prefs.sortKey === key) prefs.desc = !prefs.desc;
  else {
    prefs.sortKey = key;
    prefs.desc = false;
  }
}

function songEntry(song: Song): Entry {
  return { kind: "song", key: `t:${song.id}`, name: song.path ? baseName(song.path) : `${song.title}.${song.suffix}`, song };
}

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

function sortValue(e: Entry, key: SortKey): string | number {
  if (e.kind === "dir") {
    if (key === "duration") return e.dir.duration;
    if (key === "size") return e.dir.size;
    return e.name;
  }
  const s = e.song;
  switch (key) {
    case "title":
      return s.title;
    case "artist":
      return s.artist;
    case "duration":
      return s.duration ?? 0;
    case "size":
      return s.size;
    case "added":
      return s.created ?? "";
    default:
      return e.name;
  }
}

function sorted(list: Entry[]): Entry[] {
  const dir = prefs.desc ? -1 : 1;
  return [...list].sort((a, b) => {
    const x = sortValue(a, prefs.sortKey);
    const y = sortValue(b, prefs.sortKey);
    const c = typeof x === "number" && typeof y === "number" ? x - y : byText(String(x), String(y));
    return (c || byText(a.name, b.name)) * dir;
  });
}

// Folders always first, like any file manager.
const entries = computed<Entry[]>(() => {
  if (searching.value) return sorted((searchResults.value ?? []).map(songEntry));
  const dirEntries = dirs.value.map<Entry>((d) => ({
    kind: "dir",
    key: `d:${d.name}`,
    name: d.name,
    path: joinPath(currentPath.value, d.name),
    dir: d,
  }));
  return [...sorted(dirEntries), ...sorted(songs.value.map(songEntry))];
});

const listedSongs = computed(() => entries.value.flatMap((e) => (e.kind === "song" ? [e.song] : [])));

const totals = computed(() => {
  let size = 0;
  let duration = 0;
  for (const e of entries.value) {
    size += e.kind === "dir" ? e.dir.size : e.song.size;
    duration += e.kind === "dir" ? e.dir.duration : (e.song.duration ?? 0);
  }
  return { folders: entries.value.length - listedSongs.value.length, songs: listedSongs.value.length, size, duration };
});

// --- selection ---

const selected = reactive(new Set<string>());
let anchor: string | null = null;

const selectedEntries = computed(() => entries.value.filter((e) => selected.has(e.key)));
const selectionSize = computed(() =>
  selectedEntries.value.reduce((sum, e) => sum + (e.kind === "dir" ? e.dir.size : e.song.size), 0),
);

function selectOnly(entry: Entry) {
  selected.clear();
  selected.add(entry.key);
  anchor = entry.key;
}

function toggleSelected(entry: Entry) {
  if (selected.has(entry.key)) selected.delete(entry.key);
  else selected.add(entry.key);
  anchor = entry.key;
}

function selectRange(toKey: string, additive: boolean) {
  const keys = entries.value.map((e) => e.key);
  const from = anchor ? keys.indexOf(anchor) : -1;
  const to = keys.indexOf(toKey);
  if (!additive) selected.clear();
  if (from === -1) {
    selected.add(toKey);
    anchor = toKey;
    return;
  }
  for (let i = Math.min(from, to); i <= Math.max(from, to); i++) selected.add(keys[i]);
}

function selectAll() {
  for (const e of entries.value) selected.add(e.key);
}

// Touch: a long press toggles selection (and, once anything is selected,
// plain taps keep toggling) since there's no Ctrl/Shift to hold.
let lastPointerType = "mouse";
let longPressTimer: ReturnType<typeof setTimeout> | undefined;
let suppressClick = false;

function onPointerDown(e: PointerEvent, entry: Entry) {
  lastPointerType = e.pointerType;
  if (e.pointerType !== "touch") return;
  clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => {
    toggleSelected(entry);
    suppressClick = true;
    navigator.vibrate?.(15);
  }, 500);
}
function cancelLongPress() {
  clearTimeout(longPressTimer);
}

function onEntryClick(e: MouseEvent, entry: Entry) {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  if (e.shiftKey) selectRange(entry.key, e.metaKey || e.ctrlKey);
  else if (e.metaKey || e.ctrlKey || (lastPointerType === "touch" && selected.size > 0)) toggleSelected(entry);
  else selectOnly(entry);
}

function onCheckboxClick(e: MouseEvent, entry: Entry) {
  if (e.shiftKey) selectRange(entry.key, true);
  else toggleSelected(entry);
}

// Declared after `selected`/`query`, which it resets immediately.
watch(
  currentPath,
  (path) => {
    loading.value = true;
    selected.clear();
    anchor = null;
    query.value = "";
    load(path);
  },
  { immediate: true },
);
onMounted(() => {
  if (!folderTree.loaded) loadFolderTree();
});

// --- opening / playing ---

function openEntry(entry: Entry) {
  if (entry.kind === "dir") navigate(entry.path);
  else playQueue(listedSongs.value, listedSongs.value.indexOf(entry.song));
}

// Selected songs, with each selected folder expanded to everything in it
// (subfolders included), in display order.
async function resolveSongs(list: Entry[]): Promise<Song[]> {
  const out: Song[] = [];
  for (const e of list) {
    if (e.kind === "song") out.push(e.song);
    else out.push(...(await getFolderSongs(e.path)));
  }
  return out;
}

async function playFolder() {
  await attempt(async () => {
    const list = await getFolderSongs(currentPath.value);
    if (list.length) playQueue(list);
  });
}

// --- feedback ---

// A toast, optionally with one action button (e.g. "Undo").
const notice = ref<{ message: string; action?: { label: string; run: () => void } } | null>(null);
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function notify(message: string, action?: { label: string; run: () => void }) {
  notice.value = { message, action };
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.value = null), action ? 8000 : 3500);
}

async function attempt(action: () => Promise<void>) {
  error.value = "";
  try {
    await action();
  } catch (e) {
    error.value = e instanceof SubsonicError ? e.message : e instanceof Error ? e.message : String(e);
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// --- rename / new folder (inline) ---

const renamingKey = ref<string | null>(null);
const renameValue = ref("");

function startRename(entry: Entry) {
  renamingKey.value = entry.key;
  renameValue.value = entry.name;
}

async function confirmRename(entry: Entry) {
  // Enter and the resulting blur (once the input unmounts) can both fire
  // this — bail out on the second call rather than renaming twice.
  if (renamingKey.value !== entry.key) return;
  renamingKey.value = null;
  const name = renameValue.value.trim();
  if (!name || name === entry.name) return;
  await attempt(async () => {
    if (entry.kind === "dir") await renameFolder(entry.path, name);
    else await renameTrackFile(entry.song.id, name);
    await refresh();
  });
}

const creatingFolder = ref(false);
const newFolderName = ref("");

function startCreateFolder() {
  query.value = "";
  creatingFolder.value = true;
  newFolderName.value = "New folder";
}

async function confirmCreateFolder() {
  if (!creatingFolder.value) return;
  creatingFolder.value = false;
  const name = newFolderName.value.trim();
  if (!name) return;
  await attempt(async () => {
    await createFolder(currentPath.value, name);
    await refresh();
  });
}

// Focuses an inline name input and selects the name — minus the extension
// for a file, like Finder/Explorer do.
const vFocusName: Directive<HTMLInputElement, boolean | undefined> = {
  mounted(el, binding) {
    el.focus();
    const dot = binding.value ? el.value.lastIndexOf(".") : -1;
    el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
  },
};

// --- move (dialog, drag and drop) ---

function payloadOf(list: Entry[]): DragPayload {
  return {
    songIds: list.flatMap((e) => (e.kind === "song" ? [e.song.id] : [])),
    folderPaths: list.flatMap((e) => (e.kind === "dir" ? [e.path] : [])),
  };
}

const moveDialog = ref<{ payload: DragPayload; count: number } | null>(null);
const conflict = ref<{ payload: DragPayload; dest: string; names: string[] } | null>(null);
const moving = ref(false);

async function moveTo(payload: DragPayload, dest: string, policy: ConflictPolicy = "ask") {
  moving.value = true;
  await attempt(async () => {
    const result = await moveItems({ ...payload, dest, onConflict: policy });
    if (policy === "ask" && result.conflicts.length) {
      moveDialog.value = null;
      conflict.value = { payload, dest, names: result.conflicts };
      return;
    }
    moveDialog.value = null;
    conflict.value = null;
    notify(
      `Moved ${plural(result.moved, "item")} to ${dest || "the root folder"}` +
        (result.skipped ? ` · skipped ${result.skipped}` : ""),
    );
    await refresh();
  });
  moving.value = false;
}

const dropTarget = ref<string | null>(null);

function onDragStart(e: DragEvent, entry: Entry) {
  if (!selected.has(entry.key)) selectOnly(entry);
  drag.payload = payloadOf(selectedEntries.value);
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `${selectedEntries.value.length} items`);
  }
}

function onDragEnd() {
  drag.payload = null;
  dropTarget.value = null;
}

function onDragOverFolder(e: DragEvent, path: string) {
  if (!canDropInto(path) || path === currentPath.value) return;
  e.preventDefault();
  dropTarget.value = path;
}

function dropInto(path: string) {
  const payload = drag.payload;
  onDragEnd();
  if (payload && canDropInto(path, payload) && path !== currentPath.value) moveTo(payload, path);
}

// --- delete: to the trash (with Undo), or forever ---

async function trash(list: Entry[]) {
  if (!list.length) return;
  await attempt(async () => {
    const { deleted, entryIds } = await deleteItems(payloadOf(list));
    const what = list.length === 1 ? `“${list[0].name}”` : plural(list.length, "item");
    notify(`Moved ${what} to the trash${list.some((e) => e.kind === "dir") ? ` (${plural(deleted, "song")})` : ""}`, {
      label: "Undo",
      run: () => undo(entryIds),
    });
    await refresh();
  });
}

async function undo(entryIds: string[]) {
  notice.value = null;
  await attempt(async () => {
    const { restored, renamed } = await restoreTrash(entryIds);
    notify(`Restored ${plural(restored, "song")}${renamed ? ` (${renamed} renamed — the name was taken)` : ""}`);
    await refresh();
  });
}

const deleteDialog = ref<{ payload: DragPayload; label: string; songCount: number; size: number } | null>(null);
const deleting = ref(false);

function askDeleteForever(list: Entry[]) {
  if (!list.length) return;
  const folders = list.filter((e) => e.kind === "dir").length;
  const label = [folders && plural(folders, "folder"), list.length - folders && plural(list.length - folders, "song")]
    .filter(Boolean)
    .join(" and ");
  deleteDialog.value = {
    payload: payloadOf(list),
    label: list.length === 1 ? `"${list[0].name}"` : label,
    songCount: list.reduce((n, e) => n + (e.kind === "dir" ? e.dir.songCount : 1), 0),
    size: list.reduce((n, e) => n + (e.kind === "dir" ? e.dir.size : e.song.size), 0),
  };
}

async function confirmDeleteForever() {
  if (!deleteDialog.value) return;
  deleting.value = true;
  await attempt(async () => {
    const { deleted } = await deleteItems({ ...deleteDialog.value!.payload, permanent: true });
    deleteDialog.value = null;
    notify(`Deleted ${plural(deleted, "song")} forever`);
    await refresh();
  });
  deleting.value = false;
}

// --- download ---

async function download(list: Song[]) {
  for (const [i, song] of list.entries()) {
    // Browsers drop rapid-fire programmatic downloads; space them out.
    if (i) await new Promise((r) => setTimeout(r, 500));
    const a = document.createElement("a");
    a.href = downloadUrl(song.id);
    a.download = "";
    a.click();
  }
}

// --- dialogs ---

const playlistDialog = ref<string[] | null>(null);
const propertiesDialog = ref<{ song?: Song; folder?: FolderDir & { path: string } } | null>(null);
const tagDialog = ref<{ songs: Song[]; songIds: string[]; folderPaths: string[]; count: number } | null>(null);
// --- upload: pick files/a folder, or drop them from the OS onto the view ---

const uploadDialog = ref<PickedFile[] | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const folderInput = ref<HTMLInputElement | null>(null);

function onPicked(e: Event) {
  const input = e.target as HTMLInputElement;
  const picked = fromFileList(input.files);
  input.value = "";
  if (picked.length) uploadDialog.value = picked;
}

function openUploadMenu(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  menu.value = {
    x: rect.left,
    y: rect.bottom + 4,
    items: [
      { label: "Upload files…", action: () => fileInput.value?.click() },
      { label: "Upload a folder…", action: () => folderInput.value?.click() },
    ],
  };
}

// dragover fires continuously while over the view; the overlay hides
// shortly after it stops (dragleave is unreliable across child elements).
const fileDragOver = ref(false);
let fileDragTimer: ReturnType<typeof setTimeout> | undefined;

function onViewDragOver(e: DragEvent) {
  if (drag.payload || !isFileDrag(e)) return; // rows being moved, not files
  e.preventDefault();
  fileDragOver.value = true;
  clearTimeout(fileDragTimer);
  fileDragTimer = setTimeout(() => (fileDragOver.value = false), 150);
}

async function onViewDrop(e: DragEvent) {
  if (drag.payload || !e.dataTransfer || !isFileDrag(e)) return;
  e.preventDefault();
  fileDragOver.value = false;
  const picked = await fromDataTransfer(e.dataTransfer);
  if (picked.length) uploadDialog.value = picked;
}

// Uploads finish in the background (stores/uploads.ts): refresh once a
// burst of them settles, whichever folder they went to (totals change too).
let uploadRefreshTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => uploads.completed,
  () => {
    clearTimeout(uploadRefreshTimer);
    uploadRefreshTimer = setTimeout(() => {
      if (!renamingKey.value && !creatingFolder.value) refresh();
    }, 1200);
  },
);

function onAddedToPlaylist(name: string) {
  playlistDialog.value = null;
  notify(`Added to “${name}”`);
}

// Folders are edited server-side as a whole (however big); their songs are
// fetched here only to show the current values.
async function editTags(list: Entry[]) {
  await attempt(async () => {
    const songIds = list.flatMap((e) => (e.kind === "song" ? [e.song.id] : []));
    const folderPaths = list.flatMap((e) => (e.kind === "dir" ? [e.path] : []));
    const count = list.reduce((n, e) => n + (e.kind === "song" ? 1 : e.dir.songCount), 0);
    if (!count) return notify("Nothing to edit — no songs selected");
    tagDialog.value = { songs: await resolveSongs(list), songIds, folderPaths, count };
  });
}

function onTagsSaved(updated: number) {
  tagDialog.value = null;
  notify(`Updated ${plural(updated, "song")}`);
  refresh();
}

function showProperties(entry: Entry) {
  propertiesDialog.value = entry.kind === "song" ? { song: entry.song } : { folder: { ...entry.dir, path: entry.path } };
}

// --- context menu / actions on the selection ---

const menu = ref<{ x: number; y: number; items: MenuItem[] } | null>(null);

function selectionActions(list: Entry[]): MenuItem[] {
  const single = list.length === 1 ? list[0] : null;
  const onlySongs = list.every((e) => e.kind === "song");
  const items: MenuItem[] = [];
  if (single?.kind === "dir") items.push({ label: "Open", action: () => navigate(single.path) });
  if (single?.kind === "song" && searching.value && single.song.path) {
    items.push({ label: "Show in folder", action: () => navigate(parentOf(single.song.path!)) });
  }
  items.push(
    { label: "Play", action: () => attempt(async () => playQueue(await resolveSongs(list))) },
    { label: "Play next", action: () => attempt(async () => playNext(await resolveSongs(list))) },
    { label: "Add to queue", action: () => attempt(async () => addToQueue(await resolveSongs(list))) },
    {
      label: "Add to playlist…",
      action: () => attempt(async () => void (playlistDialog.value = (await resolveSongs(list)).map((s) => s.id))),
    },
    { label: "Edit tags…", separated: true, action: () => editTags(list) },
    {
      label: "Move to…",
      action: () => (moveDialog.value = { payload: payloadOf(list), count: list.length }),
    },
    { label: "Rename", disabled: !single, action: () => single && startRename(single) },
    {
      label: onlySongs ? "Download" : "Download (songs only)",
      disabled: !onlySongs,
      action: () => download(list.flatMap((e) => (e.kind === "song" ? [e.song] : []))),
    },
    { label: "Properties", disabled: !single, action: () => single && showProperties(single) },
    { label: "Move to trash", separated: true, danger: true, action: () => trash(list) },
    { label: "Delete forever…", danger: true, action: () => askDeleteForever(list) },
  );
  return items;
}

function backgroundActions(): MenuItem[] {
  return [
    { label: "New folder", action: startCreateFolder },
    { label: "Upload files…", action: () => fileInput.value?.click() },
    { label: "Upload a folder…", action: () => folderInput.value?.click() },
    { label: "Play all", separated: true, action: playFolder },
    { label: "Select all", action: selectAll },
  ];
}

function openMenu(e: MouseEvent, entry?: Entry) {
  // A touch long-press fires contextmenu on some platforms; that gesture
  // means "select" here (see onPointerDown).
  if (lastPointerType === "touch") return;
  if (entry && !selected.has(entry.key)) selectOnly(entry);
  if (!entry) selected.clear();
  menu.value = {
    x: e.clientX,
    y: e.clientY,
    items: entry ? selectionActions(selectedEntries.value) : backgroundActions(),
  };
}

// The ⋯ button on each row: same menu, for touch screens and anyone who
// doesn't think of right-clicking.
function openMenuAt(e: MouseEvent, entry: Entry) {
  if (!selected.has(entry.key)) selectOnly(entry);
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  menu.value = { x: rect.left, y: rect.bottom + 4, items: selectionActions(selectedEntries.value) };
}

// --- keyboard ---

const dialogOpen = computed(
  () =>
    !!(
      menu.value ||
      moveDialog.value ||
      conflict.value ||
      deleteDialog.value ||
      playlistDialog.value ||
      propertiesDialog.value ||
      tagDialog.value ||
      uploadDialog.value
    ),
);

function onKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement;
  if (dialogOpen.value || target.closest("input, textarea, select, [contenteditable]")) return;
  const mod = e.metaKey || e.ctrlKey;
  const list = selectedEntries.value;

  if (mod && e.key.toLowerCase() === "a") {
    e.preventDefault();
    selectAll();
  } else if (e.key === "Escape") {
    selected.clear();
  } else if (e.shiftKey && e.key === "Delete") {
    e.preventDefault();
    askDeleteForever(list);
  } else if (e.key === "Delete" || (mod && e.key === "Backspace")) {
    e.preventDefault();
    trash(list);
  } else if (e.key === "Backspace" && !searching.value && currentPath.value) {
    e.preventDefault();
    navigate(parentOf(currentPath.value));
  } else if (e.key === "F2" && list.length === 1) {
    e.preventDefault();
    startRename(list[0]);
  } else if (e.key === "Enter" && list.length === 1) {
    e.preventDefault();
    openEntry(list[0]);
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const keys = entries.value.map((x) => x.key);
    if (!keys.length) return;
    const at = anchor ? keys.indexOf(anchor) : -1;
    const next = keys[Math.max(0, Math.min(keys.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))];
    const entry = entries.value.find((x) => x.key === next)!;
    if (e.shiftKey) {
      selected.add(next);
      anchor = next;
    } else selectOnly(entry);
    document.querySelector(`[data-key="${CSS.escape(next)}"]`)?.scrollIntoView({ block: "nearest" });
  }
}

onMounted(() => document.addEventListener("keydown", onKeydown));
onUnmounted(() => document.removeEventListener("keydown", onKeydown));

const isPlaying = (entry: Entry) => entry.kind === "song" && currentTrack.value?.id === entry.song.id;

const columns: { key: SortKey; label: string; class: string }[] = [
  { key: "name", label: "Name", class: "col-name" },
  { key: "title", label: "Title · Artist", class: "col-meta" },
  { key: "duration", label: "Time", class: "col-time" },
  { key: "size", label: "Size", class: "col-size" },
  { key: "added", label: "Added", class: "col-added" },
];
</script>

<template>
  <div class="drive" @dragover="onViewDragOver" @drop="onViewDrop">
    <aside class="sidebar glass">
      <FolderTree :selected="currentPath" accept-drops @select="navigate" @drop="dropInto" />
      <p v-if="folderTree.loaded" class="mt-2 border-t border-[var(--border)] px-2 pt-2 text-xs text-[var(--text-dim)]">
        {{ folderTree.root.songCount.toLocaleString() }} songs · {{ formatBytes(folderTree.root.size) }}
      </p>
      <div class="sidebar-links">
        <RouterLink :to="{ name: 'duplicates' }">⧉ Duplicates</RouterLink>
        <RouterLink :to="{ name: 'trash' }">🗑 Trash</RouterLink>
      </div>
    </aside>

    <section class="min-w-0 flex-1" @contextmenu.self.prevent="openMenu($event)">
      <!-- Breadcrumb (each segment is also a drop target) -->
      <nav class="mb-3 flex flex-wrap items-center gap-1 text-sm text-[var(--text-dim)]">
        <template v-for="(crumb, i) in ['', ...segments.map((_, j) => segments.slice(0, j + 1).join('/'))]" :key="crumb">
          <span v-if="i > 0">/</span>
          <RouterLink
            :to="folderRoute(crumb)"
            class="crumb"
            :class="{ current: crumb === currentPath, 'drop-target': dropTarget === crumb && drag.payload }"
            @dragover="onDragOverFolder($event, crumb)"
            @dragleave="dropTarget = null"
            @drop.prevent="dropInto(crumb)"
          >
            {{ i === 0 ? "Folders" : segments[i - 1] }}
          </RouterLink>
        </template>
      </nav>

      <!-- Toolbar -->
      <div class="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <button @click="openUploadMenu">⬆ Upload ▾</button>
        <input ref="fileInput" type="file" multiple :accept="AUDIO_EXTENSIONS.join(',')" hidden @change="onPicked" />
        <input ref="folderInput" type="file" webkitdirectory hidden @change="onPicked" />
        <button @click="startCreateFolder">+ New folder</button>
        <button :disabled="!entries.length" @click="playFolder">▶ Play all</button>
        <ShuffleButton
          v-if="entries.length"
          title="Shuffle everything in this folder, including subfolders"
          :load="() => getShuffleSongs({ path: currentPath })"
        />
        <RouterLink :to="{ name: 'duplicates' }" class="narrow-link" title="Find duplicates">⧉</RouterLink>
        <RouterLink :to="{ name: 'trash' }" class="narrow-link" title="Trash">🗑</RouterLink>
        <input v-model="query" type="search" class="search ml-auto" placeholder="Search in this folder…" />
        <div class="segmented" role="group" aria-label="View">
          <button :class="{ active: prefs.mode === 'list' }" title="List view" @click="prefs.mode = 'list'">☰</button>
          <button :class="{ active: prefs.mode === 'grid' }" title="Grid view" @click="prefs.mode = 'grid'">▦</button>
        </div>
        <select v-if="prefs.mode === 'grid'" v-model="prefs.sortKey" title="Sort by">
          <option v-for="c in columns" :key="c.key" :value="c.key">{{ c.key === "title" ? "Title" : c.label }}</option>
          <option value="artist">Artist</option>
        </select>
      </div>

      <!-- Selection bar -->
      <div v-if="selected.size" class="selection-bar glass">
        <span class="font-medium">{{ selected.size }} selected</span>
        <span class="text-[var(--text-dim)]">· {{ formatBytes(selectionSize) }}</span>
        <div class="ml-auto flex flex-wrap gap-1.5">
          <button
            v-for="item in selectionActions(selectedEntries).filter(
              (i) => !i.disabled && i.label !== 'Open' && i.label !== 'Delete forever…',
            )"
            :key="item.label"
            :class="{ danger: item.danger }"
            @click="item.action()"
          >
            {{ item.label.replace("…", "") }}
          </button>
          <button title="Clear selection" @click="selected.clear()">✕</button>
        </div>
      </div>

      <p v-if="error" class="error mb-3 text-sm">{{ error }}</p>

      <p v-if="loading || (searching && !searchResults)" class="flex items-center gap-2 text-[var(--text-dim)]">
        <span class="spinner"></span> {{ searching ? "Searching…" : "Loading…" }}
      </p>
      <template v-else>
        <p v-if="!entries.length && !creatingFolder" class="py-10 text-center text-[var(--text-dim)]">
          {{ searching ? "No matches in this folder." : "This folder is empty — drop files or folders here to upload, or drag items in from elsewhere." }}
        </p>

        <!-- List view -->
        <div v-if="prefs.mode === 'list' && (entries.length || creatingFolder)" class="glass list" @contextmenu.self.prevent="openMenu($event)">
          <div class="row header">
            <input
              type="checkbox"
              :checked="selected.size > 0 && selected.size === entries.length"
              :indeterminate="selected.size > 0 && selected.size < entries.length"
              title="Select all"
              @change="selected.size === entries.length ? selected.clear() : selectAll()"
            />
            <span></span>
            <button v-for="c in columns" :key="c.key" class="sort" :class="c.class" @click="setSort(c.key)">
              {{ c.label }}
              <span v-if="prefs.sortKey === c.key || (c.key === 'title' && prefs.sortKey === 'artist')">
                {{ prefs.desc ? "↓" : "↑" }}
              </span>
            </button>
            <span></span>
          </div>

          <div v-if="creatingFolder" class="row">
            <span></span>
            <span class="icon">📁</span>
            <input
              v-model="newFolderName"
              v-focus-name
              class="col-name !py-0.5"
              @keyup.enter="confirmCreateFolder"
              @keyup.esc="creatingFolder = false"
              @blur="confirmCreateFolder"
            />
          </div>

          <div
            v-for="entry in entries"
            :key="entry.key"
            :data-key="entry.key"
            class="row item"
            :class="{
              selected: selected.has(entry.key),
              playing: isPlaying(entry),
              'drop-target': entry.kind === 'dir' && dropTarget === entry.path && drag.payload,
            }"
            :draggable="renamingKey !== entry.key"
            @click="onEntryClick($event, entry)"
            @dblclick="openEntry(entry)"
            @contextmenu.prevent="openMenu($event, entry)"
            @pointerdown="onPointerDown($event, entry)"
            @pointerup="cancelLongPress"
            @pointercancel="cancelLongPress"
            @pointermove="cancelLongPress"
            @dragstart="onDragStart($event, entry)"
            @dragend="onDragEnd"
            @dragover="entry.kind === 'dir' && onDragOverFolder($event, entry.path)"
            @dragleave="dropTarget = null"
            @drop.prevent="entry.kind === 'dir' && dropInto(entry.path)"
          >
            <input type="checkbox" :checked="selected.has(entry.key)" @click.stop="onCheckboxClick($event, entry)" />
            <span v-if="entry.kind === 'dir'" class="icon">📁</span>
            <button v-else class="icon play" title="Play" @click.stop="openEntry(entry)">
              <img :src="coverArtUrl(entry.song.coverArt)" alt="" loading="lazy" />
              <span>{{ isPlaying(entry) ? "♪" : "▶" }}</span>
            </button>

            <div class="col-name">
              <input
                v-if="renamingKey === entry.key"
                v-model="renameValue"
                v-focus-name="entry.kind === 'song'"
                class="w-full !py-0.5"
                @click.stop
                @dblclick.stop
                @keyup.enter="confirmRename(entry)"
                @keyup.esc="renamingKey = null"
                @blur="confirmRename(entry)"
              />
              <template v-else>
                <a class="name" :title="entry.name" @click.stop="openEntry(entry)">{{ entry.name }}</a>
                <div v-if="entry.kind === 'dir'" class="sub">{{ plural(entry.dir.songCount, "song") }}</div>
                <div v-else class="sub">
                  <span class="narrow-only">{{ entry.song.title }} · {{ entry.song.artist }}</span>
                  <a
                    v-if="searching && entry.song.path"
                    class="folder-link"
                    @click.stop="navigate(parentOf(entry.song.path))"
                  >
                    📁 {{ parentOf(entry.song.path) || "(root)" }}
                  </a>
                </div>
              </template>
            </div>
            <div class="col-meta">
              <template v-if="entry.kind === 'song'">
                <div class="truncate">{{ entry.song.title }}</div>
                <div class="sub truncate">{{ entry.song.artist }}</div>
              </template>
            </div>
            <span class="col-time">{{ formatDuration(entry.kind === "dir" ? entry.dir.duration : entry.song.duration) }}</span>
            <span class="col-size">{{ formatBytes(entry.kind === "dir" ? entry.dir.size : entry.song.size) }}</span>
            <span class="col-added">
              <template v-if="entry.kind === 'song'">
                {{ formatDate(entry.song.created) }}
                <span class="sub block">{{ entry.song.suffix.toUpperCase() }}{{ entry.song.bitRate ? ` · ${entry.song.bitRate}k` : "" }}</span>
              </template>
            </span>
            <button class="more" title="More actions" @click.stop="openMenuAt($event, entry)">⋯</button>
          </div>
        </div>

        <!-- Grid view -->
        <div v-else-if="prefs.mode === 'grid' && (entries.length || creatingFolder)" class="grid-view" @contextmenu.self.prevent="openMenu($event)">
          <div v-if="creatingFolder" class="card glass">
            <div class="thumb">📁</div>
            <input
              v-model="newFolderName"
              v-focus-name
              class="w-full !py-0.5 text-sm"
              @keyup.enter="confirmCreateFolder"
              @keyup.esc="creatingFolder = false"
              @blur="confirmCreateFolder"
            />
          </div>
          <div
            v-for="entry in entries"
            :key="entry.key"
            :data-key="entry.key"
            class="card glass"
            :class="{
              selected: selected.has(entry.key),
              playing: isPlaying(entry),
              'drop-target': entry.kind === 'dir' && dropTarget === entry.path && drag.payload,
            }"
            :draggable="renamingKey !== entry.key"
            @click="onEntryClick($event, entry)"
            @dblclick="openEntry(entry)"
            @contextmenu.prevent="openMenu($event, entry)"
            @pointerdown="onPointerDown($event, entry)"
            @pointerup="cancelLongPress"
            @pointercancel="cancelLongPress"
            @pointermove="cancelLongPress"
            @dragstart="onDragStart($event, entry)"
            @dragend="onDragEnd"
            @dragover="entry.kind === 'dir' && onDragOverFolder($event, entry.path)"
            @dragleave="dropTarget = null"
            @drop.prevent="entry.kind === 'dir' && dropInto(entry.path)"
          >
            <input
              type="checkbox"
              class="card-check"
              :checked="selected.has(entry.key)"
              @click.stop="onCheckboxClick($event, entry)"
            />
            <button class="card-more" title="More actions" @click.stop="openMenuAt($event, entry)">⋯</button>
            <div v-if="entry.kind === 'dir'" class="thumb">📁</div>
            <img v-else class="thumb" :src="coverArtUrl(entry.song.coverArt)" alt="" loading="lazy" />
            <input
              v-if="renamingKey === entry.key"
              v-model="renameValue"
              v-focus-name="entry.kind === 'song'"
              class="w-full !py-0.5 text-sm"
              @click.stop
              @dblclick.stop
              @keyup.enter="confirmRename(entry)"
              @keyup.esc="renamingKey = null"
              @blur="confirmRename(entry)"
            />
            <a v-else class="name line-clamp-2 text-sm" :title="entry.name" @click.stop="openEntry(entry)">{{ entry.name }}</a>
            <div class="sub truncate">
              {{ entry.kind === "dir" ? `${plural(entry.dir.songCount, "song")} · ${formatBytes(entry.dir.size)}` : entry.song.artist }}
            </div>
          </div>
        </div>

        <p v-if="entries.length" class="mt-3 text-xs text-[var(--text-dim)]">
          <template v-if="totals.folders">{{ plural(totals.folders, "folder") }} · </template>
          {{ plural(totals.songs, "song") }} · {{ formatBytes(totals.size) }} · {{ formatDuration(totals.duration) }}
          <template v-if="searching && searchResults?.length === 500"> · showing the first 500 matches</template>
          <span class="hint"> · Right-click or ⋯ for actions; drag onto a folder to move</span>
        </p>
      </template>
    </section>

    <Transition name="fade">
      <div v-if="notice" class="notice glass">
        {{ notice.message }}
        <button v-if="notice.action" class="notice-action" @click="notice.action.run()">{{ notice.action.label }}</button>
      </div>
    </Transition>

    <ContextMenu v-if="menu" :x="menu.x" :y="menu.y" :items="menu.items" @close="menu = null" />

    <MoveDialog
      v-if="moveDialog"
      :items="moveDialog.payload"
      :count="moveDialog.count"
      :from="searching ? undefined : currentPath"
      @close="moveDialog = null"
      @move="moveTo(moveDialog!.payload, $event)"
    />

    <ConfirmDialog
      v-if="conflict"
      title="Name already taken"
      confirm-label=""
      @close="conflict = null"
    >
      <p>
        {{ conflict.names.length === 1 ? "An item" : `${conflict.names.length} items` }} with the same name already
        {{ conflict.names.length === 1 ? "exists" : "exist" }} in “{{ conflict.dest || "the root folder" }}”:
      </p>
      <ul class="max-h-40 overflow-y-auto rounded-lg border border-[var(--border)] px-3 py-2 text-[var(--text-dim)]">
        <li v-for="name in conflict.names" :key="name" class="truncate">{{ name }}</li>
      </ul>
      <template #actions>
        <button :disabled="moving" @click="conflict = null">Cancel</button>
        <button :disabled="moving" @click="moveTo(conflict!.payload, conflict!.dest, 'skip')">Skip these</button>
        <button class="primary" :disabled="moving" @click="moveTo(conflict!.payload, conflict!.dest, 'rename')">
          Keep both (rename)
        </button>
      </template>
    </ConfirmDialog>

    <ConfirmDialog
      v-if="deleteDialog"
      title="Delete forever?"
      confirm-label="Delete forever"
      danger
      :busy="deleting"
      @close="deleteDialog = null"
      @confirm="confirmDeleteForever"
    >
      <p>
        Delete {{ deleteDialog.label }}?
        <template v-if="!deleteDialog.songCount">It's empty.</template>
        <template v-else-if="deleteDialog.payload.folderPaths.length">
          That's {{ plural(deleteDialog.songCount, "song") }} ({{ formatBytes(deleteDialog.size) }}) in total.
        </template>
      </p>
      <p v-if="deleteDialog.songCount" class="text-[var(--text-dim)]">
        This skips the trash: the files are deleted from Telegram right away, and they're removed from playlists and
        favorites. This can't be undone.
      </p>
    </ConfirmDialog>

    <AddToPlaylistDialog
      v-if="playlistDialog"
      :song-ids="playlistDialog"
      @close="playlistDialog = null"
      @added="onAddedToPlaylist"
    />

    <PropertiesDialog
      v-if="propertiesDialog"
      :song="propertiesDialog.song"
      :folder="propertiesDialog.folder"
      @close="propertiesDialog = null"
    />

    <TagEditorDialog
      v-if="tagDialog"
      v-bind="tagDialog"
      @close="tagDialog = null"
      @saved="onTagsSaved($event.updated)"
    />

    <UploadDialog v-if="uploadDialog" :picked="uploadDialog" :folder="currentPath" @close="uploadDialog = null" />

    <div v-if="fileDragOver" class="file-drop-overlay">
      <div>⬆ Drop to upload to “{{ currentPath || "the root folder" }}”</div>
    </div>
  </div>
</template>

<style scoped>
.drive {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
}
.sidebar {
  position: sticky;
  top: 5.5rem;
  width: 15rem;
  flex-shrink: 0;
  max-height: calc(100vh - 12rem);
  overflow: auto;
  padding: 0.4rem;
}
@media (max-width: 1023px) {
  .sidebar {
    display: none;
  }
}

.crumb {
  border-radius: 6px;
  padding: 0.1rem 0.3rem;
}
.crumb:hover,
.crumb.current {
  color: var(--text);
}
.crumb.drop-target,
.drop-target {
  outline: 1px dashed var(--accent);
  background: rgba(125, 211, 192, 0.1);
}

.search {
  min-width: 0;
  width: 14rem;
  padding-top: 0.4rem;
  padding-bottom: 0.4rem;
}
@media (max-width: 600px) {
  .search {
    width: 100%;
    order: 10;
  }
}
.segmented {
  display: flex;
}
.segmented button {
  padding: 0.4rem 0.6rem;
}
.segmented button:first-child {
  border-radius: 8px 0 0 8px;
}
.segmented button:last-child {
  border-radius: 0 8px 8px 0;
  border-left: none;
}
.segmented .active {
  background: var(--surface-hover);
  color: var(--accent);
}

.selection-bar {
  position: sticky;
  top: 5rem;
  z-index: 10;
  display: flex;
  flex-wrap: wrap;
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
.danger {
  color: var(--danger);
}
.primary {
  border-color: var(--accent);
  color: var(--accent);
}

/* --- list view --- */
.list {
  padding: 0.25rem;
  user-select: none;
}
.row {
  display: grid;
  grid-template-columns: 1.25rem 2.25rem minmax(0, 2fr) minmax(0, 1.4fr) 3.75rem 4.5rem 6rem 1.75rem;
  align-items: center;
  gap: 0.6rem;
  padding: 0.35rem 0.5rem;
  border-radius: 10px;
  font-size: 0.875rem;
}
.row.header {
  color: var(--text-dim);
  font-size: 0.75rem;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  margin-bottom: 0.15rem;
}
.row.item {
  cursor: default;
}
.row.item:hover {
  background: rgba(255, 255, 255, 0.04);
}
.row.selected,
.card.selected {
  background: rgba(125, 211, 192, 0.12);
}
.row.playing .name,
.card.playing .name {
  color: var(--accent);
}
.sort {
  border: none;
  background: none;
  padding: 0;
  text-align: left;
  font-size: inherit;
  color: inherit;
}
.sort:hover {
  background: none;
  color: var(--text);
}
.col-time,
.col-size {
  font-variant-numeric: tabular-nums;
  color: var(--text-dim);
  text-align: right;
}
.sort.col-time,
.sort.col-size {
  text-align: right;
}
.col-added {
  color: var(--text-dim);
  font-size: 0.8rem;
}
.icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  font-size: 1.35rem;
}
.icon.play {
  position: relative;
  padding: 0;
  border: none;
  border-radius: 6px;
  overflow: hidden;
  background: var(--surface-hover);
}
.icon.play img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.icon.play span {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  background: rgba(0, 0, 0, 0.45);
  opacity: 0;
  transition: opacity 0.15s ease;
}
.icon.play:hover span,
.row.playing .icon.play span {
  opacity: 1;
}
.name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.name:hover {
  text-decoration: underline;
}
.sub {
  font-size: 0.75rem;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.folder-link {
  cursor: pointer;
}
.folder-link:hover {
  color: var(--text);
}
.narrow-only {
  display: none;
}
.more,
.card-more {
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: transparent;
  line-height: 1;
}
@media (max-width: 900px) {
  .row {
    grid-template-columns: 1.25rem 2.25rem minmax(0, 1fr) 3.5rem 4.25rem 1.75rem;
  }
  .col-meta,
  .col-added {
    display: none;
  }
  .narrow-only {
    display: inline;
  }
  .narrow-only + .folder-link::before {
    content: " · ";
  }
  .hint {
    display: none;
  }
}
@media (max-width: 600px) {
  .row {
    grid-template-columns: 1.25rem 2.25rem minmax(0, 1fr) 3.25rem 1.75rem;
    gap: 0.5rem;
  }
  .col-size {
    display: none;
  }
}

/* --- grid view --- */
.grid-view {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
  gap: 0.75rem;
  user-select: none;
}
.card {
  position: relative;
  padding: 0.6rem;
  border-radius: 14px;
}
.card:hover {
  background: rgba(255, 255, 255, 0.07);
}
.thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 1;
  margin-bottom: 0.45rem;
  border-radius: 10px;
  object-fit: cover;
  font-size: 3.5rem;
  background: var(--surface-hover);
}
.card-check {
  position: absolute;
  top: 0.9rem;
  left: 0.9rem;
  opacity: 0;
}
.card-more {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  background: rgba(0, 0, 0, 0.5);
  opacity: 0;
}
.card:hover .card-check,
.card:hover .card-more,
.card.selected .card-check {
  opacity: 1;
}
@media (hover: none) {
  .card-check,
  .card-more {
    opacity: 1;
  }
}

/* Pinned to the bottom of the (scrolling) sidebar so a long tree can't
   push them out of sight. */
.sidebar-links {
  position: sticky;
  bottom: -0.4rem;
  margin-top: 0.4rem;
  border-top: 1px solid var(--border);
  background: rgb(26, 29, 36);
}
.sidebar-links a {
  display: flex;
  gap: 0.35rem;
  padding: 0.45rem 0.4rem 0.45rem 1.5rem;
  font-size: 0.875rem;
}
.sidebar-links a:hover {
  background: rgba(255, 255, 255, 0.05);
}
/* The sidebar (and its links) is hidden on narrow screens. */
.narrow-link {
  display: none;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}
@media (max-width: 1023px) {
  .narrow-link {
    display: block;
  }
}
.file-drop-overlay {
  position: fixed;
  inset: 0;
  z-index: 45;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  background: rgba(11, 13, 18, 0.6);
  border: 3px dashed var(--accent);
  font-size: 1.1rem;
  color: var(--accent);
}
.notice-action {
  margin-left: 0.75rem;
  padding: 0.2rem 0.6rem;
  border-color: var(--accent);
  color: var(--accent);
}
.notice {
  position: fixed;
  left: 50%;
  bottom: 6.5rem;
  z-index: 40;
  transform: translateX(-50%);
  padding: 0.6rem 1rem;
  font-size: 0.875rem;
  background: rgba(23, 26, 33, 0.95);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>

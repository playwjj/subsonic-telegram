// State shared between the Folders view, its sidebar tree and the "Move
// to…" dialog: the whole folder tree (small — one row per folder), and
// what's currently being dragged, since a drop target can't read custom
// drag data until the drop itself.
import { computed, reactive } from "vue";
import { getFolderTree, type FolderStats, type TreeFolder } from "../api/subsonic";
import { parentOf } from "../utils/format";

export const folderTree = reactive({
  loaded: false,
  root: { songCount: 0, size: 0, duration: 0 } as FolderStats,
  folders: [] as TreeFolder[],
});

export async function loadFolderTree(): Promise<void> {
  const { root, folders } = await getFolderTree();
  folderTree.root = root;
  folderTree.folders = folders;
  folderTree.loaded = true;
}

// Parent path ("" for the root) -> its direct subfolders, in path order.
export const childFolders = computed(() => {
  const map = new Map<string, TreeFolder[]>();
  for (const folder of folderTree.folders) {
    const parent = parentOf(folder.path);
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent)!.push(folder);
  }
  return map;
});

export interface DragPayload {
  songIds: string[];
  folderPaths: string[];
}

export const drag = reactive({ payload: null as DragPayload | null });

// Whether the dragged items may be dropped into `dest`: not into a folder
// being dragged (or anything inside it).
export function canDropInto(dest: string, payload: DragPayload | null = drag.payload): boolean {
  if (!payload) return false;
  return !payload.folderPaths.some((p) => dest === p || dest.startsWith(`${p}/`));
}

// "Find online…" from any song's ⋯ menu (QueueMenu), wherever the song is
// listed: App.vue shows the tag editor for `identifying`, so views don't
// each need their own. `saved` is bumped after any such save; views that
// group songs (an album, a folder) watch it to reload, since a song may
// have moved out of them.
import { reactive } from "vue";
import { getSong, type Song } from "../api/subsonic";

export const songEdits = reactive({
  identifying: null as Song | null,
  saved: 0,
});

export function findSongOnline(song: Song): void {
  songEdits.identifying = song;
}

// Brings the listed Song object (shared by every list and the player
// showing it) up to date with what was saved.
export async function songSaved(song: Song): Promise<void> {
  songEdits.identifying = null;
  try {
    Object.assign(song, await getSong(song.id));
  } catch {
    // stays stale until the view reloads
  }
  songEdits.saved++;
}

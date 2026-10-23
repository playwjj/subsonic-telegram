// Captions on the Telegram messages holding the songs: the song's path in
// the library and its id, written once at upload. They make the channel
// readable on its own. Moves and renames only change D1, so after one the
// caption still shows the upload-time path; the id line stays right.
export function captionFor(t: { id: string; source_path: string | null; title: string; artist_name: string; suffix: string }): string {
  const path = t.source_path ?? `${t.artist_name} - ${t.title}.${t.suffix}`;
  return `${path}\nid: ${t.id}`;
}

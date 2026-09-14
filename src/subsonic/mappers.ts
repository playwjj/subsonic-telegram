import { node, type SNode } from "./node";
import type { ArtistRow, AlbumRow, TrackRow, PlaylistRow } from "../db/queries";
import type { StructuredLyrics } from "../lyrics";

export function isoDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

export function artistNode(a: ArtistRow, opts?: { albums?: SNode[]; starredAt?: number }): SNode {
  return node(
    "artist",
    {
      id: a.id,
      name: a.name,
      albumCount: a.album_count,
      starred: opts?.starredAt ? isoDate(opts.starredAt) : undefined,
    },
    opts?.albums ? { lists: { album: opts.albums } } : undefined,
  );
}

export function albumNode(al: AlbumRow, opts?: { songs?: SNode[]; starredAt?: number }): SNode {
  return node(
    "album",
    {
      id: al.id,
      name: al.name,
      artist: al.artist_name,
      artistId: al.artist_id,
      songCount: al.song_count,
      duration: al.duration,
      created: isoDate(al.created_at),
      year: al.year ?? undefined,
      genre: al.genre ?? undefined,
      coverArt: al.cover_ref ? al.id : undefined,
      starred: opts?.starredAt ? isoDate(opts.starredAt) : undefined,
    },
    opts?.songs ? { lists: { song: opts.songs } } : undefined,
  );
}

export function songNode(t: TrackRow, opts?: { starredAt?: number }): SNode {
  return node("song", {
    id: t.id,
    parent: t.album_id,
    isDir: false,
    title: t.title,
    album: t.album_name,
    artist: t.artist_name,
    track: t.track_no ?? undefined,
    discNumber: t.disc_no ?? undefined,
    year: t.year ?? undefined,
    genre: t.genre ?? undefined,
    size: t.size,
    contentType: t.content_type,
    suffix: t.suffix,
    duration: t.duration ?? undefined,
    bitRate: t.bitrate ?? undefined,
    coverArt: t.cover_ref ? t.id : t.album_id,
    albumId: t.album_id,
    artistId: t.artist_id,
    playCount: t.play_count || undefined,
    played: t.last_played ? isoDate(t.last_played) : undefined,
    starred: opts?.starredAt ? isoDate(opts.starredAt) : undefined,
    userRating: t.rating || undefined,
    type: "music",
  });
}

// Playlist entries use the same fields as a song, just under an <entry> tag.
export function playlistEntryNode(t: TrackRow, opts?: { starredAt?: number }): SNode {
  return { ...songNode(t, opts), tag: "entry" };
}

export function playlistNode(p: PlaylistRow, opts?: { entries?: SNode[] }): SNode {
  return node(
    "playlist",
    {
      id: p.id,
      name: p.name,
      owner: p.owner,
      songCount: p.song_count,
      duration: p.duration,
      created: isoDate(p.created_at),
      changed: isoDate(p.changed_at),
    },
    opts?.entries ? { lists: { entry: opts.entries } } : undefined,
  );
}

// OpenSubsonic's getLyricsBySongId response shape (see src/lyrics.ts for how
// `lyrics` is fetched) — a list of <structuredLyrics>, each a list of
// per-line <line start="ms">text</line> (start omitted when unsynced).
export function lyricsListNode(artist: string, title: string, lyrics: StructuredLyrics | null): SNode {
  const entries =
    lyrics && lyrics.lines.length
      ? [
          node(
            "structuredLyrics",
            { displayArtist: artist, displayTitle: title, lang: "xxx", synced: lyrics.synced },
            { lists: { line: lyrics.lines.map((l) => node("line", { start: l.start }, { text: l.value })) } },
          ),
        ]
      : [];
  return node("lyricsList", undefined, { lists: { structuredLyrics: entries } });
}

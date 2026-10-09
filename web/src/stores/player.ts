// Client-side playback queue + a single shared <audio> element. The queue is
// mirrored to the server via savePlayQueue (and restored with getPlayQueue)
// so playback resumes across reloads and devices, same as Amperfy & co.
import { computed, reactive } from "vue";
import { coverArtUrl, getPlayQueue, savePlayQueue, scrobble, streamUrl, type Song } from "../api/subsonic";

const audio = new Audio();

// Record a play only once playback has stuck around a bit — skips within
// the first few seconds shouldn't count toward play history/stats.
const SCROBBLE_DELAY_MS = 5000;
let scrobbleTimer: ReturnType<typeof setTimeout> | undefined;
// Set when a track is loaded without autoplay (a restored queue), so the
// scrobble timer is armed on the first real play instead.
let scrobblePending = false;

// "Previous" restarts the current track instead once it's past this point,
// like every other media player.
const PREV_RESTART_THRESHOLD_SEC = 3;

export type RepeatMode = "off" | "all" | "one";

const PREFS_KEY = "player-prefs";

function loadPrefs(): { shuffle: boolean; repeat: RepeatMode; volume: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return {
      shuffle: raw.shuffle === true,
      repeat: raw.repeat === "all" || raw.repeat === "one" ? raw.repeat : "off",
      volume: typeof raw.volume === "number" ? Math.min(Math.max(raw.volume, 0), 1) : 1,
    };
  } catch {
    return { shuffle: false, repeat: "off", volume: 1 };
  }
}

function savePrefs(): void {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ shuffle: state.shuffle, repeat: state.repeat, volume: state.volume }),
    );
  } catch {
    // Storage unavailable (private mode etc.) — prefs just won't stick.
  }
}

const prefs = loadPrefs();

const state = reactive({
  queue: [] as Song[],
  // The queue in the order it was handed to playQueue, kept so turning
  // shuffle off can restore it. Same as `queue` while shuffle is off.
  originalQueue: [] as Song[],
  currentIndex: -1,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  shuffle: prefs.shuffle,
  repeat: prefs.repeat,
  volume: prefs.volume,
});

audio.volume = state.volume;

audio.addEventListener("timeupdate", () => {
  state.currentTime = audio.currentTime;
});
audio.addEventListener("loadedmetadata", () => {
  state.duration = audio.duration;
});
audio.addEventListener("play", () => {
  state.isPlaying = true;
  updateMediaSessionState();
});
audio.addEventListener("pause", () => {
  state.isPlaying = false;
  updateMediaSessionState();
  persistQueue();
});
audio.addEventListener("ended", () => {
  if (state.repeat === "one") {
    audio.currentTime = 0;
    void audio.play();
    return;
  }
  next();
});

// Fisher–Yates; returns a new array.
function shuffled<T>(items: T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Puts `first` at the front and shuffles everything else behind it, so
// turning shuffle on mid-track doesn't interrupt what's playing.
function shuffleAround(tracks: Song[], first: Song | undefined): Song[] {
  if (!first) return shuffled(tracks);
  return [first, ...shuffled(tracks.filter((t) => t !== first))];
}

function armScrobble(track: Song): void {
  scrobblePending = false;
  clearTimeout(scrobbleTimer);
  scrobbleTimer = setTimeout(() => {
    void scrobble(track.id).catch(() => {});
  }, SCROBBLE_DELAY_MS);
}

function loadCurrent(autoplay = true, startAt = 0): void {
  clearTimeout(scrobbleTimer);
  const track = state.queue[state.currentIndex];
  if (!track) return;
  audio.src = streamUrl(track.id);
  if (startAt > 0) {
    audio.addEventListener("loadedmetadata", () => (audio.currentTime = startAt), { once: true });
  }
  updateMediaSessionMetadata(track);
  persistQueue();
  if (!autoplay) {
    scrobblePending = true;
    return;
  }
  void audio.play();
  armScrobble(track);
}

export function playQueue(tracks: Song[], startIndex = 0): void {
  state.originalQueue = tracks;
  if (state.shuffle) {
    state.queue = shuffleAround(tracks, tracks[startIndex]);
    state.currentIndex = 0;
  } else {
    state.queue = tracks;
    state.currentIndex = startIndex;
  }
  loadCurrent();
}

// "Shuffle play" from a list: turns shuffle on and starts from a random track.
export function shufflePlay(tracks: Song[]): void {
  if (tracks.length === 0) return;
  state.shuffle = true;
  savePrefs();
  playQueue(tracks, Math.floor(Math.random() * tracks.length));
}

export function toggleShuffle(): void {
  state.shuffle = !state.shuffle;
  savePrefs();
  if (state.queue.length === 0) return;
  const current = state.queue[state.currentIndex];
  if (state.shuffle) {
    state.queue = shuffleAround(state.originalQueue, current);
    state.currentIndex = 0;
  } else {
    state.queue = state.originalQueue;
    state.currentIndex = Math.max(state.originalQueue.indexOf(current), 0);
  }
  persistQueue();
}

export function cycleRepeat(): void {
  state.repeat = state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
  savePrefs();
}

export function setVolume(volume: number): void {
  state.volume = Math.min(Math.max(volume, 0), 1);
  audio.volume = state.volume;
  savePrefs();
}

export function toggle(): void {
  const track = state.queue[state.currentIndex];
  if (!track) return;
  if (!audio.paused) {
    audio.pause();
    return;
  }
  void audio.play();
  if (scrobblePending) armScrobble(track);
}

export function next(): void {
  if (state.currentIndex < state.queue.length - 1) {
    state.currentIndex++;
    loadCurrent();
  } else if (state.repeat !== "off" && state.queue.length > 0) {
    // Reshuffle on wrap so a looping shuffled queue doesn't repeat the
    // exact same order every pass.
    if (state.shuffle) state.queue = shuffled(state.originalQueue);
    state.currentIndex = 0;
    loadCurrent();
  }
}

export function prev(): void {
  if (audio.currentTime > PREV_RESTART_THRESHOLD_SEC || state.currentIndex <= 0) {
    audio.currentTime = 0;
    return;
  }
  state.currentIndex--;
  loadCurrent();
}

export function seek(time: number): void {
  audio.currentTime = time;
}

// --- server-side queue persistence (getPlayQueue/savePlayQueue) ---

// Every id goes into the savePlayQueue query string, so very long queues
// would blow past URL limits — keep a window around the current track.
const MAX_SAVED_QUEUE = 200;
const PERSIST_DEBOUNCE_MS = 1000;
const PERSIST_INTERVAL_MS = 15000;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let restored = false;

function persistQueue(): void {
  // Don't overwrite the server's queue with our empty one before restore.
  if (!restored) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const current = state.queue[state.currentIndex];
    if (!current) return;
    const start = Math.max(
      0,
      Math.min(state.currentIndex - MAX_SAVED_QUEUE / 2, state.queue.length - MAX_SAVED_QUEUE),
    );
    const window = state.queue.slice(start, start + MAX_SAVED_QUEUE);
    void savePlayQueue(
      window.map((t) => t.id),
      current.id,
      Math.floor(audio.currentTime * 1000),
    ).catch(() => {});
  }, PERSIST_DEBOUNCE_MS);
}

setInterval(() => {
  if (state.isPlaying) persistQueue();
}, PERSIST_INTERVAL_MS);

// Loads the saved queue paused at its saved position. Safe to call more
// than once; only the first call does anything.
export async function restoreQueue(): Promise<void> {
  if (restored) return;
  try {
    const saved = await getPlayQueue();
    // The user may have started something while the request was in flight.
    if (state.currentIndex < 0 && saved.entry.length > 0) {
      const index = Math.max(
        saved.entry.findIndex((t) => t.id === saved.current),
        0,
      );
      state.queue = saved.entry;
      state.originalQueue = saved.entry;
      state.currentIndex = index;
      // persistQueue is still a no-op here, so loading doesn't echo the
      // queue straight back with a not-yet-seeked position of 0.
      loadCurrent(false, (saved.position ?? 0) / 1000);
    }
  } catch {
    // No saved queue / offline — just start empty.
  }
  restored = true;
}

// --- Media Session (lock screen, notification, hardware media keys) ---

function updateMediaSessionMetadata(track: Song): void {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: track.coverArt ? [{ src: coverArtUrl(track.coverArt) }] : [],
  });
}

function updateMediaSessionState(): void {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.playbackState = state.isPlaying ? "playing" : "paused";
}

if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play", () => toggle());
  navigator.mediaSession.setActionHandler("pause", () => audio.pause());
  navigator.mediaSession.setActionHandler("previoustrack", () => prev());
  navigator.mediaSession.setActionHandler("nexttrack", () => next());
  navigator.mediaSession.setActionHandler("seekto", (details) => {
    if (details.seekTime !== undefined) seek(details.seekTime);
  });
}

export const playerState = state;
export const currentTrack = computed<Song | null>(() => state.queue[state.currentIndex] ?? null);

// Client-side playback queue + a single shared <audio> element. Not
// persisted — the queue is ephemeral, same as any Subsonic client's "now
// playing" list.
import { computed, reactive } from "vue";
import { scrobble, streamUrl, type Song } from "../api/subsonic";

const audio = new Audio();

// Record a play only once playback has stuck around a bit — skips within
// the first few seconds shouldn't count toward play history/stats.
const SCROBBLE_DELAY_MS = 5000;
let scrobbleTimer: ReturnType<typeof setTimeout> | undefined;

const state = reactive({
  queue: [] as Song[],
  currentIndex: -1,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
});

audio.addEventListener("timeupdate", () => {
  state.currentTime = audio.currentTime;
});
audio.addEventListener("loadedmetadata", () => {
  state.duration = audio.duration;
});
audio.addEventListener("play", () => {
  state.isPlaying = true;
});
audio.addEventListener("pause", () => {
  state.isPlaying = false;
});
audio.addEventListener("ended", () => {
  next();
});

function loadCurrent(): void {
  clearTimeout(scrobbleTimer);
  const track = state.queue[state.currentIndex];
  if (!track) return;
  audio.src = streamUrl(track.id);
  void audio.play();
  scrobbleTimer = setTimeout(() => {
    void scrobble(track.id).catch(() => {});
  }, SCROBBLE_DELAY_MS);
}

export function playQueue(tracks: Song[], startIndex = 0): void {
  state.queue = tracks;
  state.currentIndex = startIndex;
  loadCurrent();
}

export function toggle(): void {
  if (audio.paused) void audio.play();
  else audio.pause();
}

export function next(): void {
  if (state.currentIndex < state.queue.length - 1) {
    state.currentIndex++;
    loadCurrent();
  }
}

export function prev(): void {
  if (state.currentIndex > 0) {
    state.currentIndex--;
    loadCurrent();
  }
}

export function seek(time: number): void {
  audio.currentTime = time;
}

export const playerState = state;
export const currentTrack = computed<Song | null>(() => state.queue[state.currentIndex] ?? null);

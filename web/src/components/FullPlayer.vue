<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import {
  playerState,
  currentTrack,
  toggle,
  next,
  prev,
  seek,
  toggleShuffle,
  cycleRepeat,
  setVolume,
  toggleCurrentStar,
  setView,
  closePlayer,
} from "../stores/player";
import { coverArtUrl, getLyricsBySongId } from "../api/subsonic";
import { formatTime } from "../utils/format";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ queue: [] }>();

const cover = computed(() =>
  currentTrack.value?.coverArt ? coverArtUrl(currentTrack.value.coverArt) : "/music-cover.jpg",
);
const starred = computed(() => !!currentTrack.value?.starred);
const repeatTitle = computed(
  () => ({ off: "Repeat: off", all: "Repeat: all", one: "Repeat: one" })[playerState.repeat],
);
const progressPct = computed(() =>
  playerState.duration ? (playerState.currentTime / playerState.duration) * 100 : 0,
);

// Tape pack radius on each reel (cassette units): the left one unwinds onto
// the right one over the course of the song.
const leftR = computed(() => 15 + 29 * (1 - progressPct.value / 100));
const rightR = computed(() => 15 + 29 * (progressPct.value / 100));
function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
const labelTitle = computed(() => clip(currentTrack.value?.title ?? "", 30));
const labelArtist = computed(() => clip(currentTrack.value?.artist ?? "", 34));
// Retro label stripes behind the reel window, top to bottom.
const STRIPES = ["#d9482b", "#ec7f2e", "#f2b33d", "#f5d469"];
const SCREWS = [
  [10, 10],
  [310, 10],
  [10, 190],
  [310, 190],
];

const KEYS = [
  { x: 34, label: "◀◀", title: "Previous", action: () => prev() },
  { x: 92, label: "▶", title: "Play / pause", action: () => toggle() },
  { x: 150, label: "▶▶", title: "Next", action: () => next() },
  { x: 208, label: "■", title: "Stop", action: () => stop() },
];

function stop() {
  if (playerState.isPlaying) toggle();
}

function onSeek(e: Event) {
  seek(Number((e.target as HTMLInputElement).value));
}
function onVolume(e: Event) {
  setVolume(Number((e.target as HTMLInputElement).value));
}

// --- lyrics ---

type Line = { start?: number; value: string };
const lyricsState = ref<"loading" | "found" | "empty" | "error">("loading");
const lines = ref<Line[]>([]);
const synced = ref(false);
// Which track the loaded lyrics belong to, so reopening the player on the
// same song doesn't refetch.
let lyricsFor: string | null = null;

async function loadLyrics() {
  const track = currentTrack.value;
  if (!track || lyricsFor === track.id) return;
  lyricsFor = track.id;
  lyricsState.value = "loading";
  lines.value = [];
  try {
    const lyrics = await getLyricsBySongId(track.id);
    if (lyricsFor !== track.id) return; // skipped ahead meanwhile
    lines.value = (lyrics?.line ?? []).map((l) => ({ start: l.start, value: l.value ?? "" }));
    synced.value = !!lyrics?.synced;
    lyricsState.value = lines.value.length ? "found" : "empty";
  } catch {
    if (lyricsFor !== track.id) return;
    lyricsFor = null; // let a later open retry
    lyricsState.value = "error";
  }
}

// Only fetch while open, so tracks playing through with the player
// collapsed never fire LRCLIB requests nobody asked for.
watch(
  () => [props.open, currentTrack.value?.id],
  () => {
    if (props.open) void loadLyrics();
  },
  { immediate: true },
);

const activeLine = computed(() => {
  if (!synced.value) return -1;
  const ms = playerState.currentTime * 1000;
  let idx = -1;
  for (let i = 0; i < lines.value.length; i++) {
    if ((lines.value[i].start ?? 0) <= ms) idx = i;
    else break;
  }
  return idx;
});

const lyricsBox = ref<HTMLElement | null>(null);
// Manual scrolling pauses auto-follow for a moment, like every lyrics view.
let userScrollUntil = 0;
function onUserScroll() {
  userScrollUntil = Date.now() + 3000;
}

function centerActive(smooth = true) {
  const box = lyricsBox.value;
  const el = box?.querySelector<HTMLElement>(".line.active");
  if (!box || !el) return;
  box.scrollTo({
    top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2,
    behavior: smooth ? "smooth" : "auto",
  });
}

watch(activeLine, async () => {
  if (!props.open || Date.now() < userScrollUntil) return;
  await nextTick();
  centerActive();
});

function seekToLine(line: Line) {
  if (line.start === undefined) return;
  seek(line.start / 1000);
  userScrollUntil = 0;
}

// Phones only have room for one of disc/lyrics; tapping swaps them.
const mobileLyrics = ref(false);

// --- open/close side effects ---

function onKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement;
  if (target.closest("input, textarea, select, [contenteditable]")) return;
  if (document.querySelector(".backdrop")) return; // a modal (queue) has the keys
  if (e.key === "Escape") setView("bar");
  else if (e.key === " ") {
    e.preventDefault();
    toggle();
  } else if (e.key === "ArrowRight" && e.shiftKey) next();
  else if (e.key === "ArrowLeft" && e.shiftKey) prev();
}

watch(
  () => props.open,
  async (open) => {
    document.body.style.overflow = open ? "hidden" : "";
    if (open) {
      document.addEventListener("keydown", onKeydown);
      userScrollUntil = 0;
      await nextTick();
      centerActive(false);
    } else {
      document.removeEventListener("keydown", onKeydown);
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  document.body.style.overflow = "";
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div v-if="open && currentTrack" class="full" role="dialog" aria-label="Now playing">
        <!-- Blurred, slowly drifting cover as the backdrop; crossfades per track. -->
        <div class="bg" aria-hidden="true">
          <Transition name="fade">
            <img :key="cover" class="bg-img" :src="cover" alt="" />
          </Transition>
          <div class="bg-shade"></div>
        </div>

        <header class="top">
          <button class="icon-btn" title="Collapse (Esc)" @click="setView('bar')">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          <div class="top-right">
            <button class="icon-btn small" title="Minimize" @click="setView('mini')">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 12h12" /></svg>
            </button>
            <button class="icon-btn small" title="Restore" @click="setView('bar')">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14v8H5z" /></svg>
            </button>
            <button class="icon-btn small" title="Close" @click="closePlayer">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        </header>

        <div class="stage" :class="{ 'show-lyrics': mobileLyrics }">
          <div class="disc-side" @click="mobileLyrics = true">
            <!-- A portable cassette player: the tape shows through the lid,
                 the reels turn while playing, and the tape pack moves from
                 the left reel to the right one as the song progresses. -->
            <svg class="walkman" viewBox="0 0 360 312" role="img" aria-label="Cassette player">
              <defs>
                <linearGradient id="wm-metal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stop-color="#f4f5f7" />
                  <stop offset="0.18" stop-color="#d5d8de" />
                  <stop offset="0.55" stop-color="#afb4bd" />
                  <stop offset="0.85" stop-color="#979ca5" />
                  <stop offset="1" stop-color="#868b95" />
                </linearGradient>
                <linearGradient id="wm-side" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stop-color="#5d626b" />
                  <stop offset="1" stop-color="#34373d" />
                </linearGradient>
                <!-- edge bevel: lit from above, shaded below -->
                <linearGradient id="wm-bevel" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stop-color="#fff" stop-opacity="0.95" />
                  <stop offset="0.45" stop-color="#fff" stop-opacity="0.15" />
                  <stop offset="1" stop-color="#000" stop-opacity="0.35" />
                </linearGradient>
                <!-- the reverse, for edges cut into the body (the lid recess) -->
                <linearGradient id="wm-groove" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stop-color="#000" stop-opacity="0.45" />
                  <stop offset="0.6" stop-color="#000" stop-opacity="0.1" />
                  <stop offset="1" stop-color="#fff" stop-opacity="0.85" />
                </linearGradient>
                <linearGradient id="wm-sheen" x1="0" y1="0" x2="1" y2="0.55">
                  <stop offset="0.2" stop-color="#fff" stop-opacity="0" />
                  <stop offset="0.34" stop-color="#fff" stop-opacity="0.5" />
                  <stop offset="0.42" stop-color="#fff" stop-opacity="0" />
                  <stop offset="0.66" stop-color="#fff" stop-opacity="0" />
                  <stop offset="0.72" stop-color="#fff" stop-opacity="0.18" />
                  <stop offset="0.78" stop-color="#fff" stop-opacity="0" />
                </linearGradient>
                <pattern id="wm-brush" width="6" height="2" patternUnits="userSpaceOnUse">
                  <rect width="6" height="0.8" fill="#fff" fill-opacity="0.12" />
                </pattern>
                <linearGradient id="wm-key" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stop-color="#ffffff" />
                  <stop offset="0.45" stop-color="#e2e4e8" />
                  <stop offset="1" stop-color="#b3b7bf" />
                </linearGradient>
                <linearGradient id="wm-recess-shadow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stop-color="#000" stop-opacity="0.7" />
                  <stop offset="0.12" stop-color="#000" stop-opacity="0" />
                </linearGradient>
                <linearGradient id="wm-glass" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stop-color="#fff" stop-opacity="0.2" />
                  <stop offset="0.3" stop-color="#fff" stop-opacity="0.04" />
                  <stop offset="0.31" stop-color="#fff" stop-opacity="0" />
                  <stop offset="1" stop-color="#9fb4d8" stop-opacity="0.08" />
                </linearGradient>
                <linearGradient id="wm-shell" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stop-color="#3a3d45" />
                  <stop offset="1" stop-color="#1b1d22" />
                </linearGradient>
                <linearGradient id="wm-paper" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stop-color="#faf5e9" />
                  <stop offset="1" stop-color="#e9dfc8" />
                </linearGradient>
                <radialGradient id="wm-pack">
                  <stop offset="0" stop-color="#22170f" />
                  <stop offset="0.7" stop-color="#4a3426" />
                  <stop offset="0.93" stop-color="#6d4f3b" />
                  <stop offset="1" stop-color="#3a281d" />
                </radialGradient>
                <radialGradient id="wm-hub" cx="0.4" cy="0.35">
                  <stop offset="0" stop-color="#ffffff" />
                  <stop offset="1" stop-color="#cfc9bc" />
                </radialGradient>
                <radialGradient id="wm-screw" cx="0.35" cy="0.3">
                  <stop offset="0" stop-color="#9aa0aa" />
                  <stop offset="1" stop-color="#3c4048" />
                </radialGradient>
                <linearGradient id="wm-wheel" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stop-color="#3b3f46" />
                  <stop offset="0.5" stop-color="#9196a0" />
                  <stop offset="1" stop-color="#3b3f46" />
                </linearGradient>
                <radialGradient id="wm-led-on" cx="0.4" cy="0.35">
                  <stop offset="0" stop-color="#e6fff0" />
                  <stop offset="0.45" stop-color="#4dff88" />
                  <stop offset="1" stop-color="#119140" />
                </radialGradient>
                <radialGradient id="wm-led-off" cx="0.4" cy="0.35">
                  <stop offset="0" stop-color="#5d6b61" />
                  <stop offset="1" stop-color="#1d2520" />
                </radialGradient>
                <filter id="wm-tape-shadow" x="-10%" y="-10%" width="120%" height="130%">
                  <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000" flood-opacity="0.7" />
                </filter>
                <clipPath id="wm-body"><rect x="4" y="26" width="352" height="270" rx="20" /></clipPath>
                <clipPath id="wm-lid"><rect x="22" y="46" width="316" height="206" rx="12" /></clipPath>
                <clipPath id="wm-window"><rect x="74" y="66" width="172" height="52" rx="26" /></clipPath>
              </defs>

              <!-- transport keys along the top edge; each has a side face for depth -->
              <g
                v-for="key in KEYS"
                :key="key.x"
                class="key"
                :class="{ pressed: key.label === '▶' && playerState.isPlaying }"
                @click.stop="key.action"
              >
                <title>{{ key.title }}</title>
                <rect :x="key.x" y="10" width="52" height="30" rx="5" fill="#6b7079" />
                <rect :x="key.x" y="6" width="52" height="30" rx="5" fill="url(#wm-key)" />
                <path :d="`M${key.x + 5} 7 H${key.x + 47}`" stroke="#fff" stroke-opacity="0.9" />
                <text :x="key.x + 26" y="25">{{ key.label }}</text>
              </g>

              <!-- body: thickness, metal face, brushed lines, gloss, bevel -->
              <rect x="4" y="34" width="352" height="270" rx="20" fill="url(#wm-side)" />
              <rect x="4" y="26" width="352" height="270" rx="20" fill="url(#wm-metal)" />
              <g clip-path="url(#wm-body)">
                <rect x="4" y="26" width="352" height="270" fill="url(#wm-brush)" />
                <rect
                  x="-60"
                  y="26"
                  width="480"
                  height="270"
                  fill="url(#wm-sheen)"
                />
              </g>
              <rect x="5" y="27" width="350" height="268" rx="19" fill="none" stroke="url(#wm-bevel)" stroke-width="2" />

              <!-- headphone jack -->
              <circle cx="318" cy="36" r="5.5" fill="#c9ccd2" stroke="#7d828b" stroke-width="0.8" />
              <circle cx="318" cy="36" r="3.2" fill="#14161a" />

              <!-- volume wheel on the side -->
              <rect x="352" y="96" width="8" height="64" rx="3" fill="url(#wm-wheel)" />
              <path
                d="M352 102h8M352 108h8M352 114h8M352 120h8M352 126h8M352 132h8M352 138h8M352 144h8M352 150h8M352 156h8"
                stroke="#2c2f35"
                stroke-opacity="0.7"
              />

              <!-- lid: a recess in the body, the cassette, then glass -->
              <rect x="17" y="41" width="326" height="216" rx="16" fill="none" stroke="url(#wm-groove)" stroke-width="3" />
              <rect x="22" y="46" width="316" height="206" rx="12" fill="#0c0d11" />
              <g clip-path="url(#wm-lid)">
                <Transition name="tape">
                  <g :key="currentTrack.id" class="tape-slot">
                    <g transform="translate(42.5 63) scale(0.86)" filter="url(#wm-tape-shadow)">
                      <rect width="320" height="200" rx="12" fill="url(#wm-shell)" />
                      <path d="M12 1.5 H308" stroke="#fff" stroke-opacity="0.35" />
                      <!-- plain retro label; the album cover lives beside the title instead -->
                      <rect x="20" y="12" width="280" height="124" rx="6" fill="url(#wm-paper)" />
                      <rect
                        v-for="(color, i) in STRIPES"
                        :key="color"
                        x="20"
                        :y="82 + i * 5"
                        width="280"
                        height="5"
                        :fill="color"
                      />
                      <text x="30" y="32" class="side">A</text>
                      <text x="48" y="32" class="tape-title">{{ labelTitle }}</text>
                      <path d="M30 40 H290" stroke="#cdbf9f" />
                      <text x="30" y="56" class="tape-artist">{{ labelArtist }}</text>
                      <text x="290" y="56" class="tape-type">C-60</text>
                      <g v-for="[x, y] in SCREWS" :key="`${x}-${y}`">
                        <circle :cx="x" :cy="y" r="4" fill="url(#wm-screw)" />
                        <path :d="`M${x - 2.6} ${y + 1.5} L${x + 2.6} ${y - 1.5}`" stroke="#202227" stroke-width="1" />
                      </g>

                      <rect x="74" y="66" width="172" height="52" rx="26" fill="#08080a" />
                      <g clip-path="url(#wm-window)">
                        <circle cx="112" cy="92" :r="leftR" fill="url(#wm-pack)" />
                        <circle cx="208" cy="92" :r="rightR" fill="url(#wm-pack)" />
                      </g>
                      <g v-for="cx in [112, 208]" :key="cx" :transform="`translate(${cx} 92)`">
                        <g class="reel" :class="{ spinning: playerState.isPlaying }">
                          <circle r="12" fill="url(#wm-hub)" />
                          <rect
                            v-for="i in 6"
                            :key="i"
                            x="-1.6"
                            y="-11"
                            width="3.2"
                            height="5"
                            fill="#3a3d44"
                            :transform="`rotate(${i * 60})`"
                          />
                          <circle r="3.5" fill="#25282f" />
                        </g>
                      </g>
                      <!-- the tape window's own clear plastic -->
                      <rect x="74" y="66" width="172" height="52" rx="26" fill="none" stroke="#fff" stroke-opacity="0.3" stroke-width="2" />
                      <path d="M92 70 H228" stroke="#fff" stroke-opacity="0.18" stroke-width="3" stroke-linecap="round" />

                      <path d="M64 200 L80 158 L240 158 L256 200 Z" fill="#2c2f36" />
                      <path d="M80 158.5 L240 158.5" stroke="#fff" stroke-opacity="0.15" />
                      <circle cx="104" cy="181" r="6" fill="#08080a" />
                      <circle cx="216" cy="181" r="6" fill="#08080a" />
                      <rect x="148" y="172" width="24" height="12" rx="2" fill="#08080a" />
                      <path d="M84 197 H236" stroke="#4b3427" stroke-width="2.5" />
                    </g>
                  </g>
                </Transition>
                <!-- shadow cast by the bezel onto the tape, then the glass -->
                <rect x="22" y="46" width="316" height="206" fill="url(#wm-recess-shadow)" />
                <rect x="22" y="46" width="316" height="206" fill="url(#wm-glass)" />
                <path
                  d="M40 46 L118 46 L52 252 L22 252 L22 90 Z"
                  fill="#fff"
                  fill-opacity="0.06"
                />
              </g>
              <rect x="22.5" y="46.5" width="315" height="205" rx="11.5" fill="none" stroke="#000" stroke-opacity="0.6" />
              <path d="M34 48 H326" stroke="#fff" stroke-opacity="0.22" />

              <!-- nameplate (engraved: light edge under dark text) + play light -->
              <text x="26" y="281" class="brand engrave">STEREO CASSETTE PLAYER</text>
              <text x="26" y="280" class="brand">STEREO CASSETTE PLAYER</text>
              <text x="296" y="280" class="led-label">PLAY</text>
              <circle cx="330" cy="276" r="6.5" fill="#6b7079" stroke="url(#wm-groove)" />
              <circle
                cx="330"
                cy="276"
                r="4.5"
                class="led"
                :class="{ on: playerState.isPlaying }"
                :fill="playerState.isPlaying ? 'url(#wm-led-on)' : 'url(#wm-led-off)'"
              />
              <circle cx="328.6" cy="274.4" r="1.2" fill="#fff" fill-opacity="0.8" />
            </svg>
          </div>

          <div class="info-side">
            <Transition name="swap" mode="out-in">
              <div :key="currentTrack.id" class="track-info">
                <img class="info-cover" :src="cover" alt="" />
                <div class="info-text">
                  <h1 class="title">{{ currentTrack.title }}</h1>
                  <p class="sub">
                    <span>{{ currentTrack.artist }}</span>
                    <template v-if="currentTrack.album"> · <span>{{ currentTrack.album }}</span></template>
                  </p>
                </div>
              </div>
            </Transition>

            <div
              ref="lyricsBox"
              class="lyrics"
              @wheel.passive="onUserScroll"
              @touchmove.passive="onUserScroll"
              @click="mobileLyrics = false"
            >
              <div class="lyrics-pad"></div>
              <p v-if="lyricsState === 'loading'" class="status">Loading lyrics…</p>
              <p v-else-if="lyricsState === 'empty'" class="status">No lyrics found</p>
              <p v-else-if="lyricsState === 'error'" class="status">Couldn't load lyrics</p>
              <template v-else>
                <p
                  v-for="(line, i) in lines"
                  :key="i"
                  class="line"
                  :class="{ active: i === activeLine, synced, past: synced && i < activeLine }"
                  @click.stop="seekToLine(line)"
                >
                  {{ line.value || "♪" }}
                </p>
              </template>
              <div class="lyrics-pad"></div>
            </div>
          </div>
        </div>

        <footer class="bottom">
          <div class="progress">
            <span class="time">{{ formatTime(playerState.currentTime) }}</span>
            <input
              class="seek"
              type="range"
              min="0"
              :max="playerState.duration || 0"
              :value="playerState.currentTime"
              :style="{ '--pct': `${progressPct}%` }"
              @input="onSeek"
            />
            <span class="time">{{ formatTime(playerState.duration) }}</span>
          </div>
          <div class="control-row">
            <div class="controls">
              <button class="ctl side" :class="{ starred }" :title="starred ? 'Unfavorite' : 'Favorite'" @click="toggleCurrentStar">
                {{ starred ? "♥" : "♡" }}
              </button>
              <button
                class="ctl mode"
                :class="{ active: playerState.shuffle }"
                :title="playerState.shuffle ? 'Shuffle: on' : 'Shuffle: off'"
                @click="toggleShuffle"
              >
                🔀
              </button>
              <button class="ctl" title="Previous" @click="prev">⏮</button>
              <button class="ctl play" :title="playerState.isPlaying ? 'Pause' : 'Play'" @click="toggle">
                {{ playerState.isPlaying ? "⏸" : "▶" }}
              </button>
              <button class="ctl" title="Next" @click="next">⏭</button>
              <button
                class="ctl mode"
                :class="{ active: playerState.repeat !== 'off' }"
                :title="repeatTitle"
                @click="cycleRepeat"
              >
                {{ playerState.repeat === "one" ? "🔂" : "🔁" }}
              </button>
              <button class="ctl side" title="Queue" @click="emit('queue')">☰</button>
            </div>
            <div class="volume">
              <span>{{ playerState.volume === 0 ? "🔇" : playerState.volume < 0.5 ? "🔉" : "🔊" }}</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                :value="playerState.volume"
                :style="{ '--pct': `${playerState.volume * 100}%` }"
                @input="onVolume"
              />
            </div>
          </div>
        </footer>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.full {
  position: fixed;
  inset: 0;
  z-index: 45;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #fff;
  background: #0b0d12;
}

/* --- backdrop --- */
.bg {
  position: absolute;
  inset: 0;
  z-index: -1;
  overflow: hidden;
}
.bg-img {
  position: absolute;
  inset: -25%;
  width: 150%;
  height: 150%;
  max-width: none; /* Tailwind preflight caps imgs at 100% */
  object-fit: cover;
  filter: blur(70px) saturate(1.6) brightness(0.55);
  animation: drift 40s ease-in-out infinite alternate;
}
.bg-shade {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 30% 40%, transparent 0%, rgba(0, 0, 0, 0.35) 70%),
    linear-gradient(to bottom, rgba(0, 0, 0, 0.15), rgba(0, 0, 0, 0.55));
}
@keyframes drift {
  from {
    transform: scale(1) rotate(0deg);
  }
  to {
    transform: scale(1.15) rotate(8deg);
  }
}

/* --- header --- */
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem 0;
}
.top-right {
  display: flex;
  gap: 0.25rem;
}
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}
.icon-btn.small {
  width: 2.1rem;
  height: 2.1rem;
}
.icon-btn:hover {
  background: rgba(255, 255, 255, 0.18);
}

/* --- stage: disc + lyrics --- */
.stage {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: center;
  gap: 3rem;
  max-width: 72rem;
  width: 100%;
  margin: 0 auto;
  padding: 1rem 2.5rem;
}
.disc-side {
  display: flex;
  justify-content: center;
}
.walkman {
  display: block;
  width: min(30rem, 40vw, 60vh);
  overflow: visible;
  filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.35)) drop-shadow(0 30px 45px rgba(0, 0, 0, 0.55));
}
.key {
  cursor: pointer;
  transition: transform 0.12s ease;
}
.key:active,
.key.pressed {
  transform: translateY(7px);
}
.key text {
  font-size: 12px;
  text-anchor: middle;
  fill: #3a3d44;
  pointer-events: none;
}
.key.pressed rect:first-of-type {
  /* side face hides behind the body once pushed in */
  opacity: 0;
}
.key.pressed text {
  fill: #1f7a46;
}
.reel {
  transform-box: fill-box;
  transform-origin: center;
  animation: spin 2.4s linear infinite;
  animation-play-state: paused;
}
.reel.spinning {
  animation-play-state: running;
}
.side {
  font-size: 14px;
  font-weight: 800;
  fill: #c0392b;
}
.tape-title {
  font-size: 12px;
  font-weight: 600;
  fill: #26282d;
}
.tape-artist {
  font-size: 10px;
  fill: #6b6455;
}
.tape-type {
  font-size: 10px;
  font-weight: 800;
  text-anchor: end;
  fill: #b2412a;
}
.brand {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 3px;
  fill: rgba(28, 30, 36, 0.72);
}
.brand.engrave {
  fill: rgba(255, 255, 255, 0.4);
}
.led-label {
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 1px;
  fill: rgba(28, 30, 36, 0.72);
}
.led.on {
  filter: drop-shadow(0 0 3px #4dff88) drop-shadow(0 0 8px rgba(77, 255, 136, 0.6));
}
/* Track change: the old tape drops out, the new one slides in from above. */
.tape-enter-active,
.tape-leave-active {
  transition:
    transform 0.4s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.4s ease;
}
.tape-enter-from {
  transform: translateY(-40px);
  opacity: 0;
}
.tape-leave-to {
  transform: translateY(40px);
  opacity: 0;
}

.info-side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: min(34rem, 100%);
}
.track-info {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}
.info-cover {
  width: 5rem;
  height: 5rem;
  flex-shrink: 0;
  border-radius: 10px;
  object-fit: cover;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.info-text {
  min-width: 0;
}
.title {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.sub {
  margin: 0.4rem 0 0;
  font-size: 0.95rem;
  color: rgba(255, 255, 255, 0.65);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lyrics {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
  mask-image: linear-gradient(to bottom, transparent, #000 18%, #000 82%, transparent);
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 18%, #000 82%, transparent);
}
.lyrics::-webkit-scrollbar {
  display: none;
}
.lyrics-pad {
  height: 40%;
}
.status {
  color: rgba(255, 255, 255, 0.55);
}
.line {
  margin: 0;
  padding: 0.45rem 0;
  font-size: 1.05rem;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.75);
  transform-origin: left center;
  transition:
    color 0.35s ease,
    transform 0.35s ease,
    opacity 0.35s ease;
}
.line.synced {
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
}
.line.synced:hover {
  color: rgba(255, 255, 255, 0.8);
}
.line.past {
  opacity: 0.7;
}
.line.active {
  color: #fff;
  font-weight: 600;
  transform: scale(1.12);
  text-shadow: 0 0 18px rgba(255, 255, 255, 0.35);
}

/* --- footer controls --- */
.bottom {
  max-width: 60rem;
  width: 100%;
  margin: 0 auto;
  padding: 0.5rem 1.5rem 1.75rem;
}
.progress {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.time {
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.6);
  min-width: 2.5rem;
  text-align: center;
}
.seek,
.volume input {
  -webkit-appearance: none;
  appearance: none;
  flex: 1;
  height: 4px;
  padding: 0;
  border: none;
  border-radius: 2px;
  background: linear-gradient(to right, #fff var(--pct, 0%), rgba(255, 255, 255, 0.22) var(--pct, 0%));
  cursor: pointer;
}
.seek::-webkit-slider-thumb,
.volume input::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 6px rgba(0, 0, 0, 0.4);
  transition: transform 0.15s ease;
}
.seek:hover::-webkit-slider-thumb {
  transform: scale(1.3);
}
.seek::-moz-range-thumb,
.volume input::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border: none;
  border-radius: 50%;
  background: #fff;
}
/* Controls centered, volume pinned right: a 1fr/auto/1fr grid keeps the
   play button dead center whatever the volume block's width. */
.control-row {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  margin-top: 0.9rem;
}
.controls {
  grid-column: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.1rem;
}
.ctl {
  width: 2.75rem;
  height: 2.75rem;
  padding: 0;
  line-height: 1;
  font-size: 1.3rem;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #fff;
  opacity: 0.85;
  transition:
    transform 0.15s ease,
    opacity 0.15s ease,
    background-color 0.15s ease;
}
.ctl:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.1);
}
.ctl:active {
  transform: scale(0.9);
}
.ctl.play {
  width: 4rem;
  height: 4rem;
  font-size: 1.6rem;
  opacity: 1;
  border: 2px solid rgba(255, 255, 255, 0.85);
}
.ctl.mode {
  font-size: 1.05rem;
  opacity: 0.4;
}
.ctl.mode.active {
  opacity: 1;
}
.ctl.side {
  font-size: 1.2rem;
  opacity: 0.6;
}
.ctl.starred {
  color: #ff4d6d;
  opacity: 1;
}
.volume {
  grid-column: 3;
  justify-self: end;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 7.5rem;
  font-size: 0.9rem;
}

/* --- transitions --- */
.sheet-enter-active,
.sheet-leave-active {
  transition:
    transform 0.45s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.45s ease;
}
.sheet-enter-from,
.sheet-leave-to {
  transform: translateY(100%);
  opacity: 0.4;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 1.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.swap-enter-active,
.swap-leave-active {
  transition:
    transform 0.35s ease,
    opacity 0.35s ease;
}
.swap-enter-from {
  opacity: 0;
  transform: scale(0.92);
}
.swap-leave-to {
  opacity: 0;
  transform: scale(1.05);
}

/* --- small screens: one column, tap the disc for lyrics --- */
@media (max-width: 860px) {
  .stage {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
    gap: 1rem;
    padding: 0.5rem 1.5rem;
    align-items: stretch;
  }
  .walkman {
    width: min(86vw, 50vh);
  }
  .disc-side {
    align-items: center;
    order: 2;
  }
  .info-side {
    order: 1;
    height: auto;
    min-height: 0;
    text-align: center;
  }
  .title {
    font-size: 1.35rem;
  }
  .track-info {
    justify-content: center;
    text-align: left;
  }
  .info-cover {
    width: 3.5rem;
    height: 3.5rem;
  }
  .lyrics {
    display: none;
  }
  .stage.show-lyrics .disc-side {
    display: none;
  }
  .stage.show-lyrics .lyrics {
    display: block;
  }
  .stage.show-lyrics .info-side {
    height: 100%;
  }
  .line {
    transform-origin: center;
  }
  .volume {
    display: none;
  }
  .control-row {
    display: flex;
    justify-content: center;
  }
  .controls {
    gap: 0.4rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .reel,
  .bg-img {
    animation: none;
  }
}
</style>

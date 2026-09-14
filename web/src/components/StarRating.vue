<script setup lang="ts">
import { computed } from "vue";
import { setRating, type Song } from "../api/subsonic";

// Mutates the shared Song object (not a local copy), same as the heart
// button — a track can be rendered by both a list row and the player bar at
// once, and both should reflect the change immediately.
const props = defineProps<{ song: Song }>();

const rating = computed(() => props.song.userRating ?? 0);

// Clicking the star that already matches the current rating clears it
// (rating 0), same as most 5-star widgets — otherwise sets that many stars.
async function rate(stars: number) {
  const nextRating = rating.value === stars ? 0 : stars;
  const prevRating = props.song.userRating;
  props.song.userRating = nextRating || undefined; // optimistic
  try {
    await setRating(props.song.id, nextRating);
  } catch {
    props.song.userRating = prevRating;
  }
}
</script>

<template>
  <div class="rating">
    <button
      v-for="star in 5"
      :key="star"
      class="star-btn"
      :class="{ filled: star <= rating }"
      :title="`Rate ${star} star${star > 1 ? 's' : ''}`"
      @click="rate(star)"
    >
      ★
    </button>
  </div>
</template>

<style scoped>
.rating {
  display: flex;
  flex-shrink: 0;
}
.star-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.1rem;
  height: 1.75rem;
  padding: 0;
  line-height: 1;
  font-size: 0.9rem;
  border: none;
  background: transparent;
  color: inherit;
  opacity: 0.35;
  cursor: pointer;
}
.star-btn:hover,
.star-btn.filled {
  opacity: 1;
  color: #f5b301;
}
</style>

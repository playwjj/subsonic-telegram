<script setup lang="ts">
import { ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import { login, SubsonicError } from "../api/subsonic";

const username = ref("");
const password = ref("");
const error = ref("");
const loading = ref(false);
const router = useRouter();
const route = useRoute();

async function handleSubmit() {
  error.value = "";
  loading.value = true;
  try {
    await login(username.value, password.value);
    const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "/";
    await router.push(redirect);
  } catch (e) {
    error.value = e instanceof SubsonicError ? e.message : "Login failed";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login">
    <div class="card">
      <h1>Subsonic Telegram</h1>
      <form @submit.prevent="handleSubmit">
        <input v-model="username" placeholder="Username" autocomplete="username" required />
        <input v-model="password" type="password" placeholder="Password" autocomplete="current-password" required />
        <button type="submit" :disabled="loading">{{ loading ? "Signing in…" : "Sign in" }}</button>
        <p v-if="error" class="error">{{ error }}</p>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
.card {
  width: 100%;
  max-width: 20rem;
  padding: 2rem;
}
h1 {
  font-size: 1.4rem;
  margin-bottom: 1.5rem;
  text-align: center;
}
form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.error {
  color: var(--danger);
  font-size: 0.9rem;
}
</style>

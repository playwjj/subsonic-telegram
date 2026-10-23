<script setup lang="ts">
import { ref } from "vue";
import {
  checkTelegramBot,
  getTelegramSetup,
  saveTelegramSetup,
  SubsonicError,
  type TelegramSetup,
} from "../api/subsonic";
import { markStorageConfigured } from "../stores/telegramSetup";

// Where songs are stored: a bot of the user's own and a private channel it
// posts to. The user pastes the bot's token; the channel is found from the
// bot's updates (or typed in).
const status = ref<TelegramSetup | null>(null);
const loadError = ref("");
const saved = ref(false);

async function load() {
  try {
    status.value = await getTelegramSetup();
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
  }
}
load();

function done(next: TelegramSetup) {
  status.value = next;
  saved.value = true;
  markStorageConfigured();
}

const message = (e: unknown) => (e instanceof SubsonicError || e instanceof Error ? e.message : String(e));

// --- an existing bot ---

const token = ref("");
const bot = ref<{ username: string; channels: { id: string; title: string }[] } | null>(null);
const channel = ref("");
const botError = ref("");
const botBusy = ref(false);

async function checkBot() {
  botError.value = "";
  botBusy.value = true;
  try {
    bot.value = await checkTelegramBot(token.value.trim());
    if (!channel.value) channel.value = bot.value.channels[0]?.id ?? status.value?.channelId ?? "";
  } catch (e) {
    botError.value = message(e);
  } finally {
    botBusy.value = false;
  }
}

async function saveBot() {
  botError.value = "";
  botBusy.value = true;
  try {
    done(await saveTelegramSetup(token.value.trim(), channel.value.trim()));
  } catch (e) {
    botError.value = message(e);
  } finally {
    botBusy.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-5">
    <h1 class="text-xl font-semibold">Telegram storage</h1>
    <p v-if="loadError" class="error">{{ loadError }}</p>
    <p v-if="!status && !loadError" class="flex items-center gap-2 text-[var(--text-dim)]">
      <span class="spinner"></span> Loading…
    </p>

    <template v-if="status">
      <section v-if="saved" class="glass panel">
        <h2>✓ All set</h2>
        <p class="text-sm">
          Songs will be stored in "{{ status.channelTitle }}" by @{{ status.botUsername }}.
          <RouterLink to="/upload" class="link">Upload some music</RouterLink>
        </p>
      </section>

      <section v-else-if="status.source !== 'none'" class="glass panel">
        <h2>Current storage</h2>
        <p class="text-sm">
          Channel "{{ status.channelTitle ?? status.channelId }}"
          <span class="dim">({{ status.channelId }})</span>, uploaded to by
          {{ status.botUsername ? `@${status.botUsername}` : "the bot" }}.
        </p>
        <p v-if="status.locked === 'env'" class="dim mt-2 text-sm">
          Set by the Worker's TG_BOT_TOKEN / TG_CHANNEL_ID secrets — change it there.
        </p>
        <p v-else-if="status.locked === 'library'" class="dim mt-2 text-sm">
          Songs are stored with this bot and channel, so they can't be switched for others. A new token for the same
          bot (after revoking the old one in @BotFather) can still be saved below.
        </p>
      </section>

      <p v-else class="dim text-sm">
        Songs are stored as files in a private Telegram channel, posted there by a bot of your own. Set them up once to
        start uploading.
      </p>

      <template v-if="!saved && status.locked !== 'env'">
        <section class="glass panel">
          <h2>{{ status.source === "none" ? "Set up storage" : "Use another bot token" }}</h2>
          <ol class="steps text-sm">
            <li>Create a bot with <a href="https://t.me/BotFather" target="_blank" rel="noopener" class="link">@BotFather</a> (/newbot) and paste the token it gives you.</li>
            <li>Add the bot as an admin of a channel of yours, with rights to post, edit and delete messages.</li>
          </ol>
          <form class="row" @submit.prevent="checkBot">
            <input v-model="token" placeholder="Bot token, 123456789:AAH…" autocomplete="off" spellcheck="false" required />
            <button type="submit" :disabled="botBusy">{{ bot ? "Look again" : "Check" }}</button>
          </form>

          <form v-if="bot" class="mt-3 space-y-2" @submit.prevent="saveBot">
            <p class="text-sm">
              Token for @{{ bot.username }}.
              <template v-if="bot.channels.length">Channels it was made admin of:</template>
              <template v-else>
                No channel found yet — add the bot as an admin, then press "Look again", or enter the channel's id
                (-100…) or @username below.
              </template>
            </p>
            <label v-for="c in bot.channels" :key="c.id" class="choice text-sm">
              <input v-model="channel" type="radio" :value="c.id" /> {{ c.title }} <span class="dim">({{ c.id }})</span>
            </label>
            <div class="row">
              <input v-model="channel" placeholder="Channel id or @username" spellcheck="false" required />
              <button type="submit" :disabled="botBusy">{{ botBusy ? "Checking…" : "Save" }}</button>
            </div>
          </form>
          <p v-if="botError" class="error mt-2 text-sm">{{ botError }}</p>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.panel {
  padding: 0.9rem 1rem;
}
.panel h2 {
  margin-bottom: 0.6rem;
  font-weight: 600;
}
.dim {
  color: var(--text-dim);
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
.row input {
  flex: 1 1 14rem;
  min-width: 0;
}
.link {
  color: var(--accent);
  background: none;
  border: none;
  padding: 0;
}
.steps {
  list-style: decimal;
  padding-left: 1.25rem;
  color: var(--text-dim);
}
.choice {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.choice input {
  width: auto;
}
.error {
  color: var(--danger);
}
</style>

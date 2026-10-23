// The web UI's Telegram setup page: picks the bot and channel files go to
// when there are no TG_BOT_TOKEN / TG_CHANNEL_ID secrets. It takes a pasted
// bot token and finds the channel the bot was made admin of.
import type { Env } from "../types";
import { getSettings, getTelegramConfig, putSettings } from "../telegramConfig";

export class SetupError extends Error {}

export interface SetupStatus {
  source: "env" | "setup" | "none";
  botUsername?: string;
  channelId?: string;
  channelTitle?: string;
  // Why the bot/channel can't be switched to others: "env" (set by secrets)
  // or "library" (songs were uploaded with them — Telegram file ids only
  // work for the bot that stored them). A new token for the same bot, and
  // the same channel, is still accepted with "library".
  locked?: "env" | "library";
}

interface BotUser {
  id: number;
  username: string;
}

interface Chat {
  id: number;
  type: string;
  title?: string;
}

async function botApi<T>(token: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!/^\d+:[\w-]+$/.test(token)) throw new SetupError("That doesn't look like a bot token (123456789:AAH…)");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = (await res.json()) as { ok: boolean; result: T; description?: string; error_code?: number };
  if (!data.ok) {
    if (data.error_code === 401 || data.error_code === 404) throw new SetupError("Telegram doesn't accept this bot token");
    throw new SetupError(`Telegram: ${data.description ?? `${method} failed`}`);
  }
  return data.result;
}

async function libraryHasFiles(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare(`SELECT EXISTS (SELECT 1 FROM tracks) OR EXISTS (SELECT 1 FROM trash) AS used`)
    .first<{ used: number }>();
  return !!row?.used;
}

export async function setupStatus(env: Env): Promise<SetupStatus> {
  const config = await getTelegramConfig(env);
  if (!config) return { source: "none" };
  if (config.source === "env") {
    // Shown for reference only, so a failed lookup isn't an error here.
    const [bot, chat] = await Promise.all([
      botApi<BotUser>(config.botToken, "getMe").catch(() => undefined),
      botApi<Chat>(config.botToken, "getChat", { chat_id: config.channelId }).catch(() => undefined),
    ]);
    return {
      source: "env",
      botUsername: bot?.username,
      channelId: config.channelId,
      channelTitle: chat?.title,
      locked: "env",
    };
  }
  const settings = await getSettings(env.DB, ["bot_username", "channel_title"]);
  return {
    source: "setup",
    botUsername: settings.bot_username,
    channelId: config.channelId,
    channelTitle: settings.channel_title,
    locked: (await libraryHasFiles(env.DB)) ? "library" : undefined,
  };
}

export async function checkBot(token: string): Promise<BotUser> {
  const me = await botApi<BotUser>(token, "getMe");
  return { id: me.id, username: me.username };
}

// Channels the bot was made admin of, newest first. Telegram keeps a bot's
// updates for 24 hours, and these aren't marked as read here, so the bot can
// be added before or after its token is pasted.
export async function findChannels(token: string): Promise<{ id: string; title: string }[]> {
  type Update = {
    my_chat_member?: { date: number; chat: Chat; new_chat_member: { status: string; can_post_messages?: boolean } };
  };
  let updates: Update[];
  try {
    updates = await botApi<Update[]>(token, "getUpdates", { allowed_updates: ["my_chat_member"], timeout: 0 });
  } catch (e) {
    if (e instanceof SetupError && /webhook/i.test(e.message)) {
      throw new SetupError("This bot has a webhook set, so its updates can't be read — enter the channel id instead");
    }
    throw e;
  }
  // Only each chat's latest change counts (the bot may have been removed since).
  const latest = new Map<number, NonNullable<Update["my_chat_member"]>>();
  for (const u of updates) {
    const m = u.my_chat_member;
    if (m && m.chat.type === "channel") latest.set(m.chat.id, m);
  }
  return [...latest.values()]
    .filter((m) => m.new_chat_member.status === "administrator" && m.new_chat_member.can_post_messages)
    .sort((a, b) => b.date - a.date)
    .map((m) => ({ id: String(m.chat.id), title: m.chat.title ?? String(m.chat.id) }));
}

// Checks the bot can post, edit and delete in the channel, then saves both.
export async function saveSetup(env: Env, token: string, channel: string): Promise<SetupStatus> {
  const current = await getTelegramConfig(env);
  if (current?.source === "env") {
    throw new SetupError("Storage is set by the TG_BOT_TOKEN / TG_CHANNEL_ID secrets — change them there");
  }
  const bot = await checkBot(token);
  const chat = await botApi<Chat>(token, "getChat", { chat_id: channel.trim() }).catch((e) => {
    throw new SetupError(`The bot can't see that channel (${e instanceof Error ? e.message : e})`);
  });
  if (chat.type !== "channel") throw new SetupError(`"${chat.title ?? chat.id}" is a ${chat.type}, not a channel`);
  const member = await botApi<{
    status: string;
    can_post_messages?: boolean;
    can_delete_messages?: boolean;
  }>(token, "getChatMember", { chat_id: chat.id, user_id: bot.id });
  if (member.status !== "administrator") throw new SetupError(`@${bot.username} isn't an admin of "${chat.title}"`);
  const missing = [
    !member.can_post_messages && "post messages",
    !member.can_delete_messages && "delete messages of others",
  ].filter(Boolean);
  if (missing.length) throw new SetupError(`@${bot.username} needs these admin rights in "${chat.title}": ${missing.join(", ")}`);

  if (current && (await libraryHasFiles(env.DB))) {
    const sameBot = current.botToken.split(":")[0] === String(bot.id);
    if (!sameBot || current.channelId !== String(chat.id)) {
      throw new SetupError("Songs are already stored with the current bot and channel — those can't be switched");
    }
  }
  await putSettings(env.DB, {
    bot_token: token,
    channel_id: String(chat.id),
    bot_username: bot.username,
    channel_title: chat.title ?? "",
  });
  return setupStatus(env);
}

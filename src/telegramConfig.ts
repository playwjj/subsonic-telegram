// Which bot and channel files go to. Either TG_BOT_TOKEN / TG_CHANNEL_ID
// secrets (always win when both are set), or what the web UI's setup page
// saved in D1's settings table (src/subsonic/telegramSetup.ts).
import type { Env } from "./types";
import type { DeleteFilesResult, FileCheck, SourceStorage } from "./storage/types";

export interface TelegramConfig {
  botToken: string;
  channelId: string;
  source: "env" | "setup";
}

// The saved setup only changes from the setup page, and not at all once
// songs were uploaded with it — so this isolate rereads it once a minute
// rather than on every request.
const SETTINGS_TTL_MS = 60_000;
let saved: { at: number; config: TelegramConfig | null } | undefined;

export async function getTelegramConfig(env: Env): Promise<TelegramConfig | null> {
  if (env.TG_BOT_TOKEN && env.TG_CHANNEL_ID) {
    return { botToken: env.TG_BOT_TOKEN, channelId: env.TG_CHANNEL_ID, source: "env" };
  }
  if (saved && Date.now() - saved.at < SETTINGS_TTL_MS) return saved.config;
  const settings = await getSettings(env.DB, ["bot_token", "channel_id"]);
  const config =
    settings.bot_token && settings.channel_id
      ? { botToken: settings.bot_token, channelId: settings.channel_id, source: "setup" as const }
      : null;
  // Not cached while unset: the first save should take effect right away.
  if (config) saved = { at: Date.now(), config };
  return config;
}

export function forgetTelegramConfig(): void {
  saved = undefined;
}

export async function getSettings(db: D1Database, keys: string[]): Promise<Record<string, string>> {
  try {
    const { results } = await db
      .prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => "?").join(",")})`)
      .bind(...keys)
      .all<{ key: string; value: string }>();
    return Object.fromEntries(results.map((r) => [r.key, r.value]));
  } catch {
    // No settings table yet (schema not migrated): nothing was saved.
    return {};
  }
}

export async function putSettings(db: D1Database, values: Record<string, string>): Promise<void> {
  await db.batch(
    Object.entries(values).map(([key, value]) =>
      db
        .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
        .bind(key, value),
    ),
  );
  forgetTelegramConfig();
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("Telegram storage isn't set up yet — finish setup in the web UI first");
  }
}

// Stands in for TelegramStorage until there's a bot and channel: browsing
// the (empty) library works, anything touching files says what's missing.
export class UnconfiguredStorage implements SourceStorage {
  private fail(): never {
    throw new StorageNotConfiguredError();
  }
  async putFile(): Promise<string> {
    this.fail();
  }
  async getFileResponse(): Promise<Response> {
    this.fail();
  }
  async getFileBytes(): Promise<{ bytes: Uint8Array; contentType: string }> {
    this.fail();
  }
  async deleteFile(): Promise<void> {
    this.fail();
  }
  async deleteFiles(refs: string[]): Promise<DeleteFilesResult> {
    return { failed: refs, error: new StorageNotConfiguredError().message };
  }
  async checkFile(): Promise<FileCheck> {
    return { ok: false, error: new StorageNotConfiguredError().message };
  }
}

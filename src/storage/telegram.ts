import type { StorageBackend } from "./types";
import { parseRange, rangeHeaders } from "./range";

interface TelegramRef {
  messageId: number;
  fileId: string;
}

// Files must stay under Telegram Bot API's hard limits: 50MB upload via
// sendDocument, 20MB download via getFile. No chunking here — if a file
// exceeds that, putFile() throws and the caller (import script) skips it.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export class TelegramStorage implements StorageBackend {
  constructor(
    private botToken: string,
    private channelId: string,
  ) {}

  private api(method: string): string {
    return `https://api.telegram.org/bot${this.botToken}/${method}`;
  }

  async putFile(bytes: Uint8Array, filename: string, mimeType: string): Promise<string> {
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error(`File exceeds Telegram Bot API upload limit (${MAX_UPLOAD_BYTES} bytes): ${filename}`);
    }
    const form = new FormData();
    form.set("chat_id", this.channelId);
    form.set("document", new Blob([bytes], { type: mimeType }), filename);

    const res = await fetch(this.api("sendDocument"), { method: "POST", body: form });
    const data = (await res.json()) as any;
    if (!data.ok) {
      throw new Error(`Telegram sendDocument failed: ${JSON.stringify(data)}`);
    }
    const message = data.result;
    const fileId: string | undefined = message.document?.file_id ?? message.audio?.file_id;
    if (!fileId) {
      throw new Error(`Telegram response missing file_id for ${filename}`);
    }
    const ref: TelegramRef = { messageId: message.message_id, fileId };
    return JSON.stringify(ref);
  }

  // Fetches the whole file's bytes from Telegram, bypassing Range entirely.
  // Used both by getFileResponse below and by CachedStorage (cached.ts),
  // which needs the full bytes once to populate its R2 cache and then slices
  // ranges out of that cached copy itself instead of calling this again.
  async getFileBytes(refStr: string, contentType?: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const ref = JSON.parse(refStr) as TelegramRef;

    const getFileRes = await fetch(this.api(`getFile?file_id=${encodeURIComponent(ref.fileId)}`));
    const getFileData = (await getFileRes.json()) as any;
    if (!getFileData.ok) {
      throw new Error(`Telegram getFile failed: ${JSON.stringify(getFileData)}`);
    }
    const filePath = getFileData.result.file_path as string;
    const fileUrl = `https://api.telegram.org/file/bot${this.botToken}/${filePath}`;

    const upstream = await fetch(fileUrl);
    if (!upstream.ok) {
      throw new Error(`Telegram file fetch failed: ${upstream.status}`);
    }
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    const resolvedType = contentType ?? upstream.headers.get("content-type") ?? "application/octet-stream";
    return { bytes, contentType: resolvedType };
  }

  async getFileResponse(refStr: string, rangeHeader: string | null, contentType?: string): Promise<Response> {
    // Telegram's file CDN doesn't reliably honor Range requests -- it can
    // silently ignore the header and return the whole file with a 200. If we
    // just forwarded that through, a player asking for bytes at some offset
    // would instead get the file from byte 0 while believing it got the
    // range it asked for, producing misaligned/unparsable audio. So we always
    // fetch the full file ourselves and slice out the requested range,
    // never depending on Telegram to do it correctly.
    let bytes: Uint8Array;
    let resolvedType: string;
    try {
      ({ bytes, contentType: resolvedType } = await this.getFileBytes(refStr, contentType));
    } catch (err) {
      return new Response(err instanceof Error ? err.message : String(err), { status: 502 });
    }

    const range = parseRange(bytes.byteLength, rangeHeader);
    const body = range ? bytes.slice(range.start, range.end + 1) : bytes;
    const headers = rangeHeaders(resolvedType, bytes.byteLength, range);
    return new Response(body, { status: range ? 206 : 200, headers });
  }

  // Requires the bot to hold the channel's "Delete messages" admin right.
  // Callers should treat failure here as non-fatal (log and move on) rather
  // than blocking a D1 delete on it — same tolerance this project already
  // has for other "wasted" Telegram messages (see the import script's docs).
  async deleteFile(refStr: string): Promise<void> {
    const ref = JSON.parse(refStr) as TelegramRef;
    const res = await fetch(this.api("deleteMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: this.channelId, message_id: ref.messageId }),
    });
    const data = (await res.json()) as any;
    if (!data.ok) {
      throw new Error(`Telegram deleteMessage failed: ${JSON.stringify(data)}`);
    }
  }
}

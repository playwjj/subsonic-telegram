import type { StorageBackend } from "./types";

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

  async getFileResponse(refStr: string, rangeHeader: string | null): Promise<Response> {
    const ref = JSON.parse(refStr) as TelegramRef;

    const getFileRes = await fetch(this.api(`getFile?file_id=${encodeURIComponent(ref.fileId)}`));
    const getFileData = (await getFileRes.json()) as any;
    if (!getFileData.ok) {
      return new Response(`Telegram getFile failed: ${JSON.stringify(getFileData)}`, { status: 502 });
    }
    const filePath = getFileData.result.file_path as string;
    const fileUrl = `https://api.telegram.org/file/bot${this.botToken}/${filePath}`;

    const upstreamHeaders: HeadersInit = {};
    if (rangeHeader) upstreamHeaders["Range"] = rangeHeader;

    const upstream = await fetch(fileUrl, { headers: upstreamHeaders });

    const outHeaders = new Headers();
    for (const key of ["content-type", "content-length", "content-range"]) {
      const v = upstream.headers.get(key);
      if (v) outHeaders.set(key, v);
    }
    outHeaders.set("accept-ranges", "bytes");

    return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
  }
}

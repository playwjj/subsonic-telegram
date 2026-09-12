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

  async getFileResponse(refStr: string, rangeHeader: string | null, contentType?: string): Promise<Response> {
    const ref = JSON.parse(refStr) as TelegramRef;

    const getFileRes = await fetch(this.api(`getFile?file_id=${encodeURIComponent(ref.fileId)}`));
    const getFileData = (await getFileRes.json()) as any;
    if (!getFileData.ok) {
      return new Response(`Telegram getFile failed: ${JSON.stringify(getFileData)}`, { status: 502 });
    }
    const filePath = getFileData.result.file_path as string;
    const fileUrl = `https://api.telegram.org/file/bot${this.botToken}/${filePath}`;

    // Telegram's file CDN doesn't reliably honor Range requests -- it can
    // silently ignore the header and return the whole file with a 200. If we
    // just forwarded that through, a player asking for bytes at some offset
    // would instead get the file from byte 0 while believing it got the
    // range it asked for, producing misaligned/unparsable audio. So we always
    // fetch the full file ourselves and slice out the requested range,
    // never depending on Telegram to do it correctly.
    const upstream = await fetch(fileUrl);
    if (!upstream.ok) {
      return new Response(`Telegram file fetch failed: ${upstream.status}`, { status: 502 });
    }
    const body = new Uint8Array(await upstream.arrayBuffer());
    const total = body.byteLength;
    const resolvedType = contentType ?? upstream.headers.get("content-type") ?? "application/octet-stream";

    const outHeaders = new Headers();
    outHeaders.set("content-type", resolvedType);
    outHeaders.set("accept-ranges", "bytes");

    const range = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader) : null;
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : total - Number(range[2]);
      const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
      const slice = body.slice(start, end + 1);
      outHeaders.set("content-length", String(slice.byteLength));
      outHeaders.set("content-range", `bytes ${start}-${end}/${total}`);
      return new Response(slice, { status: 206, headers: outHeaders });
    }

    outHeaders.set("content-length", String(total));
    return new Response(body, { status: 200, headers: outHeaders });
  }
}

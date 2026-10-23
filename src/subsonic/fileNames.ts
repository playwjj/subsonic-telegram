// Reads artist and title out of a messy file name ("01.周杰伦-晴天[320k]",
// "Karma Police - Radiohead (Remastered) www.xx.com") with Workers AI, for
// files without tags. The model only splits text, it isn't asked for facts:
// whatever it returns must appear in the file/folder name it was given (a
// translated, corrected or made-up name is dropped), and callers still
// confirm the result with an online match before using it.
import { normalize } from "./online";
import { MetadataError } from "./metadata";

// Fast mixture-of-experts model that handles Chinese/Japanese names well.
const MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";

const SYSTEM_PROMPT = `You split music file names into artist and song title.
Reply with JSON only, no explanation: {"artist": string or null, "title": string or null}
Rules:
- Copy the text exactly as it appears in the input. Never translate, correct spelling, or convert between traditional and simplified Chinese.
- Remove track numbers, file extensions, bitrate/quality tags ([320k], FLAC, 无损), and website names from the title.
- Keep version markers that belong to the song, like (Live), (Remix), (伴奏), in the title.
- The folder may name the artist (e.g. "周杰伦/叶惠美") when the file name doesn't.
- If the input doesn't contain an artist, artist is null. Never guess one from your own knowledge.`;

export interface ParsedName {
  artist?: string;
  title?: string;
}

// The first {...} in the reply (Qwen3 may think out loud first).
function jsonIn(reply: unknown): Record<string, unknown> | null {
  if (reply && typeof reply === "object") return reply as Record<string, unknown>;
  if (typeof reply !== "string") return null;
  const text = reply.replace(/<think>[\s\S]*?<\/think>/g, "");
  const m = /\{[\s\S]*?\}/.exec(text);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

export async function parseFileName(ai: Ai | undefined, fileName: string, folder = ""): Promise<ParsedName> {
  if (!ai) throw new MetadataError("Workers AI isn't set up for this server (see wrangler.toml)");
  // The last two folder levels are the ones that name an artist/album.
  const context = folder.split("/").filter(Boolean).slice(-2).join("/");
  let reply: unknown;
  try {
    const result = (await ai.run(MODEL as Parameters<Ai["run"]>[0], {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `File name: ${fileName}\nFolder: ${context || "(none)"}\n/no_think` },
      ],
      max_tokens: 200,
      temperature: 0,
    })) as { response?: unknown };
    reply = result.response;
  } catch (err) {
    throw new MetadataError(`Workers AI failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const json = jsonIn(reply);
  const source = normalize(`${fileName} ${context}`);
  // Only what's really in the name.
  const keep = (v: unknown) => {
    if (typeof v !== "string") return undefined;
    const value = v.trim();
    const n = normalize(value);
    return n && source.includes(n) ? value : undefined;
  };
  const artist = keep(json?.artist);
  const title = keep(json?.title);
  return { artist: artist && artist !== title ? artist : undefined, title };
}

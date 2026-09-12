import { md5Hex, hexDecodeUtf8 } from "./md5";
import type { Env } from "./types";

export type AuthResult = { ok: true; username: string } | { ok: false; code: number; message: string };

// Subsonic legacy auth: either token+salt (t = md5(password + salt)) or a
// plain/obfuscated password (p, optionally "enc:<hex>"). Both require the
// server to know the plaintext password, so the single account's credentials
// live in AUTH_USERNAME/AUTH_PASSWORD Worker secrets rather than D1 — this is
// meant for single-user/personal deployments only.
export async function authenticate(env: Env, params: URLSearchParams): Promise<AuthResult> {
  const username = params.get("u");
  if (!username) return { ok: false, code: 10, message: "Required parameter 'u' is missing" };
  if (username !== env.AUTH_USERNAME) return { ok: false, code: 40, message: "Wrong username or password" };

  const password = env.AUTH_PASSWORD;

  const token = params.get("t");
  const salt = params.get("s");
  if (token && salt) {
    const expected = md5Hex(password + salt);
    if (expected === token.toLowerCase()) return { ok: true, username };
    return { ok: false, code: 40, message: "Wrong username or password" };
  }

  const p = params.get("p");
  if (p) {
    const plain = p.startsWith("enc:") ? hexDecodeUtf8(p.slice(4)) : p;
    if (plain === password) return { ok: true, username };
    return { ok: false, code: 40, message: "Wrong username or password" };
  }

  return { ok: false, code: 10, message: "Required parameter 't'/'s' or 'p' is missing" };
}

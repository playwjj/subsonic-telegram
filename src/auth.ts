import { md5Hex, hexDecodeUtf8 } from "./md5";
import { getUserPassword } from "./db/queries";

export type AuthResult = { ok: true; username: string } | { ok: false; code: number; message: string };

// Subsonic legacy auth: either token+salt (t = md5(password + salt)) or a
// plain/obfuscated password (p, optionally "enc:<hex>"). Both require the
// server to know the plaintext password, so it's stored as-is in D1 — this
// is meant for single-user/personal deployments only.
export async function authenticate(db: D1Database, params: URLSearchParams): Promise<AuthResult> {
  const username = params.get("u");
  if (!username) return { ok: false, code: 10, message: "Required parameter 'u' is missing" };

  const password = await getUserPassword(db, username);
  if (password === null) return { ok: false, code: 40, message: "Wrong username or password" };

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
